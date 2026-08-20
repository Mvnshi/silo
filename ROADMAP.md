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
- **Trigger engine** — `BucketCondition` finally has an evaluator
  (`lib/triggers.ts`): location proximity, time-of-day (including windows that
  cross midnight), date-after, date-range, day-of-week, calendar-free slots and
  manual reminders. Conditions conjoin; context it cannot read (no location fix,
  calendar refused) evaluates to *unknown* and refuses to fire rather than
  guessing. A fired condition outranks everything else in "3 things you could do
  today" and says why in the engine's own words.
- **Reminders** — local-only daily digest, after-event check-in, weekly tidy-up,
  and a **fired-trigger** lane: `nextReadyAt` computes the instant a condition
  becomes true (a rising edge, so something already ready doesn't buzz a minute
  later) and schedules the notification for then. Only clock-predictable
  conditions get one; an item gated on where you are would need background
  geofencing and an "Always" location grant, which Silo deliberately does not
  ask for, so those stay foreground evaluations.
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
- **Accessibility** — Dynamic Type verified up to the accessibility sizes (the
  Stacks header used to push its own controls off-screen at those sizes; large
  display text now yields and the controls never do — `MAX_DISPLAY_SCALE`),
  heading roles for the VoiceOver rotor, reduced-motion fallbacks throughout,
  and errors delivered as toasts rather than modal alerts.

## Next

### Needs a real device or a real account — code is written, behaviour is not proven

1. **Stand up a Supabase project and run the auth flow end to end.** The
   *server* half is now proven against a stand-in identity provider
   (`workers/scripts/verify-auth.mjs`, 17 checks): token verification, the
   refusal to trust a token a deployment cannot check, cross-space rejection,
   `REQUIRE_AUTH`, and `DELETE /api/account` including the D1 wipe and the
   admin-key call. That run also caught a live bug — `applySecurity` was
   POST-only, so `DELETE /api/account` answered 405 before its handler ran and
   in-app account deletion (App Review 5.1.1(v)) could never have worked.
   The degradation contract is verified in the simulator: with the two env vars
   blank there is no account surface anywhere and sync stays pairing-code only.

   What still needs a real project, because it depends on tokens Supabase
   actually issues: the Apple nonce round-trip, the Google PKCE callback, email
   OTP delivery, and the account→space swap on sign-in and its reversal on
   sign-out. Setup runbook: [`docs/releasing.md`](docs/releasing.md) §6.
2. **Reminders on hardware.** The scheduling logic is idempotent and
   permission-gated, but simulators don't deliver local notifications reliably.
3. **The iOS Share Extension on a device.** The Team ID is set in `app.json`;
   what remains is registering the App Group `group.com.silo.app` in the
   developer portal and building for a device. Note that the prebuild must be
   `--clean`: an incremental `expo prebuild` crashes inside
   `@bacons/apple-targets` (`Cannot read properties of undefined`) because the
   share target already exists in the project.
4. **Glass scroll performance on a real phone.** Every list row and grid tile is
   now a `UIVisualEffectView`. A Mac renders those far more cheaply than an
   iPhone does. If a long list stutters, reverting `ItemCardPro` and
   `CompactCard` to opaque is a small, isolated change.

### Product

5. **Turn on billing.** The code ships (`lib/billing.ts`, `app/paywall.tsx`,
   Settings → Subscription): purchase, restore, lapsed handling with an offline
   grace window, and a gate that genuinely closes — premium buys the Gemini-backed
   features while capture, extraction and the whole resurfacing loop stay free.
   `scripts/verify-degradation.mjs` pins the contract, including the case that
   matters most: configured-to-sell but unable to (Expo Go / an old dev client)
   stays LOCKED rather than giving the paid tier away. What remains is account
   work — a RevenueCat project, the two App Store Connect products, and a sandbox
   tester on an EAS build, since purchases cannot be exercised in a simulator.
6. **Submit.** Usage strings, the Apple Sign-In entitlement and export compliance
   are fixed in `app.json`; the privacy policy, ToS, nutrition-label answers and
   review notes are written in [`docs/legal/`](docs/legal/) and
   [`docs/app-store.md`](docs/app-store.md). Remaining: have a lawyer read the
   legal drafts, host them, set a real `SUPPORT_EMAIL`, and shoot the 6.9"
   screenshots from a **Release** build (`scripts/capture-store-screenshots.sh`).
7. **Android.** Deliberately deferred — iOS first. The `SEND` intent filter,
   Play Billing and a Maps key are the known gaps.

## Assessed and declined

### react-native-reusables (the RN port of shadcn/ui)

**Not adopted as components. Worth reaching for as primitives, later.** shadcn
itself *was* adopted on the web half (`extension/`), where it fits — that side is
React DOM and its tokens now feed shadcn's variables directly. The RN port is a
different proposition, and the numbers say so:

- **Styling idiom.** 26 of 37 `.tsx` files build their styles with
  `StyleSheet.create` against `lib/theme.ts`. `className` appears in 5 files, 34
  times total. react-native-reusables is entirely className-driven, so adopting
  it makes NativeWind the primary idiom in a codebase where it is currently a
  rounding error — and leaves the app with two.
- **Glass.** 24 files render `Glass`. The library's components are opaque
  `View`s, and its overlay primitives animate opacity to enter — which, per the
  rule at the top of this repo, doesn't fade a `UIVisualEffectView`, it stops the
  material rendering. Every one would need reskinning before it could ship.
- **Duplication.** `components/ui/` already covers the surface area: Glass,
  GlassCard, PressableScale, OptionCard, EmptyState, Skeleton, ScreenHeader,
  TextPrompt, Toast. Accessibility is not the gap either — 146 accessibility
  props are already in place.
- **Tokens.** It expects shadcn-style CSS variables. `lib/theme.ts` is the source
  of truth and is already mirrored into `tailwind.config.js`; a third mapping is
  precisely the second palette worth avoiding.

**Where it would genuinely be better:** if a form- or settings-heavy surface
lands (Select, RadioGroup, Checkbox, Accordion), take `@rn-primitives/*` — the
unstyled, accessible behaviour layer underneath react-native-reusables — and
dress it in Glass and `theme.ts`. Adopt the primitives; never the skins.

> Unrelated but found while measuring: there are 18 `Alert.alert` blocking
> confirms across the app, which sits against the documented "destructive
> actions are optimistic + Undo" convention. Worth a pass at some point.

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
