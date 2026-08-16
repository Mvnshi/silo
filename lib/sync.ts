/**
 * Sync client — the phone side of POST /api/sync (S1; protocol in SYNC.md,
 * server in workers/sync.ts).
 *
 * One round-trip pushes local changes (dirty items + delete tombstones) and
 * pulls everything the server has past our cursor. Conflicts resolve
 * last-write-wins by `updated_at`, applied via storage.applyRemotePut /
 * applyRemoteDelete — paths that never mark items dirty, so a pulled change
 * cannot echo back on the next push.
 *
 * Ordering invariant: apply the response, THEN clear dirty/tombstones, THEN
 * persist the cursor. A failure anywhere leaves everything still queued for
 * the next attempt — the server merge is idempotent, so re-pushing is safe.
 */

import { Item } from './types';
import {
  applyRemoteDelete,
  applyRemotePut,
  clearDirtyIds,
  clearTombstones,
  getDirtyIds,
  getItems,
  getSyncState,
  getTombstones,
  setSyncState,
} from './storage';
import { getAccessToken } from './auth';

// Same env vars lib/api.ts reads — sync talks to the same Worker by default,
// authenticated by the same shared client token.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_CLIENT_TOKEN || '';

/**
 * Items can arrive from the extension with types the phone doesn't know
 * ('quote', 'image'); `type` widens to string until adaptRemoteItem maps it.
 */
type RemoteItem = Omit<Item, 'type'> & { type: string; quote?: string };

type Change =
  | { op: 'put'; item: RemoteItem }
  | { op: 'delete'; id: string; updated_at: string };

interface SyncResponse {
  cursor: number;
  changes: Change[];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  cursor: number;
}

/**
 * Mint a pairing code: 'silo-' + 12 lowercase hex chars. Same entropy approach
 * as lib/items.newId (Math.random) — the code is a space identifier shared
 * over your own LAN/Worker, not a cryptographic secret (SYNC.md §Identity).
 */
export function newSpaceKey(): string {
  let hex = '';
  while (hex.length < 12) hex += Math.floor(Math.random() * 16).toString(16);
  return `silo-${hex}`;
}

/**
 * Map extension-only item types onto the phone's ItemType at apply time:
 * 'quote' → 'note' (preserving the quoted text), 'image' → 'screenshot'.
 */
function adaptRemoteItem(raw: RemoteItem): Item {
  const item = { ...raw } as unknown as Item & { quote?: string };
  if (raw.type === 'quote') {
    item.type = 'note';
    // The quoted text becomes the note body unless the extension wrote one.
    if (item.quote && !item.description) item.description = item.quote;
  } else if (raw.type === 'image') {
    item.type = 'screenshot';
  }
  return item;
}

/* ---------------------------------------------------------------------------
 * Account spaces (SYNC.md "Mode 2")
 *
 * Signing in swaps the device's self-minted pairing code for the account id, so
 * every device on that account lands in the same space with nothing to type.
 * Signing out puts the original pairing code back — the local library is
 * untouched either way; only the address it syncs to changes.
 * ------------------------------------------------------------------------- */

/**
 * Point sync at the signed-in user's space. Idempotent: re-adopting the space
 * already in use is a no-op, so this is safe to call on every session event.
 *
 * The cursor resets because a different space has a different server history —
 * an initial full push follows, which the server merge is idempotent about.
 */
export async function adoptAccountSpace(accountId: string): Promise<void> {
  const state = await getSyncState();
  if (state.spaceKey === accountId) return;

  await setSyncState({
    // Park the pairing code (once) so signing out can restore it.
    localSpaceKey: state.localSpaceKey ?? state.spaceKey ?? newSpaceKey(),
    spaceKey: accountId,
    cursor: 0,
  });
}

/** Restore the device's own pairing code after signing out. */
export async function releaseAccountSpace(): Promise<void> {
  const state = await getSyncState();
  if (!state.localSpaceKey) return; // never adopted an account space

  await setSyncState({
    spaceKey: state.localSpaceKey,
    localSpaceKey: null,
    cursor: 0,
  });
}

/** Coalesce overlapping callers (foreground listener + manual tap) onto one round-trip. */
let inFlight: Promise<SyncResult> | null = null;

export function syncNow(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = doSync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function doSync(): Promise<SyncResult> {
  const state = await getSyncState();

  // Settings override wins; else the same base URL the AI proxy uses.
  const serverUrl = (state.serverUrl || API_BASE_URL).trim().replace(/\/+$/, '');
  if (!serverUrl) throw new Error('Sync server not configured');

  // First contact from this device: mint + persist the pairing code before use.
  let spaceKey = state.spaceKey;
  if (!spaceKey) {
    spaceKey = newSpaceKey();
    await setSyncState({ spaceKey });
  }

  const [items, dirtyIds, tombstones] = await Promise.all([
    getItems(),
    getDirtyIds(),
    getTombstones(),
  ]);
  const byId = new Map(items.map((it) => [it.id, it]));

  // INITIAL SYNC: cursor 0 with a clean dirty set means nothing was tracked
  // yet, so upload the whole library (server merge is idempotent — repeat-safe).
  const initial = state.cursor === 0 && dirtyIds.length === 0;
  const putIds = initial ? items.map((it) => it.id) : dirtyIds;

  const changes: Change[] = [];
  const pushedDirtyIds: string[] = [];
  for (const id of putIds) {
    const item = byId.get(id);
    if (!item) {
      // Stale dirty id (item since removed): nothing to push, but still clear
      // it after a successful round-trip or it lingers in the set forever.
      if (!initial) pushedDirtyIds.push(id);
      continue;
    }
    // getItems() normalizes, so updated_at exists; ?? only narrows the type.
    changes.push({ op: 'put', item: { ...item, updated_at: item.updated_at ?? item.created_at } });
    if (!initial) pushedDirtyIds.push(id);
  }
  for (const t of tombstones) {
    changes.push({ op: 'delete', id: t.id, updated_at: t.updated_at });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CLIENT_TOKEN) headers['X-Silo-Client'] = CLIENT_TOKEN; // same gate as lib/api.ts

  // When signed in, prove the space is ours. Without this a caller could name
  // any account id as their spaceKey and read someone else's library — the
  // Worker rejects a mismatch (and, in Mode 2, a missing token outright).
  const accessToken = await getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${serverUrl}/api/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ spaceKey, since: state.cursor, changes }),
  });
  if (!response.ok) {
    let msg = `Sync failed (${response.status})`;
    try {
      const e = (await response.json()) as { error?: string };
      if (e?.error) msg = e.error;
    } catch {
      // keep the status-based message
    }
    throw new Error(msg);
  }
  const result = (await response.json()) as SyncResponse;
  if (typeof result.cursor !== 'number' || !Array.isArray(result.changes)) {
    throw new Error('Sync server returned an unexpected response');
  }

  // Apply the pull BEFORE clearing push bookkeeping: if applying throws we
  // simply retry everything next sync; the reverse order could clear a dirty
  // id whose change never landed anywhere.
  let pulled = 0;
  for (const ch of result.changes) {
    if (ch.op === 'delete' && ch.id) {
      await applyRemoteDelete(ch.id); // no local tombstone — anti-echo
      pulled++;
    } else if (ch.op === 'put' && ch.item && typeof ch.item.id === 'string') {
      await applyRemotePut(adaptRemoteItem(ch.item)); // LWW upsert, never dirties
      pulled++;
    }
  }

  // Round-trip succeeded: release exactly what we pushed, advance the cursor.
  await clearDirtyIds(pushedDirtyIds);
  await clearTombstones(tombstones.map((t) => t.id));
  await setSyncState({ cursor: result.cursor, lastSyncAt: new Date().toISOString() });

  return { pushed: changes.length, pulled, cursor: result.cursor };
}
