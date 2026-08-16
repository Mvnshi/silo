/**
 * AsyncStorage persistence layer.
 *
 * All app data — items, stacks, settings, scheduled events, the device user id —
 * is stored here as JSON under the `@silo:*` keys below. Two invariants keep the
 * store safe under concurrency and transient I/O errors:
 *
 *  1. **Per-key write mutex** (`withLock`): every read-modify-write on a key is
 *     serialized, so two rapid mutations (e.g. fast swipes) can't interleave and
 *     lose an update.
 *  2. **Empty-read clobber guard** (`mutateArray`): `getItems`/`getStacks`/
 *     `getEvents` return `[]` on ANY read/parse error — not just a genuinely
 *     empty store. A mutation must therefore never overwrite a populated store
 *     with a short array after an empty read. `mutateArray` aborts if the parsed
 *     array is empty while the raw stored value is non-empty.
 *  3. **Sync bookkeeping** (S1, SYNC.md): the user-facing mutators (addItem /
 *     updateItem / deleteItem) record dirty ids + delete tombstones for the
 *     sync client, while the applyRemote* paths deliberately do NOT — applying
 *     a pulled change must never echo it back on the next push.
 *
 * The raw JSON writer is private; all callers go through the add/update/delete
 * helpers so the lock + guard always apply.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Item, Stack, UserSettings, ScheduledEvent } from './types';
import { normalizeItem, newId, touchItem } from './items';

const KEYS = {
  ITEMS: '@silo:items',
  STACKS: '@silo:stacks',
  SETTINGS: '@silo:settings',
  EVENTS: '@silo:events',
  USER_ID: '@silo:userId',
  SCHEMA_VERSION: '@silo:schemaVersion',
  ONBOARDED: '@silo:onboarded',
  APPEARANCE: '@silo:appearance',
  // Sync (S1, SYNC.md). Key names are a contract with the e2e harness — don't rename.
  SYNC_STATE: '@silo:syncState',
  SYNC_DIRTY: '@silo:syncDirty',
  SYNC_TOMBSTONES: '@silo:syncTombstones',
};

/* ---------------------------------------------------------------------------
 * First-run onboarding flag
 * ------------------------------------------------------------------------- */

/** Whether the user has completed (or skipped) first-run onboarding. */
export async function hasOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEYS.ONBOARDED)) === '1';
  } catch {
    // On a read error, err on the side of NOT re-showing onboarding to an
    // existing user.
    return true;
  }
}

/** Mark first-run onboarding as completed (idempotent). */
export async function setOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.ONBOARDED, '1');
  } catch (error) {
    console.warn('Failed to persist onboarding flag:', error);
  }
}

/* ---------------------------------------------------------------------------
 * Appearance preference
 *
 * Deliberately its own key rather than a field on UserSettings: the theme has
 * to resolve on the very first frame, and settings are a heavier read that the
 * provider shouldn't block on.
 * ------------------------------------------------------------------------- */

/** 'system' | 'light' | 'dark'; null when the user has never chosen. */
export async function getAppearancePreference(): Promise<'system' | 'light' | 'dark' | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.APPEARANCE);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null;
  } catch {
    return null;
  }
}

export async function setAppearancePreference(
  value: 'system' | 'light' | 'dark'
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.APPEARANCE, value);
  } catch (error) {
    console.warn('Failed to persist appearance preference:', error);
  }
}

/** Bump when the persisted Item/Stack shape changes; drives runMigrations(). */
export const CURRENT_SCHEMA_VERSION = 2;

/** Default user settings — single source of truth (getSettings fallback + UI defaults). */
export const DEFAULT_SETTINGS: UserSettings = {
  notifications_enabled: true,
  auto_schedule: true,
  default_duration: 15,
  preferred_review_times: ['09:00', '14:00', '19:00'],
  theme: 'auto',
};

/* ---------------------------------------------------------------------------
 * Low-level JSON helpers
 * ------------------------------------------------------------------------- */

/** Read + parse a JSON value, returning `fallback` if absent or on any error. */
async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const json = await AsyncStorage.getItem(key);
    if (json == null) return fallback;
    return JSON.parse(json) as T;
  } catch (error) {
    console.error(`[silo] failed to read ${key}:`, error);
    return fallback;
  }
}

/** Serialize + write a JSON value. Throws on failure so callers can react. */
async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`[silo] failed to write ${key}:`, error);
    throw new Error(`Failed to save ${key}`);
  }
}

/* ---------------------------------------------------------------------------
 * Per-key write mutex + clobber-guarded array mutation
 * ------------------------------------------------------------------------- */

const writeChains: Record<string, Promise<unknown>> = {};

/**
 * Serialize mutations on a storage key so concurrent callers can't interleave.
 * Each mutation waits for the previous one on the same key to settle; errors are
 * isolated so one failure doesn't wedge the chain.
 */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains[key] ?? Promise.resolve();
  const run = prev.then(fn, fn);
  writeChains[key] = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Atomically read the array at `key`, apply `mutate`, and write the result.
 * Guards the empty-read clobber: if the parsed array is empty but the raw stored
 * value is actually non-empty (a transient read/parse error), abort instead of
 * overwriting the whole collection.
 */
async function mutateArray<T>(key: string, mutate: (current: T[]) => T[]): Promise<void> {
  return withLock(key, async () => {
    const current = await readJson<T[]>(key, []);
    if (current.length === 0) {
      const raw = await AsyncStorage.getItem(key);
      if (raw && raw.trim() !== '[]') {
        throw new Error(`mutateArray(${key}) aborted: empty read over a non-empty store (avoided clobber)`);
      }
    }
    await writeJson(key, mutate(current));
  });
}

/* ---------------------------------------------------------------------------
 * Items
 * ------------------------------------------------------------------------- */

/** All items, each idempotently upgraded to the unified schema on read. */
export async function getItems(): Promise<Item[]> {
  const raw = await readJson<Item[]>(KEYS.ITEMS, []);
  return Array.isArray(raw) ? raw.map(normalizeItem) : [];
}

export async function getItemById(id: string): Promise<Item | null> {
  const items = await getItems();
  return items.find((item) => item.id === id) || null;
}

/** Add a new item to the front of the list. */
export async function addItem(item: Item): Promise<void> {
  const normalized = normalizeItem(item);
  await mutateArray<Item>(KEYS.ITEMS, (items) => [normalized, ...items]);
  // Local user write → queue for the next sync push (remote applies skip this).
  await markDirty(normalized.id);
}

/** Apply a partial update to an item, maintaining `updated_at` / `completed_at`. */
export async function updateItem(id: string, updates: Partial<Item>): Promise<void> {
  let touched = false;
  await mutateArray<Item>(KEYS.ITEMS, (items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return items;
    touched = true;
    // touchItem maintains updated_at / completed_at and re-derives status.
    const next = items.slice();
    next[index] = touchItem(items[index], updates);
    return next;
  });
  // Only a real edit dirties; a miss must not enqueue a phantom id for sync.
  if (touched) await markDirty(id);
}

export async function deleteItem(id: string): Promise<void> {
  await mutateArray<Item>(KEYS.ITEMS, (items) => items.filter((item) => item.id !== id));
  // Soft-delete bookkeeping: the tombstone propagates the delete to other
  // devices on the next sync…
  await mutateArray<SyncTombstone>(KEYS.SYNC_TOMBSTONES, (tombstones) => [
    ...tombstones.filter((t) => t.id !== id),
    { id, updated_at: new Date().toISOString() },
  ]);
  // …and any pending edit for the item is now moot.
  await clearDirtyIds([id]);
}

/**
 * Record that an item was just surfaced on screen (drives the staleness nudge
 * in lib/resurface). DELIBERATELY does NOT bump `updated_at` or mark the item
 * dirty: last_seen_at is ambient local telemetry, not user intent, so it never
 * syncs and never causes per-open sync churn. No-op if the item is gone.
 */
export async function touchSeen(id: string): Promise<void> {
  const seenIso = new Date().toISOString();
  await mutateArray<Item>(KEYS.ITEMS, (items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return items;
    const next = items.slice();
    next[index] = { ...items[index], last_seen_at: seenIso };
    return next;
  });
}

/* ---------------------------------------------------------------------------
 * Stacks
 * ------------------------------------------------------------------------- */

export async function getStacks(): Promise<Stack[]> {
  return readJson<Stack[]>(KEYS.STACKS, []);
}

export async function getStackById(id: string): Promise<Stack | null> {
  const stacks = await getStacks();
  return stacks.find((stack) => stack.id === id) || null;
}

export async function addStack(stack: Stack): Promise<void> {
  return mutateArray<Stack>(KEYS.STACKS, (stacks) => [...stacks, stack]);
}

export async function updateStack(id: string, updates: Partial<Stack>): Promise<void> {
  return mutateArray<Stack>(KEYS.STACKS, (stacks) => {
    const index = stacks.findIndex((s) => s.id === id);
    if (index < 0) return stacks;
    const next = stacks.slice();
    next[index] = { ...stacks[index], ...updates };
    return next;
  });
}

export async function deleteStack(id: string): Promise<void> {
  return mutateArray<Stack>(KEYS.STACKS, (stacks) => stacks.filter((s) => s.id !== id));
}

/* ---------------------------------------------------------------------------
 * Scheduled events (calendar). See lib/scheduler.ts for the calendar side.
 * ------------------------------------------------------------------------- */

export async function getEvents(): Promise<ScheduledEvent[]> {
  return readJson<ScheduledEvent[]>(KEYS.EVENTS, []);
}

export async function addEvent(event: ScheduledEvent): Promise<void> {
  return mutateArray<ScheduledEvent>(KEYS.EVENTS, (events) => [...events, event]);
}

/**
 * Remove all stored events for an item and return the removed rows, so the
 * caller can delete their native calendar entries. Used to keep scheduling
 * idempotent (re-scheduling replaces rather than duplicates).
 */
export async function removeEventsForItem(itemId: string): Promise<ScheduledEvent[]> {
  let removed: ScheduledEvent[] = [];
  await mutateArray<ScheduledEvent>(KEYS.EVENTS, (events) => {
    removed = events.filter((e) => e.item_id === itemId);
    return events.filter((e) => e.item_id !== itemId);
  });
  return removed;
}

/* ---------------------------------------------------------------------------
 * Settings / user id
 * ------------------------------------------------------------------------- */

export async function getSettings(): Promise<UserSettings> {
  return readJson<UserSettings>(KEYS.SETTINGS, DEFAULT_SETTINGS);
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  return withLock(KEYS.SETTINGS, () => writeJson(KEYS.SETTINGS, settings));
}

/** Get or lazily create the anonymous per-device user id. */
export async function getUserId(): Promise<string> {
  try {
    let userId = await AsyncStorage.getItem(KEYS.USER_ID);
    if (!userId) {
      userId = newId('user');
      await AsyncStorage.setItem(KEYS.USER_ID, userId);
    }
    return userId;
  } catch (error) {
    console.error('Failed to get user ID:', error);
    return newId('user'); // ephemeral fallback (not persisted) when storage is unavailable
  }
}

/* ---------------------------------------------------------------------------
 * Sync bookkeeping (S1 — see SYNC.md and lib/sync.ts for the protocol side)
 * ------------------------------------------------------------------------- */

/** Persistent sync client state (cursor = server high-water mark). */
export interface SyncState {
  spaceKey: string | null;
  cursor: number;
  serverUrl: string | null;
  lastSyncAt: string | null;
  /**
   * The pairing code this device minted for itself, parked while an account
   * space is active. Signing out restores it, so the un-synced device goes back
   * to exactly the space it had rather than stranding its rows behind a new
   * random key.
   */
  localSpaceKey?: string | null;
}

/** A propagating delete: keeps the conflict clock of the moment of deletion. */
export interface SyncTombstone {
  id: string;
  updated_at: string;
}

const DEFAULT_SYNC_STATE: SyncState = {
  spaceKey: null,
  cursor: 0,
  serverUrl: null,
  lastSyncAt: null,
};

/** Sync state with defaults applied, so partial/unset stores never yield undefined fields. */
export async function getSyncState(): Promise<SyncState> {
  const stored = await readJson<Partial<SyncState>>(KEYS.SYNC_STATE, {});
  return { ...DEFAULT_SYNC_STATE, ...stored };
}

/** Merge a partial patch into the stored sync state (locked read-modify-write). */
export async function setSyncState(patch: Partial<SyncState>): Promise<void> {
  return withLock(KEYS.SYNC_STATE, async () => {
    const stored = await readJson<Partial<SyncState>>(KEYS.SYNC_STATE, {});
    await writeJson(KEYS.SYNC_STATE, { ...DEFAULT_SYNC_STATE, ...stored, ...patch });
  });
}

/** Item ids with local edits not yet pushed to the sync server. */
export async function getDirtyIds(): Promise<string[]> {
  const raw = await readJson<string[]>(KEYS.SYNC_DIRTY, []);
  return Array.isArray(raw) ? raw : [];
}

/** Append an id to the dirty set (deduped). Private: only local mutators dirty. */
async function markDirty(id: string): Promise<void> {
  return mutateArray<string>(KEYS.SYNC_DIRTY, (ids) =>
    ids.includes(id) ? ids : [...ids, id]
  );
}

/** Drop ids from the dirty set — call ONLY after the server accepted the push. */
export async function clearDirtyIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  return mutateArray<string>(KEYS.SYNC_DIRTY, (current) =>
    current.filter((id) => !drop.has(id))
  );
}

/** Local deletes not yet pushed to the sync server. */
export async function getTombstones(): Promise<SyncTombstone[]> {
  const raw = await readJson<SyncTombstone[]>(KEYS.SYNC_TOMBSTONES, []);
  return Array.isArray(raw) ? raw : [];
}

/** Drop pushed tombstones — call ONLY after the server accepted the push. */
export async function clearTombstones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  return mutateArray<SyncTombstone>(KEYS.SYNC_TOMBSTONES, (tombstones) =>
    tombstones.filter((t) => !drop.has(t.id))
  );
}

/**
 * Upsert an item arriving from sync, last-write-wins by `updated_at`. Runs
 * through the same locked/guarded path as user mutations but deliberately does
 * NOT mark the id dirty — applying a pulled change must never echo it back.
 */
export async function applyRemotePut(item: Item): Promise<void> {
  const incoming = normalizeItem(item); // backfills updated_at, tags, status…
  return mutateArray<Item>(KEYS.ITEMS, (items) => {
    const index = items.findIndex((it) => it.id === incoming.id);
    if (index < 0) return [incoming, ...items];
    // LWW: replace only when the incoming write is strictly newer. Stored items
    // may predate updated_at, so fall back to created_at as their clock.
    const localClock = items[index].updated_at ?? items[index].created_at ?? '';
    if (localClock >= (incoming.updated_at ?? '')) return items;
    const next = items.slice();
    next[index] = incoming;
    return next;
  });
}

/** Remove an item deleted remotely. No tombstone — that would echo the delete back. */
export async function applyRemoteDelete(id: string): Promise<void> {
  return mutateArray<Item>(KEYS.ITEMS, (items) => items.filter((it) => it.id !== id));
}

/* ---------------------------------------------------------------------------
 * Bulk / lifecycle
 * ------------------------------------------------------------------------- */

/** Replace items + stacks wholesale — used only by the dev seeder (lib/seed.ts). */
export async function replaceCollections(items: Item[], stacks: Stack[]): Promise<void> {
  await withLock(KEYS.STACKS, () => writeJson(KEYS.STACKS, stacks));
  await withLock(KEYS.ITEMS, () => writeJson(KEYS.ITEMS, items.map(normalizeItem)));
}

/** Clear all user data (Settings → "Delete all"), including sync bookkeeping. */
export async function clearAll(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      KEYS.ITEMS,
      KEYS.STACKS,
      KEYS.SETTINGS,
      KEYS.EVENTS,
      KEYS.SYNC_STATE,
      KEYS.SYNC_DIRTY,
      KEYS.SYNC_TOMBSTONES,
    ]);
  } catch (error) {
    console.error('Failed to clear storage:', error);
    throw new Error('Failed to clear storage');
  }
}

/**
 * One-time migration: normalize all stored items to the current schema and write
 * the result, then record the schema version so this only runs after an upgrade.
 * Safe on every launch (no-op once migrated). getItems() normalizes on read
 * regardless, so correctness never depends on this — it just writes the upgraded
 * shape back once.
 */
export async function runMigrations(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEYS.SCHEMA_VERSION);
    const version = stored ? parseInt(stored, 10) : 0;
    if (version >= CURRENT_SCHEMA_VERSION) return;

    await withLock(KEYS.ITEMS, async () => {
      const items = await getItems(); // normalized on read
      // Never write [] back: a transient empty read must not wipe a populated store.
      if (items.length > 0) await writeJson(KEYS.ITEMS, items);
      await AsyncStorage.setItem(KEYS.SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));
    });
    console.log(`[silo] storage migrated ${version} -> ${CURRENT_SCHEMA_VERSION}`);
  } catch (error) {
    // Never block app start on a migration failure; getItems() still normalizes on read.
    console.error('Storage migration failed (non-fatal):', error);
  }
}
