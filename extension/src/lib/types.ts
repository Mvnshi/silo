/**
 * Item / Stack shape. KEEP IN SYNC with the phone's `lib/types.ts` — the sync
 * mechanism (spec §4.3) requires byte-identical schemas on both ends.
 *
 * If you change this, change `app/.../lib/types.ts` in lockstep AND bump the
 * Dexie schema version in `store.ts` with a migration.
 */
export type Classification =
  | 'article'
  | 'video'
  | 'recipe'
  | 'product'
  | 'event'
  | 'place'
  | 'idea'
  | 'fitness'
  | 'food'
  | 'career'
  | 'academia'
  | 'other';

export type ItemType = 'link' | 'screenshot' | 'note' | 'quote' | 'image';

export interface Item {
  id: string;
  type: ItemType;
  classification: Classification;
  title: string;
  description?: string;
  url?: string;
  imageUri?: string;
  tags: string[];
  stack_id?: string;
  /** Quote items: the selected text from the source page. */
  quote?: string;
  /** Extension-specific: dominant hex colors extracted client-side. */
  colors?: string[];
  /** OCR'd text from images (image type). */
  ocr_text?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  archived: boolean;
  viewed: boolean;
  bucketlist?: boolean;
  bucketlist_completed?: boolean;
  pinned_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Stack {
  id: string;
  name: string;
  color: string;
  item_count: number;
  created_at: string;
}
