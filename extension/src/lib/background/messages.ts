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
 *   { type: 'silo:sync-now' }               →  { ok, pushed, pulled, error? }
 */
import type { Item } from '@/lib/types';
import { addItem } from '@/lib/store';
import { syncNow } from '@/lib/sync';

interface SaveItemMessage {
  type: 'silo:save-item';
  item: Item;
}

interface SyncNowMessage {
  type: 'silo:sync-now';
}

function isSaveItemMessage(msg: unknown): msg is SaveItemMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'silo:save-item' &&
    typeof (msg as { item?: unknown }).item === 'object'
  );
}

function isSyncNowMessage(msg: unknown): msg is SyncNowMessage {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'silo:sync-now'
  );
}

// Debounced sync-after-save: rapid captures (spotlight sprees) batch into one
// round-trip. Module-level timer is fine in MV3 — if the SW dies mid-debounce
// we lose only the NUDGE, never the data; the next library open re-syncs.
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSyncAfterSave(): void {
  if (syncTimer !== undefined) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    syncNow().catch(() => {
      /* offline is fine — the dirty set keeps the change for the next sync */
    });
  }, 1500);
}

export function registerMessageBridge(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (isSyncNowMessage(msg)) {
      syncNow()
        .then((r) => sendResponse({ ok: true, pushed: r.pushed, pulled: r.pulled }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            pushed: 0,
            pulled: 0,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      return true; // keep the channel open for the async response
    }
    if (!isSaveItemMessage(msg)) return undefined;
    addItem(msg.item)
      .then(() => {
        sendResponse({ ok: true });
        scheduleSyncAfterSave(); // after the response — saving never waits on sync
      })
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true; // keep the channel open for the async response
  });
}
