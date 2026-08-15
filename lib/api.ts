/**
 * Backend API client.
 *
 * The Cloudflare Worker's ONLY job is to proxy Google Gemini so the API key
 * never ships in the app bundle (an on-device key would be extractable →
 * unauthenticated paid-quota drain, the audit's P0). Everything else —
 * search, storage, assistant retrieval — runs on-device and free. The only
 * thing that touches the network here is the single `/api/gemini` proxy.
 *
 * Required env: EXPO_PUBLIC_API_BASE_URL (Worker URL). Optional:
 * EXPO_PUBLIC_CLIENT_TOKEN (must match the Worker's APP_CLIENT_TOKEN).
 */
import {
  AnalyzeImageResponse,
  ScheduleSuggestionResponse,
  ApiErrorResponse,
  ExtractedLinkResponse,
} from './types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_CLIENT_TOKEN || '';

/** Common headers: JSON + optional shared client token (X-Silo-Client). */
function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CLIENT_TOKEN) headers['X-Silo-Client'] = CLIENT_TOKEN;
  return headers;
}

/** Network budget for one Gemini round-trip. RN's `fetch` has no default timeout. */
const REQUEST_TIMEOUT_MS = 20000;

/**
 * A signal that aborts after `ms`.
 *
 * Prefers the standard `AbortSignal.timeout`, but React Native polyfills
 * AbortSignal from the `abort-controller` package, which predates that static —
 * calling it unguarded would throw on every request. Hence the fallback.
 */
function timeoutSignal(ms: number): AbortSignal {
  const ctor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof ctor.timeout === 'function') return ctor.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** True once the Worker URL is configured (otherwise AI features no-op cleanly). */
export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

/**
 * POST a task to the single Gemini proxy endpoint. Throws a friendly error on
 * failure. Pass `signal` to make the call cancellable (capture lets the user
 * back out of a slow analysis); when omitted the request still gives up after
 * REQUEST_TIMEOUT_MS instead of hanging forever.
 */
async function postGemini<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!isApiConfigured()) {
    throw new Error('AI isn’t set up yet — add your Worker URL to turn it on.');
  }
  const response = await fetch(`${API_BASE_URL}/api/gemini`, {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(body),
    // React Native declares its own `AbortSignal` global (see
    // react-native/src/types/globals.d.ts) that is structurally incompatible
    // with the ambient one `new AbortController()` is typed to produce — one
    // runtime object, two declarations. The cast lives here so callers can just
    // pass `controller.signal`.
    signal: (signal ?? timeoutSignal(REQUEST_TIMEOUT_MS)) as unknown as RequestInit['signal'],
  });
  if (!response.ok) {
    let msg = `Request failed (${response.status})`;
    try {
      const e = (await response.json()) as ApiErrorResponse;
      if (e?.error) msg = e.error;
    } catch {
      // keep the status-based message
    }
    throw new Error(msg);
  }
  return (await response.json()) as T;
}

/** Classify/title/tag an image (e.g. a screenshot) via the Gemini proxy. */
export async function analyzeImage(
  imageBase64: string,
  mimeType: string
): Promise<AnalyzeImageResponse> {
  return postGemini<AnalyzeImageResponse>({ task: 'classify_image', imageBase64, mimeType });
}

/**
 * Universal social-link extractor. Resolves the platform and returns normalized
 * metadata (title/author/caption/thumbnail/embed) + a category + tags from the
 * Gemini classify chain — for YouTube/TikTok/X/Vimeo via oEmbed, and
 * Instagram/Reddit/Threads/Facebook/any URL via Open Graph. Fetching + parsing
 * happen server-side in the Worker (egress-hardened); the client just posts the
 * URL. On a dead/private/login-walled link the Worker returns `ok:false` with
 * whatever it has, so the caller can still save the raw link (never lose a save).
 *
 * `signal` lets capture cancel an in-flight extraction (the Cancel button under
 * the analysis skeleton); without one the call still times out on its own.
 */
export async function extractLink(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedLinkResponse> {
  return postGemini<ExtractedLinkResponse>({ task: 'extract', url }, signal);
}

/** Suggest when to review an item via the Gemini proxy. */
export async function suggestScheduleTime(data: {
  title: string;
  classification: string;
  description?: string;
  duration?: number;
}): Promise<ScheduleSuggestionResponse> {
  return postGemini<ScheduleSuggestionResponse>({ task: 'suggest_schedule', ...data });
}

/**
 * On-device keyword/tag search — no network, no cost. (Semantic search would
 * need a hosted vector DB, which we intentionally avoid; keyword+tag is the
 * free path and runs entirely on-device.) Returns matching item indices as
 * strings, preserving input order.
 */
export async function aiSearch(
  query: string,
  items: {
    id?: string;
    title: string;
    description?: string;
    tags: string[];
    classification: string;
  }[]
): Promise<string[]> {
  const q = query.trim().toLowerCase();
  if (!q) return items.map((_, i) => i.toString());
  return items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        item.title.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.classification.toLowerCase().includes(q)
    )
    .map(({ index }) => index.toString());
}

/**
 * Assistant over the user's saved items. Retrieval is on-device — the caller
 * passes the already-relevant items; the Worker only runs Gemini to phrase a
 * grounded answer. The model is instructed never to invent saved content.
 * Signature kept backward-compatible; `userId`/`suggestEvent` are ignored.
 */
export async function ragQuery(data: {
  userId?: string;
  query: string;
  suggestEvent?: boolean;
  items?: {
    id: string;
    title: string;
    description?: string;
    tags?: string[];
    classification?: string;
  }[];
}): Promise<{
  answer: string;
  sources: { itemId: string; title: string; description?: string; relevance: number }[];
  suggestedEvent?: { title: string; date: string; time: string; description: string };
}> {
  const result = await postGemini<{
    answer: string;
    sources?: { itemId: string; title: string; description?: string; relevance: number }[];
  }>({ task: 'assistant', query: data.query, items: data.items || [] });
  return { answer: result.answer, sources: result.sources || [] };
}
