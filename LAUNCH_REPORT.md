# Silo — Launch Readiness Report

> Running status. Finalized at the end of the engagement. Pairs with [`AUDIT.md`](AUDIT.md) and [`TODO.md`](TODO.md).
> **Status as of 2026-06-03: 🔴 NOT launch-ready** — discovery + audit complete; remediation not yet started.

---

## 1. Launch-readiness scorecard

| Area | Status | Notes |
|---|---|---|
| Builds & runs (iOS) | ⬜ UNVERIFIED | No Mac/Xcode + no Node here. Needs EAS or a Mac. |
| Builds & runs (Android) | ⬜ UNVERIFIED | No Node/Android SDK confirmed here. |
| Type-check / lint clean | ⬜ UNVERIFIED | No Node toolchain on this machine — cannot run `tsc`/`eslint`. |
| Core navigation | 🟡 Likely works | 5 native tabs (static read); runtime UNVERIFIED. |
| Add / import / save | 🟡 Real, gaps | Works; no stack assignment; no cancel; image-fail strands form. |
| Persistence | 🟡 Hardened (uncompiled) | Added schema versioning + migration + write-mutex + auto `updated_at`/`completed_at` (`lib/items.ts`, `lib/storage.ts`). UNVERIFIED — no toolchain to type-check. |
| Stacks / categories | 🔴 Demo-only | User content can't be assigned to a stack. |
| Streams feed | 🟡 Real, gaps | No detail nav; WebView memory risk. |
| Screenshot swipe | 🟡 Real, gaps | No OCR/undo/dedupe; wrong iOS detection. |
| Calendar scheduling | 🔴 Buggy | Timezone off-by-one; one-way sync; duplicate events. |
| Map / location | 🟡 Conditional | Needs Google key (Android); no denied/empty state; geocode perf. |
| Bucket list (engine) | 🔴 Missing | Only booleans; no conditions/triggers/notifications. |
| AI assistant (RAG) | 🔴 Failed | Retrieval broken; degrades to prompt-stuffing; can hallucinate. |
| Share extension | 🔴 Missing | First-class deliverable; no native infra. |
| Monetization / paywall | 🔴 Missing | No IAP/RevenueCat dependency. |
| Backend security | 🟡 Gated (uncompiled) | Shared-token auth + per-IP rate limit + method/body-size added (`workers/middleware.ts`). SSRF in `analyze-link` still open; real attestation pending. Needs founder to set `APP_CLIENT_TOKEN`/KV. UNVERIFIED. |
| Committed secrets | 🟢 Clean | Verified via full git-history scan; keys server-side. |
| Permissions / privacy strings | 🟡 Partial | Generic strings; missing background-location + notifications config. |
| Privacy Policy / ToS | 🔴 Missing | Mandatory for auto-renew subscriptions. |
| Store assets / metadata | 🔴 Missing | Icon set/screenshots/description/keywords TBD. |

Legend: 🟢 ready · 🟡 partial/needs work · 🔴 blocker/missing · ⬜ unverified.

---

## 2. Top launch blockers (severity-ranked — detail in AUDIT.md)
1. **Unauthenticated backend** (quota theft / SSRF). 2. **Calendar timezone off-by-one + one-way sync + duplicate events.** 3. **Stacks demo-only** (no `stack_id` assignment). 4. **Seed/fake data ships in production.** 5. **RAG/assistant broken** (no real retrieval). 6. **Audio pipeline likely broken** (Vultr signing + crashing fallback). 7. **No paywall.** 8. **No share extension.** 9. **Bucket-list engine missing.** 10. **Native gaps** (background location, notifications, Android Maps key, share intents).

## 3. What's been done
- Phase 0 stack discovery + Phase 1 full audit (file-by-file, severity-ranked, feature-classified).
- Verified no committed secret. Mapped native config + Phase 6 gaps.
- **Phase 2 (closed):** unified `Item` schema + full bucket-list engine data model; new `lib/items.ts`; AsyncStorage schema versioning + one-time migration + concurrency mutex + automatic timestamps. Boot migration wired; **production seeding removed** (dev-only now); all capture sites build items via `createItem`.
- **Phase 3 P0 backend gate:** shared-token auth + per-IP rate limit + method/body-size middleware (`workers/middleware.ts`), client token header (`lib/api.ts`). Additive/non-breaking; UNVERIFIED (no compiler here) — app + worker typechecks pending.

## 4–8. (to be filled as work proceeds)
- **Improvements made / Files changed / Commands run + real results / Remaining blockers / App Store + subscription setup still needed** — TBD.

---

## Recommended config (provisional — confirm with founder)
- **Free trial:** 7 days (single config constant). **Pricing (proposed):** $6.99/mo or $39.99/yr (~52% off) — confirm.
- **AI model:** move off `gemini-2.0-flash-exp` to a stable Gemini model before launch.
- **Min OS:** confirm (Expo 54 ⇒ ~iOS 15.1 / Android 7+); `Info.plist` currently says iOS 12 (likely stale).

## Pre-submission risks (current)
- Cannot self-verify builds/runtime here (no Node/Mac) — needs founder device/CI or EAS.
- Auto-renew subscription requires Privacy Policy + ToS + disclosure copy (none yet).
- Instagram scraping may trigger App Review / legal issues.
