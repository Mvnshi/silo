/**
 * Spawn the Workers (and the stand-in identity provider) a verification script
 * needs, then tear them all down again.
 *
 * The alternative — a header comment telling you to open five terminals — is how
 * a gate stops being run. These scripts start what they need, wait for it to be
 * ready, and kill it on the way out, including on Ctrl-C and on a thrown
 * assertion, so a failed run never leaves a wrangler holding a port.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG_DIR = mkdtempSync(join(tmpdir(), 'silo-verify-'));
const children = [];

function track(child) {
  children.push(child);
  return child;
}

/**
 * Kill the whole process GROUP, not the child.
 *
 * `npx wrangler` is a wrapper that spawns wrangler, which spawns one or more
 * `workerd` processes. Signalling only the wrapper leaves those grandchildren
 * running and holding the port, so the next run fails to bind with no obvious
 * cause. Every child is spawned `detached`, which makes it its own group
 * leader, and a negative pid signals the group.
 */
function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

export async function stopAll() {
  const dying = children.splice(0);
  for (const child of dying) killGroup(child, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  for (const child of dying) killGroup(child, 'SIGKILL');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void stopAll().then(() => process.exit(130));
  });
}
// Covers the case that actually strands ports: an assertion throwing mid-run.
process.on('uncaughtException', (error) => {
  console.error(error);
  for (const child of children) killGroup(child, 'SIGKILL');
  process.exit(1);
});
process.on('exit', () => {
  for (const child of children) killGroup(child, 'SIGKILL');
});

/** Resolve once `probe()` succeeds, or reject after `timeoutMs`. */
async function waitFor(probe, { timeoutMs = 60_000, intervalMs = 400, label = 'service' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await probe()) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${label} did not become ready in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** A `wrangler dev` on `port`, with extra `--var KEY:VALUE` pairs. */
export async function startWorker(port, vars = {}, { cwd = 'workers' } = {}) {
  const args = ['wrangler', 'dev', '--config', '../wrangler.toml', '--port', String(port)];
  for (const [key, value] of Object.entries(vars)) args.push('--var', `${key}:${value}`);

  const log = createWriteStream(join(LOG_DIR, `wrangler-${port}.log`));
  const child = track(
    spawn('npx', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  await waitFor(
    async () => (await fetch(`http://localhost:${port}/api`)).ok,
    { label: `worker on :${port}`, timeoutMs: 120_000 }
  );
  return child;
}

/** The Supabase stand-in that `verify-auth.mjs` points SUPABASE_URL at. */
export async function startMockIdp(port = 8124) {
  const log = createWriteStream(join(LOG_DIR, `idp-${port}.log`));
  const child = track(
    spawn('node', ['workers/scripts/mock-idp.mjs'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);

  await waitFor(
    async () => (await fetch(`http://localhost:${port}/__deleted`)).ok,
    { label: `mock idp on :${port}`, timeoutMs: 20_000 }
  );
  return child;
}

export const logDir = LOG_DIR;
