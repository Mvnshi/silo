/**
 * Onboarding — first-run experience (3 swipeable slides).
 *
 * Shown once (tracked via lib/storage hasOnboarded/setOnboarded), then
 * replaced with the main tabs. Both "Skip" and "Get Started" set the flag —
 * onboarding must never be able to trap the user.
 *
 * Design: matches the app's light, violet-forward language — soft page
 * gradient, big gradient icon orb per slide, staggered text entrances,
 * animated page dots, gradient CTA.
 */
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { setOnboarded } from '@/lib/storage';
import { BRAND, INK, GRADIENTS, SPRING } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  colors: readonly [string, string];
  title: string;
  subtitle: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'albums',
    colors: ['#8b5cf6', '#6366f1'],
    title: 'Save anything',
    subtitle:
      'Share any link, reel, screenshot, or thought into Silo — from any app, in one tap.',
  },
  {
    icon: 'sparkles',
    colors: ['#ec4899', '#8b5cf6'],
    title: 'Silo organizes it',
    subtitle:
      'AI titles, tags, and files every save automatically. Your library sorts itself.',
  },
  {
    icon: 'play',
    colors: ['#6366f1', '#06b6d4'],
    title: 'Actually come back to it',
    subtitle:
      'Stream your saves like a feed, and schedule time on your calendar to act on them.',
  },
];

/** One page-indicator dot that stretches into a pill while active. */
function Dot({ active }: { active: boolean }) {
  const aStyle = useAnimatedStyle(() => ({
    width: withSpring(active ? 24 : 8, SPRING.settle),
    opacity: withSpring(active ? 1 : 0.35, SPRING.settle),
  }));
  return <Animated.View style={[styles.dot, aStyle]} />;
}

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const isLast = page === SLIDES.length - 1;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (next !== page) {
      setPage(next);
      Haptics.selectionAsync();
    }
  }

  /** Persist the flag and enter the app (used by both Skip and Get Started). */
  async function finish() {
    await setOnboarded();
    router.replace('/(tabs)');
  }

  function nextOrFinish() {
    if (isLast) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finish();
    } else {
      scrollRef.current?.scrollTo({ x: SCREEN_WIDTH * (page + 1), animated: true });
    }
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...GRADIENTS.page]} style={StyleSheet.absoluteFill} />

      {/* Skip — always available; onboarding can never trap the user. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <PressableScale haptic="selection" onPress={finish} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </PressableScale>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={slide.title} style={styles.slide}>
            <Animated.View entering={FadeInDown.delay(80).springify().damping(16)}>
              <LinearGradient
                colors={[...slide.colors]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.orb, { shadowColor: slide.colors[0] }]}
              >
                <Ionicons name={slide.icon} size={88} color="#fff" />
              </LinearGradient>
            </Animated.View>
            <Animated.Text
              entering={FadeInDown.delay(160).springify().damping(16)}
              style={styles.title}
            >
              {slide.title}
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.delay(240).springify().damping(16)}
              style={styles.subtitle}
            >
              {slide.subtitle}
            </Animated.Text>
            {i === 0 && (
              <Animated.Text
                entering={FadeInDown.delay(340).springify().damping(16)}
                style={styles.privacyNote}
              >
                Everything stays on your device.
              </Animated.Text>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Dots + CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Dot key={s.title} active={i === page} />
          ))}
        </View>
        <PressableScale haptic="light" onPress={nextOrFinish} style={styles.ctaWrap}>
          <LinearGradient
            colors={[...GRADIENTS.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>{isLast ? 'Get Started' : 'Continue'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </LinearGradient>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 24,
  },
  skip: { fontSize: 15, fontWeight: '700', color: BRAND[600] },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  orb: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 44,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: INK[900],
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: INK[500],
    textAlign: 'center',
    marginTop: 12,
  },
  privacyNote: {
    fontSize: 13,
    fontWeight: '600',
    color: BRAND[600],
    marginTop: 16,
  },
  footer: { paddingHorizontal: 24 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND[600],
  },
  ctaWrap: { width: '100%' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 17,
    borderRadius: 18,
  },
  ctaText: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
