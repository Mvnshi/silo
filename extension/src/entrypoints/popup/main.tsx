/**
 * Popup entry. M0 — boots React 19 and mounts <App />, which owns the
 * three-mode capture (Page today; Note + Highlight land in later milestones).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Popup.module.css is imported by App.tsx; that injection covers the global
// `:root` / `body` rules too. No need to re-import here.

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
