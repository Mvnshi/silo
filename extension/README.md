# Silo — Browser Extension

> Implementation lives here. **Read [`../EXTENSION_SPEC.md`](../EXTENSION_SPEC.md) first.** It explains the *why*, the architecture, the mymind deconstruction, and the v1 milestones (M0–M8). This README is just the developer quickstart.

## Status

**Working, unpublished.** What ships today:

| Surface | State |
| --- | --- |
| Popup capture (⌘⇧S) | Preview card, classification pills, tags, note, duplicate badge. Saves immediately and enriches from the Worker when extraction lands. |
| Right-click menus | Save image / highlight / link. |
| Spotlight overlay (⌘⇧K) | On-page capture with the page URL + og:image. |
| Omnibox (`silo` + Space) | Instant local search over saved items. |
| Library (`library.html`) | Masonry grid, live search, classification filter, undoable delete. |
| Sync | Two-way with the phone via the Worker's `/api/sync` (see `../SYNC.md`). Opt-in: pair with a space code in the library's sync modal. |
| Storage | IndexedDB via Dexie, extension origin only. Nothing leaves the machine except what sync explicitly pushes. |

Not done yet: Firefox/Safari polish, import, snapshot, reader-mode UI.

## Quickstart

```sh
cd extension
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev                  # WXT dev server with HMR
```

Load it in Chrome:
1. `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select `extension/.output/chrome-mv3`
4. Pin Silo to the toolbar

`npm run build` produces the same directory for a production bundle; `npm run build:firefox` produces `.output/firefox-mv2`.

### Backend config

The extension uses the **same Cloudflare Worker** the iOS app does. Copy the values of `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_CLIENT_TOKEN` from the repo-root `.env` into `extension/.env.local`:

```
WXT_SILO_API_BASE_URL=…
WXT_SILO_CLIENT_TOKEN=…
```

**The `WXT_` prefix is required.** WXT only exposes prefixed variables through `import.meta.env`; an unprefixed name silently resolves to `''`, which surfaces as "Preview unavailable" on every page and "No sync server configured" in the sync modal. `.env.local` is gitignored — `.env.example` is the checked-in template.

## Verification

```sh
npx tsc --noEmit     # types
npx wxt build        # bundle
node scripts/verify-e2e.mjs    # puppeteer: capture paths against a built extension
node scripts/verify-sync.mjs   # puppeteer: phone ⇄ extension sync round-trip
```

## Layout

```
src/
├─ entrypoints/
│  ├─ background.ts        — MV3 service worker (listeners at top level; see the file header)
│  ├─ popup/               — toolbar popup (React)
│  ├─ library/             — full-tab library page (React)
│  ├─ spotlight.content.ts — ⌘⇧K overlay host
│  └─ reader.content.ts    — Readability extraction on demand
├─ components/popup/       — pills, tag picker
└─ lib/
   ├─ theme.ts             — THE design tokens; emits the CSS custom properties every surface uses
   ├─ store.ts             — Dexie schema + all reads/writes (also owns the sync bookkeeping)
   ├─ sync.ts, api.ts      — Worker clients
   ├─ dupes.ts, url.ts     — duplicate detection + URL canonicalization
   ├─ search.ts            — in-memory tokenized index (omnibox + library)
   ├─ spotlight/           — the on-page overlay (pure DOM, closed shadow root)
   └─ background/          — menus, omnibox, commands, message bridge, save actions
```

### Design tokens

`lib/theme.ts` is the only place a colour, radius or spacing step is written down. It mirrors the phone app's `lib/theme.ts` and `lib/classification.ts` byte-for-byte, and emits a CSS custom-property block that the popup and library install via `injectTokens()` and the spotlight embeds into its shadow root. **Do not re-declare a palette value in a `.css` file** — that is how desktop and mobile drifted into showing the same item in two different colours.

## What this is, in one paragraph

The desktop/web half of Silo. The phone covers "I'm in Instagram and want to save this reel"; the extension covers "I'm on a long article and want to save it with a tag and a note." Same Item schema, same Worker, same on-device-first privacy posture. Direct competitor is [mymind.com](https://mymind.com) — feature parity with them, plus all the things they refuse to ship (import, sharing, public API, save-snapshot, Firefox).
