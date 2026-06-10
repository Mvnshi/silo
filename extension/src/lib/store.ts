/**
 * IndexedDB store via Dexie. Mirrors the phone's `lib/storage.ts` API so the
 * eventual sync (spec §4.3) is a 1:1 mapping. KEEP THE PUBLIC API IDENTICAL
 * to the phone's — if you rename or change a signature here, change it there.
 *
 * v1 schema mirrors `lib/types.ts` `Item` and `Stack` shapes exactly.
 * v2 will add `savedViews` (Smart Spaces), `linkedRefs` (bidirectional links),
 * and `snapshots` (full-HTML page captures).
 */
import Dexie, { type Table } from 'dexie';
import type { Item, Stack } from './types';

class SiloDB extends Dexie {
  items!: Table<Item, string>;
  stacks!: Table<Stack, string>;

  constructor() {
    super('silo');
    this.version(1).stores({
      // Indexes mirror the most common phone-side queries.
      items: 'id, created_at, classification, stack_id, archived, viewed',
      stacks: 'id, name',
    });
  }
}

const db = new SiloDB();

export async function getItems(): Promise<Item[]> {
  return db.items.orderBy('created_at').reverse().toArray();
}

export async function addItem(item: Item): Promise<void> {
  await db.items.add(item);
}

export async function updateItem(id: string, updates: Partial<Item>): Promise<void> {
  await db.items.update(id, { ...updates, updated_at: new Date().toISOString() });
}

export async function deleteItem(id: string): Promise<void> {
  await db.items.delete(id);
}

export async function getItemByUrl(url: string): Promise<Item | undefined> {
  return db.items.where('url').equals(url).first();
}
