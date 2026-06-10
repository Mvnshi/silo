/**
 * GlassCard — a real blurred-glass surface (expo-blur) with the hairline
 * border treatment, for floating bars, sheets, and overlay chrome.
 *
 * Use `tint="light"` over light content and `tint="dark"` over media/dark
 * feeds (e.g. the Streams overlay). BlurView requires `overflow: 'hidden'`
 * for rounded corners — handled here.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { HAIRLINE, HAIRLINE_DARK, RADIUS } from '@/lib/theme';

interface Props {
  tint?: 'light' | 'dark';
  /** Blur strength 0–100. ~35 reads as chrome, ~60 as a sheet. */
  intensity?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export default function GlassCard({
  tint = 'light',
  intensity = 40,
  radius = RADIUS.lg,
  style,
  children,
}: Props) {
  return (
    <BlurView
      tint={tint === 'dark' ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
      intensity={intensity}
      style={[
        {
          borderRadius: radius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: tint === 'dark' ? HAIRLINE_DARK : HAIRLINE,
        },
        style,
      ]}
    >
      {children}
    </BlurView>
  );
}
