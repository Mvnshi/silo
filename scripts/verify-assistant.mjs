/**
 * Assistant action-layer verification — `lib/assistant.ts`.
 *
 * The module is pure precisely so this can run with no simulator, no Worker and
 * no Gemini key: a tool call is just data, and every rule that decides whether
 * that data may touch a row is a function of the data plus the grounding set.
 *
 * What is checked here is the part that cannot be checked by looking at the
 * screen — the refusals. A hallucinated item id, a date that does not exist, a
 * range that runs backwards, a location fence with no coordinates: each one is
 * a plausible model output that must produce NO action rather than a wrong one.
 * These are miserable to reproduce by hand because they need a model to
 * misbehave on cue.
 *
 * Run:  node scripts/verify-assistant.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'silo-assistant-'));
try {
  execFileSync(
    'npx',
    ['tsc', 'lib/assistant.ts', 'lib/types.ts',
     '--outDir', out, '--rootDir', '.', '--module', 'commonjs', '--target', 'es2022',
     '--skipLibCheck', '--strict'],
    { stdio: 'inherit' }
  );
} catch {
  console.error('tsc failed — the action layer does not compile in isolation.');
  process.exit(1);
}

const A = createRequire(import.meta.url)(join(out, 'lib/assistant.js'));
rmSync(out, { recursive: true, force: true });

let pass = 0;
const failures = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`); }
}

/** The ids the client put on the wire this turn. Nothing else may survive. */
const GROUNDED = new Set(['a', 'b', 'c']);
const parse = (actions, grounded = GROUNDED) => A.parseActions(actions, grounded);
/** First action's tool, or null — the common shape of these assertions. */
const tool = (actions) => parse(actions)[0]?.tool ?? null;

/* ---- grounding: the whole point ---------------------------------------- */

check('a grounded id survives',
  parse([{ tool: 'archive', itemIds: ['a'] }]),
  [{ tool: 'archive', itemIds: ['a'] }]);

check('an id the client never sent is dropped',
  parse([{ tool: 'archive', itemIds: ['ghost'] }]), []);

check('a hallucinated id is dropped but its grounded siblings survive',
  parse([{ tool: 'archive', itemIds: ['a', 'ghost', 'c'] }]),
  [{ tool: 'archive', itemIds: ['a', 'c'] }]);

check('an action left with no items after grounding is dropped entirely',
  parse([{ tool: 'complete', itemIds: ['ghost', 'phantom'], outcome: 'good' }]), []);

check('duplicate ids collapse, so one row is not archived twice',
  parse([{ tool: 'archive', itemIds: ['a', 'a', 'b'] }]),
  [{ tool: 'archive', itemIds: ['a', 'b'] }]);

check('a non-string id is dropped rather than coerced',
  parse([{ tool: 'archive', itemIds: [0, null, 'a'] }]),
  [{ tool: 'archive', itemIds: ['a'] }]);

check('itemIds that is not an array yields nothing',
  parse([{ tool: 'archive', itemIds: 'a' }]), []);

check('an empty grounding set admits no item action',
  parse([{ tool: 'archive', itemIds: ['a'] }], new Set()), []);

/* ---- the tool vocabulary is closed -------------------------------------- */

check('an unknown tool is dropped', tool([{ tool: 'delete', itemIds: ['a'] }]), null);
check('a missing tool is dropped', tool([{ itemIds: ['a'] }]), null);
check('deletion is not in the vocabulary', tool([{ tool: 'deleteItem', itemIds: ['a'] }]), null);
check('sending money is not in the vocabulary', tool([{ tool: 'purchase', itemIds: ['a'] }]), null);
check('a non-object entry is skipped', parse(['archive everything', null, 42]), []);
check('a non-array payload yields nothing', parse('archive everything'), []);

/* ---- schedule: a real calendar event, so the slot must be real ---------- */

const sched = (over = {}) =>
  parse([{ tool: 'schedule', itemIds: ['a'], date: '2026-08-22', time: '09:30', ...over }])[0];

check('a well-formed slot survives',
  sched(), { tool: 'schedule', itemIds: ['a'], date: '2026-08-22', time: '09:30', duration: undefined });

check('a missing date drops the action rather than defaulting', sched({ date: undefined }), undefined);
check('a missing time drops the action rather than defaulting', sched({ time: undefined }), undefined);
check('30 February is rejected', sched({ date: '2026-02-30' }), undefined);
check('month 13 is rejected', sched({ date: '2026-13-01' }), undefined);
check('29 February in a leap year is accepted', sched({ date: '2028-02-29' })?.date, '2028-02-29');
check('29 February in a common year is rejected', sched({ date: '2027-02-29' }), undefined);
check('a 25th hour is rejected', sched({ time: '25:00' }), undefined);
check('a 60th minute is rejected', sched({ time: '09:60' }), undefined);
check('a prose date is rejected', sched({ date: 'next Saturday' }), undefined);
check('midnight is a valid time', sched({ time: '00:00' })?.time, '00:00');

check('schedule keeps one item even when handed several',
  sched({ itemIds: ['a', 'b', 'c'] })?.itemIds, ['a']);
check('a sane duration survives', sched({ duration: 45 })?.duration, 45);
check('an absurd duration is dropped, not clamped', sched({ duration: 100000 })?.duration, undefined);
check('a negative duration is dropped', sched({ duration: -30 })?.duration, undefined);
check('a stringly-typed duration is dropped', sched({ duration: '45' })?.duration, undefined);

/* ---- complete: reaches the north-star metric, so the outcome matters ---- */

check('a stated outcome survives',
  parse([{ tool: 'complete', itemIds: ['a'], outcome: 'loved' }])[0]?.outcome, 'loved');
check('an absent outcome falls back to the neutral one',
  parse([{ tool: 'complete', itemIds: ['a'] }])[0]?.outcome, 'good');
check('an invented outcome falls back rather than being stored',
  parse([{ tool: 'complete', itemIds: ['a'], outcome: 'amazing' }])[0]?.outcome, 'good');
check('retire is NOT reachable through complete — archive is the only removal',
  parse([{ tool: 'complete', itemIds: ['a'], outcome: 'retire' }])[0]?.outcome, 'good');

/* ---- add: the one verb that grounds on nothing -------------------------- */

check('add needs no grounding at all',
  parse([{ tool: 'add', title: 'Book the trailhead permit' }], new Set()),
  [{ tool: 'add', title: 'Book the trailhead permit', classification: 'other', note: undefined, tags: [] }]);

check('add without a title is dropped', parse([{ tool: 'add', note: 'no title' }]), []);
check('add with a blank title is dropped', parse([{ tool: 'add', title: '   ' }]), []);
check('a known classification survives',
  parse([{ tool: 'add', title: 'Ramen', classification: 'recipe' }])[0]?.classification, 'recipe');
check('an invented classification falls back to other',
  parse([{ tool: 'add', title: 'Ramen', classification: 'noodles' }])[0]?.classification, 'other');
check('tags are de-duplicated and capped',
  parse([{ tool: 'add', title: 'x', tags: ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }])[0]?.tags,
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
check('non-string tags are dropped, not stringified',
  parse([{ tool: 'add', title: 'x', tags: [1, {}, 'real'] }])[0]?.tags, ['real']);

/* ---- set_trigger: a condition that can never fire loses the item -------- */

const cond = (condition) => parse([{ tool: 'set_trigger', itemIds: ['a'], condition }])[0]?.condition;

check('a location fence with coordinates survives',
  cond({ type: 'location_proximity', latitude: 47.6, longitude: -122.3, radiusMeters: 500 })?.radiusMeters, 500);
check('a location fence with NO coordinates is refused',
  cond({ type: 'location_proximity', placeLabel: 'the trailhead' }), undefined);
check('a location fence with only a latitude is refused',
  cond({ type: 'location_proximity', latitude: 47.6 }), undefined);
check('an out-of-range latitude is refused',
  cond({ type: 'location_proximity', latitude: 947.6, longitude: -122.3 }), undefined);
check('a fence with coordinates but no radius takes the default',
  cond({ type: 'location_proximity', latitude: 47.6, longitude: -122.3 })?.radiusMeters, 1000);

check('an hour window survives',
  cond({ type: 'time_of_day', startHour: 18, endHour: 22 })?.endHour, 22);
check('a window crossing midnight survives — the engine handles it',
  cond({ type: 'time_of_day', startHour: 22, endHour: 2 })?.startHour, 22);
check('hour 24 is refused', cond({ type: 'time_of_day', startHour: 24, endHour: 2 }), undefined);
check('a half-specified window is refused', cond({ type: 'time_of_day', startHour: 18 }), undefined);

check('a forwards date range survives',
  cond({ type: 'date_range', startDate: '2026-09-01', endDate: '2026-09-14' })?.endDate, '2026-09-14');
check('a BACKWARDS range is refused — it could never be satisfied',
  cond({ type: 'date_range', startDate: '2026-09-14', endDate: '2026-09-01' }), undefined);
check('a single-day range is allowed',
  cond({ type: 'date_range', startDate: '2026-09-01', endDate: '2026-09-01' })?.startDate, '2026-09-01');
check('date_after needs a real date', cond({ type: 'date_after', date: 'soon' }), undefined);

check('weekdays are de-duplicated and sorted',
  cond({ type: 'day_of_week', daysOfWeek: [6, 0, 6] })?.daysOfWeek, [0, 6]);
check('day 7 is dropped as out of range',
  cond({ type: 'day_of_week', daysOfWeek: [7] }), undefined);
check('an empty weekday list is refused',
  cond({ type: 'day_of_week', daysOfWeek: [] }), undefined);

check('a free-slot condition survives',
  cond({ type: 'calendar_free', minFreeMinutes: 45 })?.minFreeMinutes, 45);
check('a free-slot condition with no minutes is refused',
  cond({ type: 'calendar_free' }), undefined);

check('a manual condition needs no time — that is the engine’s "someday"',
  cond({ type: 'manual' })?.type, 'manual');
check('an unparseable reminder time degrades to a plain manual condition',
  cond({ type: 'manual', remindAt: 'later' })?.remindAt, undefined);
check('an unknown condition type is refused', cond({ type: 'weather_is_nice' }), undefined);
check('a missing condition drops the whole trigger action',
  parse([{ tool: 'set_trigger', itemIds: ['a'] }]), []);

check('the condition id is minted here, never taken from the model',
  cond({ type: 'manual', id: 'attacker-chosen' })?.id?.startsWith('assistant_'), true);

/* ---- volume caps -------------------------------------------------------- */

check('at most 5 actions are returned',
  parse(Array.from({ length: 9 }, () => ({ tool: 'archive', itemIds: ['a'] }))).length, 5);

{
  const many = Array.from({ length: 80 }, (_, i) => `id${i}`);
  const grounded = new Set(many);
  check('a single action touches at most 50 rows',
    parse([{ tool: 'archive', itemIds: many }], grounded)[0]?.itemIds.length, 50);
}

/* ---- ordering ----------------------------------------------------------- */

check('valid actions keep their order across an invalid one',
  parse([
    { tool: 'archive', itemIds: ['a'] },
    { tool: 'bogus', itemIds: ['b'] },
    { tool: 'complete', itemIds: ['c'], outcome: 'good' },
  ]).map((a) => a.tool),
  ['archive', 'complete']);

check('item order within an action follows the model, not the grounding set',
  parse([{ tool: 'archive', itemIds: ['c', 'a'] }])[0]?.itemIds, ['c', 'a']);

/* ---- copy: what the user reads before they tap -------------------------- */

const items = new Map([
  ['a', { id: 'a', title: 'Tonkotsu ramen' }],
  ['b', { id: 'b', title: 'Trailhead hike' }],
]);
const describe = (action) => A.describeAction(action, items);

check('a single-item action names the item',
  describe({ tool: 'archive', itemIds: ['a'] }), 'Archive “Tonkotsu ramen”');
check('a multi-item action states the count, so N is never hidden',
  describe({ tool: 'archive', itemIds: ['a', 'b'] }), 'Archive 2 items');
check('a schedule reads as a date a human recognises',
  describe({ tool: 'schedule', itemIds: ['a'], date: '2026-08-22', time: '09:30' }),
  'Schedule “Tonkotsu ramen” for Saturday 22 Aug at 09:30');
check('a trigger explains the condition in words',
  describe({ tool: 'set_trigger', itemIds: ['b'], condition: { id: 'x', type: 'day_of_week', daysOfWeek: [0, 6] } }),
  'Remind you about “Trailhead hike” on Sunday or Saturday');
check('a proximity trigger states the real radius',
  A.describeCondition({ id: 'x', type: 'location_proximity', latitude: 1, longitude: 2, radiusMeters: 2000, placeLabel: 'the trailhead' }),
  "when you're within 2 km of the trailhead");
check('a sub-kilometre radius stays in metres',
  A.describeCondition({ id: 'x', type: 'location_proximity', latitude: 1, longitude: 2, radiusMeters: 300 }),
  "when you're within 300 m of the saved place");
check('an evening window reads in am/pm',
  A.describeCondition({ id: 'x', type: 'time_of_day', startHour: 18, endHour: 22 }),
  'between 6 pm and 10 pm');
check('noon and midnight are named, not printed as 12',
  A.describeCondition({ id: 'x', type: 'time_of_day', startHour: 0, endHour: 12 }),
  'between midnight and noon');

check('only schedule is flagged as reaching outside the app',
  A.ASSISTANT_TOOLS.filter((t) => A.leavesTheApp({ tool: t })), ['schedule']);

/* ---- the date formatter must not drift a day westward ------------------- */

check('formatSlot reads the date locally, not as UTC midnight',
  A.formatSlot('2026-08-22', '09:30'), 'Saturday 22 Aug at 09:30');
check('formatSlot handles the first of a month',
  A.formatSlot('2026-03-01', '00:00'), 'Sunday 1 Mar at 00:00');

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
