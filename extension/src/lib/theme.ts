/**
 * Design tokens — the single place raw style values live for the extension UI.
 *
 * MIRRORS the phone app's `lib/theme.ts` (BRAND / INK / ACCENT / RADIUS / GRADIENTS).
 * Hex values are byte-identical to the phone so the products read as one. The
 * Reanimated SPRING preset is intentionally omitted (extension uses CSS transitions).
 *
 * Rules of thumb:
 * - NEVER hardcode `#007AFF` or ad-hoc grays (`#333`, `#999`) in popup/content
 *   screens — use BRAND / INK so the popup matches the phone.
 * - Light surfaces use HAIRLINE for borders; dark/glass surfaces HAIRLINE_DARK.
 */

/** Violet brand scale. 600 is the primary action color. */
export const BRAND = {
  50: '#f5f3ff',
  100: '#ede9fe',
  200: '#ddd6fe',
  300: '#c4b5fd',
  400: '#a78bfa',
  500: '#8b5cf6',
  600: '#7c3aed',
  700: '#6d28d9',
  800: '#5b21b6',
  900: '#4c1d95',
  950: '#2e1065',
} as const;

/** Pink accent scale — sparingly, for highlights. */
export const ACCENT = {
  400: '#f472b6',
  500: '#ec4899',
  600: '#db2777',
} as const;

/** Neutral "ink" scale (slate-based). 900 = primary text. */
export const INK = {
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
} as const;

/** 1px-feel borders. HAIRLINE for light surfaces, HAIRLINE_DARK for glass. */
export const HAIRLINE = 'rgba(15, 23, 42, 0.08)';
export const HAIRLINE_DARK = 'rgba(255, 255, 255, 0.14)';

/** Corner radius scale. Cards use lg/xl; chips + pills use `pill`. */
export const RADIUS = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

/** Shared gradient stops. Use as `linear-gradient(135deg, …)` in CSS. */
export const GRADIENTS = {
  /** Primary CTA / brand surfaces. */
  brand: ['#8b5cf6', '#6366f1'] as const,
  /** Celebration / accent moments. */
  accent: ['#ec4899', '#8b5cf6'] as const,
  /** Soft page background used by the light screens. */
  page: ['#EEF2FF', '#F5F3FF', '#FAF5FF'] as const,
};
