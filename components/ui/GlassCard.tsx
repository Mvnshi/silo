/**
 * GlassCard — the original blur surface, now a thin adapter over `Glass`.
 *
 * Kept so the existing call sites don't have to change, and so they pick up
 * real Liquid Glass on iOS 26 for free. New code should import `Glass`
 * directly — it exposes the variant / interactive / tintColor controls this
 * doesn't.
 *
 * `tint` defaults to the app appearance (`glassTint`), so chrome sitting on the
 * page follows light/dark on its own. Pass `tint` explicitly ONLY when the
 * ground underneath is fixed regardless of appearance — the Streams overlays
 * and the Toast are always over media / always dark, so they pin `tint="dark"`.
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Glass from './Glass';
import { RADIUS } from '@/lib/theme';

interface Props {
  /** Omit to follow the app appearance; pass to pin the glass to a fixed ground. */
  tint?: 'light' | 'dark';
  /** Blur strength 0–100 on the pre-iOS-26 path. ~35 reads as chrome, ~60 as a sheet. */
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
  return (
    <Glass tint={tint} intensity={intensity} radius={radius} style={style}>
      {children}
    </Glass>
  );
}
