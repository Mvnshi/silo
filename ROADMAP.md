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
- **Accounts (optional)** — Sign in with Apple, Google, or a six-digit email
  code. No passwords anywhere. The app is fully usable signed out; an account
  buys a stable sync space and a restore path. The identity provider holds an
  email and a user id — saves go to your own Worker and D1.
- **Design system** — type / spacing / radius / elevation / motion scales, and a
  reactive light + dark palette across every surface.
- **Liquid Glass** — every chrome, sheet, floating control and card, with an
  automatic fall back to the previous blur below iOS 26.

## Next

### Needs a real device or a real account — code is written, behaviour is not proven

1. **Stand up a Supabase project and run the auth flow end to end.** Both states
   of the sign-in screen are verified in the simulator (configured and
   unconfigured), but no sign-in has ever completed, because no project exists
   yet. Until one does, these are untested in practice: the Apple nonce
   round-trip, the Google PKCE callback, email OTP delivery, the Worker's token
   verification, the account→space swap on sign-in and its reversal on sign-out,
   and `DELETE /api/account`. Setup runbook: [`docs/releasing.md`](docs/releasing.md) §6.
2. **Reminders on hardware.** The scheduling logic is idempotent and
   permission-gated, but simulators don't deliver local notifications reliably.
3. **The iOS Share Extension on a device.** Needs `expo prebuild -p ios --clean`,
   an Apple Team ID, and the App Group registered in the developer portal.
4. **Glass scroll performance on a real phone.** Every list row and grid tile is
   now a `UIVisualEffectView`. A Mac renders those far more cheaply than an
   iPhone does. If a long list stutters, reverting `ItemCardPro` and
   `CompactCard` to opaque is a small, isolated change.

### Product

5. **Trigger engine.** `BucketCondition` is modelled in `lib/types.ts` but has no
   evaluator yet: location proximity, time-of-day, date windows and
   calendar-free slots should fire the recommendation instead of waiting for the
   user to open the app.
6. **Monetization.** Billing via RevenueCat; entitlement checks that genuinely
   gate; restore purchases; lapsed handling. Trial length and pricing are already
   single config constants.
7. **App Store readiness.** Real usage strings, privacy nutrition label, privacy
   policy and ToS, subscription disclosure, store assets, TestFlight.
   Checklist in [`docs/releasing.md`](docs/releasing.md).
8. **Android.** Deliberately deferred — iOS first. The `SEND` intent filter,
   Play Billing and a Maps key are the known gaps.

## Explicitly not doing

- **Agentic execution** (booking, emailing, buying). The wedge is *deciding*, not
  *doing*; recommendation quality compounds, half-working agents erode trust.
- **Server-side user data.** An account is an identity — an email and a user id —
  and nothing more. No remote database of what you saved, no embeddings
  warehouse: synced rows live in your own Cloudflare D1, keyed by a space id. If
  a feature needs a data lake, redesign the feature.
- **A chat-first interface.** The assistant exists, but the product is the feed,
  the calendar and the nudge — recommendations come to you.
- **Raw media download.** Breaks platform ToS and is the single most common App
  Store rejection under Guideline 5.2.3. Playback uses each platform's own embed.
