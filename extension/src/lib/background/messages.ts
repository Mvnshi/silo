/**
 * Background message bridge — the ONLY place content scripts persist through.
 *
 * IndexedDB is origin-scoped. A content script that imports lib/store writes
 * to the HOST PAGE's origin (example.com gets its own "silo" database), so
 * the popup/background — which live on the extension origin — never see those
 * rows. Every save initiated from page context must hop here first.
 *
 * Message contract:
 *   { type: 'silo:save-item', item: Item }  →  { ok: true } | { ok: false, error }
 */
import type { Item } from '@/lib/types';
import { addItem } from '@/lib/store';

interface SaveItemMessage {
  type: 'silo:save-item';
  item: Item;
}

function isSaveItemMessage(msg: unknown): msg is SaveItemMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'silo:save-item' &&
    typeof (msg as { item?: unknown }).item === 'object'
  );
}

export function registerMessageBridge(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isSaveItemMessage(msg)) return undefined;
    addItem(msg.item)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true; // keep the channel open for the async response
  });
}
