/**
 * AsyncStorage Wrapper
 * 
 * This module provides a type-safe wrapper around React Native's AsyncStorage
 * for persisting app data locally on the device. All items, stacks, and user
 * settings are stored here.
 * 
 * Storage Keys:
 * - @silo:items - Array of Item objects
 * - @silo:stacks - Array of Stack objects
 * - @silo:settings - UserSettings object
 * - @silo:events - Array of ScheduledEvent objects
 * 
 * Dependencies:
 * - @react-native-async-storage/async-storage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Item, Stack, UserSettings, ScheduledEvent } from './types';
import { normalizeItem } from './items';

// Storage keys
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

/**
 * Serialize all item read-modify-write mutations so concurrent callers (e.g. two
 * rapid swipes) cannot interleave and lose updates. Each mutation waits for the
 * previous to settle. Errors are isolated so one failure doesn't wedge the queue.
 */
let itemsWriteChain: Promise<unknown> = Promise.resolve();
function withItemsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = itemsWriteChain.then(fn, fn);
  itemsWriteChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Get all items from storage
 */
export async function getItems(): Promise<Item[]> {
  try {
    const json = await AsyncStorage.getItem(KEYS.ITEMS);
    if (!json) return [];
    const raw = JSON.parse(json) as Item[];
    // Idempotently upgrade legacy/partial items to the unified schema on every read.
    return Array.isArray(raw) ? raw.map(normalizeItem) : [];
  } catch (error) {
    console.error('Failed to load items:', error);
    return [];
  }
}

/**
 * Save items to storage
 */
export async function saveItems(items: Item[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('Failed to save items:', error);
    throw new Error('Failed to save items');
  }
}

/**
 * Get a single item by ID
 */
export async function getItemById(id: string): Promise<Item | null> {
  const items = await getItems();
  return items.find(item => item.id === id) || null;
}

/**
 * Add a new item
 */
export async function addItem(item: Item): Promise<void> {
  return withItemsLock(async () => {
    const items = await getItems();
    items.unshift(normalizeItem(item)); // Add to beginning
    await saveItems(items);
  });
}

/**
 * Update an existing item
 */
export async function updateItem(id: string, updates: Partial<Item>): Promise<void> {
  return withItemsLock(async () => {
    const items = await getItems();
    const index = items.findIndex(item => item.id === id);
    if (index >= 0) {
      const merged: Item = {
        ...items[index],
        ...updates,
        updated_at: new Date().toISOString(),
      };
      // Maintain completed_at when an item transitions to done.
      const becameDone =
        updates.status === 'done' || updates.bucketlist_completed === true;
      if (becameDone && !merged.completed_at) {
        merged.completed_at = merged.updated_at;
      }
      items[index] = merged;
      await saveItems(items);
    }
  });
}

/**
 * Delete an item
 */
export async function deleteItem(id: string): Promise<void> {
  return withItemsLock(async () => {
    const items = await getItems();
    const filtered = items.filter(item => item.id !== id);
    await saveItems(filtered);
  });
}

/**
 * Get all stacks from storage
 */
export async function getStacks(): Promise<Stack[]> {
  try {
    const json = await AsyncStorage.getItem(KEYS.STACKS);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Failed to load stacks:', error);
    return [];
  }
}

/**
 * Save stacks to storage
 */
export async function saveStacks(stacks: Stack[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.STACKS, JSON.stringify(stacks));
  } catch (error) {
    console.error('Failed to save stacks:', error);
    throw new Error('Failed to save stacks');
  }
}

/**
 * Get a single stack by ID
 */
export async function getStackById(id: string): Promise<Stack | null> {
  const stacks = await getStacks();
  return stacks.find(stack => stack.id === id) || null;
}

/**
 * Add a new stack
 */
export async function addStack(stack: Stack): Promise<void> {
  const stacks = await getStacks();
  stacks.push(stack);
  await saveStacks(stacks);
}

/**
 * Update an existing stack
 */
export async function updateStack(id: string, updates: Partial<Stack>): Promise<void> {
  const stacks = await getStacks();
  const index = stacks.findIndex(stack => stack.id === id);
  if (index >= 0) {
    stacks[index] = { ...stacks[index], ...updates };
    await saveStacks(stacks);
  }
}

/**
 * Delete a stack
 */
export async function deleteStack(id: string): Promise<void> {
  const stacks = await getStacks();
  const filtered = stacks.filter(stack => stack.id !== id);
  await saveStacks(filtered);
}

/**
 * Get user settings
 */
export async function getSettings(): Promise<UserSettings> {
  try {
    const json = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (json) {
      return JSON.parse(json);
    }
    // Default settings
    return {
      notifications_enabled: true,
      auto_schedule: true,
      default_duration: 15,
      preferred_review_times: ['09:00', '14:00', '19:00'],
      theme: 'auto',
    };
  } catch (error) {
    console.error('Failed to load settings:', error);
    return {
      notifications_enabled: true,
      auto_schedule: true,
      default_duration: 15,
      preferred_review_times: ['09:00', '14:00', '19:00'],
      theme: 'auto',
    };
  }
}

/**
 * Save user settings
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw new Error('Failed to save settings');
  }
}

/**
 * Get scheduled events
 */
export async function getEvents(): Promise<ScheduledEvent[]> {
  try {
    const json = await AsyncStorage.getItem(KEYS.EVENTS);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Failed to load events:', error);
    return [];
  }
}

/**
 * Save scheduled events
 */
export async function saveEvents(events: ScheduledEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.EVENTS, JSON.stringify(events));
  } catch (error) {
    console.error('Failed to save events:', error);
    throw new Error('Failed to save events');
  }
}

/**
 * Get or create user ID
 */
export async function getUserId(): Promise<string> {
  try {
    let userId = await AsyncStorage.getItem(KEYS.USER_ID);
    if (!userId) {
      // Generate a unique user ID
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem(KEYS.USER_ID, userId);
    }
    return userId;
  } catch (error) {
    console.error('Failed to get user ID:', error);
    // Fallback to a device-based ID
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Clear all storage (use with caution)
 */
export async function clearAll(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      KEYS.ITEMS,
      KEYS.STACKS,
      KEYS.SETTINGS,
      KEYS.EVENTS,
    ]);
  } catch (error) {
    console.error('Failed to clear storage:', error);
    throw new Error('Failed to clear storage');
  }
}

/**
 * One-time data migration: normalize all stored items to the current schema and
 * persist the result, then record the schema version so this only runs after an
 * upgrade. Safe to call on every app launch (no-op once migrated). getItems()
 * normalizes on read regardless, so correctness never depends on this — it just
 * writes the upgraded shape back once and avoids repeated work.
 */
export async function runMigrations(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEYS.SCHEMA_VERSION);
    const version = stored ? parseInt(stored, 10) : 0;
    if (version >= CURRENT_SCHEMA_VERSION) return;

    await withItemsLock(async () => {
      const items = await getItems(); // getItems() already normalizes
      await saveItems(items);
      await AsyncStorage.setItem(
        KEYS.SCHEMA_VERSION,
        String(CURRENT_SCHEMA_VERSION)
      );
    });
    console.log(`[silo] storage migrated ${version} -> ${CURRENT_SCHEMA_VERSION}`);
  } catch (error) {
    // Never block app start on a migration failure; getItems() still normalizes on read.
    console.error('Storage migration failed (non-fatal):', error);
  }
}

