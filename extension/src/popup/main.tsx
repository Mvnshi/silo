/**
 * Popup entry. M0 — wires React, will render `<Popup />` once the popup UI
 * lands (the three-mode capture: Page / Note / Highlight).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// import { Popup } from './Popup'; // M0 — uncomment when Popup.tsx exists.

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {/* <Popup /> */}
      <div style={{ width: 380, padding: 24, fontFamily: 'system-ui' }}>
        <strong>Silo</strong>
        <p style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>
          Scaffold. See <code>../EXTENSION_SPEC.md</code> §7 for M0.
        </p>
      </div>
    </StrictMode>
  );
}
