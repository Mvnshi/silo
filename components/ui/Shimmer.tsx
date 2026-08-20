/**
 * Shimmer — a highlight that sweeps, for surfaces that are busy.
 *
 * This is the one Magic UI idea worth having natively. Magic UI itself is React
 * DOM (Tailwind + Framer Motion) and cannot run here, and most of its catalogue
 * would be decoration in this app — so rather than port it, two effects are
 * rebuilt on the primitives already in use (Reanimated + `lib/motion.ts` +
 * `lib/theme.ts`), and only where they carry information:
 *
 *  - `ShimmerText` for the assistant's thinking state, which is genuinely two
 *    phases (on-device retrieval, then the network) and takes long enough that
 *    a static label reads as a hang.
 *  - `ShimmerSweep` for an action card mid-apply, where a multi-row write has
 *    real latency and the user needs to see it is underway.
 *
 * Deliberately NOT ported: a typewriter reveal on the answer. The answer arrives
 * complete — there is no stream to mirror — so animating it in character by
 * character would only withhold text the user already has.
 *
 * GLASS: both effects animate colour and transform, never opacity. They are safe
 * INSIDE a glass sheet (a descendant may animate opacity; a glass view and its
 * ancestors may not), but the rule is easy to break by accident, so neither
 * touches opacity at all.
 *
 * REDUCE MOTION: both fall still and render their resting state, which is a
 * legible label / a plain surface — never an invisible one.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { TYPE } from '@/lib/theme';
import { usePrefersReducedMotion } from '@/lib/motion';
import { useThemeColors } from '@/lib/useTheme';

/** One full sweep. Slow enough to read as breathing, not as a spinner. */
const SWEEP_MS = 1600;

interface ShimmerTextProps {
  children: string;
  style?: StyleProp<TextStyle>;
  /** Announced to VoiceOver in place of the visual pulse. */
  accessibilityLabel?: string;
}

/**
 * Text whose colour breathes between the palette's tertiary and brand inks.
 *
 * Colour rather than opacity, so it never dips below the contrast floor: both
 * endpoints are real text colours from the palette, which means the label stays
 * readable at every frame of the animation.
 */
export function ShimmerText({ children, style, accessibilityLabel }: ShimmerTextProps) {
  const c = useThemeColors();
  const reduced = usePrefersReducedMotion();
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    phase.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [phase, reduced]);

  const animated = useAnimatedStyle(() => ({
    color: interpolateColor(phase.value, [0, 1], [c.textTertiary, c.textBrand]),
  }));

  return (
    <Animated.Text
      style={[styles.text, reduced ? { color: c.textTertiary } : animated, style]}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityLiveRegion="polite"
    >
      {children}
    </Animated.Text>
  );
}

interface ShimmerSweepProps {
  /** Corner radius of the surface being swept, so the highlight clips to it. */
  radius: number;
  /** Off = the surface is at rest and nothing renders. */
  active: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A band of light travelling left-to-right across the parent surface.
 *
 * Position it as an overlay inside a container with `overflow: 'hidden'`; it
 * fills the parent and ignores touches. When `active` is false it renders
 * nothing at all, so a resting card pays no cost.
 */
export function ShimmerSweep({ radius, active, style }: ShimmerSweepProps) {
  const c = useThemeColors();
  const reduced = usePrefersReducedMotion();
  const [width, setWidth] = React.useState(0);
  const travel = useSharedValue(0);

  useEffect(() => {
    if (!active || reduced || width === 0) {
      travel.value = 0;
      return;
    }
    travel.value = 0;
    travel.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [active, reduced, width, travel]);

  const animated = useAnimatedStyle(() => ({
    // Starts fully off the leading edge and ends fully off the trailing one, so
    // the band enters and leaves rather than popping mid-surface.
    transform: [{ translateX: -width + travel.value * (width * 2) }],
  }));

  // Reduce Motion gets the resting surface: no band, no residue.
  if (!active || reduced) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, { borderRadius: radius }, styles.clip, style]}
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.band, { width }, animated]}>
        <LinearGradient
          // The brand ink at low alpha — bright enough to read as light moving
          // over the surface, faint enough not to obscure the text under it.
          colors={['transparent', `${c.brand}24`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The assistant's two-phase thinking label. Retrieval is on-device and fast;
 * the model call is the slow half, so saying which one is running is the
 * difference between "working" and "stuck".
 */
export const THINKING_PHASES = ['Reading your library', 'Thinking'] as const;
export type ThinkingPhase = (typeof THINKING_PHASES)[number];

const styles = StyleSheet.create({
  text: {
    ...TYPE.footnote,
  },
  clip: {
    overflow: 'hidden',
  },
  // Width is measured, not fixed — the band is exactly as wide as the surface
  // and travels a full width past each edge, so it enters and leaves cleanly.
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
