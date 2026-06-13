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
 *   - "assistant"         { query, items: Array<{ title, description?, classification, tags? }> }
 *
 * SECURITY NOTES:
 *   - The URL passed to "classify_link" is never fetched by the Worker. We only
 *     forward the url string plus optional client-supplied pageText to Gemini.
 *     This removes the previous server-side fetch (SSRF risk).
 *   - On any upstream/parse failure we return a generic 502 and never echo the
 *     provider's error text back to the client (avoids leaking upstream details).
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
 * Call Gemini's generateContent with the given parts and return the generated
 * text. Throws on any non-OK response or missing text so callers can map it to a
 * single generic 502 (no upstream error text is propagated).
 */
async function callGemini(env: Env, parts: any[]): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      // Send the key as a header, not a URL query param, so it can't land in
      // request logs / `wrangler tail` output.
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );

  if (!response.ok) {
    // Read and log upstream detail server-side only; never return it to client.
    const detail = await response.text().catch(() => '');
    console.error(`[silo] Gemini ${response.status}:`, detail);
    throw new Error('gemini_upstream_error');
  }

  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== 'string') {
    throw new Error('gemini_no_text');
  }
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

async function handleAssistant(
  body: any,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { query, items } = body as {
    query?: string;
    items?: {
      title?: string;
      description?: string;
      classification?: string;
      tags?: string[];
    }[];
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
      return `${idx + 1}. ${item.title || 'Untitled'}${cls}${desc}${tags}`;
    })
    .join('\n');

  const prompt = `You are Silo, a personal assistant that answers questions using ONLY the user's saved items listed below. Never invent saved content, and do not claim the user saved something that is not in the list. If the items do not contain the answer, say so plainly.

User's saved items:
${context || 'No saved items.'}

User's question: ${query}

Return ONLY a JSON object (no markdown, no prose):
{
  "answer": "your answer, grounded only in the saved items above",
  "sources": []
}`;

  const text = await callGemini(env, [{ text: prompt }]);
  const parsed = extractJson(text);

  const answer =
    parsed && typeof parsed.answer === 'string' && parsed.answer ? parsed.answer : text.trim();

  return json(200, { answer, sources: [] }, corsHeaders);
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
