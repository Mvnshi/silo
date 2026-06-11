# Silo — Sync Architecture

> How the phone app, the browser extension, and (later) the web app stay in
> sync — across **three deployment modes** from **one codebase**. Pairs with
> [`VISION.md`](VISION.md), [`EXTENSION_SPEC.md`](EXTENSION_SPEC.md).

## The one idea that makes this simple

Every client (phone, extension, web) keeps its own **local-first** copy of your
data and talks to **one sync endpoint**: `POST /api/sync` on the Cloudflare
Worker. That endpoint is the *same code* in all three modes. What changes
between modes is only:

1. **Where the Worker runs** — your laptop, your Cloudflare account, or a
   stranger's Cloudflare account.
2. **What a "space" is** — a pairing code you typed, or an account you logged
   into.

That's it. Build the sync engine once; the three modes fall out of config.

```
   PHONE (AsyncStorage)            EXTENSION (IndexedDB)           WEB (later)
        │  local-first                  │  local-first                │
        └──────────────┐                │                ┌────────────┘
                       ▼                ▼                ▼
                ┌──────────────────────────────────────────┐
                │   POST /api/sync   (one Worker, one DB)   │
                │   push local changes → merge → pull rest  │
                └──────────────────────────────────────────┘
                                   │
                       ┌───────────┴───────────┐
                       ▼                       ▼
              D1 (SQLite) per space    auth: pairing code OR account
```

## The three modes

| | **Mode 1 — Local** | **Mode 2 — Cloud (public)** | **Mode 3 — Self-host** |
|---|---|---|---|
| Who | Just you | Friends / strangers | Anyone you hand the repo |
| Worker runs on | **your laptop** (`wrangler dev`) | **your Cloudflare** (deployed) | **their Cloudflare / Docker** |
| Identity | a **pairing code** (no account) | an **account** (email + password) | their choice (code or account) |
| Cost | **$0** — it's just a process on your PC | Cloudflare free tier → pennies | their bill, not yours |
| Network | phone + browser on the **same Wi-Fi** as the laptop | the public internet | their network |
| Use it when | you want it working today, free, private | you're ready to let others in | someone wants full control |

**Crucial: Mode 1 needs no cloud account and no monthly bill.** "Running on my
PC" = `cd workers && npm run dev` on your laptop. The phone and the browser
both point at your laptop's LAN address (e.g. `http://192.168.1.20:8787`). Sync
flows phone → laptop → browser and back. Nothing leaves your house.

You can develop and dogfood in **Mode 1 forever**, then flip to **Mode 2** by
deploying the *same* Worker and turning accounts on — no rewrite.

## Data model for sync

The `Item` shape is already byte-identical on phone (`lib/types.ts`) and
extension (`extension/src/lib/types.ts`). Sync needs three things layered on
top — all additive, no breaking changes:

1. **`updated_at`** (already exists) — the conflict-resolution clock. Newest
   write wins (last-write-wins). Good enough for a single-user-multi-device
   tool; we are not building Google Docs.
2. **Soft deletes** — deleting must *propagate*, so a delete becomes a
   tombstone (`{ id, deleted: true, updated_at }`) rather than a hard removal.
   Tombstones are garbage-collected after 30 days.
3. **A server cursor** — the Worker assigns each accepted change a monotonic
   `seq`. A client pulls "everything with `seq > my_last_seq`". No clocks to
   trust across devices; the server's sequence is the source of truth for
   *ordering*, while `updated_at` is the source of truth for *winning*.

## The protocol — one endpoint, push + pull in a single round-trip

```http
POST /api/sync
{
  "spaceKey": "<pairing-code-or-account-id>",
  "since":     1234,                  // my last server cursor (0 = first sync)
  "changes": [                        // what changed locally since last sync
    { "op": "put",    "item": { ...Item, updated_at } },
    { "op": "delete", "id": "abc", "updated_at": "..." }
  ]
}
→
{
  "cursor": 1290,                     // my new high-water mark
  "changes": [                        // everything else in the space I lack
    { "op": "put",    "item": { ... } },
    { "op": "delete", "id": "xyz" }
  ]
}
```

Merge rule on the server, per item id: **keep the row with the greatest
`updated_at`** (a delete is just a put with `deleted: true`). The client applies
the returned changes with the same rule locally. Idempotent — re-sending a
change is harmless.

## Storage: Cloudflare D1 (SQLite)

KV can't do "everything since cursor N" efficiently; D1 (Cloudflare's SQLite)
can, and it runs **locally under `wrangler dev`** so Mode 1 needs zero cloud
setup.

```sql
CREATE TABLE items (
  space_key  TEXT NOT NULL,
  id         TEXT NOT NULL,
  json       TEXT NOT NULL,        -- the full Item, or {id} for a tombstone
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,        -- ISO; conflict clock
  seq        INTEGER NOT NULL,     -- server-assigned cursor (per space)
  PRIMARY KEY (space_key, id)
);
CREATE INDEX idx_space_seq ON items (space_key, seq);
```

`seq` comes from a per-space counter row; each accepted write bumps it.

## Identity — the only real difference between modes

A **space** is a bucket of synced data. `spaceKey` decides which bucket.

- **Mode 1 (local):** the phone generates a random **pairing code** (e.g.
  `silo-7f3a-9b21`) shown as text + QR. You type/scan it into the extension.
  Both now use the same `spaceKey`. No passwords, no account, no PII. The code
  *is* the shared secret. (Fine for your own LAN.)
- **Mode 2 (cloud):** the user signs up (email + password, hashed server-side;
  or "Sign in with Apple/Google"). `spaceKey = accountId`. The Worker gates
  `/api/sync` behind a session token. This is the only piece Mode 1 doesn't
  need — and it's deliberately isolated in `workers/auth.ts` so Mode 1 can run
  with it switched off (`REQUIRE_AUTH=false`).
- **Mode 3 (self-host):** the self-hoster picks. The repo ships with auth
  *off* (Mode-1 style) and a one-line env flag to turn it on.

```
REQUIRE_AUTH = false   →  pairing-code spaces (local / self-host private)
REQUIRE_AUTH = true    →  account spaces      (public / self-host multi-user)
```

## What changes in the code (the build plan)

Additive everywhere — nothing existing breaks.

**Worker** (`workers/`)
- [ ] `sync.ts` — the `/api/sync` handler: validate, merge (LWW), return deltas.
- [ ] `db.ts` — D1 bindings + the `items` schema migration.
- [ ] `auth.ts` — session check, **no-op when `REQUIRE_AUTH=false`**. Signup /
      login only compiled in for Mode 2/3-public.
- [ ] `wrangler.toml` — add the D1 binding + `REQUIRE_AUTH` var.

**Phone** (`lib/`)
- [ ] `sync.ts` — `pushPull()`: gather local changes since cursor → POST →
      apply returned deltas → store new cursor. Soft-delete: `deleteItem`
      writes a tombstone instead of hard-removing (GC later).
- [ ] a "Sync" affordance in Settings: pairing code display/entry + "Sync now"
      + last-synced time. Background sync on foreground + after each save.

**Extension** (`extension/src/lib/`)
- [ ] `sync.ts` — same `pushPull()` against the same endpoint, from the
      background service worker (so it runs even when no tab is open).
- [ ] options page: paste the pairing code; "Sync now"; status.

**Shared discipline**
- Both `sync.ts` files implement the **identical** algorithm against the
  identical `Item` shape. Keep them in lockstep (a shared test vector lives in
  `workers/sync.test-vectors.json`).

## Conflict resolution — worked example

Phone and browser both edit item `X` offline.
- Phone sets `title = "A"`, `updated_at = 10:00`.
- Browser sets `title = "B"`, `updated_at = 10:05`.
- Phone syncs first → server stores B-less A at seq 50.
- Browser syncs → its `updated_at 10:05 > 10:00` → server replaces with B at
  seq 51, returns B to anyone behind.
- Phone's next pull gets B (seq 51 > its 50). Both converge on **B**.

Last-write-wins. Simple, predictable, correct for one person's devices. (If we
ever need field-level merge or multi-user editing, that's a CRDT upgrade with
its own spec — out of scope and probably never needed for a personal tool.)

## Privacy posture (holds in every mode)

- **Local-first**: the phone and extension always work fully offline against
  their own store. Sync is an enhancement, never a dependency.
- **Mode 1**: data never leaves your LAN. The Worker is a process on your
  laptop; the D1 file sits on your disk.
- **Mode 2/3**: only the synced `Item` rows reach the Worker's D1, scoped by
  space. No analytics, no third parties. Passwords (if accounts on) are hashed
  with a slow KDF server-side; we never store plaintext.
- **End-to-end encryption (future):** the client can encrypt each Item's `json`
  with a key derived from the pairing code before upload, so even the Worker
  operator can't read content. Designed-for, not in the v1 MVP. Tracked here.

## Cost (Mode 2, the only one that costs anything)

D1 free tier: 5 GB storage + 5M reads/day + 100k writes/day. A personal
knowledge base is kilobytes per item and a few hundred writes/day per active
user. Realistically **$0 until thousands of active users**, then pennies. The
Gemini proxy remains the only other cost (already ~$0–1/mo). Mode 1 and Mode 3
cost *you* nothing — Mode 1 is your laptop, Mode 3 is their bill.

## Milestones

- [ ] **S0 — Worker sync core**: D1 schema + `/api/sync` push-pull, `REQUIRE_AUTH=false`. Verify with curl: two fake clients converge. *(This commit.)*
- [ ] **S1 — Phone client**: `lib/sync.ts` + soft deletes + Settings pairing UI + "Sync now".
- [ ] **S2 — Extension client**: `lib/sync.ts` in the background SW + options page pairing UI.
- [ ] **S3 — Live round-trip**: save on phone → appears in the extension library, and back. Screenshot + IndexedDB read as proof.
- [ ] **S4 — Accounts (Mode 2)**: `auth.ts` signup/login, `REQUIRE_AUTH=true`, session tokens. Ship the public path.
- [ ] **S5 — E2E encryption (optional)**: encrypt `json` client-side from the pairing-code-derived key.

S0 is built in the same change as this doc. S1–S5 are sequenced so each is
shippable and Mode 1 works end-to-end after S3 — long before any cloud/account
work.
