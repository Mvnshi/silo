# Roadmap

Sequenced against the north-star metric in [`VISION.md`](VISION.md): *actions
taken per week from saved items*. Anything that doesn't move that number waits.

## Shipped

- **Capture** — paste, note, camera, gallery, iOS Share Extension, browser
  extension. Universal link extraction (oEmbed + Open Graph) with token-free
  inline playback, and a graceful-fallback contract that never loses a save.
- **Organize** — stacks, classification, tags, search (local-first, AI-refined),
  list and grid, multi-select with undoable bulk actions.
- **Act** — calendar scheduling (two-way, via `expo-calendar`), a Today view,
  places on a map, and a bucket list.
- **Resurface** — after-event report, staleness nudge, repeatables, and
  **Your Silo**: levels earned only by using things, save→do rate, streak, and a
  one-card-at-a-time cleanup pass for the stale pile.
- **Reminders** — local-only daily digest, after-event check-in, weekly tidy-up.
- **Sync** — two-way phone ⇄ extension through the Worker's `/api/sync`
  (see [`docs/sync.md`](docs/sync.md)).
- **Design system** — type / spacing / radius / elevation / motion scales, and a
  reactive light + dark palette across every surface.

## Next

1. **Verify reminders on hardware.** The scheduling logic is idempotent and
   permission-gated, but simulators don't deliver local notifications reliably.
2. **Trigger engine.** `BucketCondition` is modelled in `lib/types.ts` but has no
   evaluator yet: location proximity, time-of-day, date windows and
   calendar-free slots should fire the recommendation instead of waiting for the
   user to open the app.
3. **Monetization.** Billing via RevenueCat; entitlement checks that genuinely
   gate; restore purchases; lapsed handling. Trial length and pricing are already
   single config constants.
4. **App Store readiness.** Real usage strings, privacy nutrition label, privacy
   policy and ToS, subscription disclosure, store assets, TestFlight.
   Checklist in [`docs/releasing.md`](docs/releasing.md).
5. **Android.** Deliberately deferred — iOS first. The `SEND` intent filter,
   Play Billing and a Maps key are the known gaps.

## Explicitly not doing

- **Agentic execution** (booking, emailing, buying). The wedge is *deciding*, not
  *doing*; recommendation quality compounds, half-working agents erode trust.
- **Server-side user data.** No accounts, no remote database, no embeddings
  warehouse. If a feature needs a data lake, redesign the feature.
- **A chat-first interface.** The assistant exists, but the product is the feed,
  the calendar and the nudge — recommendations come to you.
- **Raw media download.** Breaks platform ToS and is the single most common App
  Store rejection under Guideline 5.2.3. Playback uses each platform's own embed.
