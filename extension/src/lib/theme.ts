/**
 * Design tokens — THE single source of raw style values for every extension
 * surface (popup, library page, spotlight shadow DOM).
 *
 * MIRRORS the phone app's `lib/theme.ts` and `lib/classification.ts`. Hex
 * values are byte-identical to the phone so a synced item reads as the same
 * object on both devices. The Reanimated SPRING/SHADOW presets are omitted
 * (the extension uses CSS transitions and box-shadow strings).
 *
 * WHY THIS FILE EMITS CSS: CSS Modules cannot import TS consts, so the palette
 * used to be re-typed by hand in the popup CSS, the library CSS and the
 * spotlight style string — four copies that had already drifted. Instead the
 * scales below are emitted once by `tokensCss()` and handed to each surface:
 *   - popup / library → `injectTokens()` from their `main.tsx`, synchronously
 *     before the first React render. Both HTML files ship an empty <body>, so
 *     nothing paints before JS runs and there is no flash. The only literal
 *     colours left in CSS are the `html, body` ground (see Library.module.css),
 *     which must be right in the very first frame.
 *   - spotlight → `tokensCss(':host')` concatenated into the closed shadow
 *     root's stylesheet (`:root` matches nothing inside a shadow root).
 *
 * Rules of thumb:
 * - NEVER hardcode `#007AFF` or ad-hoc grays (`#333`, `#999`) in a stylesheet —
 *   reach for the semantic `--text-*` / `--surface-*` vars, which are what dark
 *   mode flips. Raw `--brand-*` / `--ink-*` steps stay fixed in both schemes so
 *   a tint that means "violet 600" keeps meaning that.
 * - Light surfaces use `--hairline` for borders; dark/glass ones `--hairline-dark`.
 */
import type { Classification } from './types';

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

/** Status colors. Never use a raw `#ef4444` / `#22c55e` in a stylesheet. */
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
 * Semantic text roles — these, not raw INK steps, are what surfaces use.
 *
 * Contrast against white (WCAG AA needs 4.5:1 for body text):
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

/** Surface roles for cards, sheets and page backgrounds. */
export const SURFACE = {
  card: '#ffffff',
  raised: '#ffffff',
  sunken: INK[50],
  field: INK[100],
  page: BRAND[50],
  scrim: 'rgba(15, 23, 42, 0.45)',
} as const;

/** 1px-feel borders. HAIRLINE for light surfaces, HAIRLINE_DARK for glass. */
export const HAIRLINE = 'rgba(15, 23, 42, 0.08)';
export const HAIRLINE_DARK = 'rgba(255, 255, 255, 0.14)';

/** Corner radius scale. Cards use lg/xl; chips + pills use `pill`. */
export const RADIUS = { xs: 6, sm: 10, md: 14, lg: 20, xl: 26, xxl: 32, pill: 999 } as const;

/** Spacing scale (4pt grid with a 2 for tight optical fixes). */
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

/** Shared gradient stops. Emitted as ready-to-use `linear-gradient(…)` vars. */
export const GRADIENTS = {
  /** Primary CTA / brand surfaces. */
  brand: ['#8b5cf6', '#6366f1'] as const,
  /** Celebration / accent moments. */
  accent: ['#ec4899', '#8b5cf6'] as const,
  /** Soft page background used by the light screens. */
  page: ['#EEF2FF', '#F5F3FF', '#FAF5FF'] as const,
};

// ---- Classification visuals -------------------------------------------------

export interface ClassConfig {
  /** Gradient start — used for large fills (tiles, hero blocks). */
  from: string;
  /** Gradient end. */
  to: string;
  /**
   * Darkened variant for TEXT and glyphs on a soft tint of the same hue.
   * Pills render this on `from` at ~10% alpha; `from` itself lands near 2:1
   * there, which is unreadable at 11px.
   */
  deep: string;
  label: string;
}

/**
 * MIRROR of the phone's `lib/classification.ts` `CLASS_CONFIG`. The `icon`
 * field is deliberately absent — it names an Ionicons glyph, which only exists
 * in the React Native bundle. Everything else is byte-identical: the desktop
 * and phone renderings of one synced item must not disagree on its colour.
 */
export const CLASS_CONFIG: Record<Classification, ClassConfig> = {
  article: { from: '#6366f1', to: '#8b5cf6', deep: '#4338ca', label: 'Article' },
  video: { from: '#ec4899', to: '#f472b6', deep: '#be185d', label: 'Video' },
  recipe: { from: '#f59e0b', to: '#fb923c', deep: '#b45309', label: 'Recipe' },
  product: { from: '#10b981', to: '#34d399', deep: '#047857', label: 'Product' },
  event: { from: '#f43f5e', to: '#fb7185', deep: '#be123c', label: 'Event' },
  place: { from: '#06b6d4', to: '#22d3ee', deep: '#0e7490', label: 'Place' },
  idea: { from: '#f59e0b', to: '#fbbf24', deep: '#b45309', label: 'Idea' },
  fitness: { from: '#ef4444', to: '#f87171', deep: '#b91c1c', label: 'Fitness' },
  food: { from: '#f97316', to: '#fb923c', deep: '#c2410c', label: 'Food' },
  career: { from: '#14b8a6', to: '#2dd4bf', deep: '#0f766e', label: 'Career' },
  academia: { from: '#8b5cf6', to: '#a78bfa', deep: '#6d28d9', label: 'Academia' },
  other: { from: '#64748b', to: '#94a3b8', deep: '#475569', label: 'Note' },
};

/** Safe lookup with an `other` fallback. */
export function classConfig(c?: Classification): ClassConfig {
  return (c && CLASS_CONFIG[c]) || CLASS_CONFIG.other;
}

// ---- CSS emission -----------------------------------------------------------

/**
 * Dark-scheme overrides. ONLY the semantic roles move: a card is darker, text
 * inverts, the hairline flips to a light alpha. The raw scales are untouched so
 * `--brand-600` still means violet 600 wherever a tint or gradient references it.
 */
const DARK = {
  text: {
    primary: INK[50],
    secondary: INK[300],
    tertiary: INK[400],
    placeholder: INK[400],
    inverse: INK[900],
    // BRAND[600] on a near-black card is ~2.6:1 — step up the scale for text.
    brand: BRAND[300],
    decorative: INK[500],
  },
  surface: {
    card: '#171b29',
    raised: '#1e2333',
    sunken: '#11141f',
    field: '#1e2333',
    page: '#0b0e18',
    scrim: 'rgba(2, 6, 23, 0.66)',
  },
  status: {
    danger: '#f87171',
    dangerSoft: 'rgba(248, 113, 113, 0.14)',
    success: '#4ade80',
    successSoft: 'rgba(74, 222, 128, 0.14)',
    warning: '#fbbf24',
    warningSoft: 'rgba(251, 191, 36, 0.14)',
  },
} as const;

function scaleVars(prefix: string, scale: Record<string, string>): string {
  return Object.entries(scale)
    .map(([step, value]) => `  --${prefix}-${step}: ${value};`)
    .join('\n');
}

function radiusVars(): string {
  return Object.entries(RADIUS)
    .map(([step, value]) => `  --radius-${step}: ${value}px;`)
    .join('\n');
}

function spaceVars(): string {
  return Object.entries(SPACE)
    .map(([step, value]) => `  --space-${step}: ${value}px;`)
    .join('\n');
}

/**
 * Emit the whole token set as a CSS block plus its dark-scheme overrides.
 *
 * @param selector where the custom properties live. `:root` for a document,
 *   `:host` for a shadow root (`:root` matches nothing inside one).
 */
export function tokensCss(selector: string = ':root'): string {
  return `
${selector} {
  color-scheme: light dark;

${scaleVars('brand', BRAND)}
${scaleVars('accent', ACCENT)}
${scaleVars('ink', INK)}

  --hairline: ${HAIRLINE};
  --hairline-dark: ${HAIRLINE_DARK};

  --text-primary: ${TEXT.primary};
  --text-secondary: ${TEXT.secondary};
  --text-tertiary: ${TEXT.tertiary};
  --text-placeholder: ${TEXT.placeholder};
  --text-inverse: ${TEXT.inverse};
  --text-brand: ${TEXT.brand};
  --text-decorative: ${TEXT.decorative};

  --surface-card: ${SURFACE.card};
  --surface-raised: ${SURFACE.raised};
  --surface-sunken: ${SURFACE.sunken};
  --surface-field: ${SURFACE.field};
  --surface-page: ${SURFACE.page};
  --surface-scrim: ${SURFACE.scrim};
  /* Brand-tinted wash for chips/badges that sit on a card. */
  --surface-brand-soft: ${BRAND[50]};
  --border-brand-soft: ${BRAND[100]};

  --status-danger: ${STATUS.danger};
  --status-danger-soft: ${STATUS.dangerSoft};
  --status-success: ${STATUS.success};
  --status-success-soft: ${STATUS.successSoft};
  --status-warning: ${STATUS.warning};
  --status-warning-soft: ${STATUS.warningSoft};

${radiusVars()}

${spaceVars()}

  --gradient-brand: linear-gradient(135deg, ${GRADIENTS.brand[0]}, ${GRADIENTS.brand[1]});
  --gradient-accent: linear-gradient(135deg, ${GRADIENTS.accent[0]}, ${GRADIENTS.accent[1]});
  --gradient-page: linear-gradient(160deg, ${GRADIENTS.page[0]}, ${GRADIENTS.page[1]} 50%, ${GRADIENTS.page[2]});

  --shadow-card: 0 4px 14px rgba(15, 23, 42, 0.05);
  --shadow-raised: 0 10px 28px rgba(15, 23, 42, 0.09);
  --shadow-brand: 0 10px 24px -12px rgba(124, 58, 237, 0.35);
  --shadow-brand-strong: 0 14px 28px -12px rgba(124, 58, 237, 0.5);
}

@media (prefers-color-scheme: dark) {
  ${selector} {
    --hairline: ${HAIRLINE_DARK};

    --text-primary: ${DARK.text.primary};
    --text-secondary: ${DARK.text.secondary};
    --text-tertiary: ${DARK.text.tertiary};
    --text-placeholder: ${DARK.text.placeholder};
    --text-inverse: ${DARK.text.inverse};
    --text-brand: ${DARK.text.brand};
    --text-decorative: ${DARK.text.decorative};

    --surface-card: ${DARK.surface.card};
    --surface-raised: ${DARK.surface.raised};
    --surface-sunken: ${DARK.surface.sunken};
    --surface-field: ${DARK.surface.field};
    --surface-page: ${DARK.surface.page};
    --surface-scrim: ${DARK.surface.scrim};
    --surface-brand-soft: rgba(124, 58, 237, 0.18);
    --border-brand-soft: rgba(167, 139, 250, 0.28);

    --status-danger: ${DARK.status.danger};
    --status-danger-soft: ${DARK.status.dangerSoft};
    --status-success: ${DARK.status.success};
    --status-success-soft: ${DARK.status.successSoft};
    --status-warning: ${DARK.status.warning};
    --status-warning-soft: ${DARK.status.warningSoft};

    --gradient-page: linear-gradient(160deg, #0b0e18, #120f22 50%, #17111f);

    --shadow-card: 0 4px 14px rgba(0, 0, 0, 0.45);
    --shadow-raised: 0 10px 28px rgba(0, 0, 0, 0.55);
    --shadow-brand: 0 10px 24px -12px rgba(0, 0, 0, 0.6);
    --shadow-brand-strong: 0 14px 28px -12px rgba(0, 0, 0, 0.7);
  }
}
`;
}

/** Document-level token block. Shadow roots want `tokensCss(':host')` instead. */
export const TOKENS_CSS = tokensCss();

const TOKENS_STYLE_ID = 'silo-tokens';

/**
 * Install the token block into a document. Idempotent, and safe to call from
 * a module's top level — call it BEFORE the first React render so no rule ever
 * resolves a `var()` that isn't defined yet.
 */
export function injectTokens(doc: Document = document): void {
  if (doc.getElementById(TOKENS_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = TOKENS_STYLE_ID;
  style.textContent = TOKENS_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
