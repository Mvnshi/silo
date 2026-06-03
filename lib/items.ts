/**
 * Item helpers — construction, status derivation, and idempotent normalization.
 *
 * This module is the single source of truth for turning raw/legacy stored data
 * into a well-formed `Item` (the Phase 2 unified schema). It is PURE (no I/O) and
 * must not import `./storage` (storage imports this — keep the dependency one-way).
 *
 * `normalizeItem` is idempotent: running it twice yields the same result. It is
 * applied on every read in `storage.getItems` so legacy/partial items are always
 * safe, and once more (with write-back) by `storage.runMigrations` at boot.
 */

import {
  Item,
  ItemStatus,
  GeoLocation,
  Classification,
  ItemType,
} from './types';

/** Generate a collision-resistant id with a semantic prefix. */
export function newId(prefix = 'item'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Current ISO timestamp. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Derive the unified lifecycle status from an item's fields, including the
 * legacy booleans (viewed/archived/bucketlist/bucketlist_completed).
 * Priority: archived > done > bucketed > scheduled > inbox.
 */
export function computeStatus(item: Partial<Item>): ItemStatus {
  if (item.archived) return 'archived';
  if (item.bucketlist_completed || item.completed_at) return 'done';
  if (item.bucketlist) return 'bucketed';
  if (item.scheduled_date) return 'scheduled';
  return 'inbox';
}

/**
 * Idempotently upgrade a raw/legacy item to the unified schema.
 * - guarantees `tags` is an array
 * - back-fills `updated_at` from `created_at`
 * - derives `status` from legacy booleans when absent
 * - lifts flat `place_*` fields into structured `location`
 * - initializes `bucketlist_meta` for bucket-listed items
 * Never fabricates a `completed_at` timestamp it cannot justify.
 */
export function normalizeItem(raw: Item): Item {
  // Defensive copy so callers' objects aren't mutated.
  const item: Item = { ...raw };

  if (!Array.isArray(item.tags)) {
    item.tags = item.tags ? [item.tags as unknown as string] : [];
  }

  if (!item.created_at) item.created_at = nowIso();
  if (!item.updated_at) item.updated_at = item.created_at;

  // Flat place_* -> structured location (only when location is absent).
  if (
    !item.location &&
    typeof item.place_latitude === 'number' &&
    typeof item.place_longitude === 'number'
  ) {
    const loc: GeoLocation = {
      latitude: item.place_latitude,
      longitude: item.place_longitude,
    };
    if (item.place_address) loc.address = item.place_address;
    if (item.place_name) loc.name = item.place_name;
    item.location = loc;
  }

  if (!item.status) item.status = computeStatus(item);

  // A bucket-listed item must carry an evaluation container.
  if (item.bucketlist && !item.bucketlist_meta) {
    item.bucketlist_meta = { conditions: [] };
  }

  return item;
}

/** Construct a complete, well-formed Item from a partial. Used by all capture paths. */
export function createItem(
  partial: Partial<Item> & {
    type: ItemType;
    classification: Classification;
    title: string;
  }
): Item {
  const now = nowIso();
  const base: Item = {
    id: partial.id ?? newId('item'),
    type: partial.type,
    classification: partial.classification,
    title: partial.title,
    tags: partial.tags ?? [],
    created_at: partial.created_at ?? now,
    updated_at: now,
    viewed: partial.viewed ?? false,
    archived: partial.archived ?? false,
  };
  // Overlay caller fields, then normalize to derive status/location/etc.
  return normalizeItem({ ...base, ...partial, updated_at: now });
}

/**
 * Return a copy of `item` with `updates` applied plus maintained timestamps.
 * Sets `updated_at`, and `completed_at` when the item transitions to done.
 * (Storage.updateItem also enforces this, so call sites can stay unchanged.)
 */
export function touchItem(item: Item, updates: Partial<Item>): Item {
  const now = nowIso();
  const next: Item = { ...item, ...updates, updated_at: now };
  const becameDone =
    updates.status === 'done' || updates.bucketlist_completed === true;
  if (becameDone && !next.completed_at) next.completed_at = now;
  if (updates.status === undefined) next.status = computeStatus(next);
  return next;
}
