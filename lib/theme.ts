/**
 * Design tokens — the single place raw style values live for StyleSheet code.
 *
 * KEEP IN SYNC with tailwind.config.js (`brand` / `accent` / `ink` scales,
 * `borderRadius`, `fontSize`, `boxShadow`): NativeWind className styling and
 * StyleSheet styling must agree on these values or the app drifts into two
 * slightly-different palettes.
 *
 * Rules of thumb for contributors:
 * - NEVER hardcode `#007AFF` (stock iOS blue) or ad-hoc grays (`#333`, `#999`)
 *   in screens — use BRAND / INK, or better, the semantic `TEXT` / `SURFACE`
 *   roles below (they are what dark mode will flip).
 * - NEVER hand-roll a shadow object — pick a step from `SHADOW`.
 * - NEVER hand-roll a font size — pick a step from `TYPE`.
 * - Light surfaces use HAIRLINE for borders; dark/glass surfaces HAIRLINE_DARK.
 * - Spring configs live here so micro-interactions feel identical everywhere.
 */
import type { TextStyle, ViewStyle } from 'react-native';

/** Violet brand scale (mirrors tailwind `brand`). 600 is the primary action color. */
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

/** Pink accent scale (mirrors tailwind `accent`) — sparingly, for highlights. */
export const ACCENT = {
  400: '#f472b6',
  500: '#ec4899',
  600: '#db2777',
} as const;

/** Neutral "ink" scale (mirrors tailwind `ink`, slate-based). 900 = primary text. */
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

/** Status colors. Never use raw `#ef4444` / `#22c55e` in a screen. */
export const STATUS = {
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  success: '#16a34a',
  successSoft: '#f0fdf4',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  info: BRAND[600],
} as const;

/**
 * Semantic text roles — these, not raw INK steps, are what screens should use.
 *
 * Contrast against white (WCAG AA needs 4.5:1 for body text, 3:1 for large):
 *   primary   #0f172a → 17.9:1 ✓
 *   secondary #475569 →  7.5:1 ✓
 *   tertiary  #64748b →  4.8:1 ✓
 *   INK[400]  #94a3b8 →  2.6:1 ✗ — icons/dividers ONLY, never text.
 */
export const TEXT = {
  primary: INK[900],
  secondary: INK[600],
  tertiary: INK[500],
  placeholder: INK[500],
  inverse: '#ffffff',
  brand: BRAND[600],
  /** Non-text decoration only (glyphs, chevrons, dividers). */
  decorative: INK[400],
} as const;

/** Surface roles for cards, sheets, and page backgrounds. */
export const SURFACE = {
  card: '#ffffff',
  raised: '#ffffff',
  sunken: INK[50],
  field: INK[100],
  page: '#F5F3FF',
  scrim: 'rgba(15, 23, 42, 0.45)',
  /** Over media / dark feeds. */
  darkCard: 'rgba(20, 20, 26, 0.72)',
} as const;

/** 1px-feel borders. Light surfaces / dark+glass surfaces. */
export const HAIRLINE = 'rgba(15, 23, 42, 0.08)';
export const HAIRLINE_DARK = 'rgba(255, 255, 255, 0.14)';

/** Corner radius scale. Cards use lg/xl; chips + pills use `pill`. */
export const RADIUS = { xs: 6, sm: 10, md: 14, lg: 20, xl: 26, xxl: 32, pill: 999 } as const;

/**
 * Spacing scale (4pt grid with a 2 and 6 for tight optical fixes).
 * Use `SPACE.md` etc. instead of writing `16` — it keeps rhythm consistent.
 */
export const SPACE = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
} as const;

/**
 * Type scale. Every step carries its own line-height and optical letter-spacing
 * (tight tracking on display sizes, neutral on body) so text blocks always sit
 * on the same vertical rhythm.
 */
export const TYPE = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  title3: { fontSize: 19, lineHeight: 25, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400', letterSpacing: -0.1 },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600', letterSpacing: -0.1 },
  callout: { fontSize: 15, lineHeight: 21, fontWeight: '500', letterSpacing: -0.1 },
  subhead: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.1 },
  /** ALL-CAPS micro label (pills, section eyebrows). */
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '800', letterSpacing: 0.6 },
} as const satisfies Record<string, TextStyle>;

/**
 * Elevation scale. One shadow vocabulary for the whole app — `SHADOW.card`
 * on resting surfaces, `SHADOW.floating` on things that hover over content,
 * `SHADOW.brand*` when the shadow should pick up the violet.
 */
export const SHADOW = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  hairline: {
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  raised: {
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 6,
  },
  floating: {
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 30,
    elevation: 12,
  },
  brandCard: {
    shadowColor: BRAND[600],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 5,
  },
  brandFloating: {
    shadowColor: BRAND[600],
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 26,
    elevation: 10,
  },
} as const satisfies Record<string, ViewStyle>;

/**
 * Reanimated spring presets so every press/settle feels the same.
 * Usage: `withSpring(0.97, SPRING.press)` / `withSpring(1, SPRING.settle)`.
 *
 * `press`  — instant, barely-there give on touch-down.
 * `settle` — the release; slightly looser so it reads as elastic, not rigid.
 * `enter`  — list/card entrances; overshoots a hair for life.
 * `snappy` — layout moves that must feel decisive (sheets, segment pills).
 * `gentle` — long travel (sheet dismiss, hero transitions).
 */
export const SPRING = {
  press: { damping: 18, stiffness: 220 },
  settle: { damping: 14, stiffness: 180 },
  enter: { damping: 16, stiffness: 160, mass: 0.9 },
  snappy: { damping: 20, stiffness: 300 },
  gentle: { damping: 22, stiffness: 120 },
} as const;

/** Timing durations (ms) for `withTiming`. Keep transitions under ~350ms. */
export const DURATION = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 340,
  /** Toast/snackbar dwell time before auto-dismiss. */
  toast: 4000,
} as const;

/** Per-item delay for staggered list entrances, capped so long lists don't crawl. */
export const STAGGER = { step: 45, max: 8 } as const;

/** Shared gradient pairs (LinearGradient `colors`). */
export const GRADIENTS = {
  /** Primary CTA / brand surfaces. */
  brand: ['#8b5cf6', '#6366f1'] as const,
  /** Celebration / accent moments. */
  accent: ['#ec4899', '#8b5cf6'] as const,
  /** Soft page background used by the light screens. */
  page: ['#EEF2FF', '#F5F3FF', '#FAF5FF'] as const,
  /** Header wash — sits above `page`, one shade deeper so the chrome separates. */
  header: ['#E9E3FF', '#F1ECFF'] as const,
  /** Bottom-up scrim for legible text over media (Streams). */
  mediaScrim: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)'] as const,
  /** Top-down scrim so the status bar stays readable over media. */
  topScrim: ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0)'] as const,
};

/** Minimum comfortable tap target (Apple HIG). Use with `hitSlop` on small icons. */
export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;
export const MIN_TAP = 44;

/**
 * Cap for Dynamic Type on LARGE DISPLAY TEXT ONLY — a screen title, a hero
 * greeting, a number in a stat tile.
 *
 * Body copy must scale without limit; that is the whole point of Dynamic Type
 * and capping it would be an accessibility regression. But a 28pt title at the
 * accessibility sizes becomes ~70pt, which on a header row shoves the controls
 * beside it off the screen entirely — the text gets bigger and the buttons
 * become unreachable, which helps nobody. Apple caps its own large titles for
 * the same reason.
 *
 * Pass as `maxFontSizeMultiplier={MAX_DISPLAY_SCALE}`, and only on text that is
 * a heading. Never on a label, a description, or anything a user has to read to
 * operate the app.
 */
export const MAX_DISPLAY_SCALE = 1.6;

/* ---------------------------------------------------------------------------
 * Appearance
 *
 * `TEXT` / `SURFACE` / `HAIRLINE` above are the LIGHT values, kept as named
 * exports so the ~200 existing call sites keep working unchanged. The palettes
 * below are the same roles resolved per appearance; read them through
 * `useThemeColors()` (lib/useTheme.ts) in anything that should follow the
 * system setting.
 *
 * Dark is not "light with the lightness flipped": surfaces stay slightly warm
 * (a pure #000 card on an OLED reads as a hole), the brand lightens two steps
 * so violet-on-near-black keeps its chroma without glowing, and hairlines
 * become light-on-dark rather than dark-on-light.
 * ------------------------------------------------------------------------- */

export type Appearance = 'light' | 'dark';

/** Every colour role a screen can need, resolved for one appearance. */
export interface ThemeColors {
  /* text */
  text: string;
  textSecondary: string;
  textTertiary: string;
  textPlaceholder: string;
  textInverse: string;
  textBrand: string;
  /** Non-text decoration only — chevrons, dividers, glyphs. */
  decorative: string;
  /* surfaces */
  card: string;
  raised: string;
  sunken: string;
  field: string;
  page: string;
  scrim: string;
  hairline: string;
  /* brand + status, adjusted for the ground they sit on */
  brand: string;
  brandSoft: string;
  brandBorder: string;
  danger: string;
  dangerSoft: string;
  success: string;
  warning: string;
  warningSoft: string;
  /* page + header washes */
  pageGradient: readonly [string, string, string];
  headerGradient: readonly [string, string];
  /** Matching `expo-blur` tint for GlassCard and friends. */
  glassTint: 'light' | 'dark';
  /** Matching `expo-status-bar` style for screens on the page background. */
  statusBar: 'light' | 'dark';
  appearance: Appearance;
}

export const LIGHT_COLORS: ThemeColors = {
  text: INK[900],
  textSecondary: INK[600],
  textTertiary: INK[500],
  textPlaceholder: INK[500],
  textInverse: '#ffffff',
  textBrand: BRAND[600],
  decorative: INK[400],

  card: '#ffffff',
  raised: '#ffffff',
  sunken: INK[50],
  field: INK[100],
  page: '#F5F3FF',
  scrim: 'rgba(15, 23, 42, 0.45)',
  hairline: HAIRLINE,

  brand: BRAND[600],
  brandSoft: BRAND[100],
  brandBorder: BRAND[200],
  danger: STATUS.danger,
  dangerSoft: STATUS.dangerSoft,
  success: STATUS.success,
  warning: STATUS.warning,
  warningSoft: STATUS.warningSoft,

  pageGradient: GRADIENTS.page,
  headerGradient: GRADIENTS.header,
  glassTint: 'light',
  statusBar: 'dark',
  appearance: 'light',
};

export const DARK_COLORS: ThemeColors = {
  // Contrast on the #16161d card: text 15.4:1, secondary 7.1:1, tertiary 4.9:1.
  text: '#f4f4f7',
  textSecondary: '#b6b8c6',
  textTertiary: '#9093a5',
  textPlaceholder: '#82859a',
  textInverse: INK[900],
  textBrand: BRAND[300],
  decorative: '#6e7186',

  card: '#16161d',
  raised: '#1d1d26',
  sunken: '#101016',
  field: '#22222c',
  page: '#0b0b10',
  scrim: 'rgba(0, 0, 0, 0.62)',
  hairline: HAIRLINE_DARK,

  // Two steps lighter than the light-mode primary: BRAND[600] on near-black
  // loses chroma and reads muddy, while 400 keeps the violet identity.
  brand: BRAND[400],
  brandSoft: 'rgba(139, 92, 246, 0.16)',
  brandBorder: 'rgba(167, 139, 250, 0.28)',
  danger: '#f87171',
  dangerSoft: 'rgba(248, 113, 113, 0.14)',
  success: '#4ade80',
  warning: '#fbbf24',
  warningSoft: 'rgba(251, 191, 36, 0.14)',

  pageGradient: ['#0b0b10', '#121019', '#16121f'] as const,
  headerGradient: ['#171326', '#12111c'] as const,
  glassTint: 'dark',
  statusBar: 'light',
  appearance: 'dark',
};

export function colorsFor(appearance: Appearance): ThemeColors {
  return appearance === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}
