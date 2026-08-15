/**
 * GlassCard — a real blurred-glass surface (expo-blur) with the hairline
 * border treatment, for floating bars, sheets, and overlay chrome.
 *
 * `tint` defaults to the app appearance (`glassTint`), so chrome sitting on the
 * page follows light/dark on its own. Pass `tint` explicitly ONLY when the
 * ground underneath is fixed regardless of appearance — the Streams overlays
 * and the Toast are always over media / always dark, so they pin `tint="dark"`.
 *
 * BlurView requires `overflow: 'hidden'` for rounded corners — handled here.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { HAIRLINE, HAIRLINE_DARK, RADIUS } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

interface Props {
  /** Omit to follow the app appearance; pass to pin the glass to a fixed ground. */
  tint?: 'light' | 'dark';
  /** Blur strength 0–100. ~35 reads as chrome, ~60 as a sheet. */
  intensity?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export default function GlassCard({
  tint,
  intensity = 40,
  radius = RADIUS.lg,
  style,
  children,
}: Props) {
  const c = useThemeColors();
  const resolved = tint ?? c.glassTint;

  return (
    <BlurView
      tint={resolved === 'dark' ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
      intensity={intensity}
      style={[
        {
          borderRadius: radius,
          overflow: 'hidden',
          borderWidth: 1,
          // Follows the resolved tint, not the app appearance: a dark-tinted
          // card needs a light hairline even while the app renders light.
          borderColor: resolved === 'dark' ? HAIRLINE_DARK : HAIRLINE,
        },
        style,
      ]}
    >
      {children}
    </BlurView>
  );
}
