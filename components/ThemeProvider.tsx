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

/**
 * Screens still reading the static light tokens rather than the palette. While
 * this list is non-empty the app pins itself to light, because a half-converted
 * dark mode (dark shell, white screen) is worse than none — see app.json's
 * matching `userInterfaceStyle`.
 *
 * When it empties: change this to `[]`, flip app.json back to "automatic", and
 * dark mode goes live with no other code change.
 */
const UNCONVERTED_SCREENS: string[] = ['app/(tabs)/calendar.tsx', 'app/item/[id].tsx'];
const DARK_READY = UNCONVERTED_SCREENS.length === 0;

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

  const resolved: Appearance =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const appearance: Appearance = DARK_READY ? resolved : 'light';

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
