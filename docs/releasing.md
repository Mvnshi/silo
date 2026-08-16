# Releasing

> The account-level setup — Cloudflare, Expo/EAS and Apple — plus the App Store
> checklist. Everything code-side is already wired; this fills in the values and
> the cloud resources. For local development, see [`setup.md`](setup.md).
>
> Already in the repo: `.env.example`, `eas.json` (build profiles) and
> `wrangler.toml` (Worker config + a documented KV binding). Client↔Worker auth
> is wired end to end — the app sends `X-Silo-Client` (`lib/api.ts`) and the
> Worker validates it (`workers/middleware.ts`).
>
> Run all commands from the project root unless noted.

---

## 1. Cloudflare backend (`silo-api`)

**Prereq:** a Cloudflare account (free tier is fine).

- [ ] **Log in:** `npx wrangler login` (opens a browser; authorize).
      _wrangler is installed under `workers/`; from root `npx wrangler` will fetch it, or use the pinned copy with `cd workers && npx wrangler <cmd> --config ../wrangler.toml`._
- [ ] **Verify:** `npx wrangler whoami` → shows your account.

### 1a. Set the one API secret (your Gemini key — never commit it)
Silo uses exactly one external service: **Google Gemini**.
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
- [ ] `npx eas-cli init` — links the project and writes `extra.eas.projectId` into `app.json`. Let it write `app.json` so EAS builds stay reproducible.
- [ ] First dev build for the simulator (validates the EAS pipeline; profiles are already in `eas.json`):
      `npx eas-cli build --profile development --platform ios`

> RevenueCat (Phase 5) is a native module — it will be scaffolded in code but can
> only be verified on an EAS **dev build** + an App Store Connect **sandbox tester**,
> not in Expo Go. That's the flagged verification gate.

---

## 3. Apple Developer (for TestFlight + IAP)

**Prereq:** Apple Developer Program membership ($99/yr) — required for TestFlight,
push, and auto-renewable subscriptions.

- [ ] Note the **Team ID** from the developer portal.
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


## 5. Launch checklist

Code-side work is done; these are the account and asset gates. Each row says what
it unblocks.

| # | Action | Cost | Unblocks |
|---|---|---|---|
| 1 | **Google AI Studio** → create Gemini API key → `cd workers && npx wrangler secret put GEMINI_API_KEY --config ../wrangler.toml` | free tier | Real AI classify/extract/assistant in prod |
| 2 | **Cloudflare** account → `npm run deploy` (in `workers/`) → put the printed URL into `.env` `EXPO_PUBLIC_API_BASE_URL` | $0 (free tier) | The production backend |
| 3 | Same shell: `npx wrangler secret put APP_CLIENT_TOKEN --config ../wrangler.toml` (paste the value from `.env` `EXPO_PUBLIC_CLIENT_TOKEN`) | $0 | Locks the Worker to your app |
| 4 | `npx wrangler kv namespace create RATE_LIMIT_KV` → paste id into `wrangler.toml` (uncomment block) → redeploy | $0 | Per-IP rate limiting in prod |
| 5 | **Apple Developer Program** enrollment ($99/yr) → put your **Team ID** into `app.json` → `ios.appleTeamId` | $99/yr | Device builds, TestFlight, App Store, Share-Extension App Group on real devices |
| 6 | **App Store Connect**: create the app record (bundle `com.silo.app`), reserve the name "Silo" | — | TestFlight + submission |
| 7 | **Expo/EAS** account → `npx eas init` → `npx eas build --platform ios --profile production` | free tier OK | Reproducible cloud builds (no local Xcode needed) |
| 8 | **Support email + privacy policy URL** (App Review requires both; `SUPPORT_EMAIL` in `lib/config.ts` is a placeholder — set the real one). Host the privacy policy anywhere public (GitHub Pages works). | $0 | Passing App Review |
| 9 | **App Store assets**: `assets/icon.png` is a serviceable v1; a designer pass is worth it before launch. Screenshots: 6.7" + 6.5" sets (capture from the sim). | $0–ish | Store listing |
| 10 | **Pricing**: launch free to build the resurfacing habit first, or enable the $6.99/mo · $39.99/yr config (RevenueCat account + StoreKit products) | — | Revenue path |
| 11 | (Android later) Google Maps API key + Play Console — explicitly deferred; iOS-first. | — | Android release |

**Domain note:** point the apex at the landing page and privacy policy, and
consider a subdomain such as `api.silo.pro` as a custom domain for the Worker —
Cloudflare makes that one click.

---

## 6. Accounts (optional)

Accounts are off until you configure them. With the two env vars blank the app
runs exactly as it always has — fully on-device, no account surface anywhere,
sync by pairing code. This section turns on `docs/sync.md`'s **Mode 2**.

**What the identity provider sees:** an email address and a user id. Nothing
else. Saves — titles, URLs, screenshots, notes, tags — go to *your* Worker and
D1, keyed by `spaceKey = user.id`. Swapping providers later means changing one
file (`lib/auth.ts`), not migrating anyone's library.

### 6a. Create the project

- [ ] Create a free project at https://supabase.com — you are using **Auth
      only**, so the database and storage quotas are irrelevant.
- [ ] Project Settings → API: copy the **Project URL** and the **anon public**
      key into the app's `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

The anon key is a public client key — it is safe in the app bundle, and every
table is protected by row-level security regardless (we create no tables).

### 6b. Tell the Worker how to verify a session

The Worker refuses a bearer token it cannot check, so give it the same project:

```sh
cd workers
npx wrangler secret put SUPABASE_URL              --config ../wrangler.toml
npx wrangler secret put SUPABASE_ANON_KEY         --config ../wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config ../wrangler.toml
```

`SUPABASE_SERVICE_ROLE_KEY` is **server-only** and exists solely so
`DELETE /api/account` can erase a user. It must never appear in the app, the
extension, or git. Without it, account deletion returns a clean "not configured"
message instead of failing silently.

### 6c. Sign in with Apple

Required by App Review as soon as you offer any third-party sign-in.

- [ ] Apple Developer portal → Certificates, Identifiers & Profiles → your App
      ID → enable **Sign in with Apple**.
- [ ] Supabase → Authentication → Providers → Apple → enable. For the *native*
      iOS flow you only need the bundle id (`com.silo.app`) in the Client IDs
      field — the app uses `expo-apple-authentication` with a nonce, not the web
      OAuth flow, so **there is no 6-monthly secret to rotate**.
- [ ] `app.json` already declares the `expo-apple-authentication` plugin;
      re-run `npx expo prebuild -p ios --clean` after enabling the capability.

### 6d. Google (optional)

- [ ] Google Cloud console → OAuth consent screen → Credentials → create an
      **OAuth client**.
- [ ] Supabase → Authentication → Providers → Google → paste the client id and
      secret.
- [ ] Supabase → Authentication → URL Configuration → add the app's redirect:
      `silo://auth/callback` (and the Expo Go form while developing).

### 6e. Email codes

- [ ] Supabase → Authentication → Providers → Email → enable, and **turn off
      "Confirm email"** — Silo uses a six-digit OTP, not a magic link, so the
      confirmation step would strand the user.
- [ ] Free tier email is rate-limited and fine for testing. Before launch, set a
      real SMTP provider under Authentication → SMTP Settings, or codes will
      quietly stop arriving at volume.

### 6f. Requiring accounts (only if you want to)

Everything above leaves accounts **optional**. To make the public deployment
account-only, set `REQUIRE_AUTH = "true"` in `wrangler.toml` and redeploy: the
Worker then rejects sync without a valid session. The app itself still works
offline and on-device — this gates *sync*, not the product.
