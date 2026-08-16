/**
 * DELETE /api/account — erase the signed-in user and everything in their space.
 *
 * This lives on the server because deleting a user needs Supabase's
 * service-role key, and a service-role key in a shipped app is a master key to
 * every user's identity. The client only ever sends its own bearer token; the
 * Worker verifies it, then deletes exactly that subject.
 *
 * Order matters: the space rows go first. If the identity delete then fails,
 * the user still has an account and can retry — the reverse would leave
 * orphaned rows nobody can ever reach or remove.
 *
 * App Store note: an app that offers account creation must offer account
 * deletion from inside the app (Guideline 5.1.1(v)). This is that.
 */
import { Env } from './types';
import { verifyRequest } from './auth';

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export async function handleDeleteAccount(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const outcome = await verifyRequest(request, env);
  if (outcome.kind === 'error') {
    return json(outcome.status, { error: outcome.message }, cors);
  }
  if (outcome.kind !== 'user') {
    return json(401, { error: 'Sign in first' }, cors);
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const url = env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!serviceKey || !url) {
    return json(503, { error: 'Account deletion is not configured on this server' }, cors);
  }

  const userId = outcome.user.id;

  // 1. The user's synced rows. Best-effort: an unbound D1 (a deployment with
  //    sync disabled) is not a reason to block the identity delete.
  if (env.SYNC_DB) {
    try {
      await env.SYNC_DB.batch([
        env.SYNC_DB.prepare('DELETE FROM items WHERE space_key = ?').bind(userId),
        env.SYNC_DB.prepare('DELETE FROM space_seq WHERE space_key = ?').bind(userId),
      ]);
    } catch (error) {
      console.error('[account] failed to clear space rows:', error);
      return json(500, { error: 'Could not clear your synced data. Nothing was deleted.' }, cors);
    }
  }

  // 2. The identity itself.
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status !== 404) {
      // 404 means it's already gone — that is success from the caller's side.
      return json(502, { error: 'Your data was removed, but the account could not be deleted.' }, cors);
    }
  } catch {
    return json(502, { error: 'Your data was removed, but the account could not be deleted.' }, cors);
  }

  return json(200, { ok: true }, cors);
}
