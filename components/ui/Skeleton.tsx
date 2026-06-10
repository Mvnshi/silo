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
  style?: StyleProp<ViewStyle>;
}

export default function Skeleton({ width = '100%', height = 16, radius = RADIUS.sm, style }: Props) {
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
        { width, height, borderRadius: radius, backgroundColor: INK[100], overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[{ width: '60%', height: '100%' }, aStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.8)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </Animated.View>
  );
}
