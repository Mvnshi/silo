/**
 * Cloudflare Worker: Authenticated Gemini Proxy
 *
 * Single thin proxy in front of Google Gemini. Its only purpose is to keep the
 * GEMINI_API_KEY server-side so it never ships in the client bundle. There is no
 * other service here — voice (ElevenLabs), storage (Vultr), and the Instagram
 * scraper were removed in the cost-reduction pass.
 *
 * Endpoint: POST /api/gemini
 *
 * The request body carries a `task` discriminator that selects the behaviour:
 *   - "classify_image"    { imageBase64, mimeType }
 *   - "classify_link"     { url, pageText? }   (URL is NOT fetched server-side)
 *   - "suggest_schedule"  { title, classification, description?, duration? }
 *   - "assistant"         { query, items: Array<{ id, title, … }>, today?, now? }
 *
 * SECURITY NOTES:
 *   - The URL passed to "classify_link" is never fetched by the Worker. We only
 *     forward the url string plus optional client-supplied pageText to Gemini.
 *     This removes the previous server-side fetch (SSRF risk).
 *   - On any upstream/parse failure we return a generic 502 and never echo the
 *     provider's error text back to the client (avoids leaking upstream details).
 *   - "assistant" can propose ACTIONS that mutate the user's library and
 *     calendar. It never executes one — the data lives on the device, so all the
 *     Worker can do is describe an intent. Items are shown to the model as
 *     `[1]…[N]` and it answers in those numbers, so it has no item id to invent;
 *     the numbers are mapped back here and re-validated on the client. See
 *     `handleAssistant` and `lib/assistant.ts`.
 *   - Actions come back as Gemini FUNCTION CALLS, one declaration per verb with
 *     its own required fields, at temperature 0. Both of those were arrived at by
 *     measurement, not preference — see ASSISTANT_FUNCTIONS.
 *
 * Environment Variables Required:
 * - GEMINI_API_KEY: Google Gemini API key (server-side only)
 */

import { Env, ClassificationResult, ScheduleSuggestion, ErrorResponse } from './types';
import { extractLink, ExtractedLink } from './extract';

// Current stable flash model. gemini-2.0-flash was sunset (404 "no longer
// available") in 2026 — when this 404s again, bump to the next stable flash
// (`curl .../v1beta/models` lists what your key can call). 2.5-flash is fast +
// cheap, ideal for classify/extract/suggest.
const GEMINI_MODEL = 'gemini-2.5-flash';

/** Allowed classification values; anything else falls back to 'other'. */
const CLASSIFICATIONS = [
  'article',
  'video',
  'recipe',
  'product',
  'event',
  'place',
  'idea',
  'fitness',
  'food',
  'career',
  'academia',
  'other',
] as const;

type Classification = (typeof CLASSIFICATIONS)[number];

/** Coerce an arbitrary value into a valid classification, defaulting to 'other'. */
function toClassification(value: unknown): Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value as string)
    ? (value as Classification)
    : 'other';
}

function json(
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Extract the first JSON object from a model's text output. Returns null when no
 * parseable object is present. Never throws.
 */
function extractJson(text: string): Record<string, any> | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Upstream failure carrying the HTTP status, so a caller can tell "the model is
 * down" (retrying is pointless) from "the model rejected my request shape"
 * (retrying without the exotic part is worth one attempt — see
 * `handleAssistant`). The status never reaches the client: the router still maps
 * every one of these to a single generic 502.
 */
class GeminiError extends Error {
  constructor(readonly status: number) {
    super('gemini_upstream_error');
  }
}

/**
 * Call Gemini's generateContent with the given parts and return the generated
 * text. Throws on any non-OK response or missing text so callers can map it to a
 * single generic 502 (no upstream error text is propagated).
 *
 * `generationConfig` is passed straight through — it is how the assistant asks
 * for schema-enforced JSON rather than hoping prose parses.
 */
async function callGeminiParts(env: Env, parts: any[], extra?: Record<string, unknown>): Promise<any[]> {
  // Google unless a deployment overrides it; see Env.GEMINI_BASE_URL.
  const base = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  const model = env.GEMINI_MODEL || GEMINI_MODEL;
  const response = await fetch(
    `${base}/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      // Send the key as a header, not a URL query param, so it can't land in
      // request logs / `wrangler tail` output.
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents: [{ parts }], ...(extra ?? {}) }),
    }
  );

  if (!response.ok) {
    // Read and log upstream detail server-side only; never return it to client.
    const detail = await response.text().catch(() => '');
    console.error(`[silo] Gemini ${response.status}:`, detail);
    throw new GeminiError(response.status);
  }

  const data = (await response.json()) as any;
  const out = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(out) ? out : [];
}

/**
 * The text of a plain (non-tool) completion — what every task except the
 * assistant wants. Throws when the model returned no text at all so callers can
 * map it to the single generic 502.
 */
async function callGemini(env: Env, parts: any[], generationConfig?: any): Promise<string> {
  const out = await callGeminiParts(
    env,
    parts,
    generationConfig ? { generationConfig } : undefined
  );
  const text = out.find((p) => typeof p?.text === 'string' && p.text)?.text;
  if (!text) throw new Error('gemini_no_text');
  return text;
}

/** Shared instruction describing the classification JSON contract. */
function classificationInstruction(): string {
  return `Classify the input into exactly one of these categories: ${CLASSIFICATIONS.join(
    ', '
  )}.

Return ONLY a JSON object (no markdown, no prose) with this shape:
{
  "classification": "one of the categories above",
  "title": "short title",
  "description": "2-3 sentence summary",
  "tags": ["tag1", "tag2", "tag3"],
  "duration": estimated_minutes_to_review_as_a_number,
  "place_name": "only if this is a place/location",
  "place_address": "only if this is a place/location"
}

Be concise and accurate.`;
}

/** Build a ClassificationResult from raw model output, applying enum + fallbacks. */
function toClassificationResult(
  parsed: Record<string, any> | null,
  fallbackTitle: string
): ClassificationResult {
  if (!parsed) {
    return { classification: 'other', title: fallbackTitle, tags: [] };
  }
  return {
    classification: toClassification(parsed.classification),
    title: typeof parsed.title === 'string' && parsed.title ? parsed.title : fallbackTitle,
    description: typeof parsed.description === 'string' ? parsed.description : undefined,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
    place_name: typeof parsed.place_name === 'string' ? parsed.place_name : undefined,
    place_address: typeof parsed.place_address === 'string' ? parsed.place_address : undefined,
  };
}

async function handleClassifyImage(
  body: any,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { imageBase64, mimeType } = body as { imageBase64?: string; mimeType?: string };
  if (!imageBase64 || !mimeType) {
    return json(
      400,
      { error: 'Missing required fields: imageBase64, mimeType' } as ErrorResponse,
      corsHeaders
    );
  }

  const prompt = `Analyze this image.\n\n${classificationInstruction()}`;
  const text = await callGemini(env, [
    { inlineData: { data: imageBase64, mimeType } },
    { text: prompt },
  ]);

  const result = toClassificationResult(extractJson(text), 'Image');
  return json(200, result, corsHeaders);
}

async function handleSuggestSchedule(
  body: any,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { title, classification, description, duration } = body as {
    title?: string;
    classification?: string;
    description?: string;
    duration?: number;
  };
  if (!title || !classification) {
    return json(
      400,
      { error: 'Missing required fields: title, classification' } as ErrorResponse,
      corsHeaders
    );
  }

  const now = new Date();
  const currentDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

  const prompt = `Suggest the best time within the next 7 days to review this content.

Title: ${title}
Type: ${classification}
${description ? `Description: ${description}` : ''}
${duration ? `Estimated duration: ${duration} minutes` : ''}

Current date: ${currentDate}
Current time: ${currentTime}

Return ONLY a JSON object (no markdown, no prose):
{
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "reason": "one sentence explanation"
}`;

  const text = await callGemini(env, [{ text: prompt }]);
  const parsed = extractJson(text);

  let suggestion: ScheduleSuggestion;
  if (parsed) {
    suggestion = {
      date: typeof parsed.date === 'string' ? parsed.date : currentDate,
      time: typeof parsed.time === 'string' ? parsed.time : '09:00',
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'General suggestion',
    };
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    suggestion = {
      date: tomorrow.toISOString().split('T')[0],
      time: '09:00',
      reason: 'Default suggestion for tomorrow morning',
    };
  }

  return json(200, suggestion, corsHeaders);
}

/* ---------------------------------------------------------------------------
 * Assistant — grounded answers, and grounded ACTIONS
 * ------------------------------------------------------------------------- */

/**
 * The verbs the assistant may propose. Mirrors `ASSISTANT_TOOLS` in
 * `lib/assistant.ts` — a separate bundle that can't import this module, same
 * arrangement as CLASSIFICATIONS above.
 * KEEP IN SYNC WITH: lib/assistant.ts
 */
const ASSISTANT_TOOLS = ['schedule', 'complete', 'archive', 'add', 'set_trigger'] as const;

/** Condition types the trigger engine can evaluate. KEEP IN SYNC WITH: lib/types.ts */
const CONDITION_TYPES = [
  'location_proximity',
  'time_of_day',
  'date_after',
  'date_range',
  'day_of_week',
  'calendar_free',
  'manual',
] as const;

/**
 * Schema-enforced output. This is the difference between a tool call and a
 * regex over prose: the shape is validated by the API before a token reaches us,
 * so a malformed action is a retry upstream rather than a surprise downstream.
 *
 * Two deliberate choices:
 *
 *  - **Actions are one flat, permissive object.** A discriminated union of five
 *    differently-shaped actions is the part of the OpenAPI subset most likely to
 *    be rejected outright, and a rejection takes the whole assistant with it. So
 *    the schema pins the shape and `lib/assistant.parseActions` pins the meaning
 *    — in TypeScript, where it is unit-tested (`scripts/verify-assistant.mjs`).
 *  - **Items are referenced by number, never by id.** The model is shown
 *    `[1]…[N]` and answers in those numbers, so the only thing it can emit for
 *    an item is a small integer. It has no id to invent. See `resolveRefs`.
 */
/**
 * The assistant's verbs, as real function declarations.
 *
 * This started as a single permissive `responseSchema` object serving all five
 * verbs, with only `tool` required — the shape most likely to be accepted by the
 * structured-output endpoint. It was accepted, and it did not work: measured
 * against a live model, only 4 of 7 requests produced an action the client could
 * actually use. `schedule` came back with a time and no date. `set_trigger` came
 * back with no condition at all. Both were then correctly discarded by
 * `lib/assistant.parseActions`, which is the worst possible outcome — the
 * assistant says "I'll put that on Saturday" and no card ever appears.
 *
 * The cause was structural, not the model: one object shared by five verbs
 * cannot mark `date` required for `schedule` without demanding it of `archive`
 * too, so nothing ever forced the field to exist. Bumping to a newer flash
 * scored identically (4/7), which is what ruled the model out as the culprit.
 *
 * Function calling is the API built for this. Each verb is its own declaration
 * with its own `required` list, so "a schedule needs a date" stops being a
 * sentence in a description the model may skim and becomes a constraint the
 * endpoint enforces.
 *
 * KEEP IN SYNC WITH: lib/assistant.ts (ASSISTANT_TOOLS) — the client re-validates
 * everything here and remains the authority.
 */
const ASSISTANT_FUNCTIONS = [
  {
    name: 'schedule',
    description:
      "Put ONE saved item on the user's real calendar at a specific date and time. To schedule several things, call this several times.",
    parameters: {
      type: 'OBJECT',
      properties: {
        refs: {
          type: 'ARRAY',
          description: 'Exactly one reference number from the list.',
          items: { type: 'INTEGER' },
        },
        date: {
          type: 'STRING',
          description:
            'The calendar date as YYYY-MM-DD. Resolve words like "Saturday" against today\'s date, given above.',
        },
        time: { type: 'STRING', description: '24-hour local time as HH:MM, e.g. "09:30".' },
        duration: { type: 'INTEGER', description: 'Minutes the item will take.' },
      },
      required: ['refs', 'date', 'time'],
    },
  },
  {
    name: 'complete',
    description:
      'Mark saved items the user has already done. Use when they report having done something.',
    parameters: {
      type: 'OBJECT',
      properties: {
        refs: { type: 'ARRAY', items: { type: 'INTEGER' } },
        outcome: {
          type: 'STRING',
          enum: ['loved', 'good', 'skipped'],
          description:
            '"loved" if they would do it again, "skipped" if it did not happen, otherwise "good".',
        },
      },
      required: ['refs', 'outcome'],
    },
  },
  {
    name: 'archive',
    description:
      'Take saved items off the user\'s lists without deleting them. Use for tidying requests. Pass EVERY item in one call.',
    parameters: {
      type: 'OBJECT',
      properties: {
        refs: {
          type: 'ARRAY',
          description: 'Every reference number to archive, in one call.',
          items: { type: 'INTEGER' },
        },
      },
      required: ['refs'],
    },
  },
  {
    name: 'add',
    description: 'Save something NEW that is not already in the list.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'A short title. A few words, not a sentence.' },
        classification: { type: 'STRING', enum: [...CLASSIFICATIONS] },
        note: { type: 'STRING', description: 'Optional detail.' },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_trigger',
    description:
      'Attach a condition so Silo resurfaces the item when the condition becomes true. This is how "remind me when/whenever…" is handled.',
    parameters: {
      type: 'OBJECT',
      properties: {
        refs: { type: 'ARRAY', items: { type: 'INTEGER' } },
        condition: {
          type: 'OBJECT',
          description: 'The condition that makes the item resurface.',
          properties: {
            type: {
              type: 'STRING',
              enum: [...CONDITION_TYPES],
              description:
                'time_of_day for "in the evenings"; day_of_week for "on weekends"; location_proximity for "when I am near X" (only with real coordinates); date_range for a trip or season; date_after for "after some date"; calendar_free for "when I have time"; manual for a plain reminder time.',
            },
            startHour: { type: 'INTEGER', description: 'time_of_day: 0-23, local.' },
            endHour: { type: 'INTEGER', description: 'time_of_day: 0-23, local, exclusive.' },
            daysOfWeek: {
              type: 'ARRAY',
              description: 'day_of_week: 0=Sunday … 6=Saturday.',
              items: { type: 'INTEGER' },
            },
            latitude: { type: 'NUMBER', description: 'location_proximity.' },
            longitude: { type: 'NUMBER', description: 'location_proximity.' },
            radiusMeters: { type: 'INTEGER', description: 'location_proximity.' },
            placeLabel: { type: 'STRING', description: 'location_proximity: what to call the place.' },
            date: { type: 'STRING', description: 'date_after: YYYY-MM-DD.' },
            startDate: { type: 'STRING', description: 'date_range: YYYY-MM-DD.' },
            endDate: { type: 'STRING', description: 'date_range: YYYY-MM-DD.' },
            minFreeMinutes: { type: 'INTEGER', description: 'calendar_free.' },
            remindAt: { type: 'STRING', description: 'manual: ISO datetime.' },
          },
          required: ['type'],
        },
      },
      required: ['refs', 'condition'],
    },
  },
  {
    name: 'cite',
    description:
      'Call once with the reference numbers your written answer actually relied on, so the user can tap through to them. Call this for any answer that draws on a saved item.',
    parameters: {
      type: 'OBJECT',
      properties: { refs: { type: 'ARRAY', items: { type: 'INTEGER' } } },
      required: ['refs'],
    },
  },
];

/**
 * Undo the model nesting its whole reply inside its own `answer` field.
 *
 * Real Gemini does this, and it is not rare: asked for `{answer, actions}` it
 * sometimes returns `{"answer": "{\"answer\": \"…\", \"actions\": […]}"}`. That
 * satisfies the schema — `answer` really is a string — while being completely
 * wrong, and it fails in the worst possible way: the user is shown raw JSON as
 * the reply, and every action is silently dropped, because the real ones are
 * inside a string nobody looks in. A stubbed model never does it, so this cost
 * nothing to miss until the first live call.
 *
 * The prompt now tells it not to, but a prompt is a request. This is the
 * guarantee: if `answer` parses to something that is itself a reply, use that.
 * Bounded depth, and it only unwraps when the inner object really looks like an
 * envelope, so prose that merely happens to contain braces is left alone.
 */
function unwrapEnvelope(parsed: Record<string, any> | null): Record<string, any> | null {
  let out = parsed;
  for (let depth = 0; depth < 3; depth++) {
    if (!out || typeof out.answer !== 'string') break;
    const inner = extractJson(out.answer);
    if (!inner || typeof inner.answer !== 'string') break;
    out = {
      ...inner,
      // Keep whatever the outer envelope carried if the inner one omitted it.
      sourceRefs: inner.sourceRefs ?? out.sourceRefs,
      actions: inner.actions ?? out.actions,
    };
  }
  return out;
}

/**
 * Drop the `[3]` citation markers the model sprinkles through its prose.
 *
 * Reference numbers are an internal device for grounding — the user never sees
 * the numbered list, so a citation to it is noise at best and looks like a bug
 * at worst. Only numbers that actually index the list are stripped, so a genuine
 * "[2] cups of flour" quoted out of the user's own note survives.
 */
function stripRefMarkers(text: string, itemCount: number): string {
  if (itemCount === 0) return text;
  return text
    .replace(/\s*\[(\d+)\]/g, (match, n) => (Number(n) >= 1 && Number(n) <= itemCount ? '' : match))
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** Weekday name for a YYYY-MM-DD, computed in UTC so no server timezone leaks in. */
function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/** A YYYY-MM-DD the client actually sent, or null. */
function safeDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/**
 * Map `[n]` references back to real item ids.
 *
 * This is the second of the three grounding layers (the first is that the model
 * only ever sees numbers; the third is `lib/assistant.parseActions` re-checking
 * against what the client sent). A reference outside 1…N, or to an item the
 * client sent without an id, resolves to nothing and is dropped — never
 * clamped to a neighbour, which would archive the wrong row.
 */
function resolveRefs(refs: unknown, items: { id?: string }[]): string[] {
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const ref of refs) {
    if (typeof ref !== 'number' || !Number.isInteger(ref)) continue;
    const item = items[ref - 1];
    if (!item?.id || out.includes(item.id)) continue;
    out.push(item.id);
  }
  return out;
}

async function handleAssistant(
  body: any,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { query, items, today, now } = body as {
    query?: string;
    items?: {
      id?: string;
      title?: string;
      description?: string;
      classification?: string;
      tags?: string[];
      scheduled_date?: string;
      status?: string;
    }[];
    /** The DEVICE's local date. See the note on `when` below. */
    today?: string;
    /** The device's local HH:MM. */
    now?: string;
  };
  if (!query || typeof query !== 'string') {
    return json(400, { error: 'Missing required field: query' } as ErrorResponse, corsHeaders);
  }

  const safeItems = Array.isArray(items) ? items : [];
  const context = safeItems
    .map((item, idx) => {
      const cls = item.classification ? ` [${item.classification}]` : '';
      const tags = item.tags && item.tags.length ? ` (Tags: ${item.tags.join(', ')})` : '';
      const desc = item.description ? `: ${item.description}` : '';
      const when = item.scheduled_date ? ` (scheduled ${item.scheduled_date})` : '';
      return `[${idx + 1}] ${item.title || 'Untitled'}${cls}${when}${desc}${tags}`;
    })
    .join('\n');

  /**
   * "Saturday morning" is only resolvable against the USER's clock. The Worker
   * runs in UTC on some Cloudflare edge, so a device-supplied date is the only
   * correct answer here — falling back to the Worker's own clock would put a
   * user in Auckland a day behind and quietly schedule the wrong Saturday.
   */
  const localDate = safeDate(today) ?? new Date().toISOString().split('T')[0];
  const localTime = typeof now === 'string' && /^\d{2}:\d{2}$/.test(now) ? now : '09:00';

  const prompt = `You are Silo, a personal assistant that answers questions using ONLY the user's saved items listed below. Never invent saved content, and do not claim the user saved something that is not in the list. If the items do not contain the answer, say so plainly.

Silo can also DO things to those saved items on the user's behalf, through the tools you have been given. When — and only when — the user asks for something to be done, call the matching tool. Otherwise just answer.

User's saved items, each with a reference number:
${context || 'No saved items.'}

Today is ${weekdayOf(localDate)} ${localDate}. The local time is ${localTime}.

Rules for referring to items:
- Refer to a saved item ONLY by its reference number from the list above.
- Never invent a reference number. If nothing above fits, call no tool and say so.

Rules for actions:
- Call a tool ONLY when the user asks for something to be done. A question gets an answer and no tool call.
- Refer to items only by their reference number. Never invent one; if nothing above fits, call no tool and say so.
- Archive several items with ONE archive call listing every reference, not one call each.
- Never make the same call twice.
- At most 5 calls. If the request is ambiguous, ask in your reply instead of guessing.
- Call the 'cite' tool with the reference numbers your reply relied on.

Rules for your written reply:
- Always write a reply in plain prose, alongside any tool calls.
- Say plainly what you are proposing — the user confirms every action before anything happens, so describe it as something you can do, not something you have done.
- Never put JSON in the reply.
- The user cannot see the reference numbers, so never write "[2]" or "item 3". Name the item instead.

User's question: ${query}`;

  /**
   * Function calling, with a text fallback.
   *
   * A 4xx here means this deployment's model will not accept tool declarations
   * at all. Losing the assistant entirely over that is worse than losing the
   * actions, so the fallback still answers — it just cannot propose anything.
   */
  let parts: any[];
  let toolsAvailable = true;
  try {
    parts = await callGeminiParts(env, [{ text: prompt }], {
      tools: [{ functionDeclarations: ASSISTANT_FUNCTIONS }],
      // AUTO, not ANY: a question deserves an answer and no call at all, and
      // ANY would force one — including on "schedule my dentist appointment",
      // where the right behaviour is to decline because nothing saved matches.
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      // Deciding whether to call a tool is a classification, not a creative
      // act. At the default temperature the same request would sometimes get a
      // card and sometimes only prose promising one, which is the difference
      // between an assistant you trust and one you check up on.
      generationConfig: { temperature: 0 },
    });
  } catch (error) {
    if (!(error instanceof GeminiError) || error.status >= 500) throw error;
    console.warn('[silo] assistant tools rejected; answering without them');
    toolsAvailable = false;
    parts = await callGeminiParts(env, [{ text: prompt }]);
  }

  // A tool-calling response interleaves prose and calls across parts, and the
  // model may split its prose over several. Join rather than take the first.
  const rawAnswer = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
  const calls = toolsAvailable
    ? parts
        .map((p) => p?.functionCall)
        .filter((c: any) => c && typeof c.name === 'string')
    : [];

  const byId = new Map(safeItems.filter((i) => i.id).map((i) => [i.id as string, i]));

  // `cite` is a declared function rather than a response field because there is
  // no response schema any more; it is the model telling us which items its
  // prose leaned on. Actions imply their own sources, so those count too.
  const citedRefs = calls
    .filter((c: any) => c.name === 'cite')
    .flatMap((c: any) => (Array.isArray(c.args?.refs) ? c.args.refs : []));
  const actionRefs = calls
    .filter((c: any) => c.name !== 'cite')
    .flatMap((c: any) => (Array.isArray(c.args?.refs) ? c.args.refs : []));
  const sourceIds = resolveRefs([...citedRefs, ...actionRefs], safeItems);
  const sources = sourceIds.map((itemId, index) => ({
    itemId,
    title: byId.get(itemId)?.title || 'Untitled',
    description: byId.get(itemId)?.description,
    relevance: Math.max(0, 1 - index * 0.1),
  }));

  const answer =
    stripRefMarkers(rawAnswer, safeItems.length) ||
    // A model that calls a tool and says nothing still needs a sentence: the
    // card alone, with no reply above it, reads as the assistant ignoring you.
    (calls.length ? 'Here’s what I can do — confirm below.' : 'I don’t have an answer for that.');

  // Calls arrive with reference numbers; they leave as ids the client supplied.
  // The client validates them again — see lib/assistant.parseActions.
  // Deduped by shape: the live model will happily emit the same set_trigger
  // twice for one request, and two identical cards means the user either sees a
  // stutter or taps the same write through twice.
  const seenActions = new Set<string>();
  const actions = calls
    .filter((c: any) => c.name !== 'cite')
    .map((c: any) => {
      const { refs, ...rest } = (c.args ?? {}) as Record<string, unknown>;
      return { ...rest, tool: c.name, itemIds: resolveRefs(refs, safeItems) };
    })
    .filter((a: any) => {
      const signature = JSON.stringify([a.tool, a.itemIds, a.date, a.time, a.outcome, a.title, a.condition]);
      if (seenActions.has(signature)) return false;
      seenActions.add(signature);
      return true;
    });

  return json(200, { answer, sources, actions }, corsHeaders);
}

/** Heuristic classification used when no Gemini key is set (extraction is keyless). */
function heuristicClassification(e: ExtractedLink): Classification {
  if (e.kind === 'video') return 'video';
  if (e.kind === 'article') return 'article';
  if (e.kind === 'image') return 'idea';
  return 'other';
}

/**
 * Universal link extractor: resolve platform -> oEmbed/OG metadata (extract.ts;
 * keyless + egress-hardened) -> chain into the existing Gemini classify for a
 * category + tags, like any other capture. Classification is best-effort: with
 * no GEMINI_API_KEY it falls back to a platform heuristic, so extraction still
 * works (and is verifiable via `wrangler dev`). Never throws to the client — a
 * hard failure still returns a saveable shell (ok:false) so the save is kept.
 */
async function handleExtract(
  body: any,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { url } = body as { url?: string };
  if (!url || typeof url !== 'string') {
    return json(400, { error: 'Missing required field: url' } as ErrorResponse, corsHeaders);
  }

  let extracted: ExtractedLink;
  try {
    extracted = await extractLink(url);
  } catch (err) {
    // Egress-guard rejection (bad scheme / blocked host) or hard failure: still
    // hand back a saveable shell so the client can persist the raw link.
    const reason = err instanceof Error ? err.message : 'extract_failed';
    extracted = { platform: 'web', kind: 'link', title: url, sourceUrl: url, ok: false, reason };
  }

  let classification: Classification = heuristicClassification(extracted);
  let tags: string[] = [];
  let description = extracted.caption;

  if (env.GEMINI_API_KEY) {
    try {
      const prompt = `${classificationInstruction()}

Classify this saved item from its metadata only (do not browse):
Platform: ${extracted.platform}
Title: ${extracted.title}
${extracted.author ? `Author: ${extracted.author}` : ''}
${extracted.caption ? `Caption/Description: ${extracted.caption}` : ''}
URL: ${extracted.sourceUrl}`;
      const text = await callGemini(env, [{ text: prompt }]);
      const parsed = extractJson(text);
      if (parsed) {
        classification = toClassification(parsed.classification);
        if (Array.isArray(parsed.tags)) {
          tags = parsed.tags.filter((t: unknown): t is string => typeof t === 'string').slice(0, 8);
        }
        if (!description && typeof parsed.description === 'string') description = parsed.description;
        // Improve a weak/url-like extracted title with the model's title.
        if (typeof parsed.title === 'string' && parsed.title.trim()) {
          const weak =
            !extracted.title ||
            extracted.title === extracted.sourceUrl ||
            /^https?:\/\//.test(extracted.title);
          if (weak) extracted.title = parsed.title.trim();
        }
      }
    } catch (err) {
      console.error('[silo] extract classify failed (using heuristic):', err);
    }
  }

  return json(200, { ...extracted, classification, tags, description }, corsHeaders);
}

/**
 * Thin authenticated Gemini proxy. Auth + rate limiting are applied upstream in
 * the router (applySecurity); this function assumes the request already passed.
 */
export async function handleGemini(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' } as ErrorResponse, corsHeaders);
  }

  const task = body?.task;

  // Most tasks need the Gemini key; `extract` does not (extraction is keyless,
  // classification is best-effort), so it stays available even before the key
  // is configured.
  if (task !== 'extract' && !env.GEMINI_API_KEY) {
    return json(503, { error: 'Service not configured' } as ErrorResponse, corsHeaders);
  }

  try {
    switch (task) {
      case 'classify_image':
        return await handleClassifyImage(body, env, corsHeaders);
      case 'suggest_schedule':
        return await handleSuggestSchedule(body, env, corsHeaders);
      case 'assistant':
        return await handleAssistant(body, env, corsHeaders);
      case 'extract':
        return await handleExtract(body, env, corsHeaders);
      default:
        return json(400, { error: 'Unknown task' } as ErrorResponse, corsHeaders);
    }
  } catch (error) {
    // Generic error only — do not leak upstream provider error text.
    console.error('[silo] Gemini proxy error:', error);
    return json(502, { error: 'Upstream request failed' } as ErrorResponse, corsHeaders);
  }
}
