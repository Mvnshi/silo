/**
 * Thin client to the Silo Cloudflare Worker — the same Worker the iOS app
 * uses. See spec §4.4. KEEP IN SYNC with the app's `lib/api.ts` shape.
 *
 * Config: SILO_API_BASE_URL and SILO_CLIENT_TOKEN live in `.env.local`
 * (mirror of the app's EXPO_PUBLIC_* values).
 *
 * Stub for M0 — fill in extractLink + analyzeImage when wiring the popup.
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

async function callWorker<T>(task: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/api/gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CLIENT_TOKEN ? { 'X-Silo-Client': CLIENT_TOKEN } : {}),
    },
    body: JSON.stringify({ task, ...body }),
  });
  if (!res.ok) throw new Error(`Worker ${task} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function extractLink(req: ExtractRequest): Promise<ExtractedLink> {
  return callWorker<ExtractedLink>('extract', req);
}

/**
 * Worker response for `classify_image`. Mirrors the phone's
 * `AnalyzeImageResponse` shape (see ../../lib/types.ts) — kept LOCAL so
 * we don't fight the m0 agent over lib/types.ts ownership.
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
