/**
 * Inline CSS for the spotlight Shadow DOM. We ship a string (not a stylesheet
 * file) because the content-script bundle is loaded into every page — a
 * single template literal is the smallest, no-fetch path.
 *
 * Tokens mirror the phone app's `lib/theme.ts` (BRAND violet scale, INK slate
 * scale, RADIUS). DO NOT introduce stock #007AFF or ad-hoc grays here — those
 * are banned across the product per the design spec.
 */

// Mirrors `app/lib/theme.ts` BRAND scale. Kept inline to avoid an import that
// would force the workspace boundary; sync by hand when the phone palette moves.
const BRAND = {
  50: '#f5f3ff',
  100: '#ede9fe',
  200: '#ddd6fe',
  500: '#8b5cf6',
  600: '#7c3aed',
  700: '#6d28d9',
} as const;

const INK = {
  100: '#f1f5f9',
  200: '#e2e8f0',
  400: '#94a3b8',
  500: '#64748b',
  700: '#334155',
  900: '#0f172a',
} as const;

export const SPOTLIGHT_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: ${INK[900]};
  -webkit-font-smoothing: antialiased;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: auto;
  background: transparent;
}

.overlay {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%) translateY(0);
  width: 540px;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 18px;
  /* Soft brand-tinted shadow — violet 600 at low alpha + a neutral lift. */
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 8px 24px rgba(124, 58, 237, 0.18),
    0 24px 64px rgba(124, 58, 237, 0.14);
  z-index: 2147483647;
  padding: 16px 16px 14px 16px;
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms ease;
  box-sizing: border-box;
}

.overlay.open {
  opacity: 1;
}

.overlay.closing {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  color: ${BRAND[600]};
}

input.input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  font-size: 17px;
  line-height: 24px;
  padding: 8px 4px;
  background: transparent;
  color: ${INK[900]};
  font-weight: 500;
}

input.input::placeholder {
  color: ${INK[400]};
  font-weight: 400;
}

button.save {
  flex: 0 0 auto;
  border: none;
  cursor: pointer;
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: linear-gradient(135deg, ${BRAND[500]} 0%, ${BRAND[700]} 100%);
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.32);
  transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
  letter-spacing: 0.01em;
}

button.save:disabled {
  background: ${INK[200]};
  color: ${INK[500]};
  cursor: not-allowed;
  box-shadow: none;
}

button.save:not(:disabled):active {
  transform: scale(0.97);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

button.chip {
  border: 1px solid ${INK[200]};
  background: #ffffff;
  color: ${INK[700]};
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
  font-family: inherit;
}

button.chip:hover {
  border-color: ${BRAND[200]};
  color: ${BRAND[700]};
}

button.chip.active {
  background: ${BRAND[50]};
  border-color: ${BRAND[200]};
  color: ${BRAND[700]};
}

button.chip:active {
  transform: scale(0.97);
}

.tags {
  margin-top: 8px;
}

input.tagInput {
  width: 100%;
  border: 1px solid ${INK[200]};
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  color: ${INK[700]};
  font-family: inherit;
  transition: border-color 120ms ease;
  box-sizing: border-box;
  background: ${INK[100]};
}

input.tagInput:focus {
  border-color: ${BRAND[200]};
  background: #ffffff;
}

input.tagInput::placeholder {
  color: ${INK[400]};
}
`;
