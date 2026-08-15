/**
 * Skeleton — shimmer loading placeholder.
 *
 * Replaces full-screen ActivityIndicators with content-shaped placeholders so
 * loads feel faster (perceived performance). Render a few of these in the
 * shape of the list/card being loaded.
 *
 * Colours default to the appearance palette, so callers on ordinary app
 * surfaces never pass them. Only surfaces that are fixed-dark regardless of
 * appearance (the Streams feed) need to override.
 */
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { RADIUS } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

interface Props {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  /**
   * Block colour. Defaults to the palette's field surface — override only for
   * a ground the palette doesn't describe (e.g. `rgba(255,255,255,0.08)` over
   * media on the Streams feed).
   */
  color?: string;
  /** Sweep highlight colour, to match `color`'s surface. */
  sweepColor?: string;
  style?: StyleProp<ViewStyle>;
}

export default function Skeleton({
  width = '100%',
  height = 16,
  radius = RADIUS.sm,
  color,
  sweepColor,
  style,
}: Props) {
  const c = useThemeColors();
  const block = color ?? c.field;
  // A near-opaque white sweep reads as a highlight on the light field but as a
  // flashbulb on the dark one, so dark drops to a low-alpha wash instead.
  const sweepFill =
    sweepColor ?? (c.appearance === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.8)');

  // Sweep a soft highlight across the block on a loop.
  const sweep = useSharedValue(-1);
  useEffect(() => {
    sweep.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [sweep]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweep.value * 200 }],
  }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: block, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[{ width: '60%', height: '100%' }, aStyle]}>
        <LinearGradient
          colors={['transparent', sweepFill, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </Animated.View>
  );
}
