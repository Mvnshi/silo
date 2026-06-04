# Silo — Master TODO & Cross-Session Memory

> **This is the resume point for every session.** Re-read this + [`AUDIT.md`](AUDIT.md) + [`LAUNCH_REPORT.md`](LAUNCH_REPORT.md) before doing anything. Keep this file in sync constantly.

---

## ⏯️ RESUME HERE (state as of 2026-06-03)

- **Phase 0 (stack discovery): ✅ DONE** — see AUDIT.md "Phase 0".
- **Phase 1 (full audit): ✅ DONE** — every meaningful source file read; severity-ranked issues + feature classification in AUDIT.md.
- **Founder decisions received (2026-06-03):** **iOS-first** · billing via **RevenueCat** · **EAS cloud builds** (founder connects Expo account) · **7-day trial, $6.99/mo / $39.99/yr** (built as config constants).
- **Currently:** **✅ Task Zero (app loads clean) + Task One (Phase 2 typecheck) BOTH DONE & VERIFIED on a real Mac (2026-06-03).** Running on the founder's MacBook Air now — Node/Xcode/sim all present. App builds, installs, and runs on iPhone 17 Pro (iOS 26.2) sim with **zero red screens**; all 5 tabs verified by tapping (Streams/Stacks/Add/Silo/Screenshots). `npx tsc --noEmit` → **EXIT 0**. `npx expo start -c` → clean.
  - **Task Zero root cause was NOT a code change** — `react-native-reanimated` was already pinned/installed at **4.1.7** (SDK-54 compatible; peer-deps RN 0.78–0.82 ✓, worklets 0.5.1 ✓). The actual blockers, now fixed: (1) **stale `ios/Podfile.lock`** (predated the dep downgrade, missing reanimated/worklets, wrong hermes version) → deleted + regenerated via `pod install` (102 pods, RNReanimated/RNWorklets autolinked); (2) **iOS 26.5 simulator platform not installed** (Xcode 26.5 had only 26.1/26.2 runtimes → xcodebuild saw zero sim destinations) → installed via `xcodebuild -downloadPlatform iOS` (8.5 GB).
  - **Task One:** the ONLY type error was `tsconfig.json` overriding `moduleResolution:"node"`, which conflicts with `customConditions` inherited from `expo/tsconfig.base` (TS5098). Fixed → `"bundler"`. Phase 2 code (`types.ts`/`items.ts`/`storage.ts`) then type-checks clean. Migration confirmed at runtime (`[silo] storage migrated 0 -> 2`); seed runs `__DEV__`-only; capture sites (`add.tsx:183`, `screenshots.tsx:218`, `ChatBot.tsx:190`) build via `createItem`.
- **⚙️ ENV GOTCHAS ON THIS MAC (do not forget — they will recur):**
  - **Node is v24.16.0 / npm 11** (brief said "Node 20" — it's not). Expo SDK 54 tolerates it.
  - **CocoaPods (1.16.2 on Ruby 4.0) CRASHES without a UTF-8 locale** (`Encoding::CompatibilityError`). Always run pod-installing commands with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` — including `npx expo run:ios` (it runs `pod install` internally). Recommend founder add `export LANG=en_US.UTF-8` to `~/.zprofile`.
  - **Long background shells get reaped at turn boundaries** — foreground-block on long builds (`expo run:ios` ≈ 5–10 min cold).
  - App lives on sim **A31ED97F** (iPhone 17 Pro, iOS 26.2). Metro on :8081.
  - **Lint is currently broken:** ESLint 9 needs a flat `eslint.config.js` (none exists) + `eslint-config-expo`. `npm run lint` errors. Deferred — set up in Phase 7 QA (or quick `npx expo lint` scaffold).
- **Worker typecheck: ✅ DONE** — `cd workers && npm install` then `npx tsc --noEmit` → EXIT 0 (0 errors) after fixing 11 blind-written errors: removed 5 dead `OPTIONS` preflight blocks (unreachable — the `!== 'POST'` guard above them returns first, and `middleware.applySecurity` 405s non-POST too) and added 2 `json()` type assertions in `generate-embedding.ts`. Typecheck-verified only — NOT runtime-verified (needs `wrangler dev`/deploy + secrets; founder gate).
  - **CORS preflight decision:** intentionally not handled in the handlers (native iOS sends no `Origin`/preflight; middleware enforces POST). If a browser/web client is ever added, add an `OPTIONS`→204+CORS short-circuit in `middleware.applySecurity` (one place), not per-handler.
- **Next action:** (P0) SSRF hardening — allowlist + block private/non-http(s) hosts + `redirect:'manual'` in `analyze-link.ts` & `instagram-download.ts`; then scheme-allowlist `Linking.openURL`, sanitize S3 keys, lock down WebView. THEN Phase 3 calendar (timezone + two-way sync). **Founder config still needed:** `wrangler secret put APP_CLIENT_TOKEN` + `EXPO_PUBLIC_CLIENT_TOKEN`, `wrangler kv:namespace create RATE_LIMIT_KV`, EAS Expo `projectId`.

### ⚠️ Environment (UPDATED 2026-06-03 — now on a real Mac)
- **SUPERSEDED:** the original audit ran on a Windows host with no Node — that's no longer the case. We are now on the founder's **MacBook Air (Apple Silicon)** with Node v24.16.0, npm 11, Xcode 26.5, CocoaPods 1.16.2, working iOS simulator. `tsc`/`eslint`/`expo`/`wrangler`/iOS builds CAN run here.
- Things now VERIFIED by actually running them (not "correct by inspection"): app builds + runs on the sim, all 5 tabs, `tsc --noEmit` (EXIT 0), `expo start -c` clean. See ENV GOTCHAS above for the locale/turn-boundary/lint caveats.
- Still cannot self-verify here without more setup: EAS cloud build (needs founder Expo `projectId`), RevenueCat (needs a dev build + sandbox tester), live Gemini/ElevenLabs/Vultr (needs deployed Worker + secrets).

### Key facts (memory)
- Stack: Expo SDK 54 / RN 0.81 / React 19 / TS / expo-router; backend = Cloudflare Workers (`silo-api`); AI = Google Gemini; TTS = ElevenLabs; storage = Vultr S3/CDN. All data local via AsyncStorage. No auth, no accounts, no IAP.
- **No committed/shipped secret found (verified via full git-history scan).** Keys are server-side. The real P0 is the **unauthenticated open backend**.
- Native dirs `ios/`+`android/` are committed prebuild output → prefer changing native config via `app.json` + config plugins, then `expo prebuild`.

---

## ❓ FOUNDER QUESTIONS

**✅ ANSWERED 2026-06-03:**
1. **Platform:** **iOS first** (Android = fast-follow). → Build iOS Share Extension; can use Apple Maps on iOS (no Google key needed); StoreKit via RevenueCat. Defer Android-specific work (Play Billing, Maps key, SEND intent) but don't paint into a corner.
2. **Monetization layer:** **RevenueCat.** → Add `react-native-purchases` (+ `react-native-purchases-ui` optional); entitlement "premium"; configure in App Store Connect + RevenueCat dashboard.
3. **Build & verification:** **EAS cloud builds.** → Author `eas.json` + ensure `app.json`/credentials ready; founder connects Expo account + provides `projectId`/Apple team. I stay code-complete + provide commands; runtime verification happens via EAS/TestFlight.
4. **Pricing & trial:** **7-day trial · $6.99/mo · $39.99/yr.** → `TRIAL_DAYS=7`, price constants; mirror in RevenueCat/App Store Connect.

**STILL OPEN (non-blocking — proceeding with defaults):**
5. **AI provider** — keeping **Gemini**; moving off experimental `gemini-2.0-flash-exp` to a stable model. Flag if you want OpenAI/Anthropic.
6. **Apple Developer account status** — needed for TestFlight + IAP product setup (bundle `com.silo.app`). Log when known.
7. **Instagram ingestion** — scraper violates IG ToS & is unreliable. Recommend user-paste/oEmbed-with-token or dropping auto-download. Confirm direction.

---

## 📋 MASTER TASK LIST (by phase; ordered by EXECUTION ORDER priority)

### P0 — Security (do first; cheap + critical)
- [x] Gate backend: shared-token auth (`X-Silo-Client` ↔ `APP_CLIENT_TOKEN`), method + 8MB body-size checks. New `workers/middleware.ts`, wired in `workers/index.ts`; client sends header via `lib/api.ts` `apiHeaders()`. CORS left permissive on purpose (native sends no Origin). *(2026-06-03 — typecheck ✅ EXIT 0; deploy + `APP_CLIENT_TOKEN` secret still pending founder)*
- [x] Rate limiting: per-IP fixed-window (60 req/60s) via optional `RATE_LIMIT_KV`; fails open if unbound. `workers/middleware.ts`. *(2026-06-03)*
- [ ] **Real attestation** (App Attest / Play Integrity) — the shared token is extractable from the bundle; this is the proper fix. Phase 6 hardening.
- [ ] SSRF allowlist + block private/non-http(s) in `analyze-link` & `instagram-download`; `redirect:'manual'`. **← next backend item.**
- [ ] Scheme-allowlist `Linking.openURL` (http/https only). `item/[id].tsx:235`.
- [ ] Stop leaking upstream provider error text in 500 `details` (all handlers).
- [ ] Sanitize `itemId`/`userId` before using in S3 keys.
- [ ] Lock down WebView (`originWhitelist`, disable mixed content) or replace IG embed. `StreamCard.tsx`.

> **⚙️ Founder config — now scaffolded; runbook in [`FOUNDER_SETUP.md`](FOUNDER_SETUP.md).** Created (2026-06-03): `.env` (gitignored, with a generated 64-char `EXPO_PUBLIC_CLIENT_TOKEN`), `.env.example` (template), `eas.json` (dev/preview/production profiles). The account-level steps that need the founder's logins are the checklist in FOUNDER_SETUP.md: (1) `wrangler login` + set the 8 API secrets + push `APP_CLIENT_TOKEN` (pipe from `.env`, no copy-paste) + `wrangler kv namespace create RATE_LIMIT_KV` → paste id into `wrangler.toml` + `wrangler deploy` → put URL in `.env`; (2) `eas login`/`eas init` → `projectId`; (3) Apple Developer Team ID + enrollment. Backend fails **open** until `APP_CLIENT_TOKEN` is set, so nothing breaks mid-rollout.

### Phase 2 — Data model & architecture
- [x] Define unified `Item` schema: added `updated_at, completed_at, status, priority, location{}, due_date, embedding/embedding_meta, ocr_text, userId` (all optional, non-breaking). `lib/types.ts`. *(2026-06-03)*
- [x] **Bucket-list model:** `BucketListMeta { blockedReason, conditions[], locationTrigger, timeTrigger, manualReminderAt, suggestedNextAction, readyNow, readyReason, lastEvaluatedAt, notifiedAt }` + discriminated `BucketCondition` union (location/time/date/dayOfWeek/calendarFree/manual). `lib/types.ts`. *(2026-06-03)*
- [x] **AsyncStorage migration/versioning** — `CURRENT_SCHEMA_VERSION=2`, `runMigrations()`, idempotent `normalizeItem` applied on every read; `lib/items.ts` (`createItem`/`normalizeItem`/`computeStatus`/`touchItem`). Race fixed via `withItemsLock` mutex; `updateItem` now maintains `updated_at`/`completed_at`. `lib/storage.ts` + `lib/items.ts`. *(2026-06-03)*
- [x] **Wire `runMigrations()` into app boot** (`app/_layout.tsx` `init()` runs migration before any seed). *(2026-06-03)*
- [x] Migrate capture sites to `createItem()` — `add.tsx`, `screenshots.tsx`, `ChatBot.tsx` now construct via `createItem` (status/timestamps/defaults filled). *(2026-06-03)*
- [x] Remove production seeding — auto-seed is now `__DEV__`-only (`_layout.tsx`); removed auto-reseed-on-focus + shipped force-seed button (`index.tsx`). `seed.ts` retained as dev-only sample data. *(2026-06-03)*
- [ ] UI still reads legacy `viewed`/`bucketlist` booleans in screens; migrate reads to `status`/`location` opportunistically during Phase 3/4 (non-urgent — booleans retained).
- [ ] Decide global state approach (lightweight context/store) to fix cross-tab consistency vs current focus-reload.
- [ ] (Phase 3) Two-way calendar sync + timezone fix + offline behavior — tracked under Silo·Calendar below.

### Phase 3 — Feature hardening (one pass each: spec → state → gaps → build → verify)
- [ ] **Add/Capture:** stack picker + `stack_id` on save; AbortController + cancel on analysis; fix image-fail form; dedupe submit; clipboard paste; non-article link handling.
- [ ] **Share extension (NEW):** iOS Share Extension (App Group + `ExpoConfig` plugin) + Android `SEND`/`SEND_MULTIPLE` intent-filter; route shared url/text/image through the analyzer → lands in Stacks.
- [ ] **Stacks:** make stacks real (assign/move items, add/remove from stack detail); search empty-result semantics; Android-safe rename/create (replace `Alert.prompt`).
- [ ] **Streams:** detail navigation from feed; FlatList windowing for WebView memory; real empty state; inline action persistence; (roadmap) ElevenLabs voice-over.
- [ ] **Silo · Calendar:** FIX timezone off-by-one everywhere; **two-way device sync** (wire `updateScheduledEvent`/`deleteScheduledEvent`, dedupe/idempotency); real day view; honest feature set (drop or build month grid/drag).
- [ ] **Silo · Map:** Google Maps key (Android) or Apple provider on iOS; clustering; permission-denied/empty states; cache geocode results (stop re-geocoding on every focus).
- [ ] **Bucket List (NEW engine):** conditions model + background evaluation loop (geofence/time/calendar-free signals) + local notifications deep-linking to item; battery-conscious, properly permissioned. MVP + flag gaps if full automation infeasible.
- [ ] **AI Assistant (rebuild):** real retrieval (fix Vultr signing OR move to Cloudflare Vectorize/KV/D1); embed text+tags+OCR+location; ground answers in real items; tools (create event, mark done, add bucket list, open item); streaming; empty-KB state. MVP fallback documented if full RAG infeasible.
- [ ] **Screenshot Swipe:** real OCR (expo-text-recognition / ML Kit / Vision) → tags; correct iOS screenshot detection + correct mimeType; undo; batching; per-card progress; polished confirm/schedule flow; empty state.
- [ ] **Fix audio pipeline:** correct Vultr SigV4 (`x-amz-content-sha256`) + remove crashing data-URL fallback; or reconsider TTS scope.
- [ ] **Fix dead AI search route** (`/api/ai-search`) or remove the call.

### Phase 4 — UX/UI polish
- [ ] One design system (spacing/type/color/motion/components). Real empty/loading-skeleton/error states everywhere. In-context permission priming + onboarding (capture→schedule→act). Haptics, transitions, dark mode, a11y (Dynamic Type, contrast, VoiceOver). Human microcopy.

### Phase 5 — Monetization (free trial → mandatory subscription)
- [ ] Billing layer per founder answer (RevenueCat or StoreKit2/Play Billing). Paywall + entitlement checks that truly gate; locked state on expiry; restore purchases; server-side receipt validation; lapsed handling. **Trial length = single config constant, default 7 days.** Pricing constants. Analytics: paywall view / trial start / conversion. No fake premium flags.

### Phase 6 — App Store readiness
- [ ] Real usage strings (location incl. background, calendar, photos, notifications); ATT if needed; privacy nutrition label / data-safety (document data sent to Gemini/ElevenLabs/Vultr). Background-location + notifications entitlements/perms. Privacy Policy + ToS (mandatory for auto-renew). Subscription disclosure text on paywall. Icon/splash/screenshots/metadata/signing. TestFlight/internal build. Walk review guidelines (subscriptions, permissions, min functionality).

### Phase 7 — QA & regression
- [ ] Manual QA checklist (every flow, incl. empty account, no network, denied permissions, invalid URLs, missing location/images, large data, first run). Automated tests where stack allows (unit: data/AI logic; integration: pipelines; smoke: critical paths). Full regression. Nothing ships until acceptance criteria pass on real data.

---

## ✅ Done log
- 2026-06-03: Phase 0 stack discovery; full Phase 1 audit (3 subagents + lead spine read); verified no committed secret; mapped native config; established AUDIT.md / TODO.md / LAUNCH_REPORT.md.
- 2026-06-03: Founder decisions (iOS-first / RevenueCat / EAS / 7-day $6.99·$39.99). Phase 2 foundation: unified `Item` + bucket-list engine model (`lib/types.ts`), new `lib/items.ts` (createItem/normalizeItem/computeStatus/touchItem), storage migration/versioning + write-mutex + timestamp maintenance (`lib/storage.ts`). Additive, non-breaking, UNVERIFIED (no toolchain to compile).
- 2026-06-03: Phase 2 cleanup — boot migration wired + seeding gated to `__DEV__` (`_layout.tsx`); auto-reseed + dev force-seed button removed (`index.tsx`); capture→`createItem` (`add.tsx`, `screenshots.tsx`, `ChatBot.tsx`). P0 backend gate — `workers/middleware.ts` (shared-token auth + per-IP KV rate-limit + method/body-size), wired in `workers/index.ts`, client header in `lib/api.ts`, Env + wrangler.toml documented. UNVERIFIED (no toolchain).
- 2026-06-03 (on Mac): **Task Zero DONE** — got the app loading clean in the iOS simulator. reanimated already at SDK-54-compatible 4.1.7; real fixes were regenerating the stale `ios/Podfile.lock` (clean `pod install`, 102 pods) and installing the missing iOS 26.5 sim platform (`xcodebuild -downloadPlatform iOS`). Built + ran on iPhone 17 Pro (iOS 26.2): zero red screens, all 5 tabs verified, migration + dev-seed ran at runtime, `expo start -c` clean. **Task One DONE** — `npx tsc --noEmit` EXIT 0 after one fix (`tsconfig moduleResolution` `"node"`→`"bundler"`, was a TS5098 conflict with expo base's `customConditions`); Phase 2 schema/storage/items code is clean. Discovered: CocoaPods needs `LANG=en_US.UTF-8`; lint needs ESLint-9 flat-config migration (deferred).
- 2026-06-03 (on Mac): **Worker typecheck green** — `npm install` in `workers/` + fixed 11 blind-written TS errors (5 dead `OPTIONS` blocks removed, 2 `json()` assertions in `generate-embedding.ts`). `npx tsc --noEmit` EXIT 0. All blind-written code (app + worker) now compiles. Worker still needs live verification via `wrangler dev`/deploy + secrets (founder gate). Files touched: `tsconfig.json`, `workers/{analyze-image,analyze-link,generate-audio,instagram-download,suggest-schedule,generate-embedding}.ts`.
- 2026-06-03 (on Mac): **Founder config scaffolded** — generated a 64-char client token into a gitignored `.env`; created `.env.example`, `eas.json` (dev/preview/production EAS profiles), and `FOUNDER_SETUP.md` (full Cloudflare + EAS + Apple runbook with secret-safe commands). All code↔config wiring confirmed (`lib/api.ts` sends `X-Silo-Client`; `wrangler.toml` documents secrets + KV). Pending founder logins: Worker deploy URL, EAS `projectId`, Apple Team ID, and the 8 API secrets. `tsc` still EXIT 0.
- 2026-06-04 (on Mac): **Design system rollout started** (founder wants every screen made great). Added **NativeWind v4** (Tailwind-for-RN) + design tokens (`tailwind.config.js` brand/accent/ink scales), Reanimated-driven motion. Redesigned: **Stacks list cards** (`components/ItemCardPro.tsx` — gradient tiles, pills, soft shadows, staggered entrance + press-spring) and **Add/Capture screen** (`components/ui/OptionCard.tsx` + brand bg + header). Founder signed off on the card vibe; chose "keep cooking design." `tsc` EXIT 0, clean bundle, verified in sim. **Rollout still TODO:** Stacks chrome (search/filter/header), grid `CompactCard`, Streams, Silo (calendar/map/bucket), Screenshots swiper, item/stack detail, tab bar, global empty/loading/error states, haptics. NativeWind needs `expo start -c` after babel/metro config (no native rebuild).
- 2026-06-04 (on Mac): **Cost-reduction architecture pass** (near-zero monthly bill). Cut **ElevenLabs + Vultr** entirely — deps, env vars, worker routes, client calls, config, docs. Worker stripped to a SINGLE authenticated **Gemini proxy** (`workers/gemini.ts`; `index.ts` routes only `POST /api/gemini`; deleted analyze-image/analyze-link/suggest-schedule/generate-audio/generate-embedding/rag-query/instagram-download). `Env` = {GEMINI_API_KEY, APP_CLIENT_TOKEN?, RATE_LIMIT_KV?}. **SSRF removed** (worker no longer fetches URLs). Client `lib/api.ts` rewritten → `/api/gemini`; `aiSearch` now on-device keyword/tag only; assistant retrieval on-device (client passes relevant items). Voice parked behind `FEATURE_VOICE=false` in `lib/config.ts` (use Apple on-device Speech later). app + worker `tsc --noEmit` EXIT 0. Cost picture in LAUNCH_REPORT.md (≈ $0–1/mo).
  - **GAPS to revisit:** (a) voice narration parked — re-add via Apple on-device Speech (no paid TTS). (b) assistant no longer returns `suggestedEvent` (create-event-from-chat temporarily dropped; re-add to the `assistant` task). (c) screenshot OCR should move to Apple Vision (expo, on-device) — currently uses Gemini vision via the proxy. (d) `lib/instagram.ts downloadInstagramDirect` is now dead/uncalled — delete in a cleanup. (e) stale hackathon docs (README/SETUP/SETUP_CHECKLIST/HOW_IT_WORKS/QUICKSTART/BACKEND_SETUP/QUICK_EXPLANATION) still name ElevenLabs/Vultr — consolidate or delete.
