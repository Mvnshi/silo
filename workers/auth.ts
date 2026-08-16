/**
 * Session verification for account spaces (SYNC.md "Mode 2").
 *
 * The client claims a `spaceKey`. Without a check, any caller could claim
 * someone else's account id and read their whole library — the shared
 * `X-Silo-Client` token gates the *app*, not the *user*. So when a bearer token
 * is present we verify it and require the space to match the subject.
 *
 * Verification is done by asking the identity provider, not by validating the
 * JWT signature here. Reasons: the Worker would otherwise need the project's
 * JWKS (another secret to rotate and cache), Supabase can revoke a session
 * server-side in ways a signature check can't see, and the round-trip is a
 * single sub-100ms call inside the same request we're already doing D1 work in.
 *
 * `REQUIRE_AUTH` decides how strict this is:
 *   unset/'false' → pairing-code spaces allowed; a token, if sent, is still
 *                   verified and still has to match. (Mode 1 / self-host.)
 *   'true'        → every request must carry a valid token. (Mode 2 / public.)
 */
import { Env } from './types';

export interface VerifiedUser {
  id: string;
  email?: string;
}

export type AuthOutcome =
  /** No token, and this deployment doesn't require one. */
  | { kind: 'anonymous' }
  | { kind: 'user'; user: VerifiedUser }
  | { kind: 'error'; status: number; message: string };

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Resolve the caller. Never throws — a provider outage becomes a 503 the client
 * can retry, not a 500.
 */
export async function verifyRequest(request: Request, env: Env): Promise<AuthOutcome> {
  const required = env.REQUIRE_AUTH === 'true';
  const token = bearer(request);

  if (!token) {
    if (required) return { kind: 'error', status: 401, message: 'Sign in to sync' };
    return { kind: 'anonymous' };
  }

  const url = env.SUPABASE_URL?.replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // A token arrived but this deployment can't check it. Refusing is the only
    // safe answer: accepting would let anyone assert any account id.
    if (required) {
      return { kind: 'error', status: 503, message: 'Accounts are not configured on this server' };
    }
    return { kind: 'error', status: 400, message: 'This server does not accept account sessions' };
  }

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 401 || res.status === 403) {
      return { kind: 'error', status: 401, message: 'Your session expired. Sign in again.' };
    }
    if (!res.ok) {
      return { kind: 'error', status: 503, message: 'Could not verify your session' };
    }

    const user = (await res.json()) as { id?: string; email?: string };
    if (!user?.id) {
      return { kind: 'error', status: 401, message: 'Your session expired. Sign in again.' };
    }
    return { kind: 'user', user: { id: user.id, email: user.email } };
  } catch {
    return { kind: 'error', status: 503, message: 'Could not verify your session' };
  }
}

/**
 * The space this caller is allowed to touch.
 *
 * A signed-in caller may only use their own user id. An anonymous caller may
 * use any pairing code — that is the Mode 1 contract: the code IS the secret,
 * and it never leaves the devices that were paired by hand.
 */
export function authorizeSpace(outcome: AuthOutcome, requestedSpaceKey: string): string | null {
  if (outcome.kind === 'user') {
    return requestedSpaceKey === outcome.user.id ? requestedSpaceKey : null;
  }
  if (outcome.kind === 'anonymous') return requestedSpaceKey;
  return null;
}
