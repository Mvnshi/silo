/**
 * Skeleton — shimmer loading placeholder.
 *
 * Replaces full-screen ActivityIndicators with content-shaped placeholders so
 * loads feel faster (perceived performance). Render a few of these in the
 * shape of the list/card being loaded.
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
import { INK, RADIUS } from '@/lib/theme';

interface Props {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  /**
   * Block colour. The default is near-white and disappears on dark surfaces —
   * pass something like `rgba(255,255,255,0.08)` on the Streams feed.
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
  color = INK[100],
  sweepColor = 'rgba(255,255,255,0.8)',
  style,
}: Props) {
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
        { width, height, borderRadius: radius, backgroundColor: color, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[{ width: '60%', height: '100%' }, aStyle]}>
        <LinearGradient
          colors={['transparent', sweepColor, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </Animated.View>
  );
}
