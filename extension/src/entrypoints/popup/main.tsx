/**
 * Popup entry — boots React 19 and mounts <App />.
 *
 * `injectTokens()` runs first and synchronously: Popup.module.css resolves the
 * whole palette through `var(--…)` custom properties that only `lib/theme.ts`
 * defines. popup.html ships an empty <body>, so nothing paints before this
 * module executes and there is no unstyled flash.
 */
import { StrictMode } from 'react';
// Tailwind utilities for the shadcn components. Imported before `injectTokens`
// runs so Silo's runtime <style> lands last and wins the cascade.
import '@/assets/tailwind.css';
import { createRoot } from 'react-dom/client';
import { injectTokens } from '@/lib/theme';
import { App } from './App';

injectTokens();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
