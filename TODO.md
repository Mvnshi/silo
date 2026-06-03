# Silo — Master TODO & Cross-Session Memory

> **This is the resume point for every session.** Re-read this + [`AUDIT.md`](AUDIT.md) + [`LAUNCH_REPORT.md`](LAUNCH_REPORT.md) before doing anything. Keep this file in sync constantly.

---

## ⏯️ RESUME HERE (state as of 2026-06-03)

- **Phase 0 (stack discovery): ✅ DONE** — see AUDIT.md "Phase 0".
- **Phase 1 (full audit): ✅ DONE** — every meaningful source file read; severity-ranked issues + feature classification in AUDIT.md.
- **Founder decisions received (2026-06-03):** **iOS-first** · billing via **RevenueCat** · **EAS cloud builds** (founder connects Expo account) · **7-day trial, $6.99/mo / $39.99/yr** (built as config constants).
- **Currently:** **Phase 2 closed + P0 backend gate done. Awaiting founder typecheck of the app before building further on it (per instruction: don't get >1 phase ahead of a build).**
  - Phase 2: unified schema + bucket-list model + migration + storage race-fix (`types.ts`, `items.ts`, `storage.ts`); boot migration wired; seeding dev-only; capture→`createItem`.
  - P0 backend: auth + rate-limit middleware (`workers/middleware.ts` + `index.ts` + `api.ts` header).
  - **UNVERIFIED** (no Node/Mac here): app needs `npm run type-check`; worker needs `cd workers && npx tsc --noEmit` or `wrangler deploy`.
  - Watch items for typecheck: `__DEV__` global in `_layout.tsx`; `apiHeaders()` in `api.ts`; `KVNamespace` type in `workers/types.ts`.
- **Next action when resuming (after typecheck passes):** SSRF hardening in `analyze-link`/`instagram-download` (backend, independent), THEN Phase 3 calendar (timezone fix + two-way device sync) — calendar is app-side so it waits for the green build. EAS `eas.json` needs founder's Expo `projectId`.

### ⚠️ Hard environment constraints (VERIFIED — do not forget)
- **No Node.js on this machine** (no node/npm/npx, no nvm/fnm/volta/scoop/choco/winget, no bun/deno). → **Cannot** run `tsc`, `eslint`, tests, `expo`, `wrangler`, or any build/app run here.
- **No macOS/Xcode/iOS Simulator** (Windows host). → **Cannot** build/run iOS here.
- **Consequence:** all code is "correct by inspection"; mark runtime/build results **UNVERIFIED** until run on a Node-equipped machine (+ Mac or EAS for iOS). Never report a fake passing build.

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
- [x] Gate backend: shared-token auth (`X-Silo-Client` ↔ `APP_CLIENT_TOKEN`), method + 8MB body-size checks. New `workers/middleware.ts`, wired in `workers/index.ts`; client sends header via `lib/api.ts` `apiHeaders()`. CORS left permissive on purpose (native sends no Origin). *(2026-06-03, UNVERIFIED — worker needs `wrangler` typecheck/deploy)*
- [x] Rate limiting: per-IP fixed-window (60 req/60s) via optional `RATE_LIMIT_KV`; fails open if unbound. `workers/middleware.ts`. *(2026-06-03)*
- [ ] **Real attestation** (App Attest / Play Integrity) — the shared token is extractable from the bundle; this is the proper fix. Phase 6 hardening.
- [ ] SSRF allowlist + block private/non-http(s) in `analyze-link` & `instagram-download`; `redirect:'manual'`. **← next backend item.**
- [ ] Scheme-allowlist `Linking.openURL` (http/https only). `item/[id].tsx:235`.
- [ ] Stop leaking upstream provider error text in 500 `details` (all handlers).
- [ ] Sanitize `itemId`/`userId` before using in S3 keys.
- [ ] Lock down WebView (`originWhitelist`, disable mixed content) or replace IG embed. `StreamCard.tsx`.

> **⚙️ Founder config needed for the new backend gate:** (1) `wrangler secret put APP_CLIENT_TOKEN` and set `EXPO_PUBLIC_CLIENT_TOKEN` to the same value in the app `.env`; (2) `wrangler kv:namespace create RATE_LIMIT_KV` → paste id into `wrangler.toml` and uncomment the binding. Until (1) is set the endpoints stay open (fail-open) so nothing breaks mid-rollout.

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
