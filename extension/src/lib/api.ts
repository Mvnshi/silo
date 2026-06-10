/**
 * Thin client to the Silo Cloudflare Worker — the same Worker the iOS app
 * uses. See spec §4.4. KEEP IN SYNC with the app's `lib/api.ts` shape.
 *
 * Config: SILO_API_BASE_URL and SILO_CLIENT_TOKEN live in `.env.local`
 * (mirror of the app's EXPO_PUBLIC_* values).
 *
 * Stub for M0 — fill in extractLink + analyzeImage when wiring the popup.
 */

interface ExtractRequest {
  url: string;
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

const API_BASE = import.meta.env.WXT_SILO_API_BASE_URL ?? '';
const CLIENT_TOKEN = import.meta.env.WXT_SILO_CLIENT_TOKEN ?? '';

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

/* M0 stub — analyzeImage, ocrImage, summarize come in later milestones. */
