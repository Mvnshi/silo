/**
 * Item construction helper — mirrors the phone's `lib/items.ts` `createItem`
 * signature so the eventual sync (spec §4.3) is a mechanical mapping. KEEP
 * IN SYNC with the phone: shape divergence here means corrupted syncs later.
 *
 * PURE — no I/O. Callers pass the result to `store.addItem` themselves.
 *
 * The phone's Phase-2 fields (`status`, `bucketlist_meta`) live on its
 * `Item`; the extension's `Item` doesn't yet model them and gains them in
 * M5 when sync lands. Until then this factory produces a Phase-1 shape that
 * the phone's `normalizeItem` happily upgrades on read.
 */
import type { Classification, Item, ItemType } from './types';

/** Current ISO timestamp. Recomputed inside the call so it can't be frozen. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Crypto-grade id; older runtimes lacking randomUUID get a near-equivalent. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `itm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Construct a complete, well-formed Item from a partial.
 *
 * Required: `type`, `classification`, `title`. Defaults: empty `tags`,
 * `archived=false`, `viewed=false`. `id` defaults to `crypto.randomUUID()`.
 * `created_at` and `updated_at` are sourced inside this call.
 *
 * Mirrors the phone's `createItem` signature so capture paths (popup, context
 * menus, spotlight, omnibox) all mint byte-identical Item shapes.
 */
export function createItem(
  partial: Partial<Item> & {
    type: ItemType;
    classification: Classification;
    title: string;
  }
): Item {
  const now = nowIso();
  const base: Item = {
    id: partial.id ?? newId(),
    type: partial.type,
    classification: partial.classification,
    title: partial.title,
    tags: partial.tags ?? [],
    archived: partial.archived ?? false,
    viewed: partial.viewed ?? false,
    created_at: partial.created_at ?? now,
    updated_at: now,
  };
  // Overlay caller fields last but pin updated_at so it's always "now".
  return { ...base, ...partial, updated_at: now };
}
