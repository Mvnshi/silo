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
};

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
  return mutateArray<Item>(KEYS.ITEMS, (items) => [normalized, ...items]);
}

/** Apply a partial update to an item, maintaining `updated_at` / `completed_at`. */
export async function updateItem(id: string, updates: Partial<Item>): Promise<void> {
  return mutateArray<Item>(KEYS.ITEMS, (items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return items;
    // touchItem maintains updated_at / completed_at and re-derives status.
    const next = items.slice();
    next[index] = touchItem(items[index], updates);
    return next;
  });
}

export async function deleteItem(id: string): Promise<void> {
  return mutateArray<Item>(KEYS.ITEMS, (items) => items.filter((item) => item.id !== id));
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
 * Bulk / lifecycle
 * ------------------------------------------------------------------------- */

/** Replace items + stacks wholesale — used only by the dev seeder (lib/seed.ts). */
export async function replaceCollections(items: Item[], stacks: Stack[]): Promise<void> {
  await withLock(KEYS.STACKS, () => writeJson(KEYS.STACKS, stacks));
  await withLock(KEYS.ITEMS, () => writeJson(KEYS.ITEMS, items.map(normalizeItem)));
}

/** Clear all user data (Settings → "Delete all"). */
export async function clearAll(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEYS.ITEMS, KEYS.STACKS, KEYS.SETTINGS, KEYS.EVENTS]);
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
