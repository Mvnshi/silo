/**
 * IndexedDB store via Dexie. Mirrors the phone's `lib/storage.ts` API so the
 * eventual sync (spec §4.3) is a 1:1 mapping. KEEP THE PUBLIC API IDENTICAL
 * to the phone's — if you rename or change a signature here, change it there.
 *
 * v1 schema mirrors `lib/types.ts` `Item` and `Stack` shapes exactly.
 * v2 (S2 sync, SYNC.md) adds three bookkeeping stores: `kv` (sync cursor +
 * pairing), `dirty` (ids of local writes not yet pushed), `tombstones`
 * (local deletes that must propagate). User writes mark dirty HERE so every
 * capture path (popup, menus, spotlight, omnibox) inherits sync for free;
 * remote applies go through applyRemotePut/Delete which never mark dirty
 * (the anti-echo invariant).
 */
import Dexie, { type Table } from 'dexie';
import type { Item, Stack } from './types';

/** Persisted under kv key 'syncState'. Read/patched by lib/sync.ts + the library pairing UI. */
export interface SyncState {
  spaceKey: string | null;
  cursor: number;
  serverUrl: string | null;
  lastSyncAt: string | null;
}

interface KvRow {
  key: string;
  value: unknown;
}
interface DirtyRow {
  id: string;
}
/** A local delete awaiting push: `{ op:'delete', id, updated_at }` on the wire. */
export interface Tombstone {
  id: string;
  updated_at: string;
}

class SiloDB extends Dexie {
  items!: Table<Item, string>;
  stacks!: Table<Stack, string>;
  kv!: Table<KvRow, string>;
  dirty!: Table<DirtyRow, string>;
  tombstones!: Table<Tombstone, string>;

  constructor() {
    super('silo');
    this.version(1).stores({
      // Indexes mirror the most common phone-side queries.
      items: 'id, created_at, classification, stack_id, archived, viewed',
      stacks: 'id, name',
    });
    // v2 is ADDITIVE: items/stacks index strings are byte-identical to v1, so
    // Dexie touches no existing rows; the three new stores start empty.
    this.version(2).stores({
      items: 'id, created_at, classification, stack_id, archived, viewed',
      stacks: 'id, name',
      kv: 'key',
      dirty: 'id',
      tombstones: 'id',
    });
  }
}

const db = new SiloDB();

export async function getItems(): Promise<Item[]> {
  return db.items.orderBy('created_at').reverse().toArray();
}

export async function addItem(item: Item): Promise<void> {
  // Mark dirty in the same transaction so a crash can't leave an unsynced row.
  await db.transaction('rw', [db.items, db.dirty], async () => {
    await db.items.add(item);
    await db.dirty.put({ id: item.id });
  });
}

export async function updateItem(id: string, updates: Partial<Item>): Promise<void> {
  await db.transaction('rw', [db.items, db.dirty], async () => {
    const count = await db.items.update(id, { ...updates, updated_at: new Date().toISOString() });
    if (count > 0) await db.dirty.put({ id }); // no phantom dirty ids for missing rows
  });
}

export async function deleteItem(id: string): Promise<void> {
  // A local delete must PROPAGATE (SYNC.md "soft deletes") — leave a tombstone
  // for the next push. Any pending dirty flag is moot once the row is gone.
  await db.transaction('rw', [db.items, db.dirty, db.tombstones], async () => {
    await db.items.delete(id);
    await db.dirty.delete(id);
    await db.tombstones.put({ id, updated_at: new Date().toISOString() });
  });
}

export async function getItemByUrl(url: string): Promise<Item | undefined> {
  return db.items.where('url').equals(url).first();
}

// ---- Sync helpers (S2) ------------------------------------------------------
// Everything below is bookkeeping for lib/sync.ts. The e2e harness reads and
// writes these shapes directly — keep them exactly as documented.

const SYNC_STATE_KEY = 'syncState';
const DEFAULT_SYNC_STATE: SyncState = {
  spaceKey: null,
  cursor: 0,
  serverUrl: null,
  lastSyncAt: null,
};

export async function getSyncState(): Promise<SyncState> {
  const row = await db.kv.get(SYNC_STATE_KEY);
  // Spread over defaults so a row written by an older shape still satisfies SyncState.
  return { ...DEFAULT_SYNC_STATE, ...((row?.value as Partial<SyncState> | undefined) ?? {}) };
}

export async function setSyncState(patch: Partial<SyncState>): Promise<void> {
  // Read-merge-write in one transaction so concurrent patches can't clobber.
  await db.transaction('rw', db.kv, async () => {
    const row = await db.kv.get(SYNC_STATE_KEY);
    const current = { ...DEFAULT_SYNC_STATE, ...((row?.value as Partial<SyncState> | undefined) ?? {}) };
    await db.kv.put({ key: SYNC_STATE_KEY, value: { ...current, ...patch } });
  });
}

export async function getDirtyIds(): Promise<string[]> {
  return db.dirty.toCollection().primaryKeys();
}

export async function clearDirtyIds(ids: string[]): Promise<void> {
  await db.dirty.bulkDelete(ids);
}

export async function getTombstones(): Promise<Tombstone[]> {
  return db.tombstones.toArray();
}

export async function clearTombstones(ids: string[]): Promise<void> {
  await db.tombstones.bulkDelete(ids);
}

/** Bulk-fetch the items behind dirty ids; missing ids drop out (already deleted). */
export async function getItemsByIds(ids: string[]): Promise<Item[]> {
  const rows = await db.items.bulkGet(ids);
  return rows.filter((r): r is Item => r !== undefined);
}

/**
 * Apply a remote put with last-write-wins. Strictly-newer check means our own
 * echoed pushes (identical updated_at) are no-ops. Never marks dirty —
 * re-pushing what we just pulled would echo between devices forever.
 */
export async function applyRemotePut(item: Item): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    const existing = await db.items.get(item.id);
    if (!existing || existing.updated_at < item.updated_at) {
      await db.items.put(item);
    }
  });
}

/**
 * Apply a remote delete. Deliberately writes NO tombstone (anti-echo: only
 * LOCAL deletes propagate) and drops any dirty flag so the next push can't
 * resurrect the row.
 */
export async function applyRemoteDelete(id: string): Promise<void> {
  await db.transaction('rw', [db.items, db.dirty], async () => {
    await db.items.delete(id);
    await db.dirty.delete(id);
  });
}
