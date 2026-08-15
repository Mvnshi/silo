/**
 * Local search over saved items. See spec §3 — instant query from the omnibox
 * and the popup with no network round-trip.
 *
 * Strategy: keep a single in-memory snapshot of every item plus a pre-tokenized
 * field map (title / tags / description). Rebuild lazily on first call and
 * whenever Dexie reports a write. Rebuilds are debounced so a burst of saves
 * (e.g. bulk import) collapses into one IndexedDB pass.
 *
 * No external search library on purpose: 10k items is well within what a plain
 * loop can rank in <10ms, and we want zero supply-chain surface area for a
 * background script.
 */
import type { Item } from './types';
import { getItems, onItemsChanged } from './store';

interface IndexedItem {
  item: Item;
  titleTokens: Set<string>;
  tagTokens: Set<string>;
  descTokens: Set<string>;
}

let index: IndexedItem[] | null = null;
let buildingPromise: Promise<IndexedItem[]> | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let hooksInstalled = false;

/** Lowercase, split on non-alphanumerics, drop empties. Inline by design. */
function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

function buildEntry(item: Item): IndexedItem {
  return {
    item,
    titleTokens: new Set(tokenize(item.title)),
    tagTokens: new Set(item.tags.flatMap((t) => tokenize(t))),
    descTokens: new Set(tokenize(item.description ?? '')),
  };
}

async function rebuild(): Promise<IndexedItem[]> {
  const items = await getItems();
  const built = items.map(buildEntry);
  index = built;
  return built;
}

/**
 * Hook into Dexie's per-table events so any write in this context invalidates
 * the cache. Debounced 150ms so a burst of inserts (paste-many, import) only
 * triggers one rebuild.
 *
 * Subscribes through `store.onItemsChanged` rather than opening its own Dexie
 * handle: hooks are per-instance, so a second handle would never see the
 * writes store.ts makes (and, declaring an older schema version, would fail to
 * open at all).
 */
function installInvalidationHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  onItemsChanged(() => {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      index = null;
      buildingPromise = null;
    }, 150);
  });
}

async function ensureIndex(): Promise<IndexedItem[]> {
  installInvalidationHooks();
  if (index) return index;
  if (buildingPromise) return buildingPromise;
  buildingPromise = rebuild().finally(() => {
    buildingPromise = null;
  });
  return buildingPromise;
}

function scoreEntry(entry: IndexedItem, queryTokens: string[]): number {
  let score = 0;
  for (const qt of queryTokens) {
    // Substring within any token of the field counts as a hit. We pre-split
    // into a Set so the .some() over each set is O(field-tokens) per query
    // token. Plenty fast for realistic libraries.
    let hit = false;
    for (const t of entry.titleTokens) {
      if (t.includes(qt)) {
        score += 3;
        hit = true;
        break;
      }
    }
    for (const t of entry.tagTokens) {
      if (t.includes(qt)) {
        score += 2;
        hit = true;
        break;
      }
    }
    for (const t of entry.descTokens) {
      if (t.includes(qt)) {
        score += 1;
        hit = true;
        break;
      }
    }
    // A query token that matches nothing knocks the entry out entirely.
    if (!hit) return 0;
  }
  return score;
}

/**
 * Rank items by weighted token-presence: title hit = 3, tag hit = 2, description
 * hit = 1. Returns items with score > 0 sorted descending. Empty query returns
 * the most-recent N items so the omnibox isn't blank when the user is still
 * thinking.
 */
export async function searchItems(query: string, limit = 8): Promise<Item[]> {
  const idx = await ensureIndex();
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return idx.slice(0, limit).map((e) => e.item);
  }
  const scored: Array<{ item: Item; score: number }> = [];
  for (const entry of idx) {
    const s = scoreEntry(entry, tokens);
    if (s > 0) scored.push({ item: entry.item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

/** Test seam — let callers force a rebuild (e.g. after a known external write). */
export function invalidateSearchIndex(): void {
  index = null;
  buildingPromise = null;
}
