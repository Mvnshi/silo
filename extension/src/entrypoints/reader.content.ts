/**
 * Reader-mode content script. Runs on every page (activeTab-gated by manifest),
 * but stays inert until the background or popup asks it to extract via the
 * `silo:extract-readable` message. Cheap to leave installed — just a listener.
 *
 * Spec §3 ("reader mode"), §4.4 ("readability runs client-side"), §7.5.
 *
 * Why a separate content script (not the popup)? Readability needs the live
 * DOM of the host page; the popup runs in its own document and can't see it.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractArticle } from '@/lib/readability';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== 'silo:extract-readable') return undefined;
      // Wrap in try/catch — Readability throws on extremely malformed pages.
      try {
        sendResponse({ ok: true, article: extractArticle() });
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
      // Synchronous response — no `return true` needed.
      return undefined;
    });
  },
});
