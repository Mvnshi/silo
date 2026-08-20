# Silo

**Use the things you save.**

Silo turns links, screenshots, notes and social posts into an organized,
schedulable library — then brings them back at the moment you can actually act
on them. Paste or **Share → Silo** any YouTube / TikTok / X / Instagram / Reddit
link and it's auto-classified, titled, thumbnailed and playable inline.
Screenshots and notes get the same treatment. Everything lives on-device.

| | |
|---|---|
| **iOS app** | Expo SDK 54 · React Native 0.81 · React 19 · TypeScript (strict) · expo-router |
| **Browser extension** | Manifest V3 · WXT · React 19 · Dexie — the desktop half |
| **Backend** | One Cloudflare Worker: an authenticated Gemini proxy, nothing else |
| **Storage** | On-device (AsyncStorage / IndexedDB). No accounts, no remote database. |

**[→ Setup](docs/setup.md)** · [Product thesis](VISION.md) · [Roadmap](ROADMAP.md)
· [Sync design](docs/sync.md) · [Extension](docs/extension.md) · [Releasing](docs/releasing.md)

---

## Why it exists

Most save-it-later apps optimize for saving. Silo optimizes for *using* — the
north-star metric is **actions taken per week from saved items**, not saves and
not opens. Everything below follows from that. See [`VISION.md`](VISION.md).

## Architecture

```
app/                    expo-router screens
  ├─ (tabs)/            Streams · Stacks · Add · Silo (today/calendar/map/bucket) · Screenshots
  └─ item/[id] · silo/[id] · stats · settings · onboarding · share (deep-link target)

lib/                    pure logic, no UI
  ├─ storage.ts         AsyncStorage: per-key write mutex + clobber guards
  ├─ items.ts           Item factory, normalization, status derivation
  ├─ api.ts             thin client → POST /api/gemini
  ├─ assistant.ts       the assistant's tool vocabulary + what it may refuse
  ├─ assistantExec.ts   running one proposed action, undoably
  ├─ dataVersion.ts     "something changed off-screen, reload"
  ├─ embed.ts           token-free inline players
  ├─ shareImport.ts     iOS share-queue drain
  ├─ scheduler.ts       idempotent calendar scheduling
  ├─ resurface.ts       after-event report · staleness nudge · repeatables
  ├─ stats.ts           resurfacing metrics, levels, cleanup candidates
  ├─ notifications.ts   local-only digest / check-in / tidy-up reminders
  ├─ theme.ts           design tokens + light/dark palettes
  ├─ useTheme.ts        useThemeColors()
  └─ motion.ts          shared entrance/exit presets + reduced-motion

components/             StreamCard · ItemCardPro · CompactCard · TodayView · ReviewCard
                        ItemActionSheet · CleanupSheet · ThemeProvider · ui/*
                        AssistantProvider · ChatBot · assistant/ActionCard
extension/              browser extension (see docs/extension.md)
workers/                Cloudflare Worker: index → middleware (auth + rate limit) → gemini
targets/share/          native iOS Share Extension (Swift) → App Group → app drains it
```

**Why a Worker at all?** Only to keep `GEMINI_API_KEY` off the client — an
in-bundle key is extractable. Search, retrieval and storage all run on-device.
Steady-state cost is roughly **$0–1/month** (Cloudflare free tier + Gemini
pennies).

### Social link extraction

`workers/extract.ts` resolves the platform, then takes oEmbed (YouTube / TikTok /
X / Vimeo) or Open Graph via `HTMLRewriter` (Instagram / Reddit / Threads /
Facebook / any URL), normalizes it, and chains into Gemini classify.

For everything else it keeps digging rather than settling for a title guess:
repeated `og:image` tags are all kept (`thumbnailUrls` — a carousel used to lose
every frame after the first), JSON-LD supplies title, author, kind and the
duration OG almost never carries, and a site's own
`<link rel="alternate" type="application/json+oembed">` is followed so any
oEmbed-capable site gets provider-quality metadata without being hardcoded.
Relative image paths are resolved and re-checked against the egress rules.

Egress is hardened: http(s) only, private and metadata IPs blocked, redirects
re-validated manually, timeout and response-size caps. It never loses a save —
a dead or login-walled link still stores the raw URL.

Playback uses each platform's own token-free embed (`lib/embed.ts`). No media is
downloaded; that is a deliberate App Store / ToS choice, not an oversight.

### Onboarding and the paywall

Onboarding is five beats: three of promise, then **pick what you keep losing**
(the chips create real Stacks, so nobody lands in an empty library) and a
**permission slide that asks for calendar and reminders with the reason on
screen**. It hands to the trial offer, then sign-in, then the app — each link
independently skippable, and each skipped entirely when its feature is
unconfigured.

`app/paywall.tsx` is one screen with seven `?context=` variants, so the
Guideline 3.1.2 furniture — price, period, renewal terms, working ToS/Privacy
links, Restore, and a full-width "Not now" — physically cannot regress in one
variant while surviving in another. Three rules it will not break: every price
comes from the store, the trial is only promised to an Apple ID that is still
eligible for one, and a discount renders only when a real signed offer exists.

The gate is metered rather than absolute: `FREE_AI_ACTIONS` free uses of the
three Gemini-backed extras, so the upgrade prompt arrives after the feature has
visibly worked instead of the first time it is tapped. `lib/retention.ts`
classifies where a subscriber stands (`cancelled` · `lapsed` · `billingIssue` ·
…) and owns the copy for each.

### The assistant

Ask it about your library, or tell it what to do with it. Both halves are
grounded on your own saves, and the second half is where the care went.

Retrieval runs on-device: the question is matched against the library and only
the matching items go to the Worker. A question that isn't about a topic but
about the library as a whole — *"archive everything I haven't touched since
June"* — can't be answered by keywords, so a thin keyword result falls back to
Silo's own structural lanes (the cleanup pile, what's coming up) instead of an
arbitrary newest-30.

**It can act.** The vocabulary is Silo's existing verbs and nothing else:
`schedule` (a real calendar event, idempotent per item), `complete` (through
`buildReview`, so it reaches the north-star metric), `archive`, `add`, and
`set_trigger` (a `BucketCondition` the trigger engine then evaluates). Adding a
verb means adding a real capability, so the list is the security boundary as
much as the feature set.

**The model cannot invent an item.** Grounding is structural, not a prompt, in
three layers: the model is shown `[1]…[N]` and never an id, so the only thing it
can emit is a small integer; the Worker maps those back to the ids it was sent
and drops anything out of range; and `lib/assistant.parseActions` re-checks every
id against the set the *device* put on the wire. An id can only ever be one the
phone itself supplied. `verify-assistant-worker.mjs` asserts the prompt contains
no id at all.

**Nothing happens until you tap.** Silo's convention is optimistic-plus-Undo
rather than a blocking confirm — right when *you* picked the target. Here the
model picked it, so there's one more step, the same for every action:

```
propose (a card, listing every row it will touch) → you tap → apply → Undo in the Toast
```

Multi-item actions list what they'll change and let you un-tick any of it first;
the headline retitles as you do. `schedule` says out loud that it writes to your
real calendar, because it's the only verb whose effect leaves the app. Undo
restores exactly the fields the action wrote, so a change you made in between
survives.

The assistant is an overlay, not a route — reachable from every tab, primary
nowhere (VISION.md is explicit that Silo isn't chat-first). It's mounted once at
the root by `AssistantProvider`.

### The resurfacing loop

Three mechanics keep saves from rotting (`lib/resurface.ts`):

- **After-event report** — when a scheduled thing's time passes: *Did it /
  Skipped* → *Again sometime?* A "yes" marks it loved and re-recommends it later.
- **Staleness nudge** — a card you haven't opened in 21+ days asks *Still want
  this?* `last_seen_at` is local and never synced, so there's no per-open churn.
- **Repeatables** — a loved item off its cooldown returns to the top of "3 things
  you could do today".

**Your Silo** (`app/stats.tsx`) makes the metric visible: levels earned *only* by
using things, a save→do rate, a streak, and a one-card-at-a-time cleanup flow for
the stale pile. Reminders (`lib/notifications.ts`) are local-only — no push
token, no device registration, nothing server-side that knows what you saved.

### Design system

`lib/theme.ts` is the single source of style truth, mirrored into
`tailwind.config.js` for NativeWind. Nothing in a screen should be a literal:

| Token | Rule |
|---|---|
| `TYPE` | 11 steps, each with line-height + optical tracking. Never a bare `fontSize`. |
| `SPACE` / `RADIUS` | 4pt grid; `RADIUS.pill` for chips. Never a numeric radius. |
| `SHADOW` | `hairline · card · raised · floating · brandCard · brandFloating`. Never a hand-rolled shadow. |
| `SPRING` / `DURATION` | Every press and transition uses the same curves. |
| `TEXT` / `SURFACE` / `STATUS` | Semantic roles. `INK[400]` is ~2.4:1 on white — **decoration only, never text**. |

Appearance is reactive: `useThemeColors()` (backed by `components/ThemeProvider`)
returns the palette for the resolved appearance, and the provider pushes the same
value into NativeWind so `dark:` classNames and StyleSheet colours can't
disagree. Light and dark are both first-class, and a user can force either
independently of the system setting.

Motion lives in `lib/motion.ts` (`enterList`, `enterFromBottom`, `LAYOUT`, …) and
degrades to a cross-fade under **Reduce Motion**.

## Quick start

```sh
npm install                 # .npmrc sets legacy-peer-deps for RN 0.81 / React 19
cp .env.example .env
npx expo start              # press i for the iOS simulator
```

`.env` (Expo inlines `EXPO_PUBLIC_*` at build time):

```
EXPO_PUBLIC_API_BASE_URL=    # Worker URL — AI features no-op until set
EXPO_PUBLIC_CLIENT_TOKEN=    # must match the Worker's APP_CLIENT_TOKEN secret
```

**Working on the paywall without a RevenueCat account?** Start Metro with
`EXPO_PUBLIC_BILLING_FIXTURE=<state>` and `lib/billingFixtures.ts` serves a fake
store — real-shaped packages, trial eligibility, win-back offers, and any
entitlement you need (`none` · `trialing` · `subscribed` · `cancelled` ·
`lapsed` · `billing`). It is `__DEV__`-only and off unless that variable is set;
`verify-degradation.mjs` pins both guards.

The app runs without a Worker: you can still save links, notes and images, and
classification falls back to a heuristic.

Full walkthrough — local dev, deploying, and self-hosting — in
[`docs/setup.md`](docs/setup.md).

## Scripts

| Command | What |
|---|---|
| `npx expo start` | Metro dev server |
| `npx expo run:ios` | Build + run a dev client on the simulator or a device |
| `npx tsc --noEmit` | Type-check the app |
| `npx expo lint` | Lint |
| `cd workers && npx tsc --noEmit` | Type-check the Worker |
| `cd workers && npm run dev` | Run the Worker locally (`wrangler dev`) |
| `cd extension && npx wxt build` | Build the extension |
| `cd extension && node scripts/verify-e2e.mjs` | Extension e2e against a real browser |
| `node scripts/verify-triggers.mjs` | Trigger-engine rules (pure; no device needed) |
| `node scripts/verify-assistant.mjs` | What the assistant's action layer refuses (pure) |
| `node workers/scripts/verify-assistant-worker.mjs` | Item references never become ids the client didn't send (starts its own Worker + a model stub) |
| `node scripts/verify-degradation.mjs` | Accounts + subscriptions degrade to "everything open" when unconfigured |
| `node scripts/verify-funnel.mjs` | Retention states, paywall copy, price maths, the free AI allowance |
| `node workers/scripts/verify-extract.mjs` | Extractor against fixed HTML (starts its own Worker) |
| `node workers/scripts/verify-auth.mjs` | Worker session + space authorization (starts its own fleet) |
| `cd extension && node scripts/verify-tokens.mjs` | shadcn resolves to Silo's tokens |

## Conventions

- **Persistence** — never call a raw writer. Go through `lib/storage`
  (`addItem` / `updateItem` / `addStack` / …). All collection writes are
  serialized per key and guarded against clobbering on a transient empty read.
- **Items** — construct via `createItem` (`lib/items`); it fills id, timestamps
  and status. Dates are stored as `YYYY-MM-DD` and parsed with
  `lib/datetime.parseLocalDate` — never `new Date(str)`, which is UTC.
- **Categories** — the single source of truth is `CLASSIFICATIONS` in
  `lib/types.ts`. The Worker and the Swift target keep in-sync copies, marked as
  such.
- **Triggers** — a condition the device can't evaluate is `unknown`, never
  `false`. Pass `null` for missing context (no location fix, calendar refused)
  rather than a default; the engine will not call an item ready on a guess.
- **Completions** — mark done through `buildReview` (`lib/resurface`), not a bare
  `viewed: true`. A completion that doesn't bump `times_done` never reaches the
  north-star metric.
- **Destructive actions** — apply optimistically and offer Undo via the Toast,
  rather than a blocking confirm. `deleteItem` already writes a tombstone with
  everything needed to restore. The one exception is an action the *assistant*
  proposed: the model chose those rows, not the user, so it shows a card first —
  then applies and offers Undo exactly as above.
- **The assistant's reach** — `lib/assistant.ASSISTANT_TOOLS` is a closed list,
  and adding to it adds a real capability. Anything it acts on must survive
  `parseActions` against the ids the device itself sent; never widen that.
- **No demo data in production** — seeding is `__DEV__`-only.
