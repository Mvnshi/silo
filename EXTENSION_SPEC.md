# Silo — Browser Extension Spec

> The desktop/web half of Silo. Pairs with [`VISION.md`](VISION.md) (north star), [`README.md`](README.md) (current state), and [`extension/`](extension/) (scaffold + code). Read this BEFORE writing extension code.

## 1. Thesis

The extension is the natural **L1 capture surface for everything you save while reading the web**. The phone share extension already covers "I'm on Instagram and want to save this reel"; the browser extension covers "I'm on a long article, a Behance board, a GitHub repo, an Amazon product, a recipe page, a quote" — all the things you can't share-sheet from on mobile.

**Direct competitor**: [mymind.com](https://mymind.com). Their pitch is "save anything, AI organizes." Ours is the same — plus **the recommendation loop** (`VISION.md`), so saves don't rot. Mymind has 100k users at $7–13/mo with **no public API, no import, no sharing, no Firefox, no project surfaces**. That's our wedge.

## 2. Feature parity with mymind (everything they ship)

The extension must hit parity on the surface area users already expect:

| mymind feature | Silo equivalent | Notes |
|---|---|---|
| One-click toolbar save (page) | `popup.html` Save button + `Cmd/Ctrl+Shift+S` shortcut | route through existing `/api/gemini` `extract` task |
| Right-click image save | context menu `silo-save-image` | downloads + base64 → existing `analyze_image` task |
| Right-click highlighted text save | context menu `silo-save-selection` | new item type `quote`; persists `sourceUrl` + selection text |
| Right-click link save | context menu `silo-save-link` | same as toolbar but for an `<a href>` you didn't navigate to |
| In-popup quick tag + note | popup textarea + tag chips before Save | autocomplete from existing `lib/types.ts CLASSIFICATIONS` |
| Standalone Mind Notes from popup | popup mode toggle: Page / Note / Highlight | one screen, three intents |
| Duplicate detection | popup checks IndexedDB on focus → "already saved" badge + "add tag" | their UX, ours implementation |
| Auto-classification (article/recipe/product/book) | already shipped on Worker | `workers/extract.ts` resolves platform + type |
| Auto-tagging | already shipped | Gemini chain returns tags |
| OCR on images | new Worker task `ocr_image` (Gemini vision can do it) | makes saved screenshots searchable |
| Dominant color extraction | client-side via `<canvas>` on image cards | enables "search by color" |
| Recipe parser | already partially shipped (classification 'recipe') | extend `extract.ts` for ingredients list |
| Article cleanup / Reading Mode | content script using Mozilla Readability | client-side only — no Worker round-trip needed |
| AI summaries on every save | already shipped — extractor returns description | mymind paywalls this; we don't |
| Search across all cards | popup search box + dedicated web view | hits IndexedDB locally |
| Search by color | filter chip in web view | uses extracted dominant color |
| Search by type / brand / date | filter chips | from existing classification + extracted metadata |
| Smart Spaces (saved searches) | `SavedView` in web app: `{ name, query, filter, order }` | persists as a top-level entity alongside Stacks |
| Top of Mind (manual pin) | new field `Item.pinned_at?: string` | pinned items sort first |
| Serendipity (resurfacing) | new web view `/serendipity` — random old item, "keep / forget" | mymind paywalls; we ship free |
| Bidirectional linking | `Item.linked_ids?: string[]`, web view auto-renders back-references | small UI lift; storage is cheap |
| Omnibox `mm` search | omnibox `silo` keyword → search IndexedDB | one MV3 declaration |
| Keyboard shortcut for save | `Cmd/Ctrl+Shift+S` + `commands` in manifest | non-conflicting on macOS/Windows/Linux |

## 3. Things mymind doesn't have — our differentiators

These are the **competitive wedges**. Document and explicitly ship in v1.

1. **Import from everyone**, including mymind's own `cards.csv`. One-time bulk ingest from Pocket, Raindrop, Notion, Apple Bookmarks, Pinboard, Readwise, Pinterest, Are.na. **mymind has zero import**; we have all of them. This is the strongest switching argument they have *no answer for*.
2. **Read-only signed-URL sharing** of a single item or a Stack. Not "social" — just a public viewer URL that bypasses login. Addresses the #1 review complaint without breaking the privacy stance.
3. **Public, scoped local API** at `localhost:<port>` for power users + Raycast / Alfred / Shortcuts. Read-only by default, write requires a per-token grant. mymind explicitly refuses; we win the Twitter/HN power-user crowd.
4. **Snapshot-on-save** — full HTML + screenshot stored against link rot, **for every user, free**. Mymind paywalls "Article Backup" at $129/yr.
5. **Save-as-full-page-PDF** option via the existing `chrome.tabs.captureVisibleTab` + headless print. Long-form content readers love it.
6. **Spotlight-style overlay** — a content-script-injected overlay (`Cmd+Shift+K`) with title input + tag chips + Save, without leaving the page. Faster than the popup; mymind doesn't have it.
7. **Calendar / "do-with" hook**. When you save, the extension shows a tiny inline option: *"Schedule this for later?"* → posts to the phone's calendar via the existing `suggest_schedule` task. **This is the VISION loop in the extension.**
8. **Cross-browser day-one**: Chrome, Edge, Brave, Firefox, Arc, Zen all shipped together via a Manifest V3 codebase. Mymind ships Chrome/Edge/Safari and explicitly "does not officially support" Firefox/Zen.
9. **HTML email-in** via the same Cloudflare Worker that already brokers Gemini. Mymind's `remember@mymind.com` is text-only.
10. **Open file format** for export — JSON, not their CSV. Round-trip safe.

## 4. Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Extension (Manifest V3)    │   POST  │  workers/  (already deployed)│
│                             │  /api/  │                              │
│  popup.html → React app     │ ──gemini│  extract + classify_image    │
│  content-scripts:           │ ───────►│  + ocr_image  (new task)     │
│   • highlight saver         │  HTTPS  │  + summarize  (uses extract) │
│   • reader-mode extractor   │         │                              │
│   • spotlight overlay       │         └──────────────────────────────┘
│  service-worker (background)│                       │
│   • context menus           │                       ▼
│   • omnibox handler         │              ┌────────────────┐
│   • keyboard commands       │              │  Google Gemini │
│  src/lib/store.ts           │              └────────────────┘
│   • Dexie (IndexedDB)       │
│   • runs the SAME shape as  │
│     phone's lib/storage.ts  │   ┌─────────────────────────────────────┐
│                             │◄──┤  Web app (Next.js, future)          │
│  web-accessible-resources:  │   │    • Moodboards, Smart Spaces       │
│   nothing (no leaks)        │   │    • Serendipity, Top of Mind       │
└─────────────────────────────┘   │    • Search by color/type/date      │
              │                   │    • Bidirectional links graph      │
              │                   └─────────────────────────────────────┘
              ▼
        ┌─────────────────────────┐
        │  Phone (Expo app, live) │
        │  receives synced items  │
        │  via opt-in sync (TBD)  │
        └─────────────────────────┘
```

### 4.1 Manifest

**Manifest V3**, host permissions only on the active tab. No `tabs`, no `history`, no `bookmarks` (we're not scraping the user — we capture what they explicitly say to capture).

```jsonc
{
  "manifest_version": 3,
  "name": "Silo",
  "version": "0.1.0",
  "action": { "default_popup": "popup.html", "default_icon": "icons/128.png" },
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["activeTab", "scripting", "contextMenus", "storage"],
  "host_permissions": [],
  "commands": {
    "_execute_action": { "suggested_key": { "default": "Ctrl+Shift+S", "mac": "Command+Shift+S" } },
    "open-spotlight":  { "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" } }
  },
  "omnibox": { "keyword": "silo" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/spotlight.js"],
    "run_at": "document_idle",
    "world": "ISOLATED"
  }]
}
```

### 4.2 Storage

**Single source of truth on-device, just like the phone.** No accounts at v1. We re-use the same `Item` schema (`lib/types.ts`) so the eventual sync is a 1:1 mirror.

- **IndexedDB via Dexie** — `silo` database, stores: `items`, `stacks`, `savedViews`, `linkedRefs`, `kv` (settings).
- All writes go through a thin `store.ts` that mirrors the phone's `lib/storage.ts` API (`addItem`, `updateItem`, `deleteItem`, …). Same mutex + clobber-guard discipline.

### 4.3 Sync (opt-in, v2)

Out of scope for v1. Two viable paths to pick when we get there:

- **Push-only**: extension POSTs new items to a per-user inbox key on Cloudflare KV; phone pulls on foreground (same as the iOS share extension drain pattern).
- **End-to-end encrypted bidirectional**: WebCrypto on both sides, the key lives in the user's phone keychain + a QR-scan handshake to pair the browser. No accounts. This is the right long-term shape.

### 4.4 AI

Reuse the existing Cloudflare Worker. Three new tasks to add to `workers/gemini.ts`:

- `ocr_image` — Gemini vision returns text from an image; persists into `item.ocr_text`. Drives "find text in screenshots."
- `readability` — *not* a Worker task; runs client-side in the content script using `@mozilla/readability` (no key, no round-trip). Output stored as the item's `description`.
- `dominant_colors` — *not* a Worker task; client-side `<canvas>` color quantization, stores up to 5 hex colors in `item.colors`. Drives "search by color."

The existing `extract` + `analyze_image` already cover article/recipe/product classification.

## 5. File structure

```
extension/
├─ README.md                  — dev quickstart, install, scripts
├─ package.json               — wxt/plasmo or vanilla vite + crx
├─ tsconfig.json
├─ public/
│  ├─ manifest.json           — Manifest V3 (cross-browser via WXT/Plasmo overlay)
│  └─ icons/                  — 16/32/48/128 PNGs (mirror the phone's icon set)
├─ src/
│  ├─ popup/
│  │   ├─ index.html
│  │   ├─ main.tsx            — React entry
│  │   ├─ Popup.tsx           — three-mode capture: Page / Note / Highlight
│  │   └─ components/         — TagPicker, ScheduleHint, DupeBadge
│  ├─ background/
│  │   ├─ index.ts            — service worker bootstrap
│  │   ├─ menus.ts            — context menus (image / selection / link)
│  │   ├─ omnibox.ts          — `silo <q>` → IndexedDB search
│  │   └─ commands.ts         — keyboard shortcut routing
│  ├─ content/
│  │   ├─ spotlight.ts        — Cmd+Shift+K overlay (Shadow DOM, no page CSS leak)
│  │   ├─ readability.ts      — Mozilla Readability invocation
│  │   └─ snapshot.ts         — full-HTML capture for "snapshot on save"
│  ├─ lib/
│  │   ├─ store.ts            — Dexie wrapper; mirrors phone's lib/storage.ts
│  │   ├─ items.ts            — createItem, normalizeItem (copy from phone)
│  │   ├─ types.ts            — copy from phone's lib/types.ts (shared schema)
│  │   ├─ api.ts              — fetch wrapper to the Cloudflare Worker
│  │   ├─ colors.ts           — dominant color extraction
│  │   ├─ readability.ts      — Mozilla Readability bindings
│  │   └─ theme.ts            — copy from phone's lib/theme.ts
│  └─ web/                    — (later) the moodboard/search standalone web app
├─ wxt.config.ts              — recommended: WXT for MV3 cross-browser
└─ scripts/
   └─ import/                 — one-time importers (mymind csv, pocket xml, raindrop json, …)
```

## 6. Build / dev / install

**Recommended**: [WXT](https://wxt.dev) — TypeScript, Vite, MV3, Chrome+Firefox+Safari out of the box, hot-reload, identical mental model to Expo Router for tabs. Alternative: [Plasmo](https://plasmo.com) or vanilla Vite + `@crxjs/vite-plugin`.

```sh
cd extension
npm install
npm run dev             # WXT dev server with HMR; loads as an unpacked extension
npm run dev:firefox     # Firefox variant (web-ext under the hood)
npm run build           # production build (zips per browser)
npm run typecheck       # tsc --noEmit
npm run lint            # shares root eslint.config.js
```

Loading manually in Chrome for the first time:
1. `chrome://extensions` → **Developer Mode**.
2. **Load unpacked** → `extension/.output/chrome-mv3`.
3. Pin Silo to the toolbar. Open any page, hit `Cmd+Shift+S`.

## 7. v1 milestones

Sequenced so each milestone is shippable on its own. **Stop at any of these and the extension is still a real product.**

- [ ] **M0 — Skeleton + popup capture** (1 wk): MV3 scaffold, popup with URL save button, calls `/api/gemini` `extract`, stores to IndexedDB, popup shows the resulting card.
- [ ] **M1 — Context menus** (3 days): right-click image / selection / link → save with `quote` / `image` / `link` types.
- [ ] **M2 — Spotlight overlay + reader mode** (1 wk): `Cmd+Shift+K` overlay; Mozilla Readability for article cleanup; reader mode renders in the popup.
- [ ] **M3 — Search + omnibox + duplicate badge** (3 days): IndexedDB index on title/tags/description; `silo` omnibox keyword; "already saved" badge.
- [ ] **M4 — Snapshot on save + dominant colors** (1 wk): persist full HTML + screenshot; client-side color extraction; new `colors` filter chip.
- [ ] **M5 — Schedule hint** (2 days): post-save toast: "Schedule this for later?" → POSTs to `suggest_schedule` and surfaces the result.
- [ ] **M6 — Import bulk** (1.5 wk): drag-and-drop importers for mymind csv, Pocket xml, Raindrop json, Pinboard csv. Live in `extension/scripts/import/` and run from a settings page.
- [ ] **M7 — Cross-browser** (3 days): Firefox + Safari + Arc builds via WXT browser overlays.
- [ ] **M8 — Read-only share** (1 wk): generate a signed URL via the Worker; serve a static viewer at `silo.app/v/<token>`.

v2 brings sync to the phone, Smart Spaces, Serendipity, bidirectional links, the standalone web app. Those have their own spec written when M0-M8 lands.

## 8. Privacy guarantees (we can actually keep)

- **No accounts, no telemetry**. Period. No anonymized usage pings, no Sentry beacon, no PostHog. If you see one in a PR, reject it.
- **No background scraping**. The extension reads only the active tab when the user explicitly invokes a save action. We declare exactly `activeTab` + `scripting` + `contextMenus` + `storage`. No `tabs`, no `history`, no `bookmarks`, no host permissions.
- **No data leaves the device** except the URL/text/image bytes sent to the Cloudflare Worker for enrichment. The Worker is keyless-to-client, returns the enriched item, persists nothing. The client token gates abuse, not identity.
- **Local-first** — IndexedDB is the source of truth. Sync to phone is opt-in, end-to-end encrypted, and stores ciphertext only.
- **Open source** the extension (separate license decision; default MIT to remove any friction).
- **Reviewable build pipeline** — published builds reproducible from a tagged commit so you can verify what's in the store.

## 9. Pricing posture

Mirror the phone: **launch free**. The whole extension is free. The web app's Smart Spaces / Serendipity / Snapshot history are free. If we eventually charge it's for higher Worker quotas (more saves/day than the free tier) — but the local app stays free forever.

The free-vs-paid line mymind draws (AI summaries, Reading Mode, Article Backup all paywalled) is a competitive gift to us. Take all of those, ship them free, and the trade is "trust + features" vs "polish + brand." We can win that trade.

## 10. Open questions for the team

These need a decision before M0 lands. Surface in the founder's launch checklist (`FOUNDER_SETUP.md`):

1. **Sync model** at v2 — push-only via KV inbox vs E2E bidirectional. KV is cheaper and faster to ship; E2E is the right principled answer. Decide based on retention data from v1.
2. **Bundler** — WXT (opinionated, cross-browser) vs Plasmo (more flexible, React-first) vs vanilla Vite + crxjs (full control). Recommendation: **WXT** unless someone has a hard reason otherwise.
3. **Manifest distribution** — Chrome Web Store ($5 one-time dev fee), Firefox AMO (free), Safari App Extensions (requires the Apple Dev account already in the iOS line item).
4. **Brand mark for the extension icon** — reuse the phone's stacked-slabs glyph, or a wordmark? Recommend reuse — it builds the same recognition arc as Apple's icon family.
5. **Domain for the share viewer** — `silo.app/v/<token>` or `silo.pro/v/<token>`. Sit on the same Cloudflare zone as the Worker so DNS is one config.

## 11. Why this is a real moat, not a feature list

Mymind sells "save anything, AI organizes." That's their whole pitch. Silo's pitch is the same — *plus the recommendation loop in `VISION.md`*. The extension is one half of the L1 capture surface, the phone is the other half, and the Today view is where the L2 trigger engine surfaces *what to actually do*.

Mymind has been building for years and has not added a single L2 feature. They explicitly say so: *"we'd rather you spend less time managing your life, and more time doing what makes you happy."* That stops at the threshold of action. Silo crosses it. **The extension is the keyboard on a desk; the phone is the calendar on your wrist. Mymind is the desk drawer.**
