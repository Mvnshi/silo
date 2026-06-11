/**
 * Sync client — the extension half of POST /api/sync (see ../../../SYNC.md and
 * workers/sync.ts). One round-trip pushes local changes and pulls everything
 * this device lacks; conflicts resolve last-write-wins by `updated_at`.
 *
 * Invariants (mirrored by the phone's lib/sync.ts — keep in lockstep):
 * - Applying REMOTE changes never marks dirty / never writes tombstones
 *   (store.applyRemotePut/Delete enforce this) — the anti-echo rule.
 * - Bookkeeping (dirty/tombstones/cursor) is cleared only AFTER the POST
 *   succeeded and the pull was applied, so a network failure leaves local
 *   state intact and the next sync simply re-pushes (server merge is
 *   idempotent).
 *
 * Runs in the background SW (messages.ts) and the library page.
 */
import type { Item } from './types';
import {
  applyRemoteDelete,
  applyRemotePut,
  clearDirtyIds,
  clearTombstones,
  getDirtyIds,
  getItems,
  getItemsByIds,
  getSyncState,
  getTombstones,
  setSyncState,
} from './store';

/** Wire shape — identical to workers/sync.ts `Change`. */
type Change = { op: 'put'; item: Item } | { op: 'delete'; id: string; updated_at: string };

export interface SyncResult {
  pushed: number;
  pulled: number;
  cursor: number;
}

// Same env keys api.ts reads (WXT injects import.meta.env). Duplicated rather
// than exported from api.ts so the two modules stay independently owned.
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
/** Env default for the sync endpoint; the kv `serverUrl` (pairing UI) overrides it. */
export const DEFAULT_SERVER_URL = env.WXT_SILO_API_BASE_URL ?? '';
const CLIENT_TOKEN = env.WXT_SILO_CLIENT_TOKEN ?? '';

/** 'silo-' + 12 hex chars (e.g. silo-7f3a9b21c0de) — matches the Worker's spaceKey regex. */
export function generateSpaceKey(): string {
  return `silo-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

let inFlight: Promise<SyncResult> | null = null;

/**
 * Push dirty items + tombstones, pull and apply the rest, persist the cursor.
 * Concurrent callers coalesce onto the in-flight round-trip. Throws on any
 * failure; local state is never corrupted by a failed attempt.
 */
export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight; // a second caller rides the same round-trip
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(): Promise<SyncResult> {
  const state = await getSyncState();

  // First-ever sync with no pairing: mint a space so sync "just works"; the
  // user can paste a shared code later via the library modal.
  let spaceKey = state.spaceKey;
  if (!spaceKey) {
    spaceKey = generateSpaceKey();
    await setSyncState({ spaceKey });
  }

  const serverUrl = (state.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/+$/, '');
  if (!serverUrl) throw new Error('No sync server configured');

  const dirtyIds = await getDirtyIds();
  const tombstones = await getTombstones();

  let changes: Change[];
  if (state.cursor === 0 && dirtyIds.length === 0) {
    // INITIAL SYNC: nothing tracked yet (rows predate v2, or we just paired
    // into a new space) — upload everything. The server merge is an
    // idempotent LWW upsert, so repeating this after a failure is safe.
    const all = await getItems();
    changes = all.map((item): Change => ({ op: 'put', item }));
  } else {
    const dirtyItems = await getItemsByIds(dirtyIds);
    changes = dirtyItems.map((item): Change => ({ op: 'put', item }));
  }
  for (const t of tombstones) {
    changes.push({ op: 'delete', id: t.id, updated_at: t.updated_at });
  }

  const res = await fetch(`${serverUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CLIENT_TOKEN ? { 'X-Silo-Client': CLIENT_TOKEN } : {}),
    },
    body: JSON.stringify({ spaceKey, since: state.cursor, changes }),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  const data = (await res.json()) as { cursor: number; changes: Change[] };

  // Apply the pull FIRST, clear bookkeeping AFTER: if we die mid-apply, the
  // dirty set survives and the next sync re-pushes (harmless — idempotent).
  const pulled = data.changes ?? [];
  for (const ch of pulled) {
    if (ch.op === 'put') await applyRemotePut(ch.item);
    else await applyRemoteDelete(ch.id);
  }

  // Clear exactly what we pushed — an item saved DURING the round-trip under
  // a new id keeps its dirty flag and goes out on the next push.
  await clearDirtyIds(dirtyIds);
  await clearTombstones(tombstones.map((t) => t.id));
  await setSyncState({ cursor: data.cursor, lastSyncAt: new Date().toISOString() });

  return { pushed: changes.length, pulled: pulled.length, cursor: data.cursor };
}
