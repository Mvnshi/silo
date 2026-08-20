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
import { isPremium } from './billing';

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
 * Tasks that stay free forever.
 *
 * `extract` is the one that must never be gated: it is what turns a pasted link
 * into a titled, thumbnailed, playable save, and a free tier where saving is
 * degraded is a free tier nobody forms a habit in. The north-star metric is
 * actions taken per week, so everything that builds the habit is free and the
 * paywall sits where marginal cost actually is — the rest of the Gemini tasks.
 *
 * Moving the line is a one-line change here. `aiSearch` is absent on purpose:
 * it runs entirely on-device and never reaches this function.
 */
const FREE_TASKS = new Set(['extract']);

/**
 * Thrown when a premium-only task is called without an entitlement. Callers
 * already handle a throw from `postGemini` by falling back to the on-device
 * path, so gating here degrades rather than breaks; UI that wants to offer the
 * paywall instead can detect it with `isPremiumRequired`.
 */
export const PREMIUM_REQUIRED = 'Silo Premium is needed for this.';

export function isPremiumRequired(error: unknown): boolean {
  return error instanceof Error && error.message === PREMIUM_REQUIRED;
}

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
  // `isPremium()` is synchronous and returns true whenever billing is
  // unconfigured, so an unpaid build behaves exactly as it always has.
  if (!FREE_TASKS.has(String(body.task ?? '')) && !isPremium()) {
    throw new Error(PREMIUM_REQUIRED);
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

/** One saved item as the assistant sees it. Ids never reach the model — the
 *  Worker numbers the list and maps the numbers back (see workers/gemini.ts). */
export interface AssistantContextItem {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  classification?: string;
  /** Lets the model answer "what's on for Saturday" without a second round-trip. */
  scheduled_date?: string;
  status?: string;
}

export interface AssistantSource {
  itemId: string;
  title: string;
  description?: string;
  relevance: number;
}

export interface AssistantResponse {
  answer: string;
  sources: AssistantSource[];
  /**
   * Proposed actions, still RAW. Validate with `lib/assistant.parseActions`
   * against the ids you sent before showing or running any of them — that check
   * is what stops a hallucinated reference from reaching real data.
   */
  actions: unknown[];
}

/**
 * Assistant over the user's saved items — grounded answers, and grounded
 * proposals.
 *
 * Retrieval is on-device: the caller passes the already-relevant items and the
 * Worker only runs Gemini to phrase an answer and, when the user asked for
 * something to be done, to describe it as a structured action. The model is
 * instructed never to invent saved content, and cannot invent an item id
 * because it is never shown one.
 *
 * Nothing here executes anything. Actions come back as proposals for the UI to
 * confirm; `lib/assistantExec.runAction` is what actually writes.
 *
 * `today`/`now` are the DEVICE's local date and time. They are required for
 * "Saturday morning" to mean the user's Saturday rather than the edge Worker's.
 */
export async function ragQuery(data: {
  query: string;
  items?: AssistantContextItem[];
  /** Local YYYY-MM-DD. */
  today?: string;
  /** Local HH:MM. */
  now?: string;
}): Promise<AssistantResponse> {
  const result = await postGemini<{
    answer: string;
    sources?: AssistantSource[];
    actions?: unknown[];
  }>({
    task: 'assistant',
    query: data.query,
    items: data.items || [],
    today: data.today,
    now: data.now,
  });
  return {
    answer: result.answer,
    sources: result.sources || [],
    actions: Array.isArray(result.actions) ? result.actions : [],
  };
}
