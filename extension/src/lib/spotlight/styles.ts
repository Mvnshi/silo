/**
 * Inline CSS for the spotlight Shadow DOM. We ship a string (not a stylesheet
 * file) because the content-script bundle is loaded into every page — a
 * single template literal is the smallest, no-fetch path.
 *
 * The palette comes from `lib/theme.ts` via `tokensCss(':host')`. `:root`
 * matches nothing inside a shadow root, so the tokens are declared on the host
 * element instead; `all: initial` (which the spec exempts custom properties
 * from) still shields us from the page's styles.
 *
 * Dark mode matters more here than anywhere else in the product: this overlay
 * lands on top of someone ELSE's page, and a white slab dropped onto a dark
 * site is the loudest possible way to look broken.
 */
import { tokensCss } from '@/lib/theme';

export const SPOTLIGHT_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

${tokensCss(':host')}

:host {
  color: var(--text-primary);
}

/* The backdrop swallows every click on the host page, so it has to LOOK like
   it is doing that — a fully transparent full-viewport layer reads as a broken
   page, not as a modal. */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: auto;
  background: rgba(15, 23, 42, 0);
  transition: background 220ms ease, backdrop-filter 220ms ease;
}

.backdrop.open {
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.overlay {
  position: fixed;
  top: 80px;
  left: 50%;
  /* Base state = pre-entrance. The open state below is what animates. */
  transform: translateX(-50%) translateY(-12px) scale(0.97);
  width: 540px;
  max-width: 90vw;
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  /* Soft brand-tinted shadow — violet 600 at low alpha + a neutral lift. */
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 8px 24px rgba(124, 58, 237, 0.18),
    0 24px 64px rgba(124, 58, 237, 0.14);
  z-index: 2147483647;
  padding: 16px 16px 14px 16px;
  opacity: 0;
  transition: opacity 200ms ease, transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1);
  box-sizing: border-box;
}

.overlay.open {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}

.overlay.closing {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px) scale(0.98);
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
  color: var(--text-brand);
}

input.input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  font-size: 17px;
  line-height: 24px;
  padding: 8px 4px;
  background: transparent;
  color: var(--text-primary);
  font-weight: 500;
  font-family: inherit;
  min-width: 0;
}

input.input::placeholder {
  color: var(--text-placeholder);
  font-weight: 400;
}

button.save {
  flex: 0 0 auto;
  border: none;
  cursor: pointer;
  padding: 9px 18px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  color: #ffffff;
  background: var(--gradient-brand);
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.32);
  transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
  letter-spacing: 0.01em;
}

button.save:disabled {
  background: var(--surface-field);
  color: var(--text-tertiary);
  cursor: not-allowed;
  box-shadow: none;
}

button.save.saved {
  background: linear-gradient(135deg, #16a34a, #15803d);
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(22, 163, 74, 0.32);
}

button.save:not(:disabled):active {
  transform: scale(0.97);
}

button.save:focus-visible,
button.chip:focus-visible {
  outline: 2px solid var(--text-brand);
  outline-offset: 2px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

button.chip {
  border: 1px solid var(--hairline);
  background: var(--surface-card);
  color: var(--text-secondary);
  padding: 5px 11px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
  font-family: inherit;
}

button.chip:hover {
  border-color: var(--border-brand-soft);
  color: var(--text-brand);
}

button.chip.active {
  background: var(--surface-brand-soft);
  border-color: var(--border-brand-soft);
  color: var(--text-brand);
}

button.chip:active {
  transform: scale(0.97);
}

.tags {
  margin-top: 8px;
}

input.tagInput {
  width: 100%;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  color: var(--text-primary);
  font-family: inherit;
  transition: border-color 120ms ease, background 120ms ease;
  box-sizing: border-box;
  background: var(--surface-field);
}

input.tagInput:focus {
  border-color: var(--brand-400);
  background: var(--surface-card);
}

input.tagInput::placeholder {
  color: var(--text-placeholder);
}

/* Inline save failure. The overlay STAYS OPEN when this shows — closing on a
   failed save silently drops whatever the user typed. */
.error {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--status-danger);
}

.error[hidden] {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .overlay,
  .backdrop,
  button.save,
  button.chip,
  input.tagInput {
    transition-duration: 1ms !important;
  }
  /* Keep the horizontal centring; drop the travel. */
  .overlay,
  .overlay.open,
  .overlay.closing {
    transform: translateX(-50%) !important;
  }
  button.save:not(:disabled):active,
  button.chip:active {
    transform: none;
  }
}
`;
