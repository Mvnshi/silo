/**
 * Save-from-context actions — the pure functions that mint and persist an
 * Item for each entry point (right-click image / selection / link). Lives
 * here (not in menus.ts) so M2's spotlight content script can call the
 * exact same code path and behaviour stays identical across surfaces.
 *
 * Each function returns the created Item or throws. Toasting / menu wiring
 * is the caller's job — keep these pure so they're reusable.
 *
 * Every `url` is stored through `normalizeUrl` so the indexed fast path in
 * `lib/dupes.ts` can match it; saving the raw address means two captures of the
 * same page differing only in a utm tag land as two items.
 */
import type { Classification, Item } from '../types';
import { analyzeImage, extractLink } from '../api';
import { fetchImageAsBase64 } from '../image';
import { createItem } from '../items';
import { addItem } from '../store';
import { normalizeUrl } from '../url';

/** Best-effort classification map: the Worker returns a string; clamp it
 *  to the on-device union so Dexie doesn't reject the row. */
const VALID_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  'article', 'video', 'recipe', 'product', 'event', 'place',
  'idea', 'fitness', 'food', 'career', 'academia', 'other',
]);

function asClassification(value: string | undefined): Classification {
  return value && (VALID_CLASSIFICATIONS as Set<string>).has(value)
    ? (value as Classification)
    : 'other';
}

/** Right-click image → fetch + classify + save. */
export async function saveImage(srcUrl: string, pageUrl?: string): Promise<Item> {
  const { base64, mimeType } = await fetchImageAsBase64(srcUrl);
  const analysis = await analyzeImage(base64, mimeType);

  const item = createItem({
    type: 'image',
    classification: asClassification(analysis.classification),
    title: analysis.title || 'Saved image',
    description: analysis.description,
    imageUri: srcUrl,
    url: pageUrl ? normalizeUrl(pageUrl) : undefined,
    tags: analysis.tags ?? [],
  });
  await addItem(item);
  return item;
}

/** Right-click selection → quote save. No Worker call: highlights are
 *  cheap, classifying every snippet is overkill. Title = first 60 chars. */
export async function saveSelection(text: string, pageUrl?: string): Promise<Item> {
  const clean = text.trim();
  if (!clean) throw new Error('Empty selection');

  const title = clean.length > 60 ? `${clean.slice(0, 60).trimEnd()}…` : clean;
  const item = createItem({
    type: 'quote',
    classification: 'idea',
    title,
    quote: clean,
    url: pageUrl ? normalizeUrl(pageUrl) : undefined,
  });
  await addItem(item);
  return item;
}

/** Right-click link → extract metadata + save. */
export async function saveLink(url: string): Promise<Item> {
  const extracted = await extractLink({ url });

  const item = createItem({
    type: 'link',
    classification: asClassification(extracted.classification),
    title: extracted.title || url,
    description: extracted.description ?? extracted.caption,
    url: normalizeUrl(extracted.sourceUrl || url),
    imageUri: extracted.thumbnailUrl,
    tags: extracted.tags ?? [],
  });
  await addItem(item);
  return item;
}
