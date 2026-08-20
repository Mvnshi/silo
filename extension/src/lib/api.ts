/**
 * Thin client to the Silo Cloudflare Worker — the same Worker the iOS app
 * uses. See spec §4.4. KEEP IN SYNC with the app's `lib/api.ts` shape.
 *
 * Config: `WXT_SILO_API_BASE_URL` and `WXT_SILO_CLIENT_TOKEN` in
 * `extension/.env.local` (mirror of the app's EXPO_PUBLIC_* values). The
 * `WXT_` prefix is load-bearing — WXT only injects prefixed vars into the
 * bundle, so an unprefixed name silently yields `API_BASE = ''`. See
 * `.env.example`.
 *
 * EVERY call is time-boxed (see TASK_TIMEOUT_MS): a cold Cloudflare start must
 * never hold a capture hostage. Callers save what they already have and enrich
 * when (if) the response lands.
 */

/** Extract-task request shape. Index signature lets callWorker's
 *  `Record<string, unknown>` accept us without a cast. */
interface ExtractRequest {
  url: string;
  [k: string]: unknown;
}

export interface ExtractedLink {
  ok: boolean;
  platform: string;
  kind: string;
  title: string;
  description?: string;
  caption?: string;
  thumbnailUrl?: string;
  /**
   * Every image on the post, in order — a carousel/gallery keeps all its frames.
   * Present only when there is more than one; `thumbnailUrl` is always `[0]`.
   */
  thumbnailUrls?: string[];
  classification: string;
  tags?: string[];
  sourceUrl?: string;
  author?: string;
}

// WXT exposes env vars via import.meta.env. The triple-slash reference at the
// top of `tsconfig.json` doesn't always reach generated entrypoint types, so
// we declare the two keys we care about inline. Keeps callers strict.
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
const API_BASE = env.WXT_SILO_API_BASE_URL ?? '';
const CLIENT_TOKEN = env.WXT_SILO_CLIENT_TOKEN ?? '';

/**
 * Per-task ceilings. These differ because who is waiting differs:
 *
 * - `extract` blocks a HUMAN staring at the popup. A Cloudflare cold start is
 *   ~1-2s; past ~3.5s they have already decided to save, so we abort and let
 *   the popup persist what it has and enrich later.
 * - `classify_image` runs in the background service worker after a right-click,
 *   with a base64 upload and a vision model on the far end. Nothing is blocked
 *   on it, and 3.5s would abort perfectly healthy saves.
 */
const TASK_TIMEOUT_MS: Record<string, number> = {
  extract: 3500,
  classify_image: 12_000,
};
const DEFAULT_TIMEOUT_MS = 8000;

async function callWorker<T>(task: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/api/gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CLIENT_TOKEN ? { 'X-Silo-Client': CLIENT_TOKEN } : {}),
    },
    body: JSON.stringify({ task, ...body }),
    // Unbounded is not an option anywhere: a hung fetch keeps an MV3 worker
    // alive and a popup disabled forever.
    signal: AbortSignal.timeout(TASK_TIMEOUT_MS[task] ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Worker ${task} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function extractLink(req: ExtractRequest): Promise<ExtractedLink> {
  return callWorker<ExtractedLink>('extract', req);
}

/**
 * Worker response for `classify_image`. Mirrors the phone's
 * `AnalyzeImageResponse` (see ../../lib/types.ts) but is declared locally: the
 * extension is a separate build with its own tsconfig, and reaching across the
 * repo root for a type would couple the two bundles for no benefit.
 */
interface AnalyzeImageResponse {
  classification: string;
  title: string;
  description?: string;
  tags?: string[];
  duration?: number;
  script?: string;
}

/** Classify/title/tag a raw image (right-click image save). */
export function analyzeImage(
  imageBase64: string,
  mimeType: string
): Promise<AnalyzeImageResponse> {
  return callWorker<AnalyzeImageResponse>('classify_image', { imageBase64, mimeType });
}
