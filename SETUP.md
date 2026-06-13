# Silo — Setup Guide (from a fresh clone)

Everything you need to run Silo with **only the repo**, two ways:

- **Track A — Personal:** everything on your Mac + your phone. No cloud, no accounts, **$0**. Start here.
- **Track B — Public:** deploy so friends / strangers can download and use it.

> Background reading (optional): [`SYNC.md`](SYNC.md) explains the sync design and the three modes; [`README.md`](README.md) is the architecture overview; [`FOUNDER_SETUP.md`](FOUNDER_SETUP.md) is the App-Store launch checklist.

Silo has **three parts**: the **phone app** (Expo/React Native), the **Worker** (Cloudflare — the AI proxy + sync server), and the **browser extension**. They all talk to the one Worker.

---

## 0. Prerequisites

| You need | For | Get it |
|---|---|---|
| **macOS + Xcode** (with an iOS Simulator) | building the iPhone app | App Store → Xcode → open once to install the iOS platform |
| **Node 20+** (22 recommended) | everything | `nvm install 22` or nodejs.org |
| **Git** | cloning | preinstalled on macOS |
| **A Google Gemini API key** *(optional but recommended)* | AI titles/tags/scheduling | [aistudio.google.com](https://aistudio.google.com) → free tier. Without it the app still works (heuristic fallback). |
| **A Cloudflare account** *(Track B only)* | hosting the Worker publicly | free tier — dash.cloudflare.com |
| **Apple Developer ($99/yr)** *(Track B, iOS distribution)* | TestFlight / App Store | developer.apple.com |

---

## 1. Clone & install (both tracks)

```bash
git clone <your-repo-url> silo
cd silo

npm install                       # phone app (root). .npmrc handles RN/React peer deps
(cd workers && npm install)       # the Worker
(cd extension && npm install)     # the browser extension
```

---

# Track A — Personal (local, free)

You'll run the Worker on your Mac and point your phone + browser at it. Nothing leaves your machine/LAN.

### A1 · Start the Worker (AI + sync server)

Create the local secrets file at the **repo root** (gitignored — never committed):

```bash
# from the repo root
cat > .dev.vars <<EOF
GEMINI_API_KEY=PASTE_YOUR_GEMINI_KEY_HERE
APP_CLIENT_TOKEN=$(openssl rand -hex 32)
EOF
cat .dev.vars        # copy the APP_CLIENT_TOKEN value — you'll reuse it in A2 & A3
```

> No Gemini key? Omit that line — extraction falls back to heuristics and the app still runs.

Run it (leave this terminal open):

```bash
cd workers
npm run dev                                   # → http://127.0.0.1:8787  (Simulator can reach this)
# Testing on a REAL iPhone instead of the Simulator? Expose it to your Wi-Fi:
#   npx wrangler dev --config ../wrangler.toml --ip 0.0.0.0
# then use your Mac's LAN IP (System Settings → Wi-Fi → Details → IP, e.g. 192.168.1.20)
```

The sync database (D1/SQLite) is created automatically under `.wrangler/` — no setup.

### A2 · Run the phone app

Create `.env` at the repo root (copy from the template, then fill in):

```bash
cp .env.example .env
```

```ini
# .env  — Simulator:
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8787
# …or on a REAL iPhone, your Mac's LAN address instead:
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:8787

EXPO_PUBLIC_CLIENT_TOKEN=<the APP_CLIENT_TOKEN you generated in A1>
```

Build & launch (first run compiles the native app — a few minutes):

```bash
npx expo run:ios
```

That installs a dev build on the Simulator and starts Metro. Later launches: just `npm start` and press `i`.

> **Share-into-Silo extension (iOS):** to get the "Share → Silo" sheet, set `ios.appleTeamId` in `app.json`, then `npx expo prebuild -p ios --clean && npx expo run:ios`. (Not required to use the app; only for the share sheet.)

### A3 · Load the browser extension

```bash
cd extension
cat > .env.local <<EOF
WXT_SILO_API_BASE_URL=http://127.0.0.1:8787
WXT_SILO_CLIENT_TOKEN=<the same APP_CLIENT_TOKEN>
EOF
npm run build                  # outputs .output/chrome-mv3
```

Then in Chrome/Brave/Edge:
1. Go to `chrome://extensions` (or `brave://extensions`).
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select `silo/extension/.output/chrome-mv3`.
4. Pin Silo. Press **⌘⇧S** on any page to save it; **⌘⇧K** for the quick-note overlay.

> Prefer hot-reload while developing the extension? `npm run dev` instead of `build`, then load `.output/chrome-mv3` the same way. Firefox: `npm run build:firefox` → load `.output/firefox-mv2`.

### A4 · Pair them (turn on sync)

1. **Phone** → Silo tab is the feed; go to **Settings** (person icon, top-right of Stacks) → **Sync across devices**:
   - Copy the **Space code**.
   - Set **Server URL** to match your `.env` (`http://127.0.0.1:8787`, or your LAN IP on a real phone).
   - Tap **Sync now** → it pushes your library.
2. **Extension** → open the library (grid icon in the popup) → the **"Set up sync"** chip → paste the **same Space code** + the **same Server URL** → **Save & Sync now**.

Now a save on either device shows up on the other within a second or two. ✅ That's the whole personal setup.

---

# Track B — Public (deploy for others)

Same code; you host the Worker on Cloudflare and distribute the apps. Do Track A first to confirm it all works locally — Track B is just "swap localhost for a deployed URL."

### B1 · Deploy the Worker to Cloudflare

```bash
npm install -g wrangler        # or use npx wrangler everywhere
wrangler login                 # opens the browser to authorize

cd workers

# 1) Create the sync database, then paste the printed database_id into ../wrangler.toml
npx wrangler d1 create silo-sync --config ../wrangler.toml
#   → edit wrangler.toml: under [[d1_databases]] set  database_id = "<the id it printed>"

# 2) Secrets (production — NOT .dev.vars):
npx wrangler secret put GEMINI_API_KEY   --config ../wrangler.toml      # paste your key
npx wrangler secret put APP_CLIENT_TOKEN --config ../wrangler.toml      # paste a strong token (openssl rand -hex 32)

# 3) (optional) abuse rate-limiting via KV:
npx wrangler kv namespace create RATE_LIMIT_KV
#   → uncomment the [[kv_namespaces]] block in wrangler.toml and paste the id

# 4) Ship it
npm run deploy                 # → prints https://silo-api.<your-subdomain>.workers.dev
```

### B2 · Point the clients at the deployed URL

- **Phone** `.env`: `EXPO_PUBLIC_API_BASE_URL=https://silo-api.<your-subdomain>.workers.dev` (+ the same `EXPO_PUBLIC_CLIENT_TOKEN` you set as `APP_CLIENT_TOKEN`).
- **Extension** `extension/.env.local`: `WXT_SILO_API_BASE_URL=https://silo-api.<your-subdomain>.workers.dev` (+ the same token). Then `npm run build` (or `npm run zip` for distribution).

Now sync works over the public internet — users leave the Server URL field default (it's baked from the env) and just pair with their own Space code.

### B3 · Distribute the apps

- **iOS app:** needs Apple Developer ($99/yr). The reproducible path is EAS:
  ```bash
  npx eas init            # one-time, links an Expo project
  npx eas build -p ios --profile production
  ```
  Then submit to **TestFlight** (friends) → **App Store** (public). Full checklist: [`FOUNDER_SETUP.md §5`](FOUNDER_SETUP.md).
- **Browser extension:**
  ```bash
  cd extension && npm run zip      # → .output/silo-extension-<v>-chrome.zip
  ```
  Upload to the **Chrome Web Store** ($5 one-time dev fee) / Edge Add-ons (free) / Firefox AMO (free `npm run zip` of the firefox build). Or just hand people the zip + the "Load unpacked" steps from A3.

### B4 · How "public users" actually work today — read this

- Each person installs the app + extension, opens **Settings → Sync**, generates their **own Space code**, and pairs their phone + browser with it. Their data lives in its **own isolated space** in your D1. Strangers can't see each other's saves (different codes).
- The `APP_CLIENT_TOKEN` is shared (baked into the build) — it gates *anonymous abuse* of your Worker, not per-user identity.
- **Real accounts** (email/password login, `REQUIRE_AUTH` enforcement, per-account spaces) are the **documented next step — not built yet** (see [`SYNC.md`](SYNC.md) milestone **S4**). For friends and early users, per-person pairing codes work today. Build S4 before opening to true public scale where you don't want to share one client token.

### B5 · What it costs

| Thing | Tier | Realistic cost |
|---|---|---|
| Cloudflare Worker + D1 | free | **$0** until thousands of active users, then pennies |
| Gemini API | free tier | pennies/month at small scale |
| Apple Developer | — | **$99/yr** (only for iOS distribution) |
| Chrome Web Store | — | **$5** one-time |

---

# Track C — Self-host (you hand someone the repo)

Identical to the above, on their hardware:
- **Private, for themselves:** they follow **Track A** (their Mac, free).
- **For their own users:** they follow **Track B** (their Cloudflare account, their bill — not yours).

No code changes — the Worker is the same in every mode; only *where it runs* and *which `.env` URL the clients point at* differ.

---

# Troubleshooting

| Symptom | Fix |
|---|---|
| **AI does nothing / empty tags / "Upstream request failed"** | Worker not running, wrong/quota-exhausted Gemini key, or the model was sunset. The Worker uses `gemini-2.5-flash`; if Google retires it, `curl https://generativelanguage.googleapis.com/v1beta/models -H "x-goog-api-key: KEY"` lists callable models and bump `GEMINI_MODEL` in `workers/gemini.ts`. |
| **Real iPhone can't reach the Worker** | Use your Mac's **LAN IP**, not `127.0.0.1`; run the Worker with `--ip 0.0.0.0`; phone + Mac on the **same Wi-Fi**; allow incoming connections in macOS firewall. |
| **One tab's content shows inside another tab (phone)** | Stale Metro bundle from a mid-edit reload. `npx expo start --clear`, then relaunch the app. |
| **Extension changes don't appear** | After `npm run build`, hit the **↻ reload** on the Silo card at `chrome://extensions`. |
| **Sync says "not configured"** | Set the **Server URL** in the pairing UI (or `EXPO_PUBLIC_API_BASE_URL` / `WXT_SILO_API_BASE_URL`). |
| **`401 Unauthorized` on sync/AI** | The app's token must equal the Worker's `APP_CLIENT_TOKEN` exactly. Re-check both. |
| **iOS build fails on CocoaPods** | `cd ios && LANG=en_US.UTF-8 pod install` (a UTF-8 locale issue), or just rerun `npx expo run:ios`. |

---

# One-glance command summary

```bash
# install
npm install && (cd workers && npm install) && (cd extension && npm install)

# personal: run the three pieces (three terminals)
cd workers && npm run dev                 # Worker  (http://127.0.0.1:8787)
npx expo run:ios                          # phone app
cd extension && npm run build             # then Load unpacked .output/chrome-mv3

# public: deploy the Worker, point .env at the URL, distribute
cd workers && npm run deploy
```
