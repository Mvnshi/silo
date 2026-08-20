/**
 * Assistant action execution — the impure half of `lib/assistant.ts`.
 *
 * `lib/assistant.ts` decides what a proposal is allowed to be; this runs one.
 * The split mirrors `lib/triggers.ts` (pure rules) vs `lib/notifications.ts`
 * (the device work): everything that needs a simulator lives here, so the rules
 * that decide whether a row may change stay testable without one.
 *
 * ## Every action is undoable
 *
 * `runAction` captures whatever it is about to overwrite BEFORE it writes, and
 * returns an `undo` that puts it back. That is what lets the assistant follow
 * the app's own convention — apply optimistically, offer Undo in the Toast,
 * never a blocking confirm — even though the model, not the user, chose the
 * rows. (The user still chooses whether to run it at all: proposals are cards
 * they tap. See `components/assistant/ActionCard.tsx`.)
 *
 * Undo restores the fields the action touched and nothing else, so a change the
 * user made in between is preserved rather than rolled back with it.
 *
 * ## Partial failure is reported, not swallowed
 *
 * A ten-item archive where two writes fail must not claim ten. `runAction`
 * returns how many rows it actually changed, and the caller's toast says that
 * number.
 */
import * as Calendar from 'expo-calendar';
import type { AssistantAction } from './assistant';
import { actionItemIds } from './assistant';
import { buildReview } from './resurface';
import { normalizeConditions } from './triggers';
import { scheduleItemReview } from './scheduler';
import { createItem } from './items';
import {
  addEvent,
  addItem,
  deleteItem,
  getItemById,
  removeEventsForItem,
  updateItem,
} from './storage';
import type { BucketListMeta, Item, ScheduledEvent } from './types';

export interface ActionResult {
  /** Rows actually written. Zero means nothing happened — say so. */
  changed: number;
  /** Rows that were targeted but failed (gone, permission refused, I/O). */
  failed: number;
  /** Puts back exactly what this run overwrote. Safe to call once. */
  undo: () => Promise<void>;
  /** Set when the whole action could not run at all (e.g. calendar refused). */
  error?: string;
}

const NOOP_UNDO = async () => {};

/** The fields `buildReview` writes, so undo can restore precisely those. */
const REVIEW_FIELDS = [
  'rating',
  'wants_again',
  'times_done',
  'last_done_at',
  'last_reviewed_at',
  'completed_at',
  'status',
  'viewed',
  'scheduled_date',
  'scheduled_time',
] as const satisfies readonly (keyof Item)[];

/**
 * Snapshot the listed keys of an item.
 *
 * `undefined` is preserved deliberately: `buildReview` clears `scheduled_date`
 * by setting it to `undefined`, and an undo that omitted the key would leave the
 * slot cleared. Restoring the shape means restoring the absences too.
 */
function snapshot<K extends keyof Item>(item: Item, keys: readonly K[]): Partial<Item> {
  const out: Partial<Item> = {};
  for (const key of keys) out[key] = item[key];
  return out;
}

/** Load the targeted items, skipping any that vanished since the proposal. */
async function loadTargets(action: AssistantAction): Promise<Item[]> {
  const ids = actionItemIds(action);
  const found = await Promise.all(ids.map((id) => getItemById(id).catch(() => null)));
  return found.filter((item): item is Item => item !== null);
}

/**
 * Apply the same patch to many items, snapshotting each first.
 *
 * Writes run in parallel but are counted individually, so a partial failure
 * reports the real number and undo only covers what genuinely changed.
 */
async function applyToEach(
  targets: Item[],
  keys: readonly (keyof Item)[],
  patchFor: (item: Item) => Partial<Item>
): Promise<ActionResult> {
  const restored: { id: string; patch: Partial<Item> }[] = [];
  let failed = 0;

  await Promise.all(
    targets.map(async (item) => {
      const before = snapshot(item, keys);
      try {
        await updateItem(item.id, patchFor(item));
        restored.push({ id: item.id, patch: before });
      } catch (error) {
        console.warn('[silo] assistant action write failed', item.id, error);
        failed += 1;
      }
    })
  );

  return {
    changed: restored.length,
    failed,
    undo: async () => {
      await Promise.all(
        restored.map(({ id, patch }) => updateItem(id, patch).catch(() => {}))
      );
    },
  };
}

/* ---------------------------------------------------------------------------
 * The verbs
 * ------------------------------------------------------------------------- */

/**
 * Put a real event on the real calendar.
 *
 * `scheduleItemReview` is idempotent per item — it removes any prior review
 * event, native and stored, before creating the new one — so undo has to
 * restore BOTH halves: delete the event we created, and re-create the one we
 * displaced. Without the second half, "schedule it for Saturday" followed by
 * Undo would silently lose a slot the user had set themselves.
 */
async function runSchedule(
  action: Extract<AssistantAction, { tool: 'schedule' }>,
  targets: Item[]
): Promise<ActionResult> {
  const item = targets[0];
  if (!item) return { changed: 0, failed: 1, undo: NOOP_UNDO, error: 'That item is gone.' };

  // Captured before scheduleItemReview clears them.
  const priorSlot = snapshot(item, ['scheduled_date', 'scheduled_time', 'status']);
  const priorEvents = await displacedEvents(item.id);

  const duration = action.duration ?? (item.duration && item.duration > 0 ? item.duration : 15);
  const created = await scheduleItemReview(item, action.date, action.time, duration);
  if (!created) {
    return {
      changed: 0,
      failed: 1,
      undo: NOOP_UNDO,
      // scheduleItemReview swallows the specific cause; permission is by far
      // the likeliest, and it is the one the user can fix.
      error: 'Couldn’t reach your calendar — check Silo’s calendar permission.',
    };
  }

  await updateItem(item.id, {
    scheduled_date: action.date,
    scheduled_time: action.time,
    duration,
  });

  return {
    changed: 1,
    failed: 0,
    undo: async () => {
      // Drop what we made, native side included.
      const ours = await removeEventsForItem(item.id).catch(() => [] as ScheduledEvent[]);
      for (const event of ours) {
        if (event.calendar_event_id) {
          await Calendar.deleteEventAsync(event.calendar_event_id).catch(() => {});
        }
      }
      // Then put back the slot (and any event) we displaced.
      await updateItem(item.id, priorSlot).catch(() => {});
      for (const event of priorEvents) {
        await restoreEvent(item, event).catch(() => {});
      }
    },
  };
}

/**
 * The stored events `scheduleItemReview` is about to remove. Read-only — it
 * does its own removal; this just remembers what was there.
 */
async function displacedEvents(itemId: string): Promise<ScheduledEvent[]> {
  const events = await removeEventsForItem(itemId).catch(() => [] as ScheduledEvent[]);
  // Put them straight back: this is a peek, not a delete. scheduleItemReview
  // removes them properly (native entry included) a moment later.
  for (const event of events) await addEvent(event).catch(() => {});
  return events;
}

/** Re-create a displaced event, native entry and stored row. */
async function restoreEvent(item: Item, event: ScheduledEvent): Promise<void> {
  const restored = await scheduleItemReview(item, event.date, event.time, event.duration);
  if (restored) {
    await updateItem(item.id, { scheduled_date: event.date, scheduled_time: event.time });
  }
}

/**
 * Mark items done through `buildReview` — never a bare `viewed: true`. A
 * completion that doesn't bump `times_done` never reaches the north-star metric,
 * which would make "mark the ramen done" look like it worked while quietly
 * failing at the only thing the app measures.
 */
function runComplete(
  action: Extract<AssistantAction, { tool: 'complete' }>,
  targets: Item[]
): Promise<ActionResult> {
  return applyToEach(targets, REVIEW_FIELDS, (item) => buildReview(item, action.outcome));
}

/** Archive: off every surface, still recoverable. Mirrors ItemActionSheet. */
function runArchive(targets: Item[]): Promise<ActionResult> {
  return applyToEach(targets, ['archived', 'status'], () => ({
    archived: true,
    status: 'archived',
  }));
}

/**
 * Attach a trigger condition.
 *
 * Existing conditions are kept and the new one appended — conditions conjoin
 * (lib/triggers.ts, "Everything is AND"), so replacing the set would quietly
 * loosen a gate the user set by hand. `normalizeConditions` first, so an item
 * whose conditions live in the legacy `locationTrigger`/`timeTrigger` aggregates
 * keeps them instead of having them stranded behind the new array.
 */
function runSetTrigger(
  action: Extract<AssistantAction, { tool: 'set_trigger' }>,
  targets: Item[]
): Promise<ActionResult> {
  return applyToEach(targets, ['bucketlist_meta', 'bucketlist', 'status'], (item) => {
    const existing = normalizeConditions(item.bucketlist_meta);
    const meta: BucketListMeta = {
      ...(item.bucketlist_meta ?? { conditions: [] }),
      conditions: [...existing, action.condition],
      // The readiness verdict was computed against the old condition set and is
      // now stale; clearing it makes the next evaluation re-derive rather than
      // inherit a "ready" that no longer holds.
      readyNow: undefined,
      readyReason: undefined,
      lastEvaluatedAt: undefined,
    };
    // A conditioned item belongs on the bucket list — that is the surface the
    // trigger engine feeds.
    return { bucketlist_meta: meta, bucketlist: true, status: 'bucketed' };
  });
}

/** Save something new. The only verb that grounds on nothing, because it
 *  invents a row rather than touching one. */
async function runAdd(
  action: Extract<AssistantAction, { tool: 'add' }>
): Promise<ActionResult> {
  const item = createItem({
    type: 'note',
    classification: action.classification,
    title: action.title,
    description: action.note,
    tags: action.tags,
  });
  try {
    await addItem(item);
  } catch (error) {
    console.warn('[silo] assistant add failed', error);
    return { changed: 0, failed: 1, undo: NOOP_UNDO, error: 'Couldn’t save that.' };
  }
  return {
    changed: 1,
    failed: 0,
    undo: async () => {
      await deleteItem(item.id).catch(() => {});
    },
  };
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------- */

/**
 * Run one validated action. Never throws: a failure comes back as
 * `{ changed: 0, error }` so the caller can put it in a toast rather than an
 * unhandled rejection.
 */
export async function runAction(action: AssistantAction): Promise<ActionResult> {
  try {
    if (action.tool === 'add') return await runAdd(action);

    const targets = await loadTargets(action);
    if (targets.length === 0) {
      return {
        changed: 0,
        failed: actionItemIds(action).length,
        undo: NOOP_UNDO,
        error: 'Those items are no longer there.',
      };
    }
    // Items that disappeared between the proposal and the tap count as failures
    // rather than being silently dropped from the total.
    const missing = actionItemIds(action).length - targets.length;

    let result: ActionResult;
    switch (action.tool) {
      case 'schedule':
        result = await runSchedule(action, targets);
        break;
      case 'complete':
        result = await runComplete(action, targets);
        break;
      case 'archive':
        result = await runArchive(targets);
        break;
      case 'set_trigger':
        result = await runSetTrigger(action, targets);
        break;
    }
    return { ...result, failed: result.failed + missing };
  } catch (error) {
    console.error('[silo] assistant action failed', error);
    return { changed: 0, failed: 1, undo: NOOP_UNDO, error: 'That didn’t go through.' };
  }
}

/** Past-tense confirmation for the toast: "Archived 6 items". */
export function confirmationMessage(action: AssistantAction, changed: number): string {
  const noun = changed === 1 ? 'item' : 'items';
  switch (action.tool) {
    case 'schedule':
      return 'Added to your calendar';
    case 'complete':
      return action.outcome === 'skipped'
        ? `Marked ${changed} ${noun} skipped`
        : `Marked ${changed} ${noun} done`;
    case 'archive':
      return `Archived ${changed} ${noun}`;
    case 'add':
      return 'Saved';
    case 'set_trigger':
      return changed === 1 ? 'Reminder set' : `Reminder set on ${changed} items`;
  }
}
