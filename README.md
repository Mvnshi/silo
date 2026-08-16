# Silo

**Use the things you save.**

Silo turns links, screenshots, notes and social posts into an organized,
schedulable library — then brings them back at the moment you can actually act
on them. Paste or **Share → Silo** any YouTube / TikTok / X / Instagram / Reddit
link and it's auto-classified, titled, thumbnailed and playable inline.
Screenshots and notes get the same treatment. Everything lives on-device.

| | |
|---|---|
| **iOS app** | Expo SDK 54 · React Native 0.81 · React 19 · TypeScript (strict) · expo-router |
| **Browser extension** | Manifest V3 · WXT · React 19 · Dexie — the desktop half |
| **Backend** | One Cloudflare Worker: an authenticated Gemini proxy, nothing else |
| **Storage** | On-device (AsyncStorage / IndexedDB). No accounts, no remote database. |

**[→ Setup](docs/setup.md)** · [Product thesis](VISION.md) · [Roadmap](ROADMAP.md)
· [Sync design](docs/sync.md) · [Extension](docs/extension.md) · [Releasing](docs/releasing.md)

---

## Why it exists

Most save-it-later apps optimize for saving. Silo optimizes for *using* — the
north-star metric is **actions taken per week from saved items**, not saves and
not opens. Everything below follows from that. See [`VISION.md`](VISION.md).

## Architecture

```
app/                    expo-router screens
  ├─ (tabs)/            Streams · Stacks · Add · Silo (today/calendar/map/bucket) · Screenshots
  └─ item/[id] · silo/[id] · stats · settings · onboarding · share (deep-link target)

lib/                    pure logic, no UI
  ├─ storage.ts         AsyncStorage: per-key write mutex + clobber guards
  ├─ items.ts           Item factory, normalization, status derivation
  ├─ api.ts             thin client → POST /api/gemini
  ├─ embed.ts           token-free inline players
  ├─ shareImport.ts     iOS share-queue drain
  ├─ scheduler.ts       idempotent calendar scheduling
  ├─ resurface.ts       after-event report · staleness nudge · repeatables
  ├─ stats.ts           resurfacing metrics, levels, cleanup candidates
  ├─ notifications.ts   local-only digest / check-in / tidy-up reminders
  ├─ theme.ts           design tokens + light/dark palettes
  ├─ useTheme.ts        useThemeColors()
  └─ motion.ts          shared entrance/exit presets + reduced-motion

components/             StreamCard · ItemCardPro · CompactCard · TodayView · ReviewCard
                        ItemActionSheet · CleanupSheet · ChatBot · ThemeProvider · ui/*
extension/              browser extension (see docs/extension.md)
workers/                Cloudflare Worker: index → middleware (auth + rate limit) → gemini
targets/share/          native iOS Share Extension (Swift) → App Group → app drains it
```

**Why a Worker at all?** Only to keep `GEMINI_API_KEY` off the client — an
in-bundle key is extractable. Search, retrieval and storage all run on-device.
Steady-state cost is roughly **$0–1/month** (Cloudflare free tier + Gemini
pennies).

### Social link extraction

`workers/extract.ts` resolves the platform, then takes oEmbed (YouTube / TikTok /
X / Vimeo) or Open Graph via `HTMLRewriter` (Instagram / Reddit / Threads /
Facebook / any URL), normalizes it, and chains into Gemini classify.

Egress is hardened: http(s) only, private and metadata IPs blocked, redirects
re-validated manually, timeout and response-size caps. It never loses a save —
a dead or login-walled link still stores the raw URL.

Playback uses each platform's own token-free embed (`lib/embed.ts`). No media is
downloaded; that is a deliberate App Store / ToS choice, not an oversight.

### The resurfacing loop

Three mechanics keep saves from rotting (`lib/resurface.ts`):

- **After-event report** — when a scheduled thing's time passes: *Did it /
  Skipped* → *Again sometime?* A "yes" marks it loved and re-recommends it later.
- **Staleness nudge** — a card you haven't opened in 21+ days asks *Still want
  this?* `last_seen_at` is local and never synced, so there's no per-open churn.
- **Repeatables** — a loved item off its cooldown returns to the top of "3 things
  you could do today".

**Your Silo** (`app/stats.tsx`) makes the metric visible: levels earned *only* by
using things, a save→do rate, a streak, and a one-card-at-a-time cleanup flow for
the stale pile. Reminders (`lib/notifications.ts`) are local-only — no push
token, no device registration, nothing server-side that knows what you saved.

### Design system

`lib/theme.ts` is the single source of style truth, mirrored into
`tailwind.config.js` for NativeWind. Nothing in a screen should be a literal:

| Token | Rule |
|---|---|
| `TYPE` | 11 steps, each with line-height + optical tracking. Never a bare `fontSize`. |
| `SPACE` / `RADIUS` | 4pt grid; `RADIUS.pill` for chips. Never a numeric radius. |
| `SHADOW` | `hairline · card · raised · floating · brandCard · brandFloating`. Never a hand-rolled shadow. |
| `SPRING` / `DURATION` | Every press and transition uses the same curves. |
| `TEXT` / `SURFACE` / `STATUS` | Semantic roles. `INK[400]` is ~2.4:1 on white — **decoration only, never text**. |

Appearance is reactive: `useThemeColors()` (backed by `components/ThemeProvider`)
returns the palette for the resolved appearance, and the provider pushes the same
value into NativeWind so `dark:` classNames and StyleSheet colours can't
disagree. Light and dark are both first-class, and a user can force either
independently of the system setting.

Motion lives in `lib/motion.ts` (`enterList`, `enterFromBottom`, `LAYOUT`, …) and
degrades to a cross-fade under **Reduce Motion**.

## Quick start

```sh
npm install                 # .npmrc sets legacy-peer-deps for RN 0.81 / React 19
cp .env.example .env
npx expo start              # press i for the iOS simulator
```

`.env` (Expo inlines `EXPO_PUBLIC_*` at build time):

```
EXPO_PUBLIC_API_BASE_URL=    # Worker URL — AI features no-op until set
EXPO_PUBLIC_CLIENT_TOKEN=    # must match the Worker's APP_CLIENT_TOKEN secret
```

The app runs without a Worker: you can still save links, notes and images, and
classification falls back to a heuristic.

Full walkthrough — local dev, deploying, and self-hosting — in
[`docs/setup.md`](docs/setup.md).

## Scripts

| Command | What |
|---|---|
| `npx expo start` | Metro dev server |
| `npx expo run:ios` | Build + run a dev client on the simulator or a device |
| `npx tsc --noEmit` | Type-check the app |
| `npx expo lint` | Lint |
| `cd workers && npx tsc --noEmit` | Type-check the Worker |
| `cd workers && npm run dev` | Run the Worker locally (`wrangler dev`) |
| `cd extension && npx wxt build` | Build the extension |
| `cd extension && node scripts/verify-e2e.mjs` | Extension e2e against a real browser |

## Conventions

- **Persistence** — never call a raw writer. Go through `lib/storage`
  (`addItem` / `updateItem` / `addStack` / …). All collection writes are
  serialized per key and guarded against clobbering on a transient empty read.
- **Items** — construct via `createItem` (`lib/items`); it fills id, timestamps
  and status. Dates are stored as `YYYY-MM-DD` and parsed with
  `lib/datetime.parseLocalDate` — never `new Date(str)`, which is UTC.
- **Categories** — the single source of truth is `CLASSIFICATIONS` in
  `lib/types.ts`. The Worker and the Swift target keep in-sync copies, marked as
  such.
- **Completions** — mark done through `buildReview` (`lib/resurface`), not a bare
  `viewed: true`. A completion that doesn't bump `times_done` never reaches the
  north-star metric.
- **Destructive actions** — apply optimistically and offer Undo via the Toast,
  rather than a blocking confirm. `deleteItem` already writes a tombstone with
  everything needed to restore.
- **No demo data in production** — seeding is `__DEV__`-only.
