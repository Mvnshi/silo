/**
 * Assistant verification against the REAL model.
 *
 * `verify-assistant-worker.mjs` stubs Gemini, so it proves the plumbing and
 * proves nothing about whether a real model uses the tools correctly. That gap
 * turned out to matter enormously: the first live call exposed three defects a
 * stub is structurally incapable of showing.
 *
 *  - The model nested its entire reply inside its own `answer` string, so the
 *    user saw raw JSON and every action was silently dropped.
 *  - It cited `[3]` markers in prose the user can't see a list for.
 *  - Under the old single-schema design it omitted `date` on a schedule and
 *    `condition` on a trigger, producing actions the client correctly discarded
 *    — the assistant promising "I'll put that on Saturday" and no card
 *    appearing.
 *
 * That last one is why the task uses function declarations with real `required`
 * lists instead of one permissive response schema, and why `temperature` is
 * pinned to 0. Measured over four consecutive runs: 4/7 usable before, 7/7 after.
 *
 * This costs real tokens, so it is OPT-IN and skips cleanly without a key.
 *
 * Run:  node workers/scripts/verify-assistant-live.mjs
 *       (reads GEMINI_API_KEY from the environment or workers/.dev.vars)
 *
 * `SILO_LIVE_RUNS=4` repeats the suite — tool-calling reliability is a
 * distribution, not a single result, and one green run means little.
 */
import { readFileSync } from 'node:fs';
import { startWorker, stopAll } from './servers.mjs';

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('GEMINI_API_KEY='));
    return line ? line.slice('GEMINI_API_KEY='.length).trim() : '';
  } catch {
    return '';
  }
}

const KEY = apiKey();
if (!KEY) {
  console.log('SKIP  no GEMINI_API_KEY (env or workers/.dev.vars) — live check not run.');
  console.log('      This gate is opt-in: it spends real tokens against a real model.');
  process.exit(0);
}

const PORT = Number(process.env.SILO_LIVE_PORT ?? 8797);
const WORKER = `http://localhost:${PORT}`;
const RUNS = Number(process.env.SILO_LIVE_RUNS ?? 2);

const ITEMS = [
  { id: 'itm_ramen', title: 'Tonkotsu ramen at home',     classification: 'recipe',  description: 'Rich pork broth.',     tags: ['ramen'] },
  { id: 'itm_hike',  title: 'Hike the coastal trail',     classification: 'place',   description: 'Needs the season.',    tags: ['outdoors'] },
  { id: 'itm_lang',  title: 'LangChain agents deep dive', classification: 'article', description: 'Tool-calling agents.', tags: ['ai'] },
  { id: 'itm_hiit',  title: '20-minute HIIT workout',     classification: 'fitness', description: 'No equipment.',        tags: ['hiit'] },
  { id: 'itm_sour',  title: 'Perfect sourdough starter',  classification: 'food',    description: 'Feeding schedule.',    tags: ['baking'] },
];
const SENT = new Set(ITEMS.map((i) => i.id));

/**
 * Each case asserts a USABLE action — one that survives
 * `lib/assistant.parseActions` — not merely an action-shaped object. An action
 * the client discards is worse than no action, because the prose already
 * promised it.
 */
const CASES = [
  { q: 'What did I save about LangChain?',
    want: 'answer, no action',
    ok: (r) => r.actions.length === 0 && r.sources.length > 0 },
  { q: 'Schedule the ramen recipe for Saturday morning',
    want: 'schedule WITH a real date and time',
    ok: (r) => r.actions.some((a) => a.tool === 'schedule'
      && /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '')
      && /^\d{2}:\d{2}$/.test(a.time ?? '')
      && a.itemIds.length === 1) },
  { q: 'Remind me about the coastal trail hike in the evenings',
    want: 'set_trigger WITH a time_of_day condition',
    ok: (r) => r.actions.some((a) => a.tool === 'set_trigger'
      && a.condition?.type === 'time_of_day'
      && Number.isInteger(a.condition?.startHour)) },
  { q: 'I did the HIIT workout today and loved it',
    want: 'complete, outcome loved',
    ok: (r) => r.actions.some((a) => a.tool === 'complete' && a.outcome === 'loved' && a.itemIds.length === 1) },
  { q: 'Archive the LangChain article and the sourdough one',
    want: 'ONE archive over both items',
    ok: (r) => r.actions.length === 1 && r.actions[0].tool === 'archive' && r.actions[0].itemIds.length === 2 },
  { q: 'Save a note to buy miso paste',
    want: 'add with a short title',
    ok: (r) => r.actions.some((a) => a.tool === 'add' && typeof a.title === 'string' && a.title.length > 0 && a.title.length < 60) },
  { q: 'Schedule my dentist appointment for Tuesday',
    want: 'NO action — nothing saved matches',
    ok: (r) => r.actions.length === 0 },
];

const looksLikeJson = (s) => typeof s === 'string' && /^\s*[{[]/.test(s);
const citesRefs = (s) => typeof s === 'string' && /\[\d+\]/.test(s);

async function ask(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WORKER}/api/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'assistant', query, items: ITEMS, today: '2026-08-20', now: '10:00' }),
      });
      if (res.ok) return await res.json();
      if (attempt === 2) return { httpError: res.status };
    } catch {
      if (attempt === 2) return { httpError: 'network' };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

await startWorker(PORT, { GEMINI_API_KEY: KEY });

let usable = 0, total = 0, breaches = 0, jsonLeak = 0, refLeak = 0, errors = 0;
const misses = [];

try {
  for (let run = 1; run <= RUNS; run++) {
    console.log(`\n── run ${run}/${RUNS} ─────────────────────────────────────`);
    for (const c of CASES) {
      const r = await ask(c.q);
      total++;
      if (r?.httpError) {
        errors++;
        console.log(`  ⚠ ${c.q.slice(0, 44).padEnd(46)} HTTP ${r.httpError}`);
        continue;
      }
      const norm = { answer: r.answer ?? '', actions: r.actions ?? [], sources: r.sources ?? [] };

      // THE invariant: nothing may come back that this script did not send.
      const stray = [
        ...norm.actions.flatMap((a) => a.itemIds ?? []),
        ...norm.sources.map((s) => s.itemId),
      ].filter((id) => !SENT.has(id));
      if (stray.length) { breaches++; console.log(`  ✗ GROUNDING BREACH: ${stray.join(', ')}`); }
      if (looksLikeJson(norm.answer)) jsonLeak++;
      if (citesRefs(norm.answer)) refLeak++;

      let good = false;
      try { good = c.ok(norm); } catch { good = false; }
      if (good) usable++; else misses.push(`${c.q} — wanted ${c.want}`);
      console.log(`  ${good ? '✓' : '✗'} ${c.q.slice(0, 44).padEnd(46)} ${norm.actions.map((a) => a.tool).join(',') || '—'}`);
    }
  }
} finally {
  await stopAll();
}

const graded = total - errors;
console.log(`\n═══════════════════════════════════════════════════`);
console.log(`usable ${usable}/${graded}   grounding breaches ${breaches}   json-in-prose ${jsonLeak}   ref-leak ${refLeak}   transport errors ${errors}`);
if (misses.length) console.log('\nmissed:\n  ' + misses.join('\n  '));

// Grounding is the safety property and must be perfect. Usability is a quality
// bar: below 100% the assistant is promising things no card delivers.
if (breaches > 0 || jsonLeak > 0 || refLeak > 0) { console.log('\nFAILED on a safety property.'); process.exit(1); }
if (usable < graded) { console.log('\nFAILED on usable actions.'); process.exit(1); }
console.log('\nAll live checks passed.');
