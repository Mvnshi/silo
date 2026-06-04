# Silo — Founder Setup Runbook

> Account-level config that only you can do (it needs your Cloudflare / Expo /
> Apple logins). Everything code-side is already scaffolded and wired; this fills
> in the **values + cloud resources**. Pairs with `AUDIT.md` / `TODO.md` / `LAUNCH_REPORT.md`.
>
> **Already done for you (code-side, committed):**
> - `.env` created locally (gitignored) with a freshly generated 64-char `EXPO_PUBLIC_CLIENT_TOKEN`.
> - `.env.example` (template), `eas.json` (build profiles), `wrangler.toml` (worker config + documented KV binding).
> - Client↔worker auth is wired: app sends `X-Silo-Client` (`lib/api.ts`), worker validates it (`workers/middleware.ts`).
>
> Run all commands from the **project root** unless noted. Check items off as you go.

---

## 1. Cloudflare backend (`silo-api`)

**Prereq:** a Cloudflare account (free tier is fine).

- [ ] **Log in:** `npx wrangler login` (opens a browser; authorize).
      _wrangler is installed under `workers/`; from root `npx wrangler` will fetch it, or use the pinned copy with `cd workers && npx wrangler <cmd> --config ../wrangler.toml`._
- [ ] **Verify:** `npx wrangler whoami` → shows your account.

### 1a. Set the one API secret (your Gemini key — never commit it)
Silo uses exactly ONE external service: **Google Gemini**. (ElevenLabs + Vultr
were removed — they were sponsor prizes, not requirements; see LAUNCH_REPORT.md.)
Grab a free key at https://aistudio.google.com/apikey, then:
- [ ] `npx wrangler secret put GEMINI_API_KEY`  — prompts for the value; paste your key.

### 1b. Set the app gate token (matches the app's `.env`, no copy-paste needed)
- [ ] Pipe the value straight from `.env` so it never hits your clipboard or shell history:
      ```sh
      grep '^EXPO_PUBLIC_CLIENT_TOKEN=' .env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put APP_CLIENT_TOKEN
      ```
      Once this is set, every `/api/*` request without a matching `X-Silo-Client` header is rejected (401). Until it's set, the backend logs `UNAUTHENTICATED` and fails **open** so nothing breaks mid-rollout.

### 1c. Per-IP rate limiting (KV)
- [ ] Create the namespace: `npx wrangler kv namespace create RATE_LIMIT_KV`
- [ ] Paste the returned `id` into `wrangler.toml` and **uncomment** the binding block:
      ```toml
      [[kv_namespaces]]
      binding = "RATE_LIMIT_KV"
      id = "<paste-id-here>"
      ```
      (Without this binding the limiter is simply skipped — safe, just unlimited.)

### 1d. Deploy + wire the URL back into the app
- [ ] `npx wrangler deploy` → note the printed URL (e.g. `https://silo-api.<subdomain>.workers.dev`).
- [ ] Put that URL in `.env` as `EXPO_PUBLIC_API_BASE_URL=…`.
- [ ] **Smoke-test the gate** (should be **401** without the header once `APP_CLIENT_TOKEN` is set):
      ```sh
      curl -s -o /dev/null -w "%{http_code}\n" -X POST https://silo-api.<subdomain>.workers.dev/api/suggest-schedule -d '{}'
      ```
- [ ] Rebuild the app so Expo inlines the new `.env` (`npx expo start -c`, then reload).

---

## 2. EAS (Expo Application Services) — cloud builds

**Prereq:** a free Expo account. Needed for TestFlight builds and for any native
module that can't run in Expo Go (RevenueCat in Phase 5).

- [ ] `npx expo login` (or `npx eas-cli login`).
- [ ] `npx eas-cli init` — links the project and writes `extra.eas.projectId` into `app.json`. **Tell me the projectId** (or just let it write app.json) so EAS builds are reproducible.
- [ ] First dev build for the simulator (validates the EAS pipeline; profiles are already in `eas.json`):
      `npx eas-cli build --profile development --platform ios`

> RevenueCat (Phase 5) is a native module — it will be scaffolded in code but can
> only be verified on an EAS **dev build** + an App Store Connect **sandbox tester**,
> not in Expo Go. That's the flagged verification gate.

---

## 3. Apple Developer (for TestFlight + IAP)

**Prereq:** Apple Developer Program membership ($99/yr) — required for TestFlight,
push, and auto-renewable subscriptions.

- [ ] Confirm enrollment status and your **Team ID**.
- [ ] Bundle ID is already `com.silo.app` (`app.json`) — register it in the Apple Developer portal (or let EAS create it during the first build).
- [ ] Later (Phase 5/6): create the subscription products in App Store Connect
      (`silo_monthly` $6.99 / `silo_yearly` $39.99, 7-day trial) and a RevenueCat project + entitlement `premium`.

---

## 4. iOS Share Extension — build & test ("Share → Silo")

The native share extension (Share from Safari/Instagram/TikTok/X/Reddit/Photos →
"Add to Silo") is built + wired (via `@bacons/apple-targets`) but **cannot run in
Expo Go** — it needs a dev build. Verified so far: `expo prebuild` generates the
`share.appex` target and the Swift type-checks clean. To build + test it:

- [ ] **Install deps:** `npm install`. (The repo `.npmrc` sets `legacy-peer-deps=true`
      — required for `@bacons/apple-targets` on this RN 0.81 / React 19 / SDK 54
      stack — and pins a top-level `@expo/prebuild-config` so the plugin resolves.)
- [ ] **Add your Apple Team ID** to `app.json` as `ios.appleTeamId` (10-char ID from
      the Apple Developer portal / Xcode). apple-targets needs it to sign the
      extension on device/EAS builds (simulator builds don't).
- [ ] **Register the App Group** `group.com.silo.app` under your App ID in the Apple
      Developer portal → Identifiers → App Groups (device/EAS only; sim doesn't need it).
- [ ] **Regenerate native project:** `npx expo prebuild -p ios --clean`.
- [ ] **Build a dev build** — either local: `npx expo run:ios` (simulator or a
      USB device), or cloud: `eas build --profile development --platform ios` then
      install on a device.
- [ ] **Test (acceptance):** open Safari / Instagram / TikTok / X / Reddit → Share →
      **Add to Silo** → the confirmation sheet (preview + category) → **Add to Silo** →
      the item should appear in **Stacks**. Verify from at least 3 different apps.

> How it works: the extension hands the shared URL/text/image to the app via a
> `silo://share?...` deep link; `app/share.tsx` runs the SAME extractor + Gemini
> classify pipeline as in-app capture (so shared items get title/author/thumbnail +
> category/tags + an inline embed). Shared images travel through the App Group.

## What I need back from you to proceed deeper
1. The **Worker URL** (after deploy) — unblocks live backend verification.
2. The **EAS `projectId`** (after `eas init`) — unblocks reproducible cloud builds.
3. **Apple Team ID** + enrollment status — unblocks TestFlight/IAP setup.
4. Confirmation the **Gemini API key** is set (the only one now) — unblocks AI ingestion + assistant verification.

Until then I'll keep moving on everything that doesn't require these (SSRF
hardening, calendar fix, feature hardening) and flag each gate as I reach it.
