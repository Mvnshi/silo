/**
 * Worker session-verification tests — `workers/auth.ts` + `workers/account.ts`.
 *
 * The security property under test is the one that matters most in the whole
 * backend: **a caller may only touch their own space.** The shared
 * `X-Silo-Client` token gates the *app*, not the *user*, so without the check in
 * `authorizeSpace` any client could claim someone else's account id as a
 * `spaceKey` and sync down their entire library. That is a silent, total
 * data-exposure bug, and nothing in the type system prevents it.
 *
 * A real Supabase project is NOT required. `workers/auth.ts` verifies a session
 * by asking the identity provider over HTTP (deliberately — see its header), so
 * pointing `SUPABASE_URL` at a stand-in exercises the Worker's real code path:
 * the same fetch, the same status handling, the same failure modes. What this
 * cannot prove is that Supabase issues tokens the way we expect; that needs a
 * real project and a real sign-in.
 *
 * The four Worker configurations under test are started and stopped by this
 * script (see `servers.mjs`), so there is nothing to set up by hand.
 *
 * Run:  node workers/scripts/verify-auth.mjs
 */
import { startMockIdp, startWorker, stopAll } from './servers.mjs';

const IDP_URL = 'http://localhost:8124';
const SUPABASE_VARS = {
  SUPABASE_URL: IDP_URL,
  SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
};

console.log('▸ starting the identity stand-in and four Worker configurations…');
await startMockIdp();
// Sequentially on purpose: each `wrangler dev` boots its own workerd and D1,
// and four of them racing for the CPU is slower than four in a row — slow
// enough that the readiness probe times out on a busy machine.
// No SUPABASE_* at all: a fresh clone / self-host.
await startWorker(8799);
// Accounts configured but optional — Mode 1 and Mode 2 side by side.
await startWorker(8798, SUPABASE_VARS);
// The public deployment: a session is mandatory.
await startWorker(8797, { ...SUPABASE_VARS, REQUIRE_AUTH: 'true' });
// Sessions verifiable, but no service-role key: deletion must degrade.
await startWorker(8796, { SUPABASE_URL: IDP_URL, SUPABASE_ANON_KEY: 'anon-test' });
console.log('▸ ready\n');

const UNCONFIGURED = 'http://localhost:8799';
const OPTIONAL = 'http://localhost:8798';
const REQUIRED = 'http://localhost:8797';
const NO_SERVICE_KEY = 'http://localhost:8796';
const IDP = 'http://localhost:8124';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let pass = 0;
const failures = [];
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { failures.push(label); console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function sync(base, { token, spaceKey, changes = [], since = 0 } = {}) {
  const res = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ spaceKey, since, changes }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function deleteAccount(base, token) {
  const res = await fetch(`${base}/api/account`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const item = (id, title) => ({
  op: 'put',
  item: { id, title, type: 'note', classification: 'other', tags: [], created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(), viewed: false, archived: false },
  updated_at: new Date(0).toISOString(),
});

/* --- A deployment with no identity provider (a fresh clone / self-host) ---- */
{
  const r = await sync(UNCONFIGURED, { spaceKey: 'pair-abc123' });
  check('unconfigured: an anonymous pairing-code space still syncs', r.status === 200, `HTTP ${r.status}`);

  const t = await sync(UNCONFIGURED, { token: 'token-alice', spaceKey: ALICE });
  check('unconfigured: a bearer token is REFUSED, never trusted blindly',
    t.status === 400, `HTTP ${t.status} ${t.body.error ?? ''}`);
}

/* --- Accounts configured, still optional (docs/sync.md Mode 1 + Mode 2) ---- */
{
  const own = await sync(OPTIONAL, { token: 'token-alice', spaceKey: ALICE, changes: [item('itm-alice-1', 'Alice private note')] });
  check('signed in: writing to your OWN space succeeds', own.status === 200, `HTTP ${own.status}`);

  const cross = await sync(OPTIONAL, { token: 'token-bob', spaceKey: ALICE });
  check("signed in: claiming ANOTHER user's space is rejected",
    cross.status === 403, `HTTP ${cross.status} ${cross.body.error ?? ''}`);

  const leaked = JSON.stringify(cross.body);
  check('the cross-space rejection leaks no items', !leaked.includes('Alice private note'));

  const bad = await sync(OPTIONAL, { token: 'not-a-real-token', spaceKey: ALICE });
  check('signed in: an invalid/expired token is a 401', bad.status === 401, `HTTP ${bad.status}`);

  const anon = await sync(OPTIONAL, { spaceKey: 'pair-abc123' });
  check('configured but optional: pairing-code sync still works', anon.status === 200, `HTTP ${anon.status}`);

  const bobOwn = await sync(OPTIONAL, { token: 'token-bob', spaceKey: BOB });
  check("Bob's own space is readable and empty of Alice's rows",
    bobOwn.status === 200 && !JSON.stringify(bobOwn.body).includes('Alice private note'));
}

/* --- REQUIRE_AUTH=true: the public deployment ------------------------------ */
{
  const anon = await sync(REQUIRED, { spaceKey: 'pair-abc123' });
  check('REQUIRE_AUTH: anonymous sync is refused', anon.status === 401, `HTTP ${anon.status}`);

  const ok = await sync(REQUIRED, { token: 'token-alice', spaceKey: ALICE });
  check('REQUIRE_AUTH: a valid session still syncs', ok.status === 200, `HTTP ${ok.status}`);

  const cross = await sync(REQUIRED, { token: 'token-bob', spaceKey: ALICE });
  check('REQUIRE_AUTH: cross-space is still rejected', cross.status === 403, `HTTP ${cross.status}`);
}

/* --- DELETE /api/account --------------------------------------------------- */
{
  const anon = await deleteAccount(OPTIONAL, null);
  check('account deletion without a session is refused', anon.status === 401, `HTTP ${anon.status}`);

  const unconfigured = await deleteAccount(NO_SERVICE_KEY, 'token-alice');
  check('no service-role key → a clean 503, not a silent success',
    unconfigured.status === 503, `HTTP ${unconfigured.status} ${unconfigured.body.error ?? ''}`);

  // Alice has a row from the sync test above; deletion must remove it.
  const before = await sync(OPTIONAL, { token: 'token-alice', spaceKey: ALICE });
  const hadRow = JSON.stringify(before.body).includes('Alice private note');
  check('precondition: Alice has a synced row to delete', hadRow);

  const del = await deleteAccount(OPTIONAL, 'token-alice');
  check('account deletion succeeds for the signed-in user', del.status === 200, `HTTP ${del.status}`);

  const deleted = await (await fetch(`${IDP}/__deleted`)).json();
  check('the identity was deleted via the ADMIN endpoint with the service key',
    deleted.includes(ALICE), JSON.stringify(deleted));

  const after = await sync(OPTIONAL, { token: 'token-alice', spaceKey: ALICE });
  check("the user's synced rows are gone afterwards",
    !JSON.stringify(after.body).includes('Alice private note'));
}

await stopAll();

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.log('failed:\n  ' + failures.join('\n  ')); process.exit(1); }
