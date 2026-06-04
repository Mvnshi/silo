# Silo — Launch Readiness Report

> Running status. Finalized at the end of the engagement. Pairs with [`AUDIT.md`](AUDIT.md) and [`TODO.md`](TODO.md).
> **Status as of 2026-06-03: 🔴 NOT launch-ready** — but now building/running/typechecking on a real Mac. Task Zero (app loads clean in sim, zero red screens, all 5 tabs) ✅ and Task One (Phase 2 `tsc --noEmit` EXIT 0) ✅ both verified. Remediation of the Phase 3+ feature blockers not yet started.

---

## 1. Launch-readiness scorecard

| Area | Status | Notes |
|---|---|---|
| Builds & runs (iOS) | 🟢 VERIFIED (sim) | Builds + runs on iPhone 17 Pro (iOS 26.2) sim, zero red screens. Fixes: regenerated stale Podfile.lock; installed iOS 26.5 sim platform. EAS/device build still pending founder Expo projectId. |
| Builds & runs (Android) | ⬜ UNVERIFIED | iOS-first; Android deferred. |
| Type-check clean | 🟢 VERIFIED | `npx tsc --noEmit` EXIT 0 (after `tsconfig moduleResolution`→`bundler` fix). |
| Lint clean | 🟡 Blocked | ESLint 9 needs flat `eslint.config.js` (none) + `eslint-config-expo`; `npm run lint` errors. Deferred to QA. |
| Core navigation | 🟢 VERIFIED | All 5 native tabs (Streams/Stacks/Add/Silo/Screenshots) tapped + render clean at runtime. |
| Add / import / save | 🟡 Real, gaps | Works; no stack assignment; no cancel; image-fail strands form. |
| Persistence | 🟢 Hardened + verified | Schema versioning + migration + write-mutex + auto `updated_at`/`completed_at` (`lib/items.ts`, `lib/storage.ts`). Type-checks clean; migration ran at runtime (`storage migrated 0 -> 2`) and seeded items render. |
| Stacks / categories | 🔴 Demo-only | User content can't be assigned to a stack. |
| Streams feed | 🟡 Real, gaps | No detail nav; WebView memory risk. |
| Screenshot swipe | 🟡 Real, gaps | No OCR/undo/dedupe; wrong iOS detection. |
| Calendar scheduling | 🔴 Buggy | Timezone off-by-one; one-way sync; duplicate events. |
| Map / location | 🟡 Conditional | Needs Google key (Android); no denied/empty state; geocode perf. |
| Bucket list (engine) | 🔴 Missing | Only booleans; no conditions/triggers/notifications. |
| AI assistant (RAG) | 🔴 Failed | Retrieval broken; degrades to prompt-stuffing; can hallucinate. |
| Social link extractor | 🟢 Built + verified | **Part B.1 DONE:** universal Worker `extract` (oEmbed + OG via HTMLRewriter, egress-hardened) → Gemini classify → normalized item; token-free inline embeds. Verified via `wrangler dev` + real curl; app+worker `tsc` EXIT 0; `expo export` clean; sim relaunched. Full in-app demo gated on deployed Worker URL. |
| Share extension | 🟡 Building | **Part B.2:** native iOS Share Extension (App Group + config plugin) — scaffolding; needs an EAS dev build to test (not Expo Go). |
| Monetization / paywall | 🔴 Missing | No IAP/RevenueCat dependency. |
| Backend security | 🟡 Gated + minimized (typecheck ✅, not deployed) | Worker stripped to ONE endpoint (`POST /api/gemini`) behind shared-token auth + per-IP rate limit + body-size (`workers/middleware.ts`); worker `tsc` EXIT 0. **SSRF removed** (worker no longer fetches URLs). ElevenLabs/Vultr/Instagram-scraper deleted. Real attestation still pending; needs founder `APP_CLIENT_TOKEN` + deploy. |
| Committed secrets | 🟢 Clean | Verified via full git-history scan; keys server-side. |
| Permissions / privacy strings | 🟡 Partial | Generic strings; missing background-location + notifications config. |
| Privacy Policy / ToS | 🔴 Missing | Mandatory for auto-renew subscriptions. |
| Store assets / metadata | 🔴 Missing | Icon set/screenshots/description/keywords TBD. |

Legend: 🟢 ready · 🟡 partial/needs work · 🔴 blocker/missing · ⬜ unverified.

---

## 2. Top launch blockers (severity-ranked — detail in AUDIT.md)
1. **Unauthenticated backend** (quota theft / SSRF). 2. **Calendar timezone off-by-one + one-way sync + duplicate events.** 3. **Stacks demo-only** (no `stack_id` assignment). 4. **Seed/fake data ships in production.** 5. **RAG/assistant broken** (no real retrieval). 6. **Audio pipeline likely broken** (Vultr signing + crashing fallback). 7. **No paywall.** 8. **No share extension.** 9. **Bucket-list engine missing.** 10. **Native gaps** (background location, notifications, Android Maps key, share intents).

## 3. What's been done
- **Task Zero (2026-06-03, on Mac) — app loads clean.** reanimated already at SDK-54 4.1.7; real blockers were a stale `Podfile.lock` (regenerated via clean `pod install`) and the missing iOS 26.5 simulator platform (installed via `xcodebuild -downloadPlatform iOS`). Verified: builds + runs on iPhone 17 Pro (iOS 26.2), zero red screens, all 5 tabs render, `expo start -c` clean.
- **Task One (2026-06-03) — Phase 2 typecheck green.** `npx tsc --noEmit` EXIT 0 after fixing a `tsconfig` `moduleResolution` conflict (`"node"`→`"bundler"`, TS5098 vs expo base's `customConditions`). Phase 2 schema/storage/items code is clean; migration + `__DEV__`-only seed + `createItem` capture paths confirmed at runtime.
- Phase 0 stack discovery + Phase 1 full audit (file-by-file, severity-ranked, feature-classified).
- Verified no committed secret. Mapped native config + Phase 6 gaps.
- **Phase 2 (closed):** unified `Item` schema + full bucket-list engine data model; new `lib/items.ts`; AsyncStorage schema versioning + one-time migration + concurrency mutex + automatic timestamps. Boot migration wired; **production seeding removed** (dev-only now); all capture sites build items via `createItem`.
- **Phase 3 P0 backend gate:** shared-token auth + per-IP rate limit + method/body-size middleware (`workers/middleware.ts`), client token header (`lib/api.ts`). Additive/non-breaking; UNVERIFIED (no compiler here) — app + worker typechecks pending.
- **Social Extraction — Part A research (2026-06-04, verified):** live-probed every platform's free extraction path (YouTube/TikTok/X oEmbed = 200 + no auth; IG/Reddit/Threads/FB = OG tags; IG legacy oEmbed dead / Meta oEmbed token-gated) + Apple's verbatim 5.2.3/5.2.2/4.2 text. **CTO call: ship Tier-1, keep Tier-2 download off behind a flag.** Build plan speced in TODO "🔗 Social Extraction"; founder check-in before Part B build.

## 4–8. (to be filled as work proceeds)
- **Improvements made / Files changed / Commands run + real results / Remaining blockers / App Store + subscription setup still needed** — TBD.

---

## 💸 Cost picture — near-zero monthly bill (cost-reduction pass, 2026-06-04)

ElevenLabs and Vultr were sponsor prizes, not requirements — both **removed entirely**
(deps, env vars, worker routes, client calls, docs). The Worker is now a single
authenticated **Gemini proxy** (`POST /api/gemini`) and nothing else; its only reason
to exist is keeping the Gemini key off the client. Everything else runs on-device, free.

| Service | Role | Tier | Realistic monthly cost (low usage) |
|---|---|---|---|
| **Cloudflare Workers** | Hosts the Gemini proxy (key server-side) | Free: 100k req/day | **$0** (a solo app is a few hundred req/day) |
| **Cloudflare KV** (optional) | Per-IP rate-limit counters | Free: 100k reads / 1k writes/day | **$0** |
| **Google Gemini** `gemini-2.0-flash` | classify image/link, suggest schedule, assistant | Pay-per-use (free dev tier too) | **cents** — ~$0.075/1M input + $0.30/1M output tokens → a few hundred analyses is well under **$1/mo** |
| **RevenueCat** | Subscriptions (Phase 5) | Free until $2.5k/mo tracked revenue | **$0** until you earn |
| Apple Developer | TestFlight + IAP | $99/yr | ~$8/mo amortized (required to ship; not usage) |
| ~~ElevenLabs~~ | ~~TTS~~ | **REMOVED** | $0 |
| ~~Vultr Object Storage~~ | ~~audio + embeddings~~ | **REMOVED** | $0 |

**Bottom line:** Cloudflare free-tier + Gemini pay-per-use (pennies) + RevenueCat
free-until-revenue → steady-state ≈ **$0–1/month** plus the $99/yr Apple membership.

**On-device & free** (no service, no bill): AsyncStorage for all saved data;
keyword+tag retrieval for the assistant (no vector DB); and the roadmap on-device
paths — Apple Vision OCR for screenshot text, expo-location geofencing for
bucket-list triggers, expo-notifications for local notifications, and Apple's
on-device Speech framework if voice is ever turned on (flag in `lib/config.ts`,
default off). Only the Gemini proxy touches the network.

---

## Recommended config (provisional — confirm with founder)
- **Free trial:** 7 days (single config constant). **Pricing (proposed):** $6.99/mo or $39.99/yr (~52% off) — confirm.
- **AI model:** move off `gemini-2.0-flash-exp` to a stable Gemini model before launch.
- **Min OS:** confirm (Expo 54 ⇒ ~iOS 15.1 / Android 7+); `Info.plist` currently says iOS 12 (likely stale).

## Pre-submission risks (current)
- Cannot self-verify builds/runtime here (no Node/Mac) — needs founder device/CI or EAS.
- Auto-renew subscription requires Privacy Policy + ToS + disclosure copy (none yet).
- Instagram scraping may trigger App Review / legal issues.
