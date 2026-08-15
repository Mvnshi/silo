/**
 * ThemeProvider — resolves the appearance and keeps every styling system on it.
 *
 * Mount once at the root, above everything that renders. It:
 *  1. reads the persisted preference (system / light / dark),
 *  2. resolves it against `useColorScheme()`,
 *  3. pushes the result into NativeWind so `dark:` classNames agree with the
 *     StyleSheet palette, and
 *  4. hands the palette down through ThemeContext.
 *
 * Until the persisted preference loads it renders with the SYSTEM appearance
 * rather than a hardcoded light default — otherwise a dark-mode user gets a
 * white flash on every cold start.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';
import { colorScheme as nativewindColorScheme } from 'nativewind';
import { colorsFor, type Appearance } from '@/lib/theme';
import {
  ThemeContext,
  type AppearancePreference,
  type ThemeContextValue,
} from '@/lib/useTheme';
import { getAppearancePreference, setAppearancePreference } from '@/lib/storage';

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');

  useEffect(() => {
    let alive = true;
    getAppearancePreference()
      .then((stored) => {
        if (alive && stored) setPreferenceState(stored);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const appearance: Appearance =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  // Keep NativeWind in lockstep so `dark:` variants and StyleSheet colours can
  // never disagree — a half-converted screen is worse than an unconverted one.
  useEffect(() => {
    nativewindColorScheme.set(appearance);
  }, [appearance]);

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next);
    setAppearancePreference(next).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ appearance, colors: colorsFor(appearance), preference, setPreference }),
    [appearance, preference, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
