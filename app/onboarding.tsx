/**
 * Onboarding — first-run experience.
 *
 * Shown once (tracked via lib/storage hasOnboarded/setOnboarded), then replaced
 * with the main tabs. Every exit path — Skip, Continue, "Allow", "Not now" —
 * ends with the flag set; onboarding must never be able to trap the user.
 *
 * ## Shape
 *
 * Three slides of promise, then two slides that do something:
 *
 *   1–3  what Silo is: save · organize · come back to it
 *   4    **Pick what you want to stop losing.** Not a preference screen — the
 *        chips create real Stacks, so the library the user lands in has their
 *        own shape instead of being empty. An empty first screen is the single
 *        biggest predictor of a save-it-later app being deleted in week one,
 *        and the fix is not fake data (which this app deliberately never ships)
 *        but structure the user chose.
 *   5    **Permissions, with the reason on screen.** Calendar AND notifications,
 *        each asked beside the thing it enables. Silo's whole resurfacing loop
 *        is delivered by local notifications, so a cold prompt later — or none
 *        at all — quietly breaks the product's core promise. Asking here, in
 *        context, is the single highest-yield thing in this file.
 *
 * ## Handoff
 *
 * Onboarding hands to the trial offer, then to sign-in, then to the app. Each
 * link is independently skippable, and each is skipped entirely when its
 * feature is unconfigured — so a fresh clone still runs onboarding → tabs.
 *
 * ## Motion
 *
 * All slides mount at t=0 inside one paging ScrollView, so entrance animations
 * would only ever be seen on slide 1. Instead the orb and copy are driven from
 * the live scroll offset (`scrollX`), which also feeds the page dots so they
 * stretch *with* the swipe rather than snapping after it. Only slide 1 gets a
 * real entrance, since it is the one on screen at mount.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView,
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
import { addStack, setOnboarded } from '@/lib/storage';
import { newId } from '@/lib/items';
import { isAuthConfigured } from '@/lib/auth';
import { isBillingAvailable } from '@/lib/billing';
import { requestCalendarPermissions } from '@/lib/scheduler';
import { requestNotificationPermission } from '@/lib/notifications';
import { enterHero, enterList, usePrefersReducedMotion } from '@/lib/motion';
import {
  ACCENT,
  BRAND,
  GRADIENTS,
  MAX_DISPLAY_SCALE,
  RADIUS,
  SHADOW,
  SPACE,
  TEXT,
  TYPE,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

const ORB_SIZE = 200;
const ORB_ICON = 88;
/** The interactive slides need the vertical room, so their orb gives it up. */
const ORB_SIZE_COMPACT = 108;
const ORB_ICON_COMPACT = 46;

/**
 * What a new user can say they want to stop losing.
 *
 * Every entry maps onto a real category from `CLASSIFICATIONS` — this is the
 * vocabulary the classifier already uses, not a parallel one invented for
 * onboarding, so a stack created here is the stack items actually land in.
 */
const INTERESTS: {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}[] = [
  { key: 'recipe', label: 'Recipes', icon: 'restaurant', color: ACCENT[500] },
  { key: 'place', label: 'Places to go', icon: 'location', color: BRAND[500] },
  { key: 'video', label: 'Videos', icon: 'play-circle', color: BRAND[600] },
  { key: 'article', label: 'Things to read', icon: 'book', color: BRAND[400] },
  { key: 'fitness', label: 'Workouts', icon: 'barbell', color: ACCENT[400] },
  { key: 'product', label: 'Things to buy', icon: 'pricetag', color: BRAND[700] },
  { key: 'idea', label: 'Ideas', icon: 'bulb', color: ACCENT[600] },
  { key: 'career', label: 'Career', icon: 'briefcase', color: BRAND[800] },
];

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  colors: readonly [string, string];
  title: string;
  subtitle: string;
  /** Reassurance line under the copy. */
  note?: string;
  /** Renders the interest chips. */
  pick?: boolean;
  /** Renders the permission-priming actions instead of the footer CTA. */
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
      'Stream your saves like a feed, and Silo brings the good ones back when you can act on them.',
  },
  {
    icon: 'grid',
    colors: [BRAND[500], ACCENT[500]],
    title: 'What do you keep losing?',
    subtitle: 'Pick a few and Silo sets up stacks for them. You can change these any time.',
    pick: true,
  },
  {
    icon: 'calendar',
    colors: [ACCENT[400], BRAND[600]],
    title: 'Two things, and you’re set',
    subtitle:
      'Silo works best when it can find you a slot and tap you on the shoulder. Both are optional.',
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

/** A single interest chip. Selection is the whole interaction, so it has weight. */
function InterestChip({
  interest,
  selected,
  onToggle,
}: {
  interest: (typeof INTERESTS)[number];
  selected: boolean;
  onToggle: () => void;
}) {
  const c = useThemeColors();
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.94}
      selected={selected}
      onPress={onToggle}
      accessibilityLabel={interest.label}
      style={[
        styles.chip,
        { backgroundColor: c.card, borderColor: c.hairline },
        selected && { backgroundColor: interest.color, borderColor: interest.color },
      ]}
    >
      <Ionicons
        name={interest.icon}
        size={16}
        color={selected ? TEXT.inverse : interest.color}
      />
      <Text style={[styles.chipText, { color: selected ? TEXT.inverse : c.text }]}>
        {interest.label}
      </Text>
    </PressableScale>
  );
}

/** One permission ask, with the reason beside it rather than in a cold prompt. */
function PermissionRow({
  icon,
  title,
  why,
  granted,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  why: string;
  granted: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <PressableScale
      haptic="light"
      scaleTo={0.985}
      disabled={granted}
      onPress={onPress}
      accessibilityLabel={granted ? `${title}, allowed` : `Allow ${title}`}
      style={[
        styles.permRow,
        { backgroundColor: c.card, borderColor: granted ? c.brand : c.hairline },
      ]}
    >
      <View style={[styles.permIcon, { backgroundColor: c.brandSoft }]}>
        <Ionicons name={granted ? 'checkmark' : icon} size={18} color={c.brand} />
      </View>
      <View style={styles.permCopy}>
        <Text style={[styles.permTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.permWhy, { color: c.textSecondary }]}>{why}</Text>
      </View>
      {!granted && (
        <Text style={[styles.permAction, { color: c.textBrand }]}>Allow</Text>
      )}
    </PressableScale>
  );
}

function SlideView({
  slide,
  index,
  width,
  scrollX,
  reduced,
  selected,
  onToggleInterest,
  calendarOk,
  notifyOk,
  onAllowCalendar,
  onAllowNotifications,
  onDone,
}: {
  slide: Slide;
  index: number;
  width: number;
  scrollX: SharedValue<number>;
  reduced: boolean;
  selected: Set<string>;
  onToggleInterest: (key: string) => void;
  calendarOk: boolean;
  notifyOk: boolean;
  onAllowCalendar: () => void;
  onAllowNotifications: () => void;
  onDone: () => void;
}) {
  const c = useThemeColors();
  const compact = !!slide.pick || !!slide.prime;
  const size = compact ? ORB_SIZE_COMPACT : ORB_SIZE;

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
    // Vertically scrollable per slide: the chips and the permission rows both
    // outgrow the viewport at the accessibility text sizes, and a horizontally
    // paging container gives them nowhere to go.
    <ScrollView
      style={{ width }}
      contentContainerStyle={styles.slide}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View entering={first ? enterHero(0, reduced) : undefined}>
        <Animated.View style={orbStyle}>
          {/* The orb is a brand surface: same gradient, same white glyph, in
              both appearances. Only the copy under it follows the palette. */}
          <LinearGradient
            colors={[...slide.colors]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.orb,
              { width: size, height: size, shadowColor: slide.colors[0] },
              compact && styles.orbCompact,
            ]}
          >
            <Ionicons
              name={slide.icon}
              size={compact ? ORB_ICON_COMPACT : ORB_ICON}
              color={TEXT.inverse}
            />
          </LinearGradient>
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={styles.copyWrap}
        entering={first ? enterList(2, reduced) : undefined}
      >
        <Animated.View style={[styles.copy, copyStyle]}>
          {/* Capped per lib/theme: the subtitle and every control below scale
              freely, but an uncapped 34pt title wraps mid-word here. */}
          <Text
            style={[styles.title, { color: c.text }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_DISPLAY_SCALE}
          >
            {slide.title}
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {slide.subtitle}
          </Text>
          {!!slide.note && (
            <Text style={[styles.note, { color: c.textBrand }]}>{slide.note}</Text>
          )}

          {slide.pick && (
            <View style={styles.chips}>
              {INTERESTS.map((interest) => (
                <InterestChip
                  key={interest.key}
                  interest={interest}
                  selected={selected.has(interest.key)}
                  onToggle={() => onToggleInterest(interest.key)}
                />
              ))}
            </View>
          )}

          {slide.prime && (
            <>
              <View style={styles.perms}>
                <PermissionRow
                  icon="calendar-outline"
                  title="Calendar"
                  why="So Silo can find you a free slot and block real time. We only add events you create."
                  granted={calendarOk}
                  onPress={onAllowCalendar}
                />
                <PermissionRow
                  icon="notifications-outline"
                  title="Reminders"
                  why="So a save can come back when it's worth doing. All on-device — nothing leaves your phone."
                  granted={notifyOk}
                  onPress={onAllowNotifications}
                />
              </View>
              <PressableScale
                haptic="light"
                onPress={onDone}
                containerStyle={styles.primeButton}
                accessibilityLabel="Start using Silo"
              >
                <LinearGradient
                  colors={[...GRADIENTS.brand]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.cta}
                >
                  <Text style={styles.ctaText}>Start using Silo</Text>
                  <Ionicons name="arrow-forward" size={18} color={TEXT.inverse} />
                </LinearGradient>
              </PressableScale>
            </>
          )}
        </Animated.View>
      </Animated.View>
    </ScrollView>
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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [calendarOk, setCalendarOk] = useState(false);
  const [notifyOk, setNotifyOk] = useState(false);
  /** Stacks are created once, on whichever path leaves onboarding. */
  const seededRef = useRef(false);

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

  function toggleInterest(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Turn the picked interests into real stacks.
   *
   * This is the only thing onboarding writes to the library, and it writes
   * nothing the user did not choose — no demo items, no placeholder content.
   * Guarded so swiping back and forth can't create duplicates.
   */
  const seedStacks = useCallback(async () => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (selected.size === 0) return;
    try {
      for (const interest of INTERESTS) {
        if (!selected.has(interest.key)) continue;
        await addStack({
          id: newId('stack'),
          name: interest.label,
          color: interest.color,
          icon: interest.icon,
          item_count: 0,
          created_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      // A failed stack write must never block someone from entering the app.
      console.warn('Failed to create starter stacks:', error);
    }
  }, [selected]);

  /**
   * Enter the app without an account. Every "not now" path funnels through
   * here, so skipping is always one tap and always lands somewhere useful.
   */
  const finish = useCallback(async () => {
    await seedStacks();
    await setOnboarded();
    router.replace('/(tabs)');
  }, [router, seedStacks]);

  /**
   * Hand off to sign-in as the last housekeeping beat, rather than dropping the
   * user straight into the tabs.
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
  const continueToSignIn = useCallback(async () => {
    await seedStacks();
    if (!isAuthConfigured()) return finish();
    router.replace('/sign-in?first=1');
  }, [finish, router, seedStacks]);

  /**
   * The trial offer — a soft ask, not a wall.
   *
   * Placed here rather than on first launch because Silo's premium features act
   * on a library that, at install, is empty: the assistant has nothing to answer
   * about and there is nothing to schedule. It sits BEFORE sign-in because the
   * money ask belongs where attention is highest, and because "you're
   * subscribed — sign in so it follows you to your other devices" is a better
   * sentence than the reverse order can produce.
   *
   * Skipped entirely when this build cannot actually sell, so an unconfigured
   * clone still runs onboarding → tabs with no dead screens.
   */
  const continueToOffer = useCallback(async () => {
    await seedStacks();
    if (!isBillingAvailable()) return continueToSignIn();
    router.replace('/paywall?context=onboarding&first=1');
  }, [continueToSignIn, router, seedStacks]);

  function next() {
    scrollRef.current?.scrollTo({ x: width * (page + 1), animated: !reduced });
  }

  /**
   * Ask with the reason still on screen. We proceed either way — a denial must
   * not strand the user, and both permissions re-ask in context later.
   */
  async function allowCalendar() {
    const granted = await requestCalendarPermissions();
    setCalendarOk(granted);
    if (granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }

  async function allowNotifications() {
    const granted = await requestNotificationPermission();
    setNotifyOk(granted);
    if (granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
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
        <PressableScale haptic="selection" onPress={continueToOffer}>
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
            selected={selected}
            onToggleInterest={toggleInterest}
            calendarOk={calendarOk}
            notifyOk={notifyOk}
            onAllowCalendar={allowCalendar}
            onAllowNotifications={allowNotifications}
            onDone={continueToOffer}
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
              <Text style={styles.ctaText}>
                {SLIDES[page]?.pick && selected.size > 0
                  ? `Create ${selected.size} ${selected.size === 1 ? 'stack' : 'stacks'}`
                  : 'Continue'}
              </Text>
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
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xxl,
    paddingVertical: SPACE.xxl,
  },
  orb: {
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.xxxl,
    ...SHADOW.brandFloating,
  },
  orbCompact: { marginBottom: SPACE.xl },
  copyWrap: { alignSelf: 'stretch' },
  copy: { alignItems: 'center' },
  title: { ...TYPE.display, textAlign: 'center' },
  subtitle: {
    ...TYPE.body,
    textAlign: 'center',
    marginTop: SPACE.md,
  },
  note: { ...TYPE.footnote, marginTop: SPACE.base },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACE.sm,
    marginTop: SPACE.xl,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.base,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    ...SHADOW.hairline,
  },
  chipText: { ...TYPE.callout },

  perms: { alignSelf: 'stretch', gap: SPACE.md, marginTop: SPACE.xl },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    ...SHADOW.hairline,
  },
  permIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permCopy: { flex: 1 },
  permTitle: { ...TYPE.headline },
  permWhy: { ...TYPE.footnote, marginTop: SPACE.xxs },
  permAction: { ...TYPE.bodyStrong },

  primeButton: { alignSelf: 'stretch', marginTop: SPACE.xl },
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
