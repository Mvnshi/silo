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
 * The stub answers in Gemini's FUNCTION CALLING shape (`parts` carrying `text`
 * and `functionCall`), because that is what the assistant task asks for now. The
 * earlier response-schema version of this file measured 4/7 usable actions
 * against the live model — see the note on ASSISTANT_FUNCTIONS for why.
 *
 * For the complementary check that a real model actually calls these tools
 * correctly, see `verify-assistant-live.mjs` (needs a real key).
 *
 * Run:  node workers/scripts/verify-assistant-worker.mjs
 *
 * The Worker and the stub are started and stopped by this script.
 */
import http from 'node:http';
import { startWorker, stopAll } from './servers.mjs';

const STUB_PORT = Number(process.env.SILO_STUB_PORT ?? 8125);
const WORKER = process.env.SILO_WORKER_URL ?? 'http://localhost:8798';

/** Set per-test: the `parts` array the stubbed model "returns". */
let nextParts = [{ text: 'ok' }];
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
    res.end(JSON.stringify({ candidates: [{ content: { parts: nextParts } }] }));
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

/** Shorthand for a model turn: some prose plus zero or more tool calls. */
const turn = (text, ...calls) => [
  ...(text === null ? [] : [{ text }]),
  ...calls.map(([name, args]) => ({ functionCall: { name, args } })),
];

async function ask(parts, body = {}) {
  nextParts = parts;
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

  await ask(turn('hello'), { query: 'what did I save about ramen' });
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
    const r = await ask(turn('Archiving those.',
      ['cite', { refs: [1, 3] }],
      ['archive', { refs: [1, 3] }]));
    check('cite refs map to real ids', r.sources.map((s) => s.itemId), ['itm_ramen', 'itm_lang']);
    check('sources carry the title, so a chip can render it',
      r.sources.map((s) => s.title), ['Tonkotsu ramen', 'LangChain agents']);
    check('a call becomes an action with the tool name', r.actions[0].tool, 'archive');
    check('call refs become itemIds', r.actions[0].itemIds, ['itm_ramen', 'itm_lang']);
    check('the raw refs field does not survive', 'refs' in r.actions[0], false);
    check('cite is not itself an action', r.actions.length, 1);
    check('the prose comes back as the answer', r.answer, 'Archiving those.');
  }

  /* ---- a reference the model made up resolves to NOTHING -------------- */

  const archiveRefs = async (refs) =>
    (await ask(turn('x', ['archive', { refs }]))).actions[0].itemIds;

  check('a reference past the end is dropped, not clamped', await archiveRefs([9]), []);
  check('reference 0 is dropped — the list is 1-based', await archiveRefs([0]), []);
  check('a negative reference is dropped', await archiveRefs([-1]), []);
  check('a bad reference does not poison its valid siblings',
    await archiveRefs([1, 99, 2]), ['itm_ramen', 'itm_hike']);
  check('a fractional reference is dropped rather than rounded', await archiveRefs([1.5]), []);
  check('an id the model INVENTED in the refs slot is dropped',
    await archiveRefs(['itm_ramen']), []);
  check('a repeated reference collapses', await archiveRefs([2, 2]), ['itm_hike']);

  {
    const r = await ask(turn('x', ['cite', { refs: [42] }]));
    check('an invented cite reference yields no chip', r.sources, []);
  }

  /* ---- shape ---------------------------------------------------------- */

  {
    const r = await ask(turn('just answering'));
    check('no calls means an empty action array, never undefined', r.actions, []);
    check('the answer is passed through', r.answer, 'just answering');
  }
  {
    // Gemini splits prose across parts more often than you would expect.
    const r = await ask([{ text: 'Half a sentence' }, { text: ', and the rest.' }]);
    check('prose split across parts is joined', r.answer, 'Half a sentence, and the rest.');
  }
  {
    const r = await ask(turn(null, ['archive', { refs: [1] }]));
    check('a call with no prose still gets a sentence', r.answer.length > 0, true);
  }
  {
    const r = await ask(turn('x',
      ['schedule', { refs: [1], date: '2026-08-22', time: '09:00', duration: 45 }]));
    check('schedule fields survive the mapping',
      [r.actions[0].date, r.actions[0].time, r.actions[0].duration],
      ['2026-08-22', '09:00', 45]);
  }
  {
    const r = await ask(turn('x',
      ['set_trigger', { refs: [2], condition: { type: 'day_of_week', daysOfWeek: [0, 6] } }]));
    check('a nested condition survives intact',
      r.actions[0].condition, { type: 'day_of_week', daysOfWeek: [0, 6] });
  }
  {
    // `add` invents a row rather than touching one, so it needs no references.
    const r = await ask(turn('x', ['add', { title: 'Book the permit' }]));
    check('add survives with no refs at all',
      [r.actions[0].tool, r.actions[0].itemIds], ['add', []]);
  }
  {
    // The live model really does emit the same call twice for one request.
    const r = await ask(turn('x',
      ['set_trigger', { refs: [2], condition: { type: 'manual' } }],
      ['set_trigger', { refs: [2], condition: { type: 'manual' } }]));
    check('an identical repeated call is deduped', r.actions.length, 1);
  }
  {
    const r = await ask(turn('x',
      ['archive', { refs: [1] }],
      ['archive', { refs: [2] }]));
    check('calls that differ are both kept', r.actions.length, 2);
  }

  /* ---- an item the client sent without an id can't be referenced ------- */

  {
    const r = await ask(turn('x', ['archive', { refs: [1, 2] }]),
      { items: [{ title: 'no id here' }, ITEMS[0]] });
    check('a reference to an id-less item resolves to nothing',
      r.actions[0].itemIds, ['itm_ramen']);
  }

  /* ---- an empty library still answers --------------------------------- */

  {
    const r = await ask(turn('You have nothing saved.'), { items: [] });
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
