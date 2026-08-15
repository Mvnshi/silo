/**
 * PressableScale — the app's standard touchable.
 *
 * A Pressable that springs to ~0.97 scale on press-in and settles back on
 * release, with optional haptic feedback. Use this instead of TouchableOpacity
 * for buttons/cards so every press in the app feels identical (same spring,
 * same haptic vocabulary). Purely additive: all Pressable props pass through.
 *
 * LAYOUT NOTE: `style` lands on the inner animated wrapper, which is what you
 * want for visuals (padding, background, radius) — but layout props that the
 * *parent* must see (`flex`, `alignSelf`, absolute positioning) have no effect
 * there, because the outer Pressable is the child the parent lays out. Pass
 * those via `containerStyle`.
 *
 * Defaults `accessibilityRole` to "button" and applies a HIG-minimum hit slop,
 * so converting a raw Pressable/TouchableOpacity to this component makes the
 * control accessible and comfortably tappable without extra props.
 */
import React from 'react';
import { Pressable, ViewStyle, StyleProp, PressableProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { HIT_SLOP, SPRING } from '@/lib/theme';

interface Props extends Omit<PressableProps, 'style'> {
  /** Style applied to the animated wrapper (padding / background / radius). */
  style?: StyleProp<ViewStyle>;
  /** Style applied to the OUTER Pressable — use for `flex`, `alignSelf`, position. */
  containerStyle?: StyleProp<ViewStyle>;
  /** NativeWind classes for the animated wrapper. */
  className?: string;
  /** Haptic on press-in. 'selection' for chips/toggles, 'light' for buttons. */
  haptic?: 'selection' | 'light' | 'medium' | 'none';
  /** Scale target while pressed. Use ~0.985 for full-width rows. */
  scaleTo?: number;
  /** Toggle/segment state — surfaced to VoiceOver as `selected`. */
  selected?: boolean;
  children?: React.ReactNode;
}

export default function PressableScale({
  style,
  containerStyle,
  className,
  haptic = 'none',
  scaleTo = 0.97,
  selected,
  onPressIn,
  onPressOut,
  accessibilityRole = 'button',
  accessibilityState,
  hitSlop = HIT_SLOP,
  disabled,
  children,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      hitSlop={hitSlop}
      style={containerStyle}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, selected, ...accessibilityState }}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, SPRING.press);
        if (haptic === 'selection') Haptics.selectionAsync().catch(() => {});
        else if (haptic === 'light')
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        else if (haptic === 'medium')
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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
