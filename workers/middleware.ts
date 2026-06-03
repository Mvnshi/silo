/**
 * Worker security middleware — Phase 3 (P0).
 *
 * Addresses the unauthenticated/open backend (AUDIT.md CRITICAL #1): every
 * /api/* request now passes method + body-size checks, an optional shared-token
 * gate, and optional per-IP rate limiting before reaching a handler.
 *
 * THREAT MODEL NOTE: these endpoints broker paid APIs (Gemini/ElevenLabs/Vultr).
 * The shared client token raises the bar against opportunistic/automated abuse,
 * but a token shipped in an app bundle is extractable — it is NOT a substitute
 * for real device attestation. Proper hardening is App Attest (iOS) / Play
 * Integrity (Android); tracked in TODO.md. CORS stays permissive on purpose:
 * native clients send no Origin header, so CORS is not the control here — auth
 * and rate limiting are.
 */

import { Env } from './types';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Silo-Client',
};

/** Max request body for /api/* (base64 images are large). ~8 MB. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Fixed rate-limit window and per-window request cap, per IP. */
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_REQUESTS = 60;

function jsonError(
  status: number,
  error: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** Constant-time string comparison so the token can't be guessed via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  );
}

/**
 * Fixed-window per-IP rate limit backed by KV. Approximate (KV is eventually
 * consistent and has no atomic increment) — adequate for abuse mitigation, not
 * strict quotas. Use Durable Objects or Cloudflare's native Rate Limiting
 * binding if exactness is required. Fails OPEN on any limiter error so a KV
 * hiccup never takes the API down.
 */
async function checkRateLimit(
  env: Env,
  ip: string
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (!env.RATE_LIMIT_KV) {
    console.warn('[silo] RATE_LIMIT_KV not bound — rate limiting disabled');
    return { allowed: true, retryAfter: 0 };
  }
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % RATE_WINDOW_SECONDS);
  const key = `rl:${ip}:${windowStart}`;
  try {
    const current = parseInt((await env.RATE_LIMIT_KV.get(key)) || '0', 10);
    if (current >= RATE_MAX_REQUESTS) {
      return { allowed: false, retryAfter: Math.max(1, windowStart + RATE_WINDOW_SECONDS - now) };
    }
    await env.RATE_LIMIT_KV.put(key, String(current + 1), {
      expirationTtl: RATE_WINDOW_SECONDS * 2,
    });
    return { allowed: true, retryAfter: 0 };
  } catch (err) {
    console.error('[silo] rate limit check failed (allowing):', err);
    return { allowed: true, retryAfter: 0 };
  }
}

/**
 * Apply security checks to an /api/* request. Returns a Response to short-circuit
 * (reject) or null to continue to the handler.
 */
export async function applySecurity(
  request: Request,
  env: Env,
  _path: string
): Promise<Response | null> {
  // Only POST is allowed on the processing endpoints.
  if (request.method !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  // Reject oversized bodies up front (cost/DoS amplification guard).
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonError(413, 'Request body too large');
  }

  // Shared-token gate. Only enforced when APP_CLIENT_TOKEN is configured, so a
  // deploy can roll out before the client ships the header. Set it in prod.
  if (env.APP_CLIENT_TOKEN) {
    const provided = request.headers.get('X-Silo-Client') || '';
    if (!safeEqual(provided, env.APP_CLIENT_TOKEN)) {
      return jsonError(401, 'Unauthorized');
    }
  } else {
    console.warn('[silo] APP_CLIENT_TOKEN not set — /api endpoints are UNAUTHENTICATED');
  }

  // Per-IP rate limit.
  const { allowed, retryAfter } = await checkRateLimit(env, getClientIp(request));
  if (!allowed) {
    return jsonError(429, 'Rate limit exceeded. Please slow down.', {
      'Retry-After': String(retryAfter),
    });
  }

  return null;
}
