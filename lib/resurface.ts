/**
 * Resurfacing & feedback engine — the loop that keeps saves from rotting.
 *
 * This is the "act → learn" half of the VISION loop (capture → recommend →
 * act → learn). Three mechanics, all derived as PURE functions from the item
 * list + clock so they're trivially testable and screen-agnostic:
 *
 *  1. After-event report  — a scheduled thing's time has passed without a
 *     verdict → ask "How did it go?" (getPendingReviews).
 *  2. Staleness nudge     — a card you haven't OPENED in weeks → "Still want
 *     this?" (getStaleItems).
 *  3. Repeatables         — something you loved, off-cooldown → re-recommend
 *     ("you loved this last time") (isRepeatableDue / repeatableScore).
 *
 * The mutation builders (buildReview etc.) return a Partial<Item> for
 * storage.updateItem — they never touch storage themselves, so callers control
 * persistence + sync. `last_seen_at` is the one exception: it's ambient and
 * written via storage.touchSeen (local, unsynced).
 */
import { Item, ItemRating } from './types';
import { parseLocalDate } from './datetime';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Not opened in this many days → eligible for the "still want this?" nudge. */
export const STALE_DAYS = 21;
/** A loved item is re-recommendable again this many days after you last did it. */
export const REPEAT_COOLDOWN_DAYS = 7;
/** Don't overwhelm: cap each resurfacing lane shown at once. */
export const MAX_PER_LANE = 3;

/* ---------------------------------------------------------------------------
 * Derivations
 * ------------------------------------------------------------------------- */

/** End instant of an item's scheduled slot (start + duration), or null if unscheduled. */
export function scheduledEnd(item: Item): Date | null {
  if (!item.scheduled_date) return null;
  // parseLocalDate avoids the UTC off-by-one of new Date('YYYY-MM-DD').
  const start = parseLocalDate(item.scheduled_date, item.scheduled_time || '09:00');
  const mins = typeof item.duration === 'number' && item.duration > 0 ? item.duration : 15;
  return new Date(start.getTime() + mins * 60 * 1000);
}

/** True if the item is retired or archived — excluded from ALL resurfacing. */
function isOff(item: Item): boolean {
  return item.archived === true || item.status === 'archived' || item.rating === 'retired';
}

/**
 * Items whose scheduled slot has elapsed and haven't been reported since. The
 * after-event report queue, newest-elapsed first.
 */
export function getPendingReviews(items: Item[], now: Date = new Date()): Item[] {
  return items
    .filter((item) => {
      if (isOff(item)) return false;
      const end = scheduledEnd(item);
      if (!end || end > now) return false; // not scheduled, or hasn't happened yet
      // Already reported for this (or a later) slot?
      if (item.last_reviewed_at && new Date(item.last_reviewed_at).getTime() >= end.getTime()) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (scheduledEnd(b)?.getTime() ?? 0) - (scheduledEnd(a)?.getTime() ?? 0))
    .slice(0, MAX_PER_LANE);
}

/**
 * Items you saved a while ago and haven't OPENED in {STALE_DAYS}+ days. Needs
 * enough history (created that long ago) so brand-new saves aren't nagged.
 * Excludes scheduled / pending-review / done / off items. Oldest-seen first.
 */
export function getStaleItems(items: Item[], now: Date = new Date()): Item[] {
  const pendingIds = new Set(getPendingReviews(items, now).map((i) => i.id));
  const cutoff = now.getTime() - STALE_DAYS * DAY_MS;
  return items
    .filter((item) => {
      if (isOff(item) || pendingIds.has(item.id)) return false;
      if (item.scheduled_date) return false; // it's on the calendar
      if (item.status === 'done' || item.bucketlist_completed) return false;
      const created = new Date(item.created_at).getTime();
      if (Number.isNaN(created) || created > cutoff) return false; // too new to judge
      const seen = item.last_seen_at ? new Date(item.last_seen_at).getTime() : created;
      return seen <= cutoff;
    })
    .sort((a, b) => seenTime(a) - seenTime(b))
    .slice(0, MAX_PER_LANE);
}

function seenTime(item: Item): number {
  return item.last_seen_at
    ? new Date(item.last_seen_at).getTime()
    : new Date(item.created_at).getTime();
}

/** A loved item, off-cooldown, not currently scheduled → ripe to suggest again. */
export function isRepeatableDue(item: Item, now: Date = new Date()): boolean {
  if (item.rating !== 'loved' || !item.wants_again || isOff(item)) return false;
  if (item.scheduled_date) return false;
  if (!item.last_done_at) return false;
  return now.getTime() - new Date(item.last_done_at).getTime() >= REPEAT_COOLDOWN_DAYS * DAY_MS;
}

/* ---------------------------------------------------------------------------
 * Mutation builders — return Partial<Item> for storage.updateItem
 * ------------------------------------------------------------------------- */

/** Possible answers to "How did it go?". */
export type ReviewOutcome = 'loved' | 'good' | 'skipped' | 'retire';

/**
 * Apply an after-event verdict. "Did it" (loved/good) marks the item done,
 * clears its calendar slot, bumps the habit counter, and — for 'loved' — flags
 * it for re-recommendation. "Skipped" just records the report (caller may then
 * offer a reschedule). "Retire" archives it for good.
 */
export function buildReview(item: Item, outcome: ReviewOutcome, now: Date = new Date()): Partial<Item> {
  const iso = now.toISOString();
  if (outcome === 'retire') {
    return { rating: 'retired', archived: true, status: 'archived', last_reviewed_at: iso };
  }
  if (outcome === 'skipped') {
    // Leave it where it is but stop nagging for this elapsed slot.
    return { rating: 'skipped', last_reviewed_at: iso };
  }
  const rating: ItemRating = outcome === 'loved' ? 'loved' : 'good';
  return {
    rating,
    wants_again: outcome === 'loved',
    times_done: (item.times_done ?? 0) + 1,
    last_done_at: iso,
    last_reviewed_at: iso,
    completed_at: iso,
    status: 'done',
    viewed: true,
    // Clear the elapsed slot so it leaves the calendar; a 'loved' item is
    // re-surfaced later by isRepeatableDue, not by a stale calendar entry.
    scheduled_date: undefined,
    scheduled_time: undefined,
  };
}

// "Keep" a stale item is just storage.touchSeen(id) — resets the seen-clock
// (local, unsynced). "Archive" is storage.updateItem(id, { archived: true,
// status: 'archived' }). Both live at the call site so persistence + sync stay
// the caller's concern.
