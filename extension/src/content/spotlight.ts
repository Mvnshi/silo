/**
 * Spotlight overlay — mounted on Cmd+Shift+K (see spec §3 row "Spotlight-
 * style overlay"). M2.
 *
 * Implementation notes for the eventual author:
 * - Mount the overlay inside a Shadow DOM root so the host page's CSS can't
 *   bleed into our UI and we can't accidentally leak ours.
 * - Position fixed, top-center, ~520px wide.
 * - Listen for `silo:open-spotlight` messages from `background/commands.ts`.
 * - On submit, call the same code path the popup uses (`lib/api.ts` +
 *   `lib/store.ts`) so behaviour is identical.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'silo:open-spotlight') return;
  // M2 — mount the overlay here.
});
