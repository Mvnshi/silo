/**
 * Spotlight overlay content script — registered on every page so the
 * Cmd+Shift+K command (routed via background → chrome.tabs.sendMessage) can
 * mount the overlay without an extra injection round-trip.
 *
 * Spec §3 "Spotlight-style overlay", §4 architecture. The actual UI lives in
 * `lib/spotlight/overlay.ts` so this entrypoint stays a thin message router.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { openSpotlight } from '@/lib/spotlight/overlay';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'silo:open-spotlight') return undefined;
      // Toggle behaviour lives in openSpotlight — if mounted, it refocuses.
      openSpotlight();
      return undefined;
    });
  },
});
