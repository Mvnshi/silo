/**
 * Trigger engine — the L2 centrepiece (VISION.md "The Context Ladder").
 *
 * `BucketCondition` has been modelled in `lib/types.ts` since Phase 2 with no
 * evaluator behind it, which meant a bucket-list item could describe exactly
 * when it becomes actionable and then sit there until the user happened to open
 * the app. This is the missing half: given the conditions plus whatever context
 * the device can supply right now, decide whether an item is **ready**, say why
 * in words a notification can use, and say what is still blocking it when it
 * isn't.
 *
 * Shape follows `lib/resurface.ts` deliberately:
 *
 *  - **Pure.** Clock and context arrive as arguments; nothing here imports expo,
 *    touches storage or renders. That makes every rule testable without a device
 *    (`node lib/scripts/verify-triggers.mjs`), which matters because most of
 *    these rules are calendar/geo edge cases that are miserable to reproduce by
 *    hand.
 *  - **Mutation builders, not mutations.** `buildReadinessPatch` returns a
 *    `Partial<Item>` for `storage.updateItem`; callers own persistence and sync.
 *
 * ## Unknown is not false
 *
 * The one rule that shapes the whole module: a condition we *cannot evaluate*
 * (no location fix, calendar permission refused) is `unknown`, never
 * "unsatisfied". An unknown condition blocks readiness — we will not claim
 * something is ready on a guess — but it is reported separately so the UI can
 * say "allow location to use this trigger" instead of the false "you're too far
 * away". Conflating the two is how a trigger engine silently stops firing.
 *
 * ## Everything is AND
 *
 * `BucketListMeta.readyNow` is documented as "every condition currently
 * satisfied", so conditions conjoin. Conditions are the item's own description
 * of when it is worth doing; an OR would fire on the loosest one and train the
 * user to ignore the notification.
 */
import { parseLocalDate, toLocalDateString } from './datetime';
import type { BucketCondition, BucketListMeta, Item } from './types';

/** How far ahead "you have a free slot" looks. Beyond this nobody is planning. */
export const FREE_SLOT_HORIZON_MINUTES = 240;
/** Don't re-notify about the same ready item more than once in this window. */
export const READY_NOTIFY_COOLDOWN_HOURS = 20;
/** Cap the ready lane, matching resurface.MAX_PER_LANE. */
export const MAX_READY_ITEMS = 3;

const HOUR_MS = 60 * 60 * 1000;

/* ---------------------------------------------------------------------------
 * Context
 * ------------------------------------------------------------------------- */

/** A calendar entry, structurally — avoids importing expo-calendar into a pure module. */
export interface BusyWindow {
  startDate: Date;
  endDate: Date;
}

/**
 * Everything the device knows right now. Every field beyond `now` is optional:
 * absent means "couldn't determine", which is what produces an `unknown`
 * verdict rather than a false negative.
 */
export interface TriggerContext {
  now: Date;
  /** Current coarse position, when permission is granted and a fix exists. */
  location?: { latitude: number; longitude: number } | null;
  /** Minutes free from `now` until the next commitment. See `freeMinutesFrom`. */
  freeMinutes?: number | null;
}

export interface ConditionVerdict {
  condition: BucketCondition;
  satisfied: boolean;
  /** Missing context — neither satisfied nor genuinely blocked. */
  unknown: boolean;
  /** Short fragment for the "why now" line, e.g. "250 m from the trailhead". */
  reason?: string;
  /** Short fragment for the "not yet" line, e.g. "4.2 km away, needs 500 m". */
  blocker?: string;
}

export interface Readiness {
  readyNow: boolean;
  /** Joined `reason` fragments — the notification body. Only set when ready. */
  readyReason?: string;
  /** Joined `blocker` fragments — the item-detail explanation. */
  blockedBy?: string;
  /** True when at least one condition couldn't be evaluated. */
  needsContext: boolean;
  verdicts: ConditionVerdict[];
  lastEvaluatedAt: string;
}

/* ---------------------------------------------------------------------------
 * Formatting — these strings are user-visible, so they live next to the rules
 * that produce them rather than in a screen.
 * ------------------------------------------------------------------------- */

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/** 18 → "6pm", 9 → "9am", 0 → "12am". */
function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDateLabel(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ---------------------------------------------------------------------------
 * Geo
 * ------------------------------------------------------------------------- */

/** Great-circle distance in METRES (conditions specify `radiusMeters`). */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------------------------------------------------------------------------
 * Calendar
 * ------------------------------------------------------------------------- */

/**
 * Minutes free from `now` until the next commitment, capped at the horizon.
 *
 * Inside an event → 0. No upcoming event → the full horizon (an empty calendar
 * is maximally free, not unknown). Pure, so the caller passes whatever windows
 * it already loaded rather than this module re-querying the calendar.
 */
export function freeMinutesFrom(
  busy: BusyWindow[],
  now: Date,
  horizonMinutes: number = FREE_SLOT_HORIZON_MINUTES
): number {
  const t = now.getTime();
  let nextStart = Infinity;
  for (const w of busy) {
    const start = w.startDate.getTime();
    const end = w.endDate.getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (start <= t && end > t) return 0; // mid-commitment
    if (start > t && start < nextStart) nextStart = start;
  }
  if (nextStart === Infinity) return horizonMinutes;
  return Math.max(0, Math.min(horizonMinutes, Math.round((nextStart - t) / 60_000)));
}

/* ---------------------------------------------------------------------------
 * Conditions
 * ------------------------------------------------------------------------- */

/**
 * The effective condition list for an item.
 *
 * `BucketListMeta` carries both an explicit `conditions` array and the
 * "convenience aggregates" (`locationTrigger`, `timeTrigger`,
 * `manualReminderAt`) that the capture UI writes for the common cases. Both are
 * real inputs, so the evaluator normalizes the aggregates into conditions
 * instead of quietly honouring only one shape.
 */
export function normalizeConditions(meta: BucketListMeta | undefined): BucketCondition[] {
  if (!meta) return [];
  const out: BucketCondition[] = [...(meta.conditions ?? [])];
  const has = (type: BucketCondition['type']) => out.some((c) => c.type === type);

  const loc = meta.locationTrigger;
  if (loc && !has('location_proximity')) {
    out.push({
      id: 'aggregate:location',
      type: 'location_proximity',
      latitude: loc.latitude,
      longitude: loc.longitude,
      radiusMeters: loc.radiusMeters,
      placeLabel: loc.placeLabel,
    });
  }

  const time = meta.timeTrigger;
  if (time) {
    if (time.startHour !== undefined && time.endHour !== undefined && !has('time_of_day')) {
      out.push({
        id: 'aggregate:time_of_day',
        type: 'time_of_day',
        startHour: time.startHour,
        endHour: time.endHour,
      });
    }
    if (time.daysOfWeek?.length && !has('day_of_week')) {
      out.push({ id: 'aggregate:day_of_week', type: 'day_of_week', daysOfWeek: time.daysOfWeek });
    }
    if (time.afterDate && time.beforeDate && !has('date_range')) {
      out.push({
        id: 'aggregate:date_range',
        type: 'date_range',
        startDate: time.afterDate,
        endDate: time.beforeDate,
      });
    } else if (time.afterDate && !has('date_after')) {
      out.push({ id: 'aggregate:date_after', type: 'date_after', date: time.afterDate });
    }
  }

  if (meta.manualReminderAt && !has('manual')) {
    out.push({ id: 'aggregate:manual', type: 'manual', remindAt: meta.manualReminderAt });
  }
  return out;
}

/** Is `hour` inside [start, end)? Handles windows that cross midnight (22 → 2). */
function withinHourWindow(hour: number, startHour: number, endHour: number): boolean {
  const s = ((startHour % 24) + 24) % 24;
  const e = ((endHour % 24) + 24) % 24;
  if (s === e) return true; // a zero-width window means "any time"
  if (s < e) return hour >= s && hour < e;
  return hour >= s || hour < e; // wraps midnight
}

export function evaluateCondition(condition: BucketCondition, ctx: TriggerContext): ConditionVerdict {
  const { now } = ctx;
  const base = { condition, unknown: false };

  switch (condition.type) {
    case 'location_proximity': {
      if (!ctx.location) {
        return {
          ...base,
          satisfied: false,
          unknown: true,
          blocker: 'needs your location',
        };
      }
      const meters = distanceMeters(ctx.location, condition);
      const where = condition.placeLabel ? ` from ${condition.placeLabel}` : ' away';
      if (meters <= condition.radiusMeters) {
        return { ...base, satisfied: true, reason: `${formatDistance(meters)}${where}` };
      }
      return {
        ...base,
        satisfied: false,
        blocker: `${formatDistance(meters)}${where}, needs ${formatDistance(condition.radiusMeters)}`,
      };
    }

    case 'time_of_day': {
      const window = `${hourLabel(condition.startHour)}–${hourLabel(condition.endHour)}`;
      if (withinHourWindow(now.getHours(), condition.startHour, condition.endHour)) {
        return { ...base, satisfied: true, reason: `it's your ${window} window` };
      }
      return { ...base, satisfied: false, blocker: `only between ${window}` };
    }

    case 'day_of_week': {
      const days = condition.daysOfWeek ?? [];
      if (days.length === 0) return { ...base, satisfied: true };
      if (days.includes(now.getDay())) {
        return { ...base, satisfied: true, reason: `it's ${DAY_NAMES[now.getDay()]}` };
      }
      const names = days.map((d) => DAY_NAMES[((d % 7) + 7) % 7]).join(' / ');
      return { ...base, satisfied: false, blocker: `only on ${names}` };
    }

    case 'date_after': {
      // Local midnight on the date itself — "after 1 June" includes 1 June.
      const start = parseLocalDate(condition.date);
      if (now.getTime() >= start.getTime()) {
        return { ...base, satisfied: true, reason: `it's past ${formatDateLabel(condition.date)}` };
      }
      return { ...base, satisfied: false, blocker: `not until ${formatDateLabel(condition.date)}` };
    }

    case 'date_range': {
      const today = toLocalDateString(now);
      // Compare as date strings so the end date is inclusive of its whole day —
      // a range ending "14 Jun" must still be satisfied at 14 Jun 18:00.
      const label = `${formatDateLabel(condition.startDate)}–${formatDateLabel(condition.endDate)}`;
      if (today >= condition.startDate && today <= condition.endDate) {
        return { ...base, satisfied: true, reason: `you're inside ${label}` };
      }
      return {
        ...base,
        satisfied: false,
        blocker: today < condition.startDate ? `not until ${label}` : `window closed (${label})`,
      };
    }

    case 'calendar_free': {
      if (ctx.freeMinutes == null) {
        return { ...base, satisfied: false, unknown: true, blocker: 'needs your calendar' };
      }
      if (ctx.freeMinutes >= condition.minFreeMinutes) {
        return { ...base, satisfied: true, reason: `you have ${formatMinutes(ctx.freeMinutes)} free` };
      }
      return {
        ...base,
        satisfied: false,
        blocker: `needs ${formatMinutes(condition.minFreeMinutes)} free, you have ${formatMinutes(ctx.freeMinutes)}`,
      };
    }

    case 'manual': {
      // No reminder set means the user gates this by hand — nothing to block on.
      if (!condition.remindAt) return { ...base, satisfied: true };
      const at = new Date(condition.remindAt).getTime();
      if (Number.isNaN(at)) return { ...base, satisfied: true };
      if (now.getTime() >= at) return { ...base, satisfied: true, reason: 'your reminder is due' };
      return { ...base, satisfied: false, blocker: 'reminder not due yet' };
    }

    default: {
      // An unknown condition type must never silently satisfy. Exhaustiveness is
      // checked at compile time; this is the runtime guard for older stored data.
      const _never: never = condition;
      void _never;
      return { condition, satisfied: false, unknown: true, blocker: 'unrecognised condition' };
    }
  }
}

/** Evaluate every condition on an item. No conditions → not a triggered item. */
export function evaluateItem(item: Item, ctx: TriggerContext): Readiness {
  const conditions = normalizeConditions(item.bucketlist_meta);
  const verdicts = conditions.map((c) => evaluateCondition(c, ctx));
  const needsContext = verdicts.some((v) => v.unknown);
  // An item with no conditions is never "ready" — readiness is a claim the item
  // made about itself, and a bare save made no claim.
  const readyNow = conditions.length > 0 && !needsContext && verdicts.every((v) => v.satisfied);

  const reasons = verdicts.map((v) => v.reason).filter((r): r is string => Boolean(r));
  const blockers = verdicts.filter((v) => !v.satisfied).map((v) => v.blocker).filter((b): b is string => Boolean(b));

  return {
    readyNow,
    readyReason: readyNow && reasons.length ? reasons.join(' · ') : undefined,
    blockedBy: !readyNow && blockers.length ? blockers.join(' · ') : undefined,
    needsContext,
    verdicts,
    lastEvaluatedAt: ctx.now.toISOString(),
  };
}

/* ---------------------------------------------------------------------------
 * Mutation builders
 * ------------------------------------------------------------------------- */

/**
 * A patch recording this evaluation, or **null when nothing meaningful changed**.
 *
 * The null case matters: evaluation runs on every foreground, and writing
 * `lastEvaluatedAt` each time would push a row through `updateItem` — and
 * therefore through sync — several times a session for every bucket-list item,
 * for no user-visible change. Only a flipped `readyNow` or a changed reason is
 * worth persisting.
 */
export function buildReadinessPatch(item: Item, readiness: Readiness): Partial<Item> | null {
  const meta = item.bucketlist_meta;
  if (!meta) return null;
  const changed =
    meta.readyNow !== readiness.readyNow || (meta.readyReason ?? undefined) !== readiness.readyReason;
  if (!changed) return null;
  return {
    bucketlist_meta: {
      ...meta,
      readyNow: readiness.readyNow,
      readyReason: readiness.readyReason,
      lastEvaluatedAt: readiness.lastEvaluatedAt,
      // A no-longer-ready item must forget it was announced, or the next time it
      // becomes ready the cooldown would suppress the notification.
      notifiedAt: readiness.readyNow ? meta.notifiedAt : undefined,
    },
  };
}

/** Record that we announced this item, so the cooldown starts. */
export function buildNotifiedPatch(item: Item, now: Date = new Date()): Partial<Item> | null {
  const meta = item.bucketlist_meta;
  if (!meta) return null;
  return { bucketlist_meta: { ...meta, notifiedAt: now.toISOString() } };
}

/** Ready, and not announced inside the cooldown. */
export function shouldNotifyReady(item: Item, now: Date = new Date()): boolean {
  const meta = item.bucketlist_meta;
  if (!meta?.readyNow) return false;
  if (!meta.notifiedAt) return true;
  const last = new Date(meta.notifiedAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= READY_NOTIFY_COOLDOWN_HOURS * HOUR_MS;
}

/* ---------------------------------------------------------------------------
 * Looking ahead — scheduling a trigger before it fires
 * ------------------------------------------------------------------------- */

/**
 * Conditions whose truth is a pure function of the clock, and can therefore be
 * predicted. `location_proximity` and `calendar_free` cannot: where you will be
 * and what your afternoon looks like are not knowable now, so an item carrying
 * either is only ever evaluated live (`evaluateItem`) while the app is open.
 *
 * That is a deliberate privacy line as much as a technical one. Predicting a
 * location trigger would mean background geofencing and an "Always" location
 * grant; Silo asks for while-in-use only, and says so in its App Store strings.
 */
const CLOCK_ONLY_TYPES: ReadonlySet<BucketCondition['type']> = new Set([
  'time_of_day',
  'date_after',
  'date_range',
  'day_of_week',
  'manual',
]);

/** How far ahead to look for a rising edge. iOS caps pending locals at 64. */
export const LOOKAHEAD_DAYS = 14;
/** Granularity of the scan. Every clock condition changes on an hour boundary
 *  at the finest, except `manual`, whose exact instant is added as a candidate. */
const SCAN_STEP_MINUTES = 15;

/** True when every condition on this item is predictable from the clock alone. */
export function isSchedulable(item: Item): boolean {
  const conditions = normalizeConditions(item.bucketlist_meta);
  return conditions.length > 0 && conditions.every((c) => CLOCK_ONLY_TYPES.has(c.type));
}

/**
 * The next instant this item **becomes** ready — a rising edge, not merely a
 * moment when it happens to be ready.
 *
 * The distinction matters: an item that is ready right now and stays ready all
 * evening should not produce a notification a minute from now. What deserves an
 * interruption is the transition — "the window you asked for just opened".
 * Something already ready is surfaced by the daily digest and by Today instead.
 *
 * Returns null when the item carries a condition that cannot be predicted, or
 * when no rising edge falls inside the lookahead.
 */
export function nextReadyAt(
  item: Item,
  from: Date = new Date(),
  horizonDays: number = LOOKAHEAD_DAYS
): Date | null {
  if (!isSchedulable(item)) return null;

  const conditions = normalizeConditions(item.bucketlist_meta);
  const readyAt = (when: Date) =>
    conditions.every((c) => evaluateCondition(c, { now: when }).satisfied);

  const startMs = from.getTime();
  const endMs = startMs + horizonDays * 24 * 60 * 60 * 1000;
  const stepMs = SCAN_STEP_MINUTES * 60 * 1000;

  // Scan on a fixed grid, plus the exact instant of any manual reminder — those
  // are user-chosen wall-clock times and rarely land on a 15-minute boundary.
  const candidates: number[] = [];
  for (let t = startMs + stepMs; t <= endMs; t += stepMs) candidates.push(t);
  for (const c of conditions) {
    if (c.type !== 'manual' || !c.remindAt) continue;
    const at = new Date(c.remindAt).getTime();
    if (!Number.isNaN(at) && at > startMs && at <= endMs) candidates.push(at);
  }
  candidates.sort((a, b) => a - b);

  let previous = readyAt(from);
  for (const t of candidates) {
    const current = readyAt(new Date(t));
    if (current && !previous) return new Date(t);
    previous = current;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------- */

/** Retired / archived / already-done items never fire. Mirrors resurface.isOff. */
function isOff(item: Item): boolean {
  return (
    item.archived === true ||
    item.status === 'archived' ||
    item.rating === 'retired' ||
    item.status === 'done' ||
    item.bucketlist_completed === true
  );
}

export interface ReadyItem {
  item: Item;
  readiness: Readiness;
}

/**
 * Every item whose conditions are met right now, most-specific first.
 *
 * Ranking: more satisfied conditions wins, because an item that asked for
 * "near the trailhead, on a weekend, with 2 hours free" and got all three is a
 * far better recommendation than one that only asked for "after June".
 */
export function getReadyItems(
  items: Item[],
  ctx: TriggerContext,
  limit: number = MAX_READY_ITEMS
): ReadyItem[] {
  const ready: ReadyItem[] = [];
  for (const item of items) {
    if (isOff(item) || !item.bucketlist_meta) continue;
    const readiness = evaluateItem(item, ctx);
    if (readiness.readyNow) ready.push({ item, readiness });
  }
  return ready
    .sort((a, b) => {
      const spec = b.readiness.verdicts.length - a.readiness.verdicts.length;
      if (spec !== 0) return spec;
      return new Date(a.item.created_at).getTime() - new Date(b.item.created_at).getTime();
    })
    .slice(0, limit);
}
