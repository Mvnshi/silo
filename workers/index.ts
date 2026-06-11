/**
 * Cloudflare Workers Main Entry Point
 *
 * The Worker is a single authenticated Gemini proxy. Its only job is to keep the
 * GEMINI_API_KEY server-side so it never ships in the client. There are no other
 * services (voice/storage/scraper were removed in the cost-reduction pass).
 *
 * Routes:
 * - OPTIONS *        -> 204 CORS preflight
 * - POST /api/gemini -> applySecurity, then handleGemini (Gemini proxy)
 * - GET  / or /api   -> service description JSON
 * - everything else  -> 404 JSON
 */

import { Env } from './types';
import { handleGemini } from './gemini';
import { handleSync } from './sync';
import { applySecurity, corsHeaders } from './middleware';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight (harmless; native clients send no Origin).
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // The single processing endpoint: authenticate + rate-limit, then proxy.
    if (path === '/api/gemini') {
      const blocked = await applySecurity(request, env, path);
      if (blocked) return blocked;
      return handleGemini(request, env, corsHeaders);
    }

    // Sync (see SYNC.md). Same security gate (shared-token + rate limit); the
    // per-space identity (pairing code vs account) is enforced inside.
    if (path === '/api/sync' && request.method === 'POST') {
      const blocked = await applySecurity(request, env, path);
      if (blocked) return blocked;
      return handleSync(request, env, corsHeaders);
    }

    // Service description (open).
    if (path === '/' || path === '/api') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service:
            'Authenticated Gemini proxy; keeps the API key server-side; no other services',
          endpoint: '/api/gemini',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
