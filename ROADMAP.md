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
- **An assistant that can act.** It was read-only Q&A buried in the Add tab with
  a close button wired to `() => {}`. It now has a home (mounted once at the
  root, reachable from every tab), a real dismiss, and a vocabulary: schedule,
  complete, archive, add, set a trigger condition. Gemini returns
  **schema-enforced tool calls**, not prose the client regexes.

  The interesting half is what it is not allowed to do. The model never sees an
  item id — it is shown `[1]…[N]` and answers in those numbers — so the Worker
  maps them back to the ids it was sent and `lib/assistant.parseActions` checks
  them again against the set the *device* put on the wire. A hallucinated
  reference resolves to nothing and the action is dropped, never clamped to a
  neighbouring row. Everything else fails closed too: a date that doesn't exist,
  a range that runs backwards, a location fence with no coordinates.

  Every action lands as a card that names each row before touching it, with
  per-row ticks and a headline that retitles as you untick. Then it applies and
  offers Undo in the Toast, like the rest of the app. 79 pure checks
  (`verify-assistant.mjs`) plus 28 against a real Worker with a stubbed model
  (`verify-assistant-worker.mjs`).
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

5. **Turn on billing.** The funnel ships end to end. Onboarding is five beats
   (three of promise, an interest picker that creates real Stacks, and a
   permission slide that primes calendar *and* reminders in context), handing to
   a soft trial offer, then sign-in, then the app. `app/paywall.tsx` is one
   screen with seven `?context=` variants so the Guideline 3.1.2 furniture
   cannot regress in one and survive in another. The gate is metered —
   `FREE_AI_ACTIONS` free uses of the Gemini-backed extras — so the ask lands
   after the feature has visibly worked, and `lib/retention.ts` classifies
   cancelled / lapsed / billing-issue subscribers and owns what each is told.
   Every price comes from the store, the trial is offered only to an Apple ID
   still eligible for one, and a discount renders only when a real signed offer
   exists.

   Verified without an account: `scripts/verify-funnel.mjs` (66 checks) drives
   every retention state from synthetic entitlements, plus the price maths, the
   trial-length reader and the allowance; `scripts/verify-degradation.mjs` (37)
   pins the unconfigured contract, the configured-but-unusable case that must
   stay LOCKED, the free/metered/premium split read straight out of `lib/api.ts`,
   and the `__DEV__` guards on `lib/billingFixtures.ts`. The simulator confirmed
   the flows themselves — first run → onboarding → offer → decline → app, the
   cancelled-but-active banner and its "before you go" screen, and the whole
   paywall in light, dark and at `accessibility-extra-large`.

   What still needs the accounts: a RevenueCat project, the two App Store Connect
   products, and a sandbox tester on an EAS build. Purchases, real trials,
   promotional offers and iOS 18 win-back offers cannot be exercised in a
   simulator, so the buy/restore round-trip and the offer-eligibility calls are
   written and typed but unproven against a live store. Configure a `retention`
   and a `winback` offering in RevenueCat to light up the discounted paths;
   without them those screens deliberately show no price at all rather than one
   no product backs.
6. **Submit.** Usage strings, the Apple Sign-In entitlement and export compliance
   are fixed in `app.json`; the privacy policy, ToS, nutrition-label answers and
   review notes are written in [`docs/legal/`](docs/legal/) and
   [`docs/app-store.md`](docs/app-store.md). Remaining: have a lawyer read the
   legal drafts, host them, set a real `SUPPORT_EMAIL`, and shoot the 6.9"
   screenshots from a **Release** build (`scripts/capture-store-screenshots.sh`).
7. **Android.** Deliberately deferred — iOS first. The `SEND` intent filter,
   Play Billing and a Maps key are the known gaps.

## Assessed and declined

### Magic UI — and an assistant in the extension

**Not adopted. Two effects rebuilt natively instead; the extension side
declined.** Magic UI is React DOM (Tailwind + Framer Motion, sitting on
shadcn/ui), so it cannot run in the app at all — the same shape of mismatch as
react-native-reusables below. The only place it *would* drop in is `extension/`,
which is already React web with shadcn bound to Silo's tokens.

That is exactly where it shouldn't go yet. The assistant's value is the action
layer, and the action layer is calendar, notifications, triggers and location —
`expo-calendar` is native, and the extension has none of it. An assistant there
could only do `archive` / `add` / `complete`: the weakest third of the
vocabulary, at the cost of duplicating the riskiest part of the feature (deciding
what a model may touch) in a second codebase. Revisit if the extension ever grows
its own scheduling surface.

For the app, two effects earned their place and were rebuilt on the primitives
already in use (`components/ui/Shimmer.tsx`, Reanimated + `lib/motion.ts` +
`lib/theme.ts`, both still under Reduce Motion):

- **Shimmering phase label** on the thinking state. Retrieval is on-device and
  the model call is not; naming which one is running is the difference between
  "working" and "stuck".
- **Sweep** across an action card while it applies, where a multi-row write has
  real latency.

Declined: a **typewriter reveal** on the answer. The answer arrives complete —
there is no stream to mirror — so animating it in character by character would
only withhold text the user already has. Animated beams and the rest are
decoration on a surface whose job is to be trusted.

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
  The assistant's action layer is not a softening of this: every verb it has
  writes to the user's own library or their own calendar, which is the "act"
  arrow the product loop already had a button for. Nothing reaches an outside
  service on the user's behalf, and the vocabulary is a closed list precisely so
  that stays true.
- **Server-side user data.** An account is an identity — an email and a user id —
  and nothing more. No remote database of what you saved, no embeddings
  warehouse: synced rows live in your own Cloudflare D1, keyed by a space id. If
  a feature needs a data lake, redesign the feature.
- **A chat-first interface.** The assistant exists, but the product is the feed,
  the calendar and the nudge — recommendations come to you.
- **Raw media download.** Breaks platform ToS and is the single most common App
  Store rejection under Guideline 5.2.3. Playback uses each platform's own embed.
