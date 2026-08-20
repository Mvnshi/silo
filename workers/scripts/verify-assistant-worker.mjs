/**
 * Assistant Worker verification — `handleAssistant` in `workers/gemini.ts`.
 *
 * `scripts/verify-assistant.mjs` covers the client's refusal rules. This covers
 * the half that lives on the server, which is the half that decides what an
 * item reference even MEANS:
 *
 *  - The model is shown `[1]…[N]` and never an item id, so the only thing it can
 *    emit for an item is a small integer.
 *  - Those integers are mapped back to the ids the CLIENT sent.
 *  - An integer outside 1…N resolves to nothing and is DROPPED — never clamped
 *    to a neighbour, which would act on the wrong row.
 *
 * None of that is observable against the live model: it would have to
 * hallucinate a reference number on cue. So the Worker is pointed at a stub via
 * `GEMINI_BASE_URL` and handed exactly the malformed output we need to see
 * refused. The stub also proves the prompt itself carries no ids — the one
 * assertion that makes "the model cannot invent an item id" a fact rather than
 * a hope.
 *
 * Run:  node workers/scripts/verify-assistant-worker.mjs
 *
 * The Worker and the stub are started and stopped by this script.
 */
import http from 'node:http';
import { startWorker, stopAll } from './servers.mjs';

const STUB_PORT = Number(process.env.SILO_STUB_PORT ?? 8125);
const WORKER = process.env.SILO_WORKER_URL ?? 'http://localhost:8798';

/** Set per-test: what the stubbed model "returns". */
let nextModelOutput = { answer: 'ok' };
/** The prompt the Worker actually sent, so we can assert what it contains. */
let lastPrompt = '';

const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      lastPrompt = parsed?.contents?.[0]?.parts?.[0]?.text ?? '';
    } catch {
      lastPrompt = '';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Gemini's envelope, so the Worker's own extraction path is exercised.
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(nextModelOutput) }] } }],
      })
    );
  });
});

let pass = 0;
const failures = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { failures.push(label); console.log(`FAIL  ${label}\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`); }
}

/** Three saved items, with ids the model must never see. */
const ITEMS = [
  { id: 'itm_ramen', title: 'Tonkotsu ramen', classification: 'recipe' },
  { id: 'itm_hike', title: 'Trailhead hike', classification: 'place' },
  { id: 'itm_lang', title: 'LangChain agents', classification: 'article' },
];

async function ask(modelOutput, body = {}) {
  nextModelOutput = modelOutput;
  const response = await fetch(`${WORKER}/api/gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: 'assistant',
      query: 'do the thing',
      items: ITEMS,
      today: '2026-08-20',
      now: '10:00',
      ...body,
    }),
  });
  return response.json();
}

await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));
await startWorker(8798, {
  GEMINI_API_KEY: 'stub-key',
  GEMINI_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
});

try {
  /* ---- the model is never shown an id -------------------------------- */

  await ask({ answer: 'hello' }, { query: 'what did I save about ramen' });
  // The obvious one, and the one a stub will never notice on your behalf: a
  // prompt full of rules and items with no question in it produces confident
  // nonsense rather than an error.
  check('the prompt actually contains the question',
    lastPrompt.includes('what did I save about ramen'), true);
  check('the prompt numbers the items', lastPrompt.includes('[1] Tonkotsu ramen'), true);
  check('the prompt contains NO item id — the model has nothing to invent',
    ITEMS.some((item) => lastPrompt.includes(item.id)), false);
  check('the prompt carries the DEVICE date, not the Worker\'s',
    lastPrompt.includes('Thursday 2026-08-20'), true);
  check('the prompt carries the device local time', lastPrompt.includes('10:00'), true);

  /* ---- references resolve to ids the client supplied ------------------ */

  {
    const r = await ask({
      answer: 'Archiving those.',
      sourceRefs: [1, 3],
      actions: [{ tool: 'archive', refs: [1, 3] }],
    });
    check('sourceRefs map to real ids', r.sources.map((s) => s.itemId), ['itm_ramen', 'itm_lang']);
    check('sources carry the title, so a chip can render it',
      r.sources.map((s) => s.title), ['Tonkotsu ramen', 'LangChain agents']);
    check('action refs become itemIds', r.actions[0].itemIds, ['itm_ramen', 'itm_lang']);
    check('the raw refs field does not survive', 'refs' in r.actions[0], false);
    check('the tool is preserved', r.actions[0].tool, 'archive');
  }

  /* ---- a reference the model made up resolves to NOTHING -------------- */

  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: [9] }] });
    check('a reference past the end is dropped, not clamped', r.actions[0].itemIds, []);
  }
  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: [0] }] });
    check('reference 0 is dropped — the list is 1-based', r.actions[0].itemIds, []);
  }
  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: [-1] }] });
    check('a negative reference is dropped', r.actions[0].itemIds, []);
  }
  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: [1, 99, 2] }] });
    check('a bad reference does not poison its valid siblings',
      r.actions[0].itemIds, ['itm_ramen', 'itm_hike']);
  }
  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: [1.5] }] });
    check('a fractional reference is dropped rather than rounded', r.actions[0].itemIds, []);
  }
  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: ['itm_ramen'] }] });
    check('an id the model INVENTED in the refs slot is dropped', r.actions[0].itemIds, []);
  }
  {
    const r = await ask({ answer: 'x', sourceRefs: [42] });
    check('an invented source reference yields no chip', r.sources, []);
  }
  {
    const r = await ask({ answer: 'x', actions: [{ tool: 'archive', refs: [2, 2] }] });
    check('a repeated reference collapses', r.actions[0].itemIds, ['itm_hike']);
  }

  /* ---- shape ---------------------------------------------------------- */

  {
    const r = await ask({ answer: 'just answering' });
    check('no actions means an empty array, never undefined', r.actions, []);
    check('the answer is passed through', r.answer, 'just answering');
  }
  {
    const r = await ask({ answer: 'x', actions: [{ refs: [1] }, null, 'archive everything'] });
    check('entries with no tool are dropped before they reach the client', r.actions, []);
  }
  {
    const r = await ask({
      answer: 'x',
      actions: [{ tool: 'schedule', refs: [1], date: '2026-08-22', time: '09:00', duration: 45 }],
    });
    check('schedule fields survive the mapping',
      [r.actions[0].date, r.actions[0].time, r.actions[0].duration],
      ['2026-08-22', '09:00', 45]);
  }
  {
    const r = await ask({
      answer: 'x',
      actions: [{ tool: 'set_trigger', refs: [2], condition: { type: 'day_of_week', daysOfWeek: [0, 6] } }],
    });
    check('a nested condition survives intact',
      r.actions[0].condition, { type: 'day_of_week', daysOfWeek: [0, 6] });
  }
  {
    // `add` invents a row rather than touching one, so it needs no references.
    const r = await ask({ answer: 'x', actions: [{ tool: 'add', title: 'Book the permit' }] });
    check('add survives with no refs at all', [r.actions[0].tool, r.actions[0].itemIds], ['add', []]);
  }

  /* ---- an item the client sent without an id can't be referenced ------- */

  {
    const r = await ask(
      { answer: 'x', actions: [{ tool: 'archive', refs: [1, 2] }] },
      { items: [{ title: 'no id here' }, ITEMS[0]] }
    );
    check('a reference to an id-less item resolves to nothing', r.actions[0].itemIds, ['itm_ramen']);
  }

  /* ---- an empty library still answers --------------------------------- */

  {
    const r = await ask({ answer: 'You have nothing saved.' }, { items: [] });
    check('an empty library is stated in the prompt', lastPrompt.includes('No saved items.'), true);
    check('an empty library still returns cleanly', [r.sources, r.actions], [[], []]);
  }

  /* ---- a query is still required -------------------------------------- */

  {
    const response = await fetch(`${WORKER}/api/gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'assistant', items: ITEMS }),
    });
    check('a missing query is a 400', response.status, 400);
  }
} finally {
  stub.close();
  await stopAll();
}

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
