# Silo — Codebase Audit

> Living document. Re-read on every resume. Pairs with [`TODO.md`](TODO.md) (task list / cross-session memory) and [`LAUNCH_REPORT.md`](LAUNCH_REPORT.md) (launch-readiness status).
>
> **Audit date:** 2026-06-03 · **Method:** full read of every meaningful source file (lead engineer read the data/persistence/API/router spine + all native config directly; 3 parallel subagents audited screens, components+lib, and workers, each with `file:line` citations). All findings below were either read directly or cited from source with line numbers. Items that could not be confirmed in this environment are marked **UNVERIFIED**.

---

## Environment & verification ceiling (read first)

- **Host is Windows 11 / PowerShell.** There is **no macOS, no Xcode, no iOS Simulator** here. Therefore I **cannot build or run the iOS app** in this environment, and Android builds require an Android SDK/emulator that is not confirmed present. Anything requiring an actual device/simulator run is marked **UNVERIFIED** until it can run on a Mac or via EAS cloud build.
- **No Node.js toolchain is installed on this machine — VERIFIED.** Searched PATH, Program Files, nvm/fnm/volta/scoop/chocolatey/winget locations, and bun/deno/yarn/pnpm fallbacks: none present. `node`/`npm`/`npx` are unavailable in every shell. (An earlier background `npm install` reported "exit 0" but that was the exit code of a piped `tail`, not npm — `node_modules` was never created.)
- **Therefore I CANNOT run in this environment:** `tsc --noEmit` (type-check), `eslint` (lint), tests, `expo`/Metro, `wrangler`, or any iOS/Android build or app run. All such results are **UNVERIFIED** here and require a machine with Node (+ a Mac or EAS cloud build for iOS).
- **What I *can* do here:** read/analyze all source, reason about correctness, author code + config + docs, and verify by static inspection. Code I write is "correct by inspection" until compiled/run elsewhere — I will label it as such, never as a passing build.
- **What I *cannot* verify here:** type-check/lint/test results, runtime UI behavior, calendar device sync, map rendering, gesture/animation feel, live Gemini/ElevenLabs/Vultr responses, notifications, geofencing.

---

## Phase 0 — Detected stack (definitive)

| Layer | Detected |
|---|---|
| **App framework** | Expo SDK **~54.0.0**, React Native **0.81.0**, React **19.1.0**, New Architecture **enabled** (`app.json: newArchEnabled`, `Info.plist: RCTNewArchEnabled`) |
| **Language** | TypeScript (strict mode) |
| **Routing** | expo-router **^6** (file-based; `app/`), typed routes experiment on |
| **Local persistence** | `@react-native-async-storage/async-storage` 2.2.0 (all app data is local) |
| **Native projects** | Both `ios/` (`Silo.xcodeproj`, bundle `com.silo.app`) and `android/` (`com.silo.app`) are committed (prebuild output) |
| **Maps** | `react-native-maps` 1.20.1, forced `PROVIDER_GOOGLE` |
| **Backend** | **Cloudflare Workers** (`silo-api`), TypeScript, `wrangler deploy`. **Cost pass 2026-06-04:** stripped to a SINGLE authenticated Gemini proxy (`POST /api/gemini`, `workers/gemini.ts`); analyze-image/analyze-link/suggest-schedule/generate-audio/generate-embedding/rag-query/instagram-download all deleted; SSRF removed (no server-side URL fetch). |
| **AI provider** | **Google Gemini** — `gemini-2.0-flash-exp` (classification/link/schedule/RAG) + `embedding-001` (embeddings). All via `env.GEMINI_API_KEY` server-side |
| **TTS** | **REMOVED (cost pass 2026-06-04)** — was ElevenLabs (sponsor prize). Voice is roadmap-only behind `FEATURE_VOICE` (default off); use Apple on-device Speech later, no paid TTS. |
| **Object storage/CDN** | **REMOVED (cost pass 2026-06-04)** — was Vultr (sponsor prize). All data is on-device (AsyncStorage); no remote storage/CDN. |
| **Auth / accounts** | **None.** Anonymous per-device id (`@silo:userId` = `user_<ts>_<rand>`), no login, no server user model |
| **Payments / IAP** | **None.** No StoreKit/Play Billing/RevenueCat dependency anywhere |
| **Build/run commands** | `npm start` / `npm run ios` / `npm run android` / `npm run web`; `npm run type-check` (`tsc --noEmit`); `npm run lint` (`eslint .`). Backend: `wrangler dev` / `wrangler deploy` / `wrangler tail` |
| **Required config for clean build** | Frontend: `.env` with `EXPO_PUBLIC_API_BASE_URL` (Worker URL). Backend secrets (via `wrangler secret put`): `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `VULTR_ACCESS_KEY`, `VULTR_SECRET_KEY`, `VULTR_BUCKET`, `VULTR_ENDPOINT`, `VULTR_CDN_DOMAIN`. **Android Google Maps API key is NOT configured** (map will not render on Android). |

---

## SECURITY VERDICT (P0 focus)

- **Committed/shipped secret: NONE FOUND — verified, not assumed.** Definitive checks run:
  - Working-tree grep for real key shapes (`AIza…{20,}`, `sk-…`, `sk_…`, base64 blobs): only a **doc placeholder** (`HOW_IT_WORKS.md:173 'YOUR_ELEVENLABS_KEY'`) and the correct server ref (`generate-audio.ts:183 env.ELEVENLABS_API_KEY`).
  - **All-blobs scan of entire git history** (`git rev-list --all --objects` → `git cat-file` → grep for `AIza…{30,}`, `sk_…{32,}`, `sk-…{32,}`): **empty**. No real key shape ever committed.
  - Pickaxe `-G` for literal key assignments (`GEMINI_API_KEY="…"`, `xi-api-key:"…"`): **empty**.
  - Only env file on disk is `ios/.xcode.env` (stock: `export NODE_BINARY=$(command -v node)`). `.env` is gitignored and not committed.
  - Worker handlers (all 7) read every credential from `env.` — confirmed by direct read.
  - **Conclusion:** the brief's "at least one shipped secret" lead is **not substantiated**. Keys are correctly server-side. (If a secret exists, it would have to be in an un-pushed local `.env`/`.dev.vars` — none present.)
- **The REAL security P0 — unauthenticated, open backend.** `workers/index.ts:30-34` sets `Access-Control-Allow-Origin: *` with **no authentication and no rate limiting** on every endpoint. The keys aren't leaked, but the **key-protected, paid endpoints are wide open**: anyone who learns the Worker URL can drain Gemini/ElevenLabs/Vultr quota (direct money loss for a paid app) and use `analyze-link`/`instagram-download` as an **SSRF/scrape proxy**. This must be gated (app attestation / signed requests / per-device token) + rate-limited before launch.

---

## Architecture summary

**Data flow:** Screens (expo-router) → `lib/storage.ts` (AsyncStorage CRUD) for all persistence; → `lib/api.ts` (thin fetch client) → Cloudflare Worker → Gemini/ElevenLabs/Vultr. State is **screen-local** (`useState` + `useFocusEffect` reload on tab focus); there is **no global store/context** — each tab re-reads AsyncStorage on focus, which is why cross-tab consistency mostly works but optimistic edits diverge. `lib/scheduler.ts` wraps `expo-calendar`. `lib/seed.ts` injects demo data at boot.

**Core entity** (`lib/types.ts` `Item`): `id, type(link|screenshot|note), classification(12 enum), title, description?, url?, imageUri?, audio_url?, script?, tags[], stack_id?, scheduled_date?, scheduled_time?, duration?, place_{name,address,latitude,longitude}?, created_at, viewed, archived, bucketlist?, bucketlist_completed?, notes?, checklist?`. **Naming is inconsistent** (snake_case + camelCase mixed).

**Gap vs. the required schema (brief Phase 2):** missing `updated_at`, `completed_at`, `status` (uses scattered booleans `viewed`/`archived`/`bucketlist_completed`), `priority`, structured `location`, `dueDate`, and **embedding/vector metadata on the item**. **Bucket-list support is two booleans only** — there is no `blockedReason`, `conditions`, `locationTrigger`, `timeTrigger`, `priority`, or computed `readyNow`. The bucket-list "engine" does not exist at the data-model level.

**Persistence seam (`lib/storage.ts`):** every mutation does a **full-array read → modify → full-array write** (O(n), whole-array JSON each time). **No schema versioning/migration** (changing `Item` will break stored data on upgrade), **no caching layer**, and **concurrent writes are racy** (read-modify-write without a lock → lost updates). This is the seam to harden before any schema change.

**Backend seam:** stateless Workers; the only "database" is Vultr S3 (audio + intended embedding blobs). There is **no real vector store** (no KV/D1/Vectorize). Embedding persistence and RAG retrieval both rely on Vultr S3 access that is **signed incorrectly** (see HIGH issues) → effectively non-functional.

---

## File-by-file notes (condensed; full detail in issue list)

### Frontend `app/`
- **`_layout.tsx`** — Root: audio mode + first-launch seed. Fires `setupAudio()`/`checkAndSeedData()` **unawaited** before `<Slot/>` → seed-vs-load race (`:53-54`). Seeds fake data into production.
- **`(tabs)/_layout.tsx`** — Native (`unstable-native-tabs`) 5-tab bar. Labels remap files: `reel`→Streams, `index`→Stacks, `calendar`→Silo. **No assistant tab.** Tab-haptic regex (`:33`) almost certainly never matches (expo-router strips route groups) — dead. **UNVERIFIED** at runtime.
- **`(tabs)/add.tsx`** — Add/Capture (URL/camera/gallery/note → AI analyze → save). Real and fairly complete. **No stack assignment** (`:181-197` never sets `stack_id`). No double-submit guard (`:171`). No cancel/AbortController on long analysis. 11-line form-reset block copy-pasted ×4. Failed image analysis can strand the form (`:499`).
- **`(tabs)/index.tsx`** — Stacks browse + search + CRUD. Works (FlatList, swipe, long-press). **Auto-re-seeds** missing demo stacks on focus (`:95-112`); ships a dev **force-seed button** (`:490, :610-617`). AI-search effect re-fires on every `items` change and maps results by fragile array index (`:131-176, :147`). `Alert.prompt` is iOS-only (`:407, :462`).
- **`(tabs)/reel.tsx`** — Streams (paged FlatList) + archive/complete/schedule. Works. Timezone off-by-one in schedule pre-fill (`:159`). No detail navigation out of the feed. WebView-per-card memory risk. No schedule double-submit guard (`:188`).
- **`(tabs)/calendar.tsx`** — "Silo" = Calendar + Map + Bucket-list (three modes). Partially works. **Marquee timezone off-by-one** (`:316, :161, :174, :748`). Header claims month grid + drag-to-reschedule — **neither exists** (dead imports `:43-50`, dead styles `:1378-1394`); **Day view renders no events**. Map forces `PROVIDER_GOOGLE` (`:889`) with no key → blank on Android; no permission-denied/empty state (hardcoded SF fallback `:95-99`). **Repeated sequential geocoding on every focus** (`:254-308`), retried forever.
- **`(tabs)/screenshots.tsx`** — Tinder-style screenshot triage → AI import. Real swiper + import. **No OCR**, no undo, no de-dupe, no per-card progress after card #1 (`:531`). Stale-closure index advance during async (`:110-118`). Dead defensive `try/catch` around gesture build (`:318-397`).
- **`item/[id].tsx`** — Item detail/edit/audio/schedule. Works. **Audio not unloaded on unmount** (stale-closure cleanup, dep `[id]` only, `:90-97`) → playback leak. Timezone off-by-one (`:117, :300, :713`). No schedule double-submit guard (`:320`). `Linking.openURL(item.url)` with **no scheme allowlist** (`:235`). Dead `from=reel` branch (`:376`).
- **`silo/[id].tsx`** — Stack detail. Works but **read-only for user content** (no add/remove items; nothing assigns `stack_id`). Side-effecting `updateStack` on every focus (`:64-67`). `Alert.prompt` iOS-only (`:151`).

### Components
- **`ChatBot.tsx`** — Assistant UI. **Real wiring** (`ragQuery` → backend; can really create an event via `scheduleItemReview`), but weakly grounded (sends only `items.slice(0,30)`; backend stuffs ≤15 into the prompt). Only **one** action (accept-event); **no streaming**; message ids via `Date.now()+0/1/2` can collide; `new Date(date)` UTC off-by-one (`:330`). Mounted **only** in `add.tsx:378` (`onClose={()=>{}}`).
- **`StreamCard.tsx`** — Reel WebView / audio card. `expo-av` (deprecated). **Audio cleanup stale-closure leak** (dep `[item.audio_url]` not `[sound]`, `:75-81`). **WebView `originWhitelist={['*']}` + `mixedContentMode="always"`** loading 3rd-party `eeinstagram.com` (`:215-221`). Two **dead buttons** (`console.log` only: `:203, :398`). `setState` during `renderError` (`:250-252`).
- **`CompactCard.tsx` / `ItemCard.tsx`** — Cards with swipe. **`GestureHandlerRootView` wrapped per card/row** (`CompactCard:136`, `ItemCard:175`) — should be one app-root instance. No image `onError` fallback. `getClassificationColor/Icon` duplicated across both + StreamCard. `isCompleted` (prop) vs `item.viewed` (field) inconsistency in ItemCard.
- **`TagPicker.tsx`** — Cleanest file. Trims/dedupes/caps. Silent failure on dup/limit (no feedback); `key={index}`.

### `lib/`
- **`types.ts`** — see schema gap above.
- **`storage.ts`** — see persistence seam above (full-array R-M-W, no migration, racy).
- **`api.ts`** — Thin client; graceful fallbacks. **`aiSearch` calls `/api/ai-search` which is NOT routed** (`:235`) → always keyword fallback. **No AbortController/timeouts anywhere** (no cancel). Backend URL from `EXPO_PUBLIC_API_BASE_URL` (URL, not a secret — OK).
- **`scheduler.ts`** — Calendar. **`updateScheduledEvent` (`:135`) & `deleteScheduledEvent` (`:179`) are DEAD (zero callers)** → one-way create-only sync. **Timezone**: create uses local `new Date(y,m-1,d,h,min)` (`:89-92`) but `getUpcomingEvents` re-parses string form (`:226,230`) — engine-dependent → drift; DST ±1h. **No idempotency** → duplicate events (`:96-117`). Errors swallowed → callers report success on failure.
- **`seed.ts`** — **Ships fake demo data into production** (boot `_layout.tsx:44` + home `index.tsx`). Dead `example.com` URLs (`:273,:323,:346`); auto-scheduled future events (`:94-95,:166-167`). Violates "no hardcoded happy-path demo data."
- **`screenshots.ts`** — Media access. **No OCR** (delegated to remote Gemini vision). **iOS detection wrong** (`isScreenshot` matches `img_*` = camera photos, misses real screenshots, `:60-63`). `mimeType` hardcoded `image/jpeg` for PNG (`:108`). Unused `expo-file-system` import (`:19`). Header overstates "monitors the photo library" (no listener).
- **`instagram.ts`** — Reel id/embed parsing (real) + `downloadInstagramDirect` (theater: dead oEmbed/`?__a=1` endpoints + unofficial scraper; **returns `success:true` on total failure**, `:182,:196`; leaks URLs to `saveig.app`).

### Workers (`workers/`)
- **`index.ts`** — Router. Open CORS, no auth/rate-limit (P0). Routes 7 endpoints; **`/api/ai-search` is absent** (client calls it).
- **`analyze-image.ts` / `analyze-link.ts` / `suggest-schedule.ts`** — Gemini calls. Keys from `env.` (correct). Greedy `/\{[\s\S]*\}/` + `JSON.parse` on raw model text with silent low-quality fallback; **AI output not validated** against the 12-value enum. `gemini-2.0-flash-exp` (experimental) hardcoded. `analyze-link` **SSRF** (fetches arbitrary user URL, spoofed UA, no allowlist, follows redirects, `:74-76,:170-171`). Error `details` leak upstream messages.
- **`generate-audio.ts`** — ElevenLabs + Vultr SigV4. **SigV4 omits `x-amz-content-sha256`** (`:69-72,:223-227`) → likely `SignatureDoesNotMatch`. **Data-URL fallback crashes on real MP3** (`String.fromCharCode(...bytes)` RangeError, `:238-246`). `itemId` unsanitized into S3 key (`:206`).
- **`generate-embedding.ts`** — Gemini `embedding-001` then Vultr write using **legacy/malformed SigV2** (base64url, stripped `+/=`, `:92-114`) → Vultr 403 → **embeddings computed then discarded**. Self-labeled "Simplified signature (for production, use proper AWS SigV4)".
- **`rag-query.ts`** — Real cosine-similarity code exists, but **LIST/GET use the same broken SigV2** (`:107-128,:149-162`) → `retrieveEmbeddings` returns `[]`. Silently degrades to stuffing client-supplied `items.slice(0,15)` into Gemini with **hardcoded `relevance:0.8`** (`:400-413`). Prompt encourages new suggestions → **can hallucinate**; "sources" are client-controlled.
- **`instagram-download.ts`** — Deprecated Instagram oEmbed + unofficial `saveig.app` scraper; `success:true` on failure; **ToS/legal + reliability risk**.

### Native config (Phase 6 inputs)
- **`ios/Silo/Info.plist`** — Has calendar/camera/photo/location/microphone/reminders strings, but **location strings are generic placeholders** ("Allow Silo to access your location") and there is **no `UIBackgroundModes`** → background location unconfigured. `LSMinimumSystemVersion 12.0` likely stale vs Expo 54 (UNVERIFIED — check deployment target).
- **`ios/Silo/Silo.entitlements`** — **EMPTY (`<dict/>`).** No App Groups (required to share data into the app from a Share Extension), no Push, no background modes.
- **`android/.../AndroidManifest.xml`** — Foreground location/calendar/media perms present, `silo://` deep link present. **Missing:** `ACCESS_BACKGROUND_LOCATION`, `POST_NOTIFICATIONS` (Android 13+), **Google Maps API key** (`com.google.android.geo.API_KEY`), and any share `SEND` intent-filter.

---

## SEVERITY-RANKED ISSUE LIST

### CRITICAL
1. **Backend unauthenticated + open CORS `*` + no rate limit** → quota theft & SSRF/scrape proxy on paid endpoints. `workers/index.ts:30-34` (all handlers). *(Keys themselves are NOT leaked — see Security Verdict.)*
2. **Calendar timezone off-by-one (the known bug).** Date-only strings re-parsed as UTC midnight then rendered local. `calendar.tsx:316,161,174,748`; `reel.tsx:159`; `item/[id].tsx:117,300,713`; `ChatBot.tsx:330`. Scheduler create path (`scheduler.ts:89-92`) is correct but the rest diverges → visible day/hour drift; DST ±1h.
3. **Two-way calendar sync broken (one-way create-only).** `scheduler.ts:135 updateScheduledEvent` & `:179 deleteScheduledEvent` are dead code. Edits/deletes never propagate to the device calendar. *(Acceptance criterion fails.)*
4. **Duplicate calendar events.** No idempotency in `scheduleItemReview` (`scheduler.ts:96-117`); multiple call sites + reschedule create duplicate native + stored events. Ids `event_${Date.now()}` collision-prone.
5. **Stacks are demo-only.** Nothing sets `Item.stack_id` except `seed.ts`; `add.tsx:181-197` has no stack picker. User content can never enter a stack → a core feature is non-functional for real data.
6. **Fake demo/seed data ships & auto-injects in production.** `_layout.tsx:44`, `index.tsx:95-112,492`, `seed.ts` (dead `example.com` URLs, auto-scheduled events). Direct violation of "no hardcoded happy-path demo data."

### HIGH
7. **RAG/assistant retrieval broken.** Embedding write (`generate-embedding.ts:92-114`) and RAG read (`rag-query.ts:107-128,149-162`) use malformed non-SigV4 Vultr auth → nothing persists/retrieves; silently degrades to client-item prompt-stuffing with fake relevance (`rag-query.ts:400-413`). Assistant can hallucinate; not grounded.
8. **"AI semantic search" is dead.** `lib/api.ts:235` → `/api/ai-search` which has no route → always keyword fallback.
9. **Audio narration likely broken end-to-end.** SigV4 missing `x-amz-content-sha256` (`generate-audio.ts:69-72,223-227`) → upload rejected; data-URL fallback crashes on real MP3 (`:238-246`).
10. **SSRF / open proxy** via `analyze-link` (and `instagram-download`) fetching arbitrary user URLs with spoofed UA, no scheme/host allowlist, follows redirects. `analyze-link.ts:74-76,170-171`.
11. **Audio not unloaded on unmount** (stale-closure) → playback continues / memory leak. `item/[id].tsx:90-97`, `StreamCard.tsx:75-81`.
12. **Instagram ingestion unreliable + ToS/legal risk** (unofficial scraper, false-positive success). `instagram-download.ts:73,94,205`; `lib/instagram.ts:182,196`.
13. **Repeated sequential geocoding on every tab focus**, retried forever, +2 extra full `getItems()` per pass. `calendar.tsx:254-308`.
14. **AI-search re-fires on every `items` mutation**; index-based result mapping misaligns if `items` changes mid-flight. `index.tsx:131-176,147`.
15. **Double-submit (no guards)** → duplicate items/events. `add.tsx:171`, `reel.tsx:188`, `item/[id].tsx:320`, `ChatBot.tsx`.
16. **`Linking.openURL` with no scheme allowlist**; `new URL()` validation accepts `javascript:`/`file:`. `item/[id].tsx:235`, `add.tsx:78`.
17. **WebView injection surface** (`originWhitelist ['*']` + `mixedContentMode "always"`, 3rd-party page). `StreamCard.tsx:215-221`.
18. **Native gaps block required features:** no `expo-notifications` (bucket-list notifications), no background location (`UIBackgroundModes` / `ACCESS_BACKGROUND_LOCATION`) for geofencing, no Android Google Maps key (blank map), no Share Extension infra (empty entitlements / no `SEND` filter), no `POST_NOTIFICATIONS`.

### MEDIUM
- **Data model gaps** vs required schema (no `updated_at/completed_at/status/priority/embedding`; bucket-list = 2 booleans; flat `place_*`; inconsistent naming). `types.ts`.
- **Persistence is fragile** (full-array R-M-W, **no migration/versioning**, racy concurrent writes). `storage.ts`. *Must add migration before changing schema.*
- **AI output not validated** against `Classification` enum; greedy regex + `JSON.parse` on raw model text. All Gemini handlers.
- **OCR absent** despite the screenshot-analysis premise. `screenshots.ts`.
- **iOS screenshot detection wrong** (`img_*` heuristic) + `image/jpeg` hardcoded for PNG. `screenshots.ts:60-63,108`.
- **`Alert.prompt` iOS-only** → stack create/rename no-ops on Android. `index.tsx:407,462`, `silo/[id].tsx:151`.
- **`GestureHandlerRootView` per card/row** (perf/gesture conflicts). `CompactCard:136`, `ItemCard:175`.
- **Map needs Google key; no empty/permission-denied state.** `calendar.tsx:889,95-99`.
- **Path/key injection** from unsanitized `itemId`/`userId` into S3 keys. `generate-audio.ts:206`, `generate-embedding.ts:78`, `rag-query.ts:102`.
- **No payload size limits** on base64 image / text (cost/DoS amplification, worsened by no auth).
- **`gemini-2.0-flash-exp` experimental model** hardcoded ×4 (deprecation risk).
- **No cancel on long-running analysis** (no AbortController). `api.ts`, `add.tsx`.
- **Calendar over-claims** (month grid + drag-to-reschedule absent; Day view empty). `calendar.tsx`.
- **Assistant has no tab** and only one action; reachable only from Add. `add.tsx:378`.
- **No Streams→detail navigation**; dead `from=reel` branch. `item/[id].tsx:376`.
- **`expo-av` deprecated** in SDK 54 (declared in `package.json`; migrate to `expo-audio`/`expo-video`).
- **Scheduling failures reported as success** to the user. `scheduler.ts:124` vs `ChatBot.tsx:209`.

### LOW
- Dev force-seed button shipped (`index.tsx:610-617`). Duplicated `getClassificationColor/Icon` ×3. `key={index}` across lists/tags. Stale/incorrect comments (`seed.ts:79`, `instagram.ts:59`, `screenshots.ts:4-5`). Noisy success Alerts on every save. `Dimensions.get('window')` captured once (rotation/iPad). Error `details` leak upstream provider text on 500 (all handlers). S3 list parsed by regex w/o continuation token (`rag-query.ts:142`). Inconsistent 429 handling across handlers. Verbose emoji `console.log` on every boot (`seed.ts`).

---

## Feature classification (real / demo-only / missing)

| Feature | Status | Note |
|---|---|---|
| Add / Capture | **Real** (gaps) | No stack assign, no cancel, image-fail strands form |
| Stacks | **Demo-only** | No `stack_id` assignment for user content; relies on seed |
| Streams / reel | **Real** (gaps) | No detail nav; WebView memory; dead buttons |
| Silo · Calendar | **Demo-only / half** | Off-by-one; one-way sync; no month grid/drag; Day view empty |
| Silo · Map | **Real-conditional** | Needs Google key (Android blank); no empty/denied state; geocode perf |
| Bucket List | **Partial** | Surfacing works (boolean); **engine (conditions/triggers/notifications) MISSING** |
| AI Assistant | **Real-wiring / failed RAG** | Degraded to prompt-stuffing; 1 action; no streaming |
| Screenshot Swipe | **Real** (gaps) | No OCR; wrong iOS detection; no undo/dedupe/progress |
| AI semantic search | **Broken** | Dead route |
| Audio narration | **Likely broken** | Vultr signing + crashing fallback |
| Instagram / social ingest | **Tier-1 extractor built + verified (2026-06-04)** | Universal `extract` task (oEmbed/OG, egress-hardened) + token-free inline embeds; verified via `wrangler dev` + real curl. Unofficial scraper + eeinstagram proxy removed. See TODO "🔗 Social Extraction". |
| **Share extension** | **Built + wired (2026-06-04); prebuild-verified** | Native target via `@bacons/apple-targets` (`targets/share` SwiftUI sheet) → deep-links `silo://share` → `app/share.tsx` runs the extractor pipeline; App Group shares images. On-device test = EAS / `expo run:ios` gate (not Expo Go). See TODO "🔗 Social Extraction". |
| **Monetization / paywall** | **Missing** | No IAP/RevenueCat dependency |
| **Backend auth** | **Missing** | Open endpoints |
| Onboarding / in-context permissions | **Missing** | Phase 4 |
| Privacy Policy / ToS / store assets | **Missing** | Phase 6 (mandatory for subscriptions) |

### 2026-06-04 addendum — Social Extraction (research)
The "share into Silo + extract from a social link" pipeline is now a first-class mission. **Part A research is complete** (verified live endpoint probes + Apple guideline text) and lives in [`TODO.md`](TODO.md) under "🔗 SOCIAL EXTRACTION". Decision: **Tier-1** (oEmbed/OG metadata + thumbnail + token-free official embed) is the shippable build; **Tier-2** (yt-dlp/cobalt raw download) stays an off-by-default flag (ToS + Apple 5.2.3 + can't-run-on-device + legal). Architecture note: the cost-pass removed all server-side URL fetching; the extractor re-introduces a **controlled, egress-filtered** fetch in the Worker (allow public http(s), block private/link-local/metadata IPs, cap redirects/size/timeout) parsed via Cloudflare `HTMLRewriter` — *not* the old open-SSRF surface.

---

## UNVERIFIED / could not confirm in this environment
- iOS/Android **build, install, and all runtime behavior** (no Mac/simulator; deps not yet installed). Tab-haptic regex, map rendering, gesture feel, calendar device round-trip, notifications, geofencing — all UNVERIFIED.
- `tsc --noEmit` / `eslint` / test results — **cannot be produced here** (no Node toolchain on this machine, VERIFIED above). Must be run on a Node-equipped machine; treat the current type-check/lint state as UNKNOWN until then.
- Live Gemini/ElevenLabs/Vultr responses — not exercised (no deployed URL/keys here).
- Whether `ios/`/`android/` are managed by Expo prebuild (CNG) vs bare. Committed native dirs = prebuild output; **native config changes should go via `app.json` + config plugins where possible**, then `expo prebuild` regenerates. To confirm before hand-editing native files.
- `LSMinimumSystemVersion 12.0` vs Expo 54's real min (likely iOS 15.1) — check the Xcode deployment target.
