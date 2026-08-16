/**
 * Cloudflare Workers Type Definitions
 *
 * The Worker is a Gemini-only proxy: its sole job is to keep the
 * GEMINI_API_KEY server-side so it never ships in the client. This file holds
 * the environment interface and the response shapes used by that proxy.
 */

/**
 * Environment variables available in Cloudflare Workers context
 * These are configured in wrangler.toml and Cloudflare dashboard
 */
export interface Env {
  // Google Gemini API key — the only upstream service this Worker talks to.
  GEMINI_API_KEY: string;

  // --- Security (Phase 3) ---
  // Shared client token. When set, /api/* requests must send a matching
  // `X-Silo-Client` header (set EXPO_PUBLIC_CLIENT_TOKEN to the same value in
  // the app). Optional so existing deploys keep working until configured;
  // set it in production to gate the endpoints. Configure via:
  //   wrangler secret put APP_CLIENT_TOKEN
  APP_CLIENT_TOKEN?: string;

  // Optional KV namespace for per-IP rate limiting. When bound, all /api/*
  // routes are rate-limited; when absent, limiting is skipped (logged). Bind in
  // wrangler.toml: [[kv_namespaces]] binding = "RATE_LIMIT_KV", id = "<id>".
  RATE_LIMIT_KV?: KVNamespace;

  // --- Sync (see SYNC.md) ---
  // D1 database backing POST /api/sync. When absent, sync returns 503 and the
  // rest of the Worker is unaffected. Bind in wrangler.toml: [[d1_databases]]
  // binding = "SYNC_DB". Works locally under `wrangler dev` with no cloud setup.
  SYNC_DB?: D1Database;

  // When 'true', /api/sync requires an account session (Mode 2 / public).
  // Default/unset = pairing-code spaces with no accounts (Mode 1 / self-host).
  REQUIRE_AUTH?: string;

  // --- Accounts (optional; see workers/auth.ts) ---
  // Identity provider used to verify a caller's bearer token. Only needed when
  // accounts are in play: unset means pairing-code spaces only, and any request
  // that arrives WITH a token is refused rather than trusted.
  // SUPABASE_URL is safe in wrangler.toml; the anon key is a public client key
  // but is set as a secret anyway so it isn't in git.
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  // Server-only key for deleting a user. Never ship this to a client.
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * Classification result returned by AI analysis
 */
export interface ClassificationResult {
  classification: 'article' | 'video' | 'recipe' | 'product' | 'event' | 'place' | 'idea' | 'fitness' | 'food' | 'career' | 'academia' | 'other';
  title: string;
  description?: string;
  tags?: string[];
  duration?: number;
  place_name?: string;
  place_address?: string;
}

/**
 * Schedule suggestion response
 */
export interface ScheduleSuggestion {
  date: string;
  time: string;
  reason: string;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

