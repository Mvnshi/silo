# Silo — Browser Extension

> Implementation lives here. **Read [`../EXTENSION_SPEC.md`](../EXTENSION_SPEC.md) first.** It explains the *why*, the architecture, the mymind deconstruction, and the v1 milestones (M0–M8). This README is just the developer quickstart.

## Status

🌱 **Scaffold only.** Not implemented yet. M0 (popup capture into IndexedDB via the existing Cloudflare Worker) is the first milestone. See the spec.

## Quickstart (once M0 lands)

```sh
cd extension
npm install
npm run dev            # WXT dev server with HMR
```

Load it in Chrome:
1. `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select `extension/.output/chrome-mv3`
4. Pin Silo to the toolbar

Backend config: the extension uses the **same Cloudflare Worker** the iOS app does. Copy `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_CLIENT_TOKEN` from the root `.env` into `extension/.env.local` as `SILO_API_BASE_URL` and `SILO_CLIENT_TOKEN`.

## Layout (planned — see spec §5)

```
src/
├─ popup/        — popup UI (React), the toolbar action
├─ background/   — service worker: menus, omnibox, commands
├─ content/      — content scripts: spotlight overlay, reader mode, snapshot
└─ lib/          — Dexie store, types (mirrors phone's lib/types.ts), API client
```

## What this is, in one paragraph

The desktop/web half of Silo. The phone covers "I'm in Instagram and want to save this reel"; the extension covers "I'm on a long article and want to save it with a tag and a note." Same Item schema, same Worker, same on-device-first privacy posture. Direct competitor is [mymind.com](https://mymind.com) — feature parity with them, plus all the things they refuse to ship (import, sharing, public API, save-snapshot, Firefox).
