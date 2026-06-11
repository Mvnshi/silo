/**
 * Library entry — the full-tab "see everything you've saved" view.
 * Opened from the popup's grid button, the omnibox fallback, or directly at
 * chrome-extension://<id>/library.html.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Library } from './Library';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Library />
    </StrictMode>
  );
}
