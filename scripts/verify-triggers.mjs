/**
 * Trigger-engine verification — `lib/triggers.ts`.
 *
 * The engine is pure by design precisely so this can run with no simulator, no
 * location fix and no calendar: the clock and the context are arguments. What
 * is checked here is the set of rules that are painful to reproduce by hand —
 * an hour window that crosses midnight, a date range that must stay satisfied
 * on the afternoon of its final day, and the difference between "not ready" and
 * "cannot tell".
 *
 * Run:  node scripts/verify-triggers.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const out = mkdtempSync(join(tmpdir(), 'silo-triggers-'));
try {
  execFileSync(
    'npx',
    ['tsc', 'lib/triggers.ts', 'lib/datetime.ts', 'lib/types.ts',
     '--outDir', out, '--rootDir', '.', '--module', 'commonjs', '--target', 'es2022',
     '--skipLibCheck', '--strict'],
    { stdio: 'inherit' }
  );
} catch {
  console.error('tsc failed — the engine does not compile in isolation.');
  process.exit(1);
}

// CommonJS output, so Node resolves the extensionless `./datetime` import the
// same way the bundler does.
const T = createRequire(import.meta.url)(join(out, 'lib/triggers.js'));
rmSync(out, { recursive: true, force: true });

let pass = 0;
const failures = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`); }
}

/** Local Date, so tests don't depend on the machine's UTC offset. */
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);
const item = (conditions, extra = {}) => ({
  id: 'i1', type: 'link', classification: 'other', title: 't', tags: [],
  created_at: at(2026, 1, 1).toISOString(), viewed: false, archived: false,
  bucketlist_meta: { conditions, ...(extra.meta ?? {}) }, ...extra,
});
const ctx = (now, over = {}) => ({ now, ...over });
const ready = (conds, now, over) => T.evaluateItem(item(conds), ctx(now, over));

/* ---- time_of_day ------------------------------------------------------- */
const evening = { id: 'c', type: 'time_of_day', startHour: 18, endHour: 22 };
check('time_of_day inside window', ready([evening], at(2026, 6, 1, 19)).readyNow, true);
check('time_of_day before window', ready([evening], at(2026, 6, 1, 17)).readyNow, false);
check('time_of_day end is exclusive', ready([evening], at(2026, 6, 1, 22)).readyNow, false);

const overnight = { id: 'c', type: 'time_of_day', startHour: 22, endHour: 2 };
check('window crossing midnight, late evening', ready([overnight], at(2026, 6, 1, 23)).readyNow, true);
check('window crossing midnight, small hours', ready([overnight], at(2026, 6, 1, 1)).readyNow, true);
check('window crossing midnight, midday excluded', ready([overnight], at(2026, 6, 1, 12)).readyNow, false);

/* ---- dates -------------------------------------------------------------- */
const after = { id: 'c', type: 'date_after', date: '2026-06-01' };
check('date_after includes the date itself', ready([after], at(2026, 6, 1, 0, 1)).readyNow, true);
check('date_after excludes the day before', ready([after], at(2026, 5, 31, 23)).readyNow, false);

const range = { id: 'c', type: 'date_range', startDate: '2026-06-01', endDate: '2026-06-14' };
check('date_range on the final day, afternoon', ready([range], at(2026, 6, 14, 18)).readyNow, true);
check('date_range first day', ready([range], at(2026, 6, 1, 0, 5)).readyNow, true);
check('date_range day after close', ready([range], at(2026, 6, 15, 9)).readyNow, false);

const weekend = { id: 'c', type: 'day_of_week', daysOfWeek: [0, 6] };
check('day_of_week matches Saturday', ready([weekend], at(2026, 6, 6, 10)).readyNow, true);
check('day_of_week rejects Wednesday', ready([weekend], at(2026, 6, 3, 10)).readyNow, false);

/* ---- location ----------------------------------------------------------- */
const trailhead = { id: 'c', type: 'location_proximity', latitude: 51.5, longitude: -0.12, radiusMeters: 500, placeLabel: 'the trailhead' };
const near = { latitude: 51.5008, longitude: -0.12 };   // ~89 m
const far = { latitude: 51.52, longitude: -0.12 };      // ~2.2 km
check('inside the radius', ready([trailhead], at(2026, 6, 1), { location: near }).readyNow, true);
check('outside the radius', ready([trailhead], at(2026, 6, 1), { location: far }).readyNow, false);
check('outside radius names the gap',
  ready([trailhead], at(2026, 6, 1), { location: far }).blockedBy, '2.2 km from the trailhead, needs 500 m');

const noFix = ready([trailhead], at(2026, 6, 1));
check('no location fix is UNKNOWN, not ready', noFix.readyNow, false);
check('no location fix sets needsContext', noFix.needsContext, true);
check('no location fix says so', noFix.blockedBy, 'needs your location');

/* ---- calendar ----------------------------------------------------------- */
const freeHour = { id: 'c', type: 'calendar_free', minFreeMinutes: 60 };
check('enough free time', ready([freeHour], at(2026, 6, 1), { freeMinutes: 90 }).readyNow, true);
check('not enough free time', ready([freeHour], at(2026, 6, 1), { freeMinutes: 20 }).readyNow, false);
check('unknown calendar is not ready', ready([freeHour], at(2026, 6, 1)).readyNow, false);
check('unknown calendar sets needsContext', ready([freeHour], at(2026, 6, 1)).needsContext, true);

const now = at(2026, 6, 1, 12);
const win = (sh, sm, eh, em) => ({ startDate: at(2026, 6, 1, sh, sm), endDate: at(2026, 6, 1, eh, em) });
check('mid-meeting → 0 free', T.freeMinutesFrom([win(11, 30, 13, 0)], now), 0);
check('45 min until the next thing', T.freeMinutesFrom([win(12, 45, 13, 30)], now), 45);
check('empty calendar → full horizon', T.freeMinutesFrom([], now), T.FREE_SLOT_HORIZON_MINUTES);
check('past events ignored', T.freeMinutesFrom([win(9, 0, 10, 0)], now), T.FREE_SLOT_HORIZON_MINUTES);

/* ---- conjunction + reasons ---------------------------------------------- */
const both = ready([evening, weekend], at(2026, 6, 6, 19));
check('all conditions met → ready', both.readyNow, true);
check('reasons are joined for the notification body', both.readyReason, "it's your 6pm–10pm window · it's Saturday");
check('one failing condition blocks the rest', ready([evening, weekend], at(2026, 6, 3, 19)).readyNow, false);
check('an item with no conditions is never ready', ready([], at(2026, 6, 1)).readyNow, false);

/* ---- convenience aggregates --------------------------------------------- */
const aggregated = T.normalizeConditions({
  conditions: [],
  locationTrigger: { latitude: 51.5, longitude: -0.12, radiusMeters: 500 },
  timeTrigger: { startHour: 18, endHour: 22, daysOfWeek: [6] },
  manualReminderAt: '2026-06-01T09:00:00.000Z',
});
check('aggregates become conditions', aggregated.map((c) => c.type).sort(),
  ['day_of_week', 'location_proximity', 'manual', 'time_of_day']);
check('an explicit condition is not duplicated by its aggregate',
  T.normalizeConditions({ conditions: [trailhead], locationTrigger: { latitude: 1, longitude: 1, radiusMeters: 9 } })
    .filter((c) => c.type === 'location_proximity').length, 1);

/* ---- persistence + notification dedupe ----------------------------------- */
const readyItem = item([evening], { meta: { conditions: [evening], readyNow: true, readyReason: "it's your 6pm–10pm window" } });
check('no write when nothing changed',
  T.buildReadinessPatch(readyItem, T.evaluateItem(readyItem, ctx(at(2026, 6, 1, 19)))), null);
const flipped = T.buildReadinessPatch(readyItem, T.evaluateItem(readyItem, ctx(at(2026, 6, 1, 9))));
check('a flip to not-ready does write', flipped?.bucketlist_meta?.readyNow, false);

const announced = item([evening], { meta: { conditions: [evening], readyNow: true, notifiedAt: at(2026, 6, 1, 19).toISOString() } });
check('no re-notify inside the cooldown', T.shouldNotifyReady(announced, at(2026, 6, 1, 20)), false);
check('re-notify once the cooldown lapses', T.shouldNotifyReady(announced, at(2026, 6, 2, 18)), true);
check('never notify an item that is not ready',
  T.shouldNotifyReady(item([evening], { meta: { conditions: [evening], readyNow: false } }), at(2026, 6, 1, 19)), false);
const cleared = T.buildReadinessPatch(announced, T.evaluateItem(announced, ctx(at(2026, 6, 1, 9))));
check('dropping out of ready forgets notifiedAt', cleared?.bucketlist_meta?.notifiedAt, undefined);

/* ---- selection ----------------------------------------------------------- */
const specific = { ...item([evening, weekend]), id: 'specific' };
const loose = { ...item([evening]), id: 'loose' };
const archived = { ...item([evening]), id: 'archived', archived: true };
const done = { ...item([evening]), id: 'done', status: 'done' };
check('more satisfied conditions ranks higher',
  T.getReadyItems([loose, specific, archived, done], ctx(at(2026, 6, 6, 19))).map((r) => r.item.id),
  ['specific', 'loose']);
check('an item with no bucketlist_meta never fires',
  T.getReadyItems([{ ...loose, bucketlist_meta: undefined }], ctx(at(2026, 6, 6, 19))).length, 0);

/* ---- looking ahead: nextReadyAt ------------------------------------------ */
{
  // A rising edge, not "any moment it happens to be ready".
  const wed10 = at(2026, 6, 3, 10);           // Wednesday morning
  const evening = { id: 'c', type: 'time_of_day', startHour: 18, endHour: 22 };

  const edge = T.nextReadyAt(item([evening]), wed10);
  check('nextReadyAt finds tonight\'s 6pm opening',
    edge && [edge.getHours(), edge.getMinutes()], [18, 0]);
  check('nextReadyAt lands on the same day', edge && edge.getDate(), 3);

  // Already inside the window → the next edge is TOMORROW, not one step away.
  const wed19 = at(2026, 6, 3, 19);
  const nextEdge = T.nextReadyAt(item([evening]), wed19);
  check('already-ready waits for the next rising edge, not "now + 15 min"',
    nextEdge && [nextEdge.getDate(), nextEdge.getHours()], [4, 18]);

  // Conjunction: evening AND Saturday → Saturday 6 Jun at 18:00.
  const weekendOnly = { id: 'd', type: 'day_of_week', daysOfWeek: [0, 6] };
  const both = T.nextReadyAt(item([evening, weekendOnly]), wed10);
  check('a conjunction resolves to the first instant BOTH hold',
    both && [both.getDate(), both.getHours()], [6, 18]);

  // A manual reminder at an off-grid minute must be hit exactly.
  const remind = { id: 'm', type: 'manual', remindAt: at(2026, 6, 3, 14, 7).toISOString() };
  const manual = T.nextReadyAt(item([remind]), wed10);
  check('an off-grid manual reminder is hit to the minute',
    manual && [manual.getHours(), manual.getMinutes()], [14, 7]);

  // Unpredictable conditions must NOT be scheduled.
  check('a location-gated item is not schedulable', T.isSchedulable(item([trailhead])), false);
  check('a location-gated item has no nextReadyAt', T.nextReadyAt(item([trailhead]), wed10), null);
  check('a calendar-gated item is not schedulable', T.isSchedulable(item([freeHour])), false);
  check('an item with no conditions is not schedulable', T.isSchedulable(item([])), false);
  check('a clock-only item IS schedulable', T.isSchedulable(item([evening, weekendOnly])), true);

  // Nothing inside the horizon → null rather than a wrong date.
  const farFuture = { id: 'f', type: 'date_range', startDate: '2027-06-01', endDate: '2027-06-30' };
  check('an edge beyond the lookahead returns null', T.nextReadyAt(item([farFuture]), wed10), null);

  // A window that already closed for good never fires again.
  const past = { id: 'p', type: 'date_range', startDate: '2026-01-01', endDate: '2026-01-31' };
  check('a closed window never schedules', T.nextReadyAt(item([past]), wed10), null);
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
