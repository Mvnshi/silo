/**
 * PressableScale — the app's standard touchable.
 *
 * A Pressable that springs to ~0.97 scale on press-in and settles back on
 * release, with optional haptic feedback. Use this instead of TouchableOpacity
 * for buttons/cards so every press in the app feels identical (same spring,
 * same haptic vocabulary). Purely additive: all Pressable props pass through.
 */
import React from 'react';
import { Pressable, ViewStyle, StyleProp, PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SPRING } from '@/lib/theme';

interface Props extends Omit<PressableProps, 'style'> {
  /** Style applied to the animated wrapper (layout + visuals live here). */
  style?: StyleProp<ViewStyle>;
  /** NativeWind classes for the animated wrapper. */
  className?: string;
  /** Haptic on press-in. 'selection' for chips/toggles, 'light' for buttons. */
  haptic?: 'selection' | 'light' | 'medium' | 'none';
  /** Scale target while pressed. */
  scaleTo?: number;
  children?: React.ReactNode;
}

export default function PressableScale({
  style,
  className,
  haptic = 'none',
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, SPRING.press);
        if (haptic === 'selection') Haptics.selectionAsync();
        else if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        else if (haptic === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, SPRING.settle);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[aStyle, style]} className={className}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
