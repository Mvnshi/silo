/**
 * Appearance — light / dark / follow-the-system, resolved once and shared.
 *
 * Screens read colours through `useThemeColors()`. Layout tokens (TYPE, SPACE,
 * RADIUS, SHADOW) never change with appearance and stay plain imports from
 * lib/theme — only colour is dynamic.
 *
 * The user's preference is persisted, so a phone left on "always light" system
 * appearance can still run Silo dark (and vice versa). `system` is the default
 * and the only value that follows `useColorScheme()`.
 *
 * NativeWind's colorScheme is kept in lockstep, so `dark:` variants in
 * className-styled components resolve to the same appearance as StyleSheet code.
 */
import { createContext, useContext } from 'react';
import { colorsFor, type Appearance, type ThemeColors } from './theme';

export type AppearancePreference = 'system' | 'light' | 'dark';

export interface ThemeContextValue {
  /** The resolved appearance actually being rendered. */
  appearance: Appearance;
  colors: ThemeColors;
  /** What the user chose — 'system' means "follow the OS". */
  preference: AppearancePreference;
  setPreference: (next: AppearancePreference) => void;
}

/**
 * Defaults to light so a component rendered outside the provider (a unit test,
 * a detached modal) still gets a complete palette rather than crashing.
 */
export const ThemeContext = createContext<ThemeContextValue>({
  appearance: 'light',
  colors: colorsFor('light'),
  preference: 'system',
  setPreference: () => {},
});

/** The full theme controller — use when you need to READ or SET the preference. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Just the palette. This is what screens want 95% of the time. */
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

/** True when the app is rendering dark, whatever the reason. */
export function useIsDark(): boolean {
  return useContext(ThemeContext).appearance === 'dark';
}
