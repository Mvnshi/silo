/**
 * Resurfacing stats — the numbers behind Silo's north-star metric.
 *
 * VISION.md: *"Actions taken per week from saved items (resurfacing rate) — not
 * saves, not opens. Silo wins when things you saved actually happen."* This
 * module is that metric, made visible.
 *
 * The deliberate design choice: **progress is earned by USING things, never by
 * saving them.** A hoarder with 4,000 saves and no follow-through stays at level
 * one. That inverts the incentive every other save-it-later app creates, and it
 * is the only scoreboard consistent with the product thesis.
 *
 * Everything here is a pure function of the item list plus a clock, so it is
 * trivially testable and screen-agnostic (same contract as lib/resurface.ts).
 */
import { Item } from './types';
import { STALE_DAYS } from './resurface';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Window used for the headline rate. Long enough to be stable, short enough to move. */
export const RATE_WINDOW_DAYS = 30;

/**
 * Level thresholds, keyed on LIFETIME uses (completions of saved items).
 * Deliberately steep at the top: the last tier should take months of real use,
 * not a weekend of tapping "done".
 */
export const LEVELS: readonly { level: number; name: string; at: number }[] = [
  { level: 1, name: 'Collector', at: 0 },
  { level: 2, name: 'Starter', at: 1 },
  { level: 3, name: 'Doer', at: 5 },
  { level: 4, name: 'Finisher', at: 15 },
  { level: 5, name: 'Regular', at: 40 },
  { level: 6, name: 'Compounder', at: 100 },
  { level: 7, name: 'Silo native', at: 250 },
] as const;

export interface LevelProgress {
  level: number;
  name: string;
  /** Uses at which this level was reached. */
  from: number;
  /** Uses needed for the next level, or null at the cap. */
  next: number | null;
  /** 0–1 through the current tier (1 when capped). */
  progress: number;
}

export interface SiloStats {
  /** Non-archived items currently in the library. */
  totalSaves: number;
  savedThisWeek: number;
  /** Lifetime completions — every `times_done` bump across every item. */
  totalUses: number;
  usedThisWeek: number;
  usedLastWeek: number;
  /**
   * The north star: uses ÷ saves over RATE_WINDOW_DAYS, as a 0–1 ratio.
   * `null` when nothing was saved in the window (a rate over zero is noise,
   * not a 0% score — never shame a user for a quiet month).
   */
  resurfacingRate: number | null;
  /** Consecutive weeks with at least one use, counting back from this week. */
  streakWeeks: number;
  /** Items neither scheduled, done, nor opened in STALE_DAYS+ days. */
  staleCount: number;
  /** staleCount ÷ totalSaves — the hoard signal. 0 when the library is empty. */
  hoardRatio: number;
  level: LevelProgress;
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function ms(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function isActive(item: Item): boolean {
  return item.archived !== true && item.status !== 'archived';
}

/**
 * The instant an item was last "used". Prefers the explicit habit timestamp,
 * falls back to completion, so items completed before the resurfacing engine
 * shipped still count.
 */
function lastUsedAt(item: Item): number | null {
  return ms(item.last_done_at) ?? ms(item.completed_at);
}

/** True if this item has ever been acted on. */
function hasBeenUsed(item: Item): boolean {
  return (item.times_done ?? 0) > 0 || item.status === 'done' || !!item.completed_at;
}

/** Uses recorded for one item — `times_done` is authoritative once present. */
function useCount(item: Item): number {
  const n = item.times_done ?? 0;
  if (n > 0) return n;
  return hasBeenUsed(item) ? 1 : 0;
}

/** Start of the week (Monday 00:00 local) containing `t`. */
function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday. Shift so Monday is the first day.
  const offset = (d.getDay() + 6) % 7;
  return d.getTime() - offset * DAY_MS;
}

/** Resolve lifetime uses to a level and the progress through it. */
export function levelFor(totalUses: number): LevelProgress {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalUses >= LEVELS[i].at) index = i;
  }
  const current = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  const span = next ? next.at - current.at : 0;
  const progress = next && span > 0 ? Math.min(1, (totalUses - current.at) / span) : 1;
  return {
    level: current.level,
    name: current.name,
    from: current.at,
    next: next ? next.at : null,
    progress,
  };
}

/* ---------------------------------------------------------------------------
 * The computation
 * ------------------------------------------------------------------------- */

/**
 * Compute every headline number in one pass. `now` is injectable so the screen
 * and its tests can agree on "this week".
 */
export function computeStats(items: Item[], now: Date = new Date()): SiloStats {
  const t = now.getTime();
  const thisWeek = weekStart(t);
  const lastWeek = thisWeek - WEEK_MS;
  const windowStart = t - RATE_WINDOW_DAYS * DAY_MS;
  const staleCutoff = t - STALE_DAYS * DAY_MS;

  const active = items.filter(isActive);

  let totalUses = 0;
  let usedThisWeek = 0;
  let usedLastWeek = 0;
  let savedThisWeek = 0;
  let savedInWindow = 0;
  let usedInWindow = 0;
  let staleCount = 0;

  for (const item of items) {
    // Uses count even after archiving — the action still happened.
    totalUses += useCount(item);

    const used = lastUsedAt(item);
    if (used !== null) {
      if (used >= thisWeek) usedThisWeek++;
      else if (used >= lastWeek) usedLastWeek++;
      if (used >= windowStart) usedInWindow++;
    }

    const created = ms(item.created_at);
    if (created !== null) {
      if (created >= thisWeek) savedThisWeek++;
      if (created >= windowStart) savedInWindow++;
    }

    // Staleness mirrors resurface.getStaleItems, minus its display cap.
    if (
      isActive(item) &&
      !item.scheduled_date &&
      item.status !== 'done' &&
      !item.bucketlist_completed &&
      item.rating !== 'retired' &&
      created !== null &&
      created <= staleCutoff &&
      (ms(item.last_seen_at) ?? created) <= staleCutoff
    ) {
      staleCount++;
    }
  }

  return {
    totalSaves: active.length,
    savedThisWeek,
    totalUses,
    usedThisWeek,
    usedLastWeek,
    resurfacingRate: savedInWindow > 0 ? Math.min(1, usedInWindow / savedInWindow) : null,
    streakWeeks: computeStreak(items, t),
    staleCount,
    hoardRatio: active.length > 0 ? staleCount / active.length : 0,
    level: levelFor(totalUses),
  };
}

/**
 * Consecutive weeks containing at least one use, counting back from the current
 * week. The current week is a grace period: a streak built through last week
 * survives until this week ends, so opening the app on a Monday never shows a
 * streak that just collapsed to zero.
 */
export function computeStreak(items: Item[], nowMs: number = Date.now()): number {
  const weeks = new Set<number>();
  for (const item of items) {
    const used = lastUsedAt(item);
    if (used !== null) weeks.add(weekStart(used));
  }
  if (weeks.size === 0) return 0;

  const current = weekStart(nowMs);
  let cursor = weeks.has(current) ? current : current - WEEK_MS;
  let streak = 0;
  while (weeks.has(cursor)) {
    streak++;
    cursor -= WEEK_MS;
  }
  return streak;
}

export interface WeekBucket {
  /** Monday 00:00 local, as epoch ms. */
  start: number;
  uses: number;
  saves: number;
}

/**
 * Uses and saves bucketed by week, oldest first, ending with the current week.
 * Always returns exactly `weeks` entries — empty weeks are real information
 * (they are the gaps in the habit) and must not be dropped from the chart.
 */
export function usesByWeek(items: Item[], weeks = 12, now: Date = new Date()): WeekBucket[] {
  const current = weekStart(now.getTime());
  const buckets: WeekBucket[] = [];
  const index = new Map<number, WeekBucket>();
  for (let i = weeks - 1; i >= 0; i--) {
    const bucket = { start: current - i * WEEK_MS, uses: 0, saves: 0 };
    buckets.push(bucket);
    index.set(bucket.start, bucket);
  }

  for (const item of items) {
    const used = lastUsedAt(item);
    if (used !== null) {
      const b = index.get(weekStart(used));
      if (b) b.uses++;
    }
    const created = ms(item.created_at);
    if (created !== null) {
      const b = index.get(weekStart(created));
      if (b) b.saves++;
    }
  }

  return buckets;
}

/**
 * Items worth offering up for a tidy-up, worst first (oldest unseen).
 * Unlike `getStaleItems` this is uncapped — the cleanup flow pages through it.
 */
export function getCleanupCandidates(items: Item[], now: Date = new Date()): Item[] {
  const cutoff = now.getTime() - STALE_DAYS * DAY_MS;
  return items
    .filter((item) => {
      if (!isActive(item) || item.rating === 'retired') return false;
      if (item.scheduled_date) return false;
      if (item.status === 'done' || item.bucketlist_completed) return false;
      const created = ms(item.created_at);
      if (created === null || created > cutoff) return false;
      return (ms(item.last_seen_at) ?? created) <= cutoff;
    })
    .sort((a, b) => {
      const av = ms(a.last_seen_at) ?? ms(a.created_at) ?? 0;
      const bv = ms(b.last_seen_at) ?? ms(b.created_at) ?? 0;
      return av - bv;
    });
}

/** Human phrasing for the rate — a bare percentage reads like a grade. */
export function describeRate(rate: number | null): string {
  if (rate === null) return 'Save a few things and this fills in';
  const pct = Math.round(rate * 100);
  if (pct >= 60) return `${pct}% of what you save, you actually do`;
  if (pct >= 30) return `${pct}% of your saves turn into something`;
  return `${pct}% of your saves turn into something — the rest are waiting`;
}
