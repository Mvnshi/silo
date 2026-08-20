/**
 * Assistant action layer — the model's proposals, made safe.
 *
 * The assistant can now do things, not just answer. This module is the part
 * that decides what "do things" is allowed to mean. It is PURE — no storage, no
 * calendar, no UI — for the same reason `lib/triggers.ts` is: every rule here is
 * about refusing a bad instruction, and rules like that need to be testable
 * without a device (`node scripts/verify-assistant.mjs`). Execution lives next
 * door in `lib/assistantExec.ts`.
 *
 * ## Grounding survives tool-calling
 *
 * The read-only assistant was grounded by a prompt ("never invent saved
 * content"). A prompt is not enough once the model can mutate rows: a
 * hallucinated id in prose is a wrong sentence, a hallucinated id in a tool call
 * is the wrong row archived. So grounding here is STRUCTURAL, in three layers:
 *
 *  1. The model never sees an item id. The Worker numbers the retrieved items
 *     `[1]…[N]` and the model answers in those numbers, so the only thing it can
 *     emit is a small integer.
 *  2. The Worker maps those numbers back to the ids IT was sent, dropping any
 *     out of range (`workers/gemini.ts`).
 *  3. `parseActions` below re-checks every id against the grounding set the
 *     CLIENT sent. An id the client did not supply cannot survive, whatever the
 *     Worker returns.
 *
 * An id can therefore only ever be one the device itself put on the wire. There
 * is no path from "the model made something up" to "a row changed".
 *
 * ## Nothing here applies anything
 *
 * `parseActions` returns *proposals*. Every action is rendered as a card the
 * user taps, so a multi-item action shows exactly which rows it will touch
 * before it touches them. See `components/assistant/ActionCard.tsx`.
 */
import { CLASSIFICATIONS } from './types';
import type {
  BucketCondition,
  BucketConditionType,
  Classification,
  Item,
} from './types';

/* ---------------------------------------------------------------------------
 * The vocabulary
 * ------------------------------------------------------------------------- */

/**
 * What the assistant is allowed to propose. Deliberately Silo's OWN verbs and
 * nothing else — each one maps to a function that already exists and is already
 * used by a button somewhere in the app:
 *
 *   schedule    → lib/scheduler.scheduleItemReview (a real calendar event)
 *   complete    → lib/resurface.buildReview        (reaches the north-star metric)
 *   archive     → storage.updateItem
 *   add         → lib/items.createItem + storage.addItem
 *   set_trigger → BucketCondition on bucketlist_meta (lib/triggers evaluates it)
 *
 * Adding a verb means adding a real capability, so the list is the security
 * boundary as much as it is the feature set. VISION.md rules out agentic
 * execution — booking, emailing, buying — and nothing here crosses that line:
 * every verb writes to the user's own library or their own calendar.
 */
export const ASSISTANT_TOOLS = [
  'schedule',
  'complete',
  'archive',
  'add',
  'set_trigger',
] as const;

export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

/** Outcomes the assistant may report. 'retire' is deliberately absent — that is
 *  `archive`'s job, and giving the model two ways to remove things is one too
 *  many. Mirrors `ReviewOutcome` in lib/resurface minus that case. */
export const ASSISTANT_OUTCOMES = ['loved', 'good', 'skipped'] as const;
export type AssistantOutcome = (typeof ASSISTANT_OUTCOMES)[number];

/** Put a real calendar event on the user's calendar. Always exactly one item —
 *  two things can't occupy one slot, and `scheduleItemReview` is per-item. */
export interface ScheduleAction {
  tool: 'schedule';
  itemIds: [string];
  /** YYYY-MM-DD, local. */
  date: string;
  /** HH:MM, 24h, local. */
  time: string;
  /** Minutes; defaults to the item's own estimate at execution time. */
  duration?: number;
}

/** Mark items done through buildReview, so `times_done` moves. */
export interface CompleteAction {
  tool: 'complete';
  itemIds: string[];
  outcome: AssistantOutcome;
}

/** Take items off every surface without deleting them. */
export interface ArchiveAction {
  tool: 'archive';
  itemIds: string[];
}

/** Save something new. Touches no existing row, so it needs no grounding. */
export interface AddAction {
  tool: 'add';
  title: string;
  classification: Classification;
  note?: string;
  tags: string[];
}

/** Attach a condition the trigger engine will evaluate (lib/triggers.ts). */
export interface TriggerAction {
  tool: 'set_trigger';
  itemIds: string[];
  /** Fully-formed and validated; the `id` is minted here, never by the model. */
  condition: BucketCondition;
}

export type AssistantAction =
  | ScheduleAction
  | CompleteAction
  | ArchiveAction
  | AddAction
  | TriggerAction;

/** True for the actions that carry a set of existing items. `add` does not. */
export function actionItemIds(action: AssistantAction): string[] {
  return action.tool === 'add' ? [] : action.itemIds;
}

/* ---------------------------------------------------------------------------
 * Wire shape
 * ------------------------------------------------------------------------- */

/**
 * One action exactly as it arrives from the Worker.
 *
 * Every field past `tool` is optional, and that is on purpose. Gemini's
 * `responseSchema` is an OpenAPI subset whose union support is the shakiest part
 * of the surface; a discriminated union of five differently-shaped objects is
 * the thing most likely to make a request fail outright. So the schema
 * constrains the SHAPE — an array of one flat, permissive object — and this
 * module constrains the MEANING. That split puts every strict decision in
 * TypeScript, where it can be unit-tested, instead of in a remote validator
 * whose behaviour changes with the model version.
 */
export interface RawAssistantAction {
  tool?: string;
  /** Item ids, already mapped from `[n]` references by the Worker. */
  itemIds?: unknown;
  date?: unknown;
  time?: unknown;
  duration?: unknown;
  outcome?: unknown;
  title?: unknown;
  classification?: unknown;
  note?: unknown;
  tags?: unknown;
  condition?: RawCondition;
}

/** A trigger condition as it arrives — same all-optional treatment. */
export interface RawCondition {
  type?: string;
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
  placeLabel?: unknown;
  startHour?: unknown;
  endHour?: unknown;
  date?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  daysOfWeek?: unknown;
  minFreeMinutes?: unknown;
  remindAt?: unknown;
}

/* ---------------------------------------------------------------------------
 * Field coercion — every one of these returns null rather than a default
 * ------------------------------------------------------------------------- */

/**
 * A guessed value is worse than no action. `lib/triggers.ts` refuses to call an
 * item ready on a guess for exactly this reason, and a tool call deserves the
 * same treatment: a missing date must drop the proposal, not silently become
 * tomorrow at 09:00. Every coercion below therefore fails closed.
 */

function str(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** YYYY-MM-DD that is also a real calendar date (rejects 2026-02-31). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // Day 0 of the next month is the last day of this one.
  return d <= new Date(y, m, 0).getDate();
}

/** HH:MM, 24-hour. */
export function isValidTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function int(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n >= min && n <= max ? n : null;
}

function num(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= min && value <= max ? value : null;
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const s = str(entry, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------- */

/** How many rows one proposed action may touch. See `parseActions`. */
export const MAX_ACTION_ITEMS = 50;

/** How many actions one answer may propose, so a card list stays readable. */
export const MAX_ACTIONS = 5;

/**
 * Keep only ids that are genuinely in the grounding set, in the order the model
 * gave them, without duplicates. THIS is layer 3 of the grounding chain — the
 * client re-checking the Worker's work against what the client itself sent.
 */
function groundIds(value: unknown, grounded: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !grounded.has(entry) || out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= MAX_ACTION_ITEMS) break;
  }
  return out;
}

/** Mint a condition id. Never the model's — an id it chose could collide with
 *  an existing condition and silently replace it. */
function conditionId(index: number): string {
  return `assistant_${Date.now().toString(36)}_${index}`;
}

const CONDITION_TYPES: readonly BucketConditionType[] = [
  'location_proximity',
  'time_of_day',
  'date_after',
  'date_range',
  'day_of_week',
  'calendar_free',
  'manual',
];

/**
 * Build a `BucketCondition` from raw model output, or null.
 *
 * Each branch demands the fields its type genuinely needs — a
 * `location_proximity` with no coordinates is not a weak condition, it is a
 * condition that would never fire, and an item silently gated on one is an item
 * the user has lost.
 */
export function parseCondition(raw: RawCondition | undefined, index = 0): BucketCondition | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type as BucketConditionType;
  if (!CONDITION_TYPES.includes(type)) return null;
  const id = conditionId(index);

  switch (type) {
    case 'location_proximity': {
      const latitude = num(raw.latitude, -90, 90);
      const longitude = num(raw.longitude, -180, 180);
      if (latitude === null || longitude === null) return null;
      // A default radius IS safe here, unlike a default coordinate: it only
      // widens or narrows a fence the model already placed deliberately.
      const radiusMeters = int(raw.radiusMeters, 50, 100000) ?? 1000;
      const placeLabel = str(raw.placeLabel, 80) ?? undefined;
      return { id, type, latitude, longitude, radiusMeters, placeLabel };
    }
    case 'time_of_day': {
      const startHour = int(raw.startHour, 0, 23);
      const endHour = int(raw.endHour, 0, 23);
      if (startHour === null || endHour === null) return null;
      return { id, type, startHour, endHour };
    }
    case 'date_after': {
      if (!isValidDate(raw.date)) return null;
      return { id, type, date: raw.date };
    }
    case 'date_range': {
      if (!isValidDate(raw.startDate) || !isValidDate(raw.endDate)) return null;
      // A backwards range can never be satisfied — drop it rather than store a
      // condition that silently blocks the item forever.
      if (raw.endDate < raw.startDate) return null;
      return { id, type, startDate: raw.startDate, endDate: raw.endDate };
    }
    case 'day_of_week': {
      if (!Array.isArray(raw.daysOfWeek)) return null;
      const days = Array.from(
        new Set(
          raw.daysOfWeek
            .map((d) => int(d, 0, 6))
            .filter((d): d is number => d !== null)
        )
      ).sort();
      if (days.length === 0) return null;
      return { id, type, daysOfWeek: days };
    }
    case 'calendar_free': {
      const minFreeMinutes = int(raw.minFreeMinutes, 5, 1440);
      if (minFreeMinutes === null) return null;
      return { id, type, minFreeMinutes };
    }
    case 'manual': {
      const remindAt = str(raw.remindAt, 40);
      // A manual condition with no time is the engine's "someday" — valid, and
      // the one case where an absent field is meaningful rather than missing.
      if (!remindAt) return { id, type };
      const parsed = Date.parse(remindAt);
      if (Number.isNaN(parsed)) return { id, type };
      return { id, type, remindAt: new Date(parsed).toISOString() };
    }
  }
}

/**
 * Turn raw model output into actions that are safe to show.
 *
 * `grounded` is the exact set of item ids the client put on the wire for this
 * turn. Anything referencing an id outside it is dropped — not repaired, not
 * approximated. An action left with no items after grounding is dropped too:
 * "archive everything stale" that resolves to nothing must show nothing, not an
 * empty card the user could tap.
 *
 * Returns at most `MAX_ACTIONS`, preserving order.
 */
export function parseActions(
  raw: unknown,
  grounded: ReadonlySet<string>
): AssistantAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: AssistantAction[] = [];

  for (const entry of raw) {
    if (actions.length >= MAX_ACTIONS) break;
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as RawAssistantAction;
    if (!(ASSISTANT_TOOLS as readonly string[]).includes(a.tool ?? '')) continue;
    const tool = a.tool as AssistantTool;

    if (tool === 'add') {
      const title = str(a.title, 200);
      if (!title) continue;
      const classification = (CLASSIFICATIONS as readonly string[]).includes(
        a.classification as string
      )
        ? (a.classification as Classification)
        : 'other';
      actions.push({
        tool: 'add',
        title,
        classification,
        note: str(a.note, 2000) ?? undefined,
        tags: strings(a.tags, 8),
      });
      continue;
    }

    const itemIds = groundIds(a.itemIds, grounded);
    if (itemIds.length === 0) continue;

    switch (tool) {
      case 'schedule': {
        if (!isValidDate(a.date) || !isValidTime(a.time)) continue;
        actions.push({
          tool: 'schedule',
          // Schedule is single-item by construction; extra references are the
          // model misreading its own schema, so keep the first and drop the rest
          // rather than stacking N events on one instant.
          itemIds: [itemIds[0]],
          date: a.date,
          time: a.time,
          duration: int(a.duration, 5, 480) ?? undefined,
        });
        break;
      }
      case 'complete': {
        const outcome = (ASSISTANT_OUTCOMES as readonly string[]).includes(a.outcome as string)
          ? (a.outcome as AssistantOutcome)
          : 'good';
        actions.push({ tool: 'complete', itemIds, outcome });
        break;
      }
      case 'archive': {
        actions.push({ tool: 'archive', itemIds });
        break;
      }
      case 'set_trigger': {
        const condition = parseCondition(a.condition, actions.length);
        if (!condition) continue;
        actions.push({ tool: 'set_trigger', itemIds, condition });
        break;
      }
    }
  }

  return actions;
}

/* ---------------------------------------------------------------------------
 * Copy
 * ------------------------------------------------------------------------- */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 14 → "2 pm", 9 → "9 am", 0 → "midnight". */
function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** "Saturday 22 Aug at 09:00" — never a bare ISO string in front of a user. */
export function formatSlot(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  // Local construction, matching lib/datetime.parseLocalDate — `new Date(str)`
  // is UTC and lands on the previous day west of Greenwich.
  const dt = new Date(y, m - 1, d);
  const day = DAY_NAMES[dt.getDay()];
  const month = dt.toLocaleString(undefined, { month: 'short' });
  return `${day} ${d} ${month} at ${time}`;
}

/** Plain-language summary of a condition, for the proposal card. */
export function describeCondition(condition: BucketCondition): string {
  switch (condition.type) {
    case 'location_proximity': {
      const where = condition.placeLabel || 'the saved place';
      const km = condition.radiusMeters / 1000;
      const radius = km >= 1 ? `${km % 1 === 0 ? km : km.toFixed(1)} km` : `${condition.radiusMeters} m`;
      return `when you're within ${radius} of ${where}`;
    }
    case 'time_of_day':
      return `between ${hourLabel(condition.startHour)} and ${hourLabel(condition.endHour)}`;
    case 'date_after':
      return `any time after ${condition.date}`;
    case 'date_range':
      return `between ${condition.startDate} and ${condition.endDate}`;
    case 'day_of_week': {
      const names = condition.daysOfWeek.map((d) => DAY_NAMES[d]);
      if (names.length === 1) return `on ${names[0]}s`;
      const last = names.pop();
      return `on ${names.join(', ')} or ${last}`;
    }
    case 'calendar_free':
      return `when you have ${condition.minFreeMinutes} free minutes`;
    case 'manual':
      return condition.remindAt
        ? `at ${new Date(condition.remindAt).toLocaleString()}`
        : 'when you say so';
  }
}

/** Verb + object, e.g. "Archive 6 items". Used as the card's headline. */
export function describeAction(action: AssistantAction, items: ReadonlyMap<string, Item>): string {
  const count = actionItemIds(action).length;
  const only = count === 1 ? items.get(actionItemIds(action)[0])?.title : undefined;
  const target = only ? `“${only}”` : `${count} items`;

  switch (action.tool) {
    case 'schedule':
      return `Schedule ${target} for ${formatSlot(action.date, action.time)}`;
    case 'complete':
      return action.outcome === 'skipped'
        ? `Mark ${target} as skipped`
        : `Mark ${target} as done`;
    case 'archive':
      return `Archive ${target}`;
    case 'add':
      return `Save “${action.title}”`;
    case 'set_trigger':
      return `Remind you about ${target} ${describeCondition(action.condition)}`;
  }
}

/** The label on the card's confirm button. Short, and a verb. */
export function actionVerb(action: AssistantAction): string {
  switch (action.tool) {
    case 'schedule':
      return 'Add to calendar';
    case 'complete':
      return action.outcome === 'skipped' ? 'Mark skipped' : 'Mark done';
    case 'archive':
      return 'Archive';
    case 'add':
      return 'Save it';
    case 'set_trigger':
      return 'Set reminder';
  }
}

/**
 * True when the action reaches outside Silo. Today that is only `schedule`,
 * which writes a real event to a calendar the user may share with other people
 * and other devices. The UI leans on this to say so out loud before the tap.
 */
export function leavesTheApp(action: AssistantAction): boolean {
  return action.tool === 'schedule';
}
