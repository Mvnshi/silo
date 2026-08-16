/**
 * Glass — the app's one translucent surface.
 *
 * Renders Apple's real Liquid Glass (`expo-glass-effect` → `UIVisualEffectView`)
 * on iOS 26+, and falls back to the `expo-blur` treatment everywhere else. Call
 * sites never branch: they ask for a glass surface and get the best one the
 * device can draw.
 *
 * WHERE TO USE IT: floating chrome and sheets — nav bars, tab bars, action
 * sheets, toasts, modals, the auth card. Not content. Glass over a scrolling
 * list costs contrast (text sits on whatever scrolls beneath it) and GPU, and
 * Apple's own apps don't do it either.
 *
 * TWO SHARP EDGES, both handled here:
 *  1. `isLiquidGlassAvailable()` must be checked at RUNTIME, not from the iOS
 *     version — some iOS 26 betas ship without the API and calling into it
 *     crashes.
 *  2. Setting `opacity: 0` on a GlassView *or any ancestor* stops the effect
 *     rendering entirely. Animate the container's transform, or cross-fade a
 *     sibling — never the opacity of a glass subtree.
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { HAIRLINE, HAIRLINE_DARK, RADIUS } from '@/lib/theme';
import { LIQUID_GLASS } from '@/lib/glass';
import { useThemeColors } from '@/lib/useTheme';

// Re-exported so call sites can keep importing it from the component they are
// already using; the constant itself lives in lib/ so lib/motion.ts can see it.
export { LIQUID_GLASS };

export interface GlassProps {
  /**
   * Which ground this sits on. `dark` keeps a light rim + dark material over
   * media regardless of app appearance; omit it to follow the palette.
   */
  tint?: 'light' | 'dark';
  /**
   * `regular` is the default chrome material. `clear` is thinner — use it when
   * the content beneath should stay legible (a bar over a photo).
   * Fallback path maps these onto blur intensities.
   */
  variant?: 'regular' | 'clear';
  /** Blur strength for the fallback path only. Ignored under Liquid Glass. */
  intensity?: number;
  radius?: number;
  /** Tints the glass itself. Keep it subtle — glass is a material, not a fill. */
  tintColor?: string;
  /**
   * Lets the glass react to touches (Apple's specular highlight). Only for
   * surfaces that are themselves a control.
   */
  interactive?: boolean;
  /** Draw the 1px rim. Off for surfaces that already have their own border. */
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export default function Glass({
  tint,
  variant = 'regular',
  intensity,
  radius = RADIUS.lg,
  tintColor,
  interactive = false,
  bordered = true,
  style,
  children,
}: GlassProps) {
  const c = useThemeColors();
  const resolvedTint = tint ?? c.glassTint;
  const isDark = resolvedTint === 'dark';

  const shell: ViewStyle = {
    borderRadius: radius,
    overflow: 'hidden',
    ...(bordered
      ? { borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? HAIRLINE_DARK : HAIRLINE }
      : null),
  };

  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle={variant}
        tintColor={tintColor}
        isInteractive={interactive}
        colorScheme={resolvedTint}
        style={[shell, style]}
      >
        {children}
      </GlassView>
    );
  }

  // Pre-iOS-26 / Android: the material we shipped before. `clear` reads thinner,
  // so it gets a lower blur to match Liquid Glass's relative weight.
  return (
    <BlurView
      tint={isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
      intensity={intensity ?? (variant === 'clear' ? 24 : 44)}
      style={[shell, style]}
    >
      {tintColor ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} /> : null}
      {children}
    </BlurView>
  );
}

/**
 * Groups sibling glass surfaces so they merge into one shape as they approach
 * each other — Apple's lensing behaviour for a cluster of controls. A plain
 * View on the fallback path, where there is nothing to merge.
 */
export function GlassGroup({
  spacing = 12,
  style,
  children,
}: {
  spacing?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  if (!LIQUID_GLASS) return <View style={style}>{children}</View>;
  // Imported lazily so the fallback path never touches the native module.
  const { GlassContainer } = require('expo-glass-effect') as typeof import('expo-glass-effect');
  return (
    <GlassContainer spacing={spacing} style={style}>
      {children}
    </GlassContainer>
  );
}
