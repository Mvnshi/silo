/**
 * Shared-content import — the single pipeline for items that arrive from the iOS
 * Share Extension (targets/share). The extension writes shared payloads into the
 * App Group queue; the app drains that queue on foreground (drainPendingShares)
 * and runs each through the SAME extractor + classify path as in-app capture.
 *
 * Why the App Group (not a deep link): a Share Extension cannot reliably open
 * its host app via openURL on modern iOS, so the extension persists the share to
 * the shared App Group and the app picks it up next time it's foregrounded.
 * `@bacons/apple-targets`' ExtensionStorage is the JS bridge to that App Group
 * (and is a safe no-op in Expo Go, where the native module is absent).
 */
import { ExtensionStorage } from '@bacons/apple-targets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { extractLink, analyzeImage } from './api';
import { createItem } from './items';
import { addItem } from './storage';
import { detectPlatform } from './embed';
import { imageUriToBase64 } from './screenshots';
import { Classification, CLASSIFICATIONS } from './types';

export const SHARE_APP_GROUP = 'group.com.silo.app';
const PENDING_KEY = 'SiloPendingShares';
const LAST_SHARE_TS_KEY = '@silo:lastSharedTs';

export interface SharePayload {
  type?: string; // "url" | "text" | "image"
  value?: string; // url, text, or file:// path (image, in the App Group)
  category?: string; // a Classification, or "auto"
}

/** Import one shared payload into the store via the same pipeline as in-app capture. */
export async function importSharedItem(p: SharePayload): Promise<void> {
  const type = (p.type || 'url').toLowerCase();
  const value = typeof p.value === 'string' ? p.value : '';
  const cat = typeof p.category === 'string' ? p.category : '';
  const preset =
    cat && cat !== 'auto' && (CLASSIFICATIONS as readonly string[]).includes(cat) ? (cat as Classification) : undefined;

  if (!value) throw new Error('empty share payload');

  if (type === 'image') {
    // Always save the image — analysis is best-effort (needs the Gemini key);
    // a failure must not lose the user's save.
    let title = 'Shared image';
    let classification: Classification = preset || 'idea';
    let description: string | undefined;
    let tags: string[] = [];
    try {
      const base64 = await imageUriToBase64(value);
      const analysis = await analyzeImage(base64, 'image/jpeg');
      title = analysis.title || title;
      if (!preset) classification = analysis.classification;
      description = analysis.description;
      tags = analysis.tags || [];
    } catch (e) {
      console.warn('[silo] image analysis failed; saving the image without it:', e);
    }
    await addItem(
      createItem({ type: 'screenshot', classification, title, description, imageUri: value, tags })
    );
    return;
  }

  if (type === 'text' && !/^https?:\/\//i.test(value)) {
    await addItem(
      createItem({
        type: 'note',
        classification: preset || 'idea',
        title: value.slice(0, 60) || 'Shared note',
        description: value,
        notes: value,
        tags: [],
      })
    );
    return;
  }

  // URL (or shared text containing a URL) → the universal extractor.
  try {
    const r = await extractLink(value);
    await addItem(
      createItem({
        type: 'link',
        classification: preset || r.classification,
        title: r.title || value,
        description: r.description || r.caption,
        url: r.sourceUrl || value,
        imageUri: r.thumbnailUrl,
        author: r.author,
        platform: r.platform,
        tags: r.tags || [],
      })
    );
  } catch {
    // Backend unreachable → still save the raw link (never lose a save).
    await addItem(
      createItem({
        type: 'link',
        classification: preset || 'other',
        title: value,
        url: value,
        platform: detectPlatform(value),
        tags: [],
      })
    );
  }
}

/**
 * Drain everything the Share Extension queued into the App Group. Clears the
 * queue before importing so items aren't processed twice. Returns the count
 * imported. No-op (returns 0) when the native App Group bridge is unavailable.
 */
let draining = false;

export async function drainPendingShares(): Promise<number> {
  if (draining) return 0; // prevent overlapping mount + foreground runs
  draining = true;
  let count = 0;
  try {
    const storage = new ExtensionStorage(SHARE_APP_GROUP);
    const raw = storage.get(PENDING_KEY) as unknown;
    if (!raw || typeof raw !== 'string') return 0;

    let items: (SharePayload & { ts?: number })[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return 0;
    }
    if (items.length === 0) return 0;

    // Best-effort clear of the App Group queue. It may not flush if the app is
    // killed right after, so we ALSO dedupe by timestamp (AsyncStorage flushes
    // reliably) — that guarantees a share is never imported twice.
    try {
      storage.remove(PENDING_KEY);
    } catch {
      /* ignore */
    }

    const lastTs = Number((await AsyncStorage.getItem(LAST_SHARE_TS_KEY)) || '0');
    let maxTs = lastTs;
    for (const p of items) {
      const ts = typeof p.ts === 'number' ? p.ts : 0;
      if (ts && ts <= lastTs) continue; // already imported on a prior run
      try {
        await importSharedItem(p);
        count += 1;
      } catch (e) {
        console.warn('[silo] failed to import one shared item:', e);
      }
      if (ts > maxTs) maxTs = ts;
    }
    if (maxTs > lastTs) await AsyncStorage.setItem(LAST_SHARE_TS_KEY, String(maxTs));
  } catch {
    // ExtensionStorage native module absent (e.g. Expo Go) → nothing to drain.
  } finally {
    draining = false;
  }
  return count;
}
