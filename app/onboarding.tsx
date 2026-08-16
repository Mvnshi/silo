/**
 * Onboarding — first-run experience (4 swipeable slides).
 *
 * Shown once (tracked via lib/storage hasOnboarded/setOnboarded), then
 * replaced with the main tabs. Every exit path — Skip, Continue, "Allow
 * calendar access", "Not now" — sets the flag; onboarding must never be able
 * to trap the user.
 *
 * Motion: all four slides mount at t=0 inside one paging ScrollView, so
 * entrance animations would only ever be seen on slide 1. Instead the orb and
 * copy are driven from the live scroll offset (`scrollX`), which also feeds the
 * page dots so they stretch *with* the swipe rather than snapping after it.
 * Only slide 1 gets a real entrance, since it is the one on screen at mount.
 *
 * The last slide primes the calendar permission. Asking here — with the reason
 * on screen — replaces the cold prompt that used to fire from the Silo tab on
 * first load; a denial there silently broke the whole scheduling loop.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { setOnboarded } from '@/lib/storage';
import { isAuthConfigured } from '@/lib/auth';
import { requestCalendarPermissions } from '@/lib/scheduler';
import { enterHero, enterList, usePrefersReducedMotion } from '@/lib/motion';
import {
  ACCENT,
  BRAND,
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  TEXT,
  TYPE,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

const ORB_SIZE = 200;
const ORB_ICON = 88;

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  colors: readonly [string, string];
  title: string;
  subtitle: string;
  /** Reassurance line under the copy. */
  note?: string;
  /** Renders the calendar permission-priming actions instead of the footer CTA. */
  prime?: boolean;
}

const SLIDES: Slide[] = [
  {
    icon: 'albums',
    colors: GRADIENTS.brand,
    title: 'Save anything',
    subtitle:
      'Share any link, reel, screenshot, or thought into Silo — from any app, in one tap.',
    note: 'Everything stays on your device.',
  },
  {
    icon: 'sparkles',
    colors: GRADIENTS.accent,
    title: 'Silo organizes it',
    subtitle:
      'AI titles, tags, and files every save automatically. Your library sorts itself.',
  },
  {
    icon: 'play',
    colors: [BRAND[400], BRAND[700]],
    title: 'Actually come back to it',
    subtitle:
      'Stream your saves like a feed, and schedule time on your calendar to act on them.',
  },
  {
    icon: 'calendar',
    colors: [ACCENT[400], BRAND[600]],
    title: 'Put it on the calendar',
    subtitle:
      'Silo blocks real time so your saves become plans. We only add events you create.',
    prime: true,
  },
];

const LAST = SLIDES.length - 1;

/**
 * One page-indicator dot that stretches into a pill as its slide arrives.
 * Interpolated off the live scroll offset so it tracks the finger.
 */
function Dot({
  index,
  width,
  scrollX,
}: {
  index: number;
  width: number;
  scrollX: SharedValue<number>;
}) {
  const c = useThemeColors();
  const aStyle = useAnimatedStyle(() => {
    const range = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      width: interpolate(scrollX.value, range, [8, 24, 8], 'clamp'),
      opacity: interpolate(scrollX.value, range, [0.35, 1, 0.35], 'clamp'),
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: c.brand }, aStyle]} />;
}

function SlideView({
  slide,
  index,
  width,
  scrollX,
  reduced,
  onAllow,
  onDecline,
}: {
  slide: Slide;
  index: number;
  width: number;
  scrollX: SharedValue<number>;
  reduced: boolean;
  onAllow: () => void;
  onDecline: () => void;
}) {
  const c = useThemeColors();
  const orbStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: 1, transform: [{ scale: 1 }] };
    const range = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      opacity: interpolate(scrollX.value, range, [0.4, 1, 0.4], 'clamp'),
      transform: [{ scale: interpolate(scrollX.value, range, [0.78, 1, 0.78], 'clamp') }],
    };
  });

  // Copy trails the orb (larger travel) so the two layers separate as you swipe.
  const copyStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: 1, transform: [{ translateY: 0 }] };
    const range = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      opacity: interpolate(scrollX.value, range, [0, 1, 0], 'clamp'),
      transform: [{ translateY: interpolate(scrollX.value, range, [32, 0, 32], 'clamp') }],
    };
  });

  // Only the first slide is on screen at mount, so it alone gets an entrance.
  const first = index === 0;

  return (
    <View style={[styles.slide, { width }]}>
      <Animated.View entering={first ? enterHero(0, reduced) : undefined}>
        <Animated.View style={orbStyle}>
          {/* The orb is a brand surface: same gradient, same white glyph, in
              both appearances. Only the copy under it follows the palette. */}
          <LinearGradient
            colors={[...slide.colors]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.orb, { shadowColor: slide.colors[0] }]}
          >
            <Ionicons name={slide.icon} size={ORB_ICON} color={TEXT.inverse} />
          </LinearGradient>
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={styles.copyWrap}
        entering={first ? enterList(2, reduced) : undefined}
      >
        <Animated.View style={[styles.copy, copyStyle]}>
          <Text style={[styles.title, { color: c.text }]}>{slide.title}</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>{slide.subtitle}</Text>
          {!!slide.note && (
            <Text style={[styles.note, { color: c.textBrand }]}>{slide.note}</Text>
          )}

          {slide.prime && (
            <>
              <PressableScale
                haptic="light"
                onPress={onAllow}
                containerStyle={styles.primeButton}
                accessibilityLabel="Allow calendar access"
              >
                <LinearGradient
                  colors={[...GRADIENTS.brand]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.cta}
                >
                  <Ionicons name="calendar-outline" size={18} color={TEXT.inverse} />
                  <Text style={styles.ctaText}>Allow calendar access</Text>
                </LinearGradient>
              </PressableScale>
              <PressableScale
                haptic="selection"
                onPress={onDecline}
                style={styles.declineHit}
              >
                <Text style={[styles.decline, { color: c.textSecondary }]}>Not now</Text>
              </PressableScale>
            </>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();

  const scrollRef = useRef<React.ComponentRef<typeof Animated.ScrollView>>(null);
  const [page, setPage] = useState(0);
  /** Mirrors `page` for effects that must not re-run when the page changes. */
  const pageRef = useRef(0);
  const isPrime = page === LAST;

  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  // Split View / Stage Manager resizes change `width` after layout; re-anchor
  // the offset so the active slide stays centred instead of drifting mid-page.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: width * pageRef.current, animated: false });
  }, [width]);

  /** Discrete page state — dots and copy already track the finger continuously. */
  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== pageRef.current) {
      pageRef.current = next;
      setPage(next);
      Haptics.selectionAsync().catch(() => {});
    }
  }

  /**
   * Enter the app without an account. Every "not now" path funnels through
   * here, so skipping is always one tap and always lands somewhere useful.
   */
  async function finish() {
    await setOnboarded();
    router.replace('/(tabs)');
  }

  /**
   * Hand off to sign-in as the last beat, rather than dropping the user
   * straight into the tabs.
   *
   * `first=1` tells that screen it owns the end of onboarding: whichever way it
   * exits — signed in or "not now" — it marks onboarding complete and replaces
   * to the tabs. So the flag is deliberately NOT set here; setting it early
   * would let a back-swipe out of sign-in strand the user on a screen that is
   * no longer in the stack.
   *
   * When accounts aren't configured in this build there is nothing to offer, so
   * we skip the detour entirely instead of showing a dead screen.
   */
  async function continueToSignIn() {
    if (!isAuthConfigured()) return finish();
    router.replace('/sign-in?first=1');
  }

  function next() {
    scrollRef.current?.scrollTo({ x: width * (page + 1), animated: !reduced });
  }

  /**
   * Ask for calendar access with the reason still on screen. We proceed either
   * way — a denial must not strand the user on the last slide, and scheduling
   * re-asks in context later.
   */
  async function allowCalendar() {
    const granted = await requestCalendarPermissions();
    if (granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    continueToSignIn();
  }

  // The footer CTA hands off to the prime slide's own buttons: fade it out with
  // the swipe (rather than unmounting) so the footer height never jumps.
  const ctaStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, [(LAST - 1) * width, LAST * width], [1, 0], 'clamp'),
  }));

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...c.pageGradient]} style={StyleSheet.absoluteFill} />

      {/* Skip — always available; onboarding can never trap the user. */}
      <View style={[styles.topBar, { paddingTop: insets.top + SPACE.sm }]}>
        <PressableScale haptic="selection" onPress={finish}>
          <Text style={[styles.skip, { color: c.textBrand }]}>Skip</Text>
        </PressableScale>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={styles.pager}
      >
        {SLIDES.map((slide, i) => (
          <SlideView
            key={slide.title}
            slide={slide}
            index={i}
            width={width}
            scrollX={scrollX}
            reduced={reduced}
            onAllow={allowCalendar}
            onDecline={continueToSignIn}
          />
        ))}
      </Animated.ScrollView>

      {/* Dots + CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACE.xl }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Dot key={s.title} index={i} width={width} scrollX={scrollX} />
          ))}
        </View>
        <Animated.View
          style={ctaStyle}
          pointerEvents={isPrime ? 'none' : 'auto'}
          accessibilityElementsHidden={isPrime}
          importantForAccessibility={isPrime ? 'no-hide-descendants' : 'auto'}
        >
          <PressableScale
            haptic="light"
            onPress={next}
            containerStyle={styles.ctaWrap}
            accessibilityLabel="Continue"
          >
            <LinearGradient
              colors={[...GRADIENTS.brand]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color={TEXT.inverse} />
            </LinearGradient>
          </PressableScale>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pager: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: SPACE.xl,
  },
  skip: { ...TYPE.bodyStrong },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xxl,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.xxxl,
    ...SHADOW.brandFloating,
  },
  copyWrap: { alignSelf: 'stretch' },
  copy: { alignItems: 'center' },
  title: { ...TYPE.display, textAlign: 'center' },
  subtitle: {
    ...TYPE.body,
    textAlign: 'center',
    marginTop: SPACE.md,
  },
  note: { ...TYPE.footnote, marginTop: SPACE.base },
  primeButton: { alignSelf: 'stretch', marginTop: SPACE.xl },
  declineHit: { paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg },
  decline: { ...TYPE.callout },
  footer: { paddingHorizontal: SPACE.xl },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACE.sm,
    marginBottom: SPACE.lg,
  },
  dot: {
    height: 8,
    borderRadius: RADIUS.pill,
  },
  ctaWrap: { alignSelf: 'stretch' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.base,
    borderRadius: RADIUS.lg,
    ...SHADOW.brandCard,
  },
  ctaText: { ...TYPE.headline, color: TEXT.inverse },
});
