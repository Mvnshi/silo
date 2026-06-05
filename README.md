# Silo

Silo turns the things you save — links, screenshots, notes, and social posts — into an organized, schedulable library. Paste or **Share → Silo** any YouTube / TikTok / X / Instagram / Reddit link and it's auto-classified, titled, thumbnailed, and playable inline; screenshots and notes get the same AI treatment. Everything lives on-device.

> **New here?** Read this, then [`FOUNDER_SETUP.md`](FOUNDER_SETUP.md) for the account-level setup (Cloudflare, EAS, Apple). Day-to-day status + the task backlog live in [`TODO.md`](TODO.md) and [`LAUNCH_REPORT.md`](LAUNCH_REPORT.md).

## Stack

| Layer | Choice |
|---|---|
| App | Expo SDK 54, React Native 0.81, React 19, TypeScript (strict), expo-router (file-based) |
| State / storage | On-device only — `@react-native-async-storage/async-storage` (`lib/storage.ts`) |
| Backend | One Cloudflare Worker (`workers/`) — an authenticated **Gemini proxy**, nothing else |
| AI | Google Gemini (`gemini-2.0-flash`) for classify / extract / suggest / assistant |
| Native add-on | iOS **Share Extension** (`targets/share`, via `@bacons/apple-targets`) |
| Maps / calendar / media | `react-native-maps`, `expo-calendar`, `expo-media-library`, `expo-location` |

There is **no** account system, no remote database, and no third-party media/TTS/storage service — the only thing that touches the network is the Gemini proxy. Steady-state cost is roughly **$0–1/month** (Cloudflare free tier + Gemini pennies); see [`LAUNCH_REPORT.md`](LAUNCH_REPORT.md).

## Architecture

```
app/ (expo-router screens)
  ├─ (tabs)/  Streams · Stacks · Add · Silo (calendar/map/bucket) · Screenshots
  ├─ item/[id], silo/[id], settings, share (deep-link target)
lib/ (pure logic, no UI)
  ├─ storage.ts     AsyncStorage: per-key write mutex + clobber guards
  ├─ items.ts       Item factory, normalization, status derivation
  ├─ api.ts         thin client → POST /api/gemini
  ├─ extract path   embed.ts (inline players) + shareImport.ts (share queue)
  ├─ scheduler.ts   idempotent calendar scheduling
  └─ classification.ts, datetime.ts, haptics.ts, screenshots.ts, seed.ts, config.ts
components/         StreamCard, ItemCardPro, CompactCard, ItemCard, ChatBot, …
workers/            Cloudflare Worker: index → middleware (auth + rate limit) → gemini
targets/share/      native iOS Share Extension (Swift) → App Group → app drains it
```

**Why a Worker at all?** Only to keep `GEMINI_API_KEY` off the client (an in-bundle key is extractable). Everything else — search, retrieval, storage — runs on-device and free.

**Social link extractor** (`workers/extract.ts`): resolves the platform → oEmbed (YouTube/TikTok/X/Vimeo) or Open Graph via `HTMLRewriter` (Instagram/Reddit/Threads/Facebook/any URL) → normalized metadata → chained into Gemini classify. Egress-hardened (http(s) only, private/metadata IPs blocked, manual re-validated redirects, timeout + size cap) and never loses a save (dead/private links still store the raw link). Playback is the platform's own token-free embed (`lib/embed.ts`) — no media is downloaded (a deliberate App-Store / ToS choice; see the "Social Extraction" section of [`TODO.md`](TODO.md)).

## Getting started

```sh
npm install                 # uses .npmrc (legacy-peer-deps) for RN 0.81 / React 19
cp .env.example .env        # then fill in the values below
npx expo start              # Metro; press i for the iOS simulator
```

`.env` (Expo inlines `EXPO_PUBLIC_*` at build time):

```
EXPO_PUBLIC_API_BASE_URL=    # your deployed Worker URL (AI features no-op until set)
EXPO_PUBLIC_CLIENT_TOKEN=    # must match the Worker's APP_CLIENT_TOKEN secret
```

The app runs without a Worker — AI features degrade gracefully (you can still save links/notes/images; classification falls back to a heuristic). To enable AI, deploy the Worker and set the URL above.

### Backend (Cloudflare Worker)

```sh
cd workers && npm install
npx wrangler secret put GEMINI_API_KEY     --config ../wrangler.toml
npx wrangler secret put APP_CLIENT_TOKEN   --config ../wrangler.toml   # = EXPO_PUBLIC_CLIENT_TOKEN
npm run deploy                                                         # config is at repo root
```

Full runbook (KV rate-limit namespace, EAS, Apple) in [`FOUNDER_SETUP.md`](FOUNDER_SETUP.md).

### iOS Share Extension

Cannot run in Expo Go — needs a dev build: set `ios.appleTeamId` in `app.json`, register the App Group `group.com.silo.app`, then `npx expo prebuild -p ios --clean` and `npx expo run:ios` (or an EAS dev build). Details in [`FOUNDER_SETUP.md`](FOUNDER_SETUP.md) §4.

## Scripts

| Command | What |
|---|---|
| `npx expo start` | Metro dev server |
| `npx expo run:ios` | Build + run a dev client on the simulator/device |
| `npx tsc --noEmit` | Type-check the app |
| `cd workers && npx tsc --noEmit` | Type-check the Worker |
| `npx expo lint` | Lint |

## Conventions

- **Persistence**: never call a raw writer — go through `lib/storage` (`addItem`/`updateItem`/`addStack`/…). All collection writes are serialized per-key and guarded against clobbering on a transient empty read.
- **Items**: construct via `createItem` (`lib/items`); it fills id/timestamps/status. Dates stored as `YYYY-MM-DD` — parse with `lib/datetime.parseLocalDate` (never `new Date(str)`, which is UTC).
- **Categories**: the single source of truth is `CLASSIFICATIONS` in `lib/types.ts` (the worker + Swift keep in-sync copies, marked as such).
- **No demo data in production**: seeding is `__DEV__`-only.
