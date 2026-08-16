/**
 * Sync endpoint — POST /api/sync. See SYNC.md for the full design.
 *
 * One round-trip does push + pull:
 *   request:  { spaceKey, since, changes: [{op:'put',item}|{op:'delete',id,updated_at}] }
 *   response: { cursor, changes: [...] }   // everything in the space the client lacks
 *
 * Storage is D1 (SQLite). Conflict resolution is last-write-wins by
 * `updated_at`; ordering for pulls is the server-assigned monotonic `seq`.
 * This handler is identical across all three deployment modes (SYNC.md §"three
 * modes") — only auth + where the Worker runs differ.
 */
import { Env } from './types';
import { authorizeSpace, verifyRequest } from './auth';

interface PutChange {
  op: 'put';
  item: SyncItem;
}
interface DeleteChange {
  op: 'delete';
  id: string;
  updated_at: string;
}
type Change = PutChange | DeleteChange;

/** Minimal shape we rely on; the full Item rides along in `json`. */
interface SyncItem {
  id: string;
  updated_at: string;
  [k: string]: unknown;
}

interface SyncRequest {
  spaceKey: string;
  since?: number;
  changes?: Change[];
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Lazily create the schema. Cheap (IF NOT EXISTS) and keeps deploys one-step. */
async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS items (
        space_key  TEXT NOT NULL,
        id         TEXT NOT NULL,
        json       TEXT NOT NULL,
        deleted    INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        PRIMARY KEY (space_key, id)
      )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_space_seq ON items (space_key, seq)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS space_seq (
        space_key TEXT PRIMARY KEY,
        seq       INTEGER NOT NULL
      )`
    ),
  ]);
}

/** Reserve `n` sequence numbers for a space; returns the first reserved value. */
async function nextSeq(db: D1Database, spaceKey: string, n: number): Promise<number> {
  // Upsert-and-return keeps the counter atomic per request.
  const row = await db
    .prepare(
      `INSERT INTO space_seq (space_key, seq) VALUES (?, ?)
       ON CONFLICT(space_key) DO UPDATE SET seq = seq + ?
       RETURNING seq`
    )
    .bind(spaceKey, n, n)
    .first<{ seq: number }>();
  const end = row?.seq ?? n;
  return end - n + 1; // first reserved value
}

const SPACE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;

export async function handleSync(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  if (!env.SYNC_DB) {
    return json(503, { error: 'Sync not configured (no D1 binding)' }, cors);
  }

  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return json(400, { error: 'Invalid JSON' }, cors);
  }

  const requestedSpaceKey = (body.spaceKey || '').trim();
  if (!SPACE_KEY_RE.test(requestedSpaceKey)) {
    return json(400, { error: 'Invalid spaceKey' }, cors);
  }

  // A caller may only touch a space they can prove is theirs. Signed in, that
  // means their own user id; anonymous, it means a pairing code (which is
  // itself the secret). See workers/auth.ts.
  const outcome = await verifyRequest(request, env);
  if (outcome.kind === 'error') {
    return json(outcome.status, { error: outcome.message }, cors);
  }
  const spaceKey = authorizeSpace(outcome, requestedSpaceKey);
  if (!spaceKey) {
    return json(403, { error: 'That space belongs to another account' }, cors);
  }

  const since = Number.isFinite(body.since) ? Math.max(0, Math.floor(body.since as number)) : 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > 1000) {
    return json(413, { error: 'Too many changes in one batch (max 1000)' }, cors);
  }

  const db = env.SYNC_DB;
  await ensureSchema(db);

  // ---- PUSH: merge incoming changes (last-write-wins by updated_at) --------
  if (changes.length > 0) {
    const start = await nextSeq(db, spaceKey, changes.length);
    const stmts: D1PreparedStatement[] = [];
    let i = 0;
    for (const ch of changes) {
      const seq = start + i++;
      if (ch.op === 'delete') {
        if (!ch.id || typeof ch.updated_at !== 'string') continue;
        stmts.push(
          db
            .prepare(
              `INSERT INTO items (space_key, id, json, deleted, updated_at, seq)
               VALUES (?, ?, ?, 1, ?, ?)
               ON CONFLICT(space_key, id) DO UPDATE SET
                 json=excluded.json, deleted=1, updated_at=excluded.updated_at, seq=excluded.seq
               WHERE excluded.updated_at > items.updated_at`
            )
            .bind(spaceKey, ch.id, JSON.stringify({ id: ch.id }), ch.updated_at, seq)
        );
      } else if (ch.op === 'put' && ch.item && typeof ch.item.id === 'string') {
        const it = ch.item;
        if (typeof it.updated_at !== 'string') continue;
        stmts.push(
          db
            .prepare(
              `INSERT INTO items (space_key, id, json, deleted, updated_at, seq)
               VALUES (?, ?, ?, 0, ?, ?)
               ON CONFLICT(space_key, id) DO UPDATE SET
                 json=excluded.json, deleted=0, updated_at=excluded.updated_at, seq=excluded.seq
               WHERE excluded.updated_at > items.updated_at`
            )
            .bind(spaceKey, it.id, JSON.stringify(it), it.updated_at, seq)
        );
      }
    }
    if (stmts.length > 0) await db.batch(stmts);
  }

  // ---- PULL: everything in the space with seq > since ----------------------
  const res = await db
    .prepare(
      `SELECT id, json, deleted, seq FROM items
       WHERE space_key = ? AND seq > ?
       ORDER BY seq ASC LIMIT 2000`
    )
    .bind(spaceKey, since)
    .all<{ id: string; json: string; deleted: number; seq: number }>();

  const rows = res.results ?? [];
  let cursor = since;
  const out: Change[] = [];
  for (const r of rows) {
    cursor = Math.max(cursor, r.seq);
    if (r.deleted) {
      out.push({ op: 'delete', id: r.id, updated_at: '' });
    } else {
      try {
        out.push({ op: 'put', item: JSON.parse(r.json) as SyncItem });
      } catch {
        /* skip a corrupt row rather than fail the whole pull */
      }
    }
  }

  return json(200, { cursor, changes: out }, cors);
}
