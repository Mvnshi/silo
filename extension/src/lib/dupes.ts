/**
 * Duplicate detection at save time. See spec §3 — when the user re-saves an
 * article they already have, we surface the existing item instead of creating
 * a near-identical second copy.
 *
 * Two strategies, in order of preference:
 *  1. URL match. Normalize both sides via `lib/url.ts` so utm/gclid/etc. noise
 *     collapses. Cheap: a single indexed IndexedDB lookup against every saved
 *     URL we've already normalized at write time (M3 keeps this loose — if the
 *     stored URL wasn't pre-normalized, we fall back to scanning recent items).
 *  2. Title match, when no URL is present (notes, screenshots-with-caption).
 *     Strip punctuation, collapse whitespace, lowercase, then require exact
 *     equality. Good enough for v1 — full fuzzy matching can layer on later.
 */
import type { Item } from './types';
import { getItems, getItemByUrl } from './store';
import { normalizeUrl } from './url';

export interface DuplicateCheck {
  isDupe: boolean;
  existingItem?: Item;
  /** 1.0 = exact normalized match, 0 = no match. Reserved for future fuzzy. */
  similarity?: number;
}

interface CheckInput {
  url?: string;
  title?: string;
}

/** Normalize a title for comparison: lowercase, strip punctuation, collapse ws. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function checkDuplicate(input: CheckInput): Promise<DuplicateCheck> {
  const { url, title } = input;

  if (url) {
    const normalized = normalizeUrl(url);
    // Fast path: items saved under the same exact URL string. Covers the common
    // case where the caller already normalized before insert.
    const directHit = await getItemByUrl(normalized);
    if (directHit) {
      return { isDupe: true, existingItem: directHit, similarity: 1 };
    }
    // Slow path: scan and normalize. Necessary for items saved before the
    // canonicalizer existed, or with a different querystring order.
    const all = await getItems();
    for (const item of all) {
      if (!item.url) continue;
      if (normalizeUrl(item.url) === normalized) {
        return { isDupe: true, existingItem: item, similarity: 1 };
      }
    }
    return { isDupe: false };
  }

  if (title) {
    const target = normalizeTitle(title);
    if (!target) return { isDupe: false };
    const all = await getItems();
    for (const item of all) {
      if (normalizeTitle(item.title) === target) {
        return { isDupe: true, existingItem: item, similarity: 1 };
      }
    }
    return { isDupe: false };
  }

  return { isDupe: false };
}
