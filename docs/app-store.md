# App Store submission sheet

> Everything App Review asks for, answered against how Silo actually behaves.
> The account-level setup lives in [`releasing.md`](releasing.md); this is the
> listing, the privacy label and the review notes.
>
> Legal drafts are in [`legal/`](legal/) — **have a lawyer read them** before
> submitting, and host them publicly (GitHub Pages works). The URLs the app
> links to are `PRIVACY_URL` / `TERMS_URL` in `lib/config.ts`.

## 1. Blockers before you can submit

| # | Item | Where |
|---|---|---|
| 1 | Publish `docs/legal/privacy.md` + `terms.md` and point `PRIVACY_URL` / `TERMS_URL` at them | `lib/config.ts` |
| 2 | Set a real `SUPPORT_EMAIL` (App Review needs a working address) | `lib/config.ts` |
| 3 | Create `silo_monthly` / `silo_yearly` in App Store Connect, a RevenueCat project, and the `premium` entitlement | [releasing.md §5](releasing.md) |
| 4 | Put the RevenueCat public SDK key in `.env` as `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | `.env` |
| 5 | Run `npx expo prebuild -p ios --clean` — **required**, incremental prebuild fails in `@bacons/apple-targets` | — |
| 6 | Register the App Group `group.com.silo.app` and enable **Sign in with Apple** on the App ID | Apple Developer portal |

## 2. Privacy nutrition label

Answer App Store Connect → App Privacy like this. The justification column is
what to say if a reviewer pushes back.

| Data type | Collected? | Linked to identity? | Used for tracking? | Why |
|---|---|---|---|---|
| Contact info — email | **Yes**, only with an account | Yes | No | Supabase holds an email + user id so an account can be recovered. Optional; the app is fully usable signed out. |
| User content — photos, other user content | **Yes**, only when you use an AI feature | No | No | Screenshots and assistant prompts are relayed to Google Gemini for processing and are not stored. Not sent unless the user invokes the feature. |
| Identifiers — user id | **Yes**, only with an account or a subscription | Yes | No | Account id for sync partitioning; a pseudonymous RevenueCat app user id for entitlement checks. |
| Purchases | **Yes**, with a subscription | Yes | No | Apple's receipt, checked via RevenueCat. |
| Location | **No** | — | — | Used on-device only. It is never transmitted; see `lib/triggers.ts`. |
| Usage data, diagnostics | **No** | — | — | No analytics SDK, no crash reporter, no advertising SDK ships in the app. |
| Search history, browsing history, contacts, health, financial info | **No** | — | — | Never accessed. |

**Tracking: No.** Silo has no ATT prompt because it does not track across apps
or websites and shares nothing with data brokers.

> Sanity check before you tick these: `grep -rn "amplitude\|segment\|firebase\|sentry\|facebook" package.json`
> should return nothing.

## 3. Review notes (paste into App Store Connect)

```
Silo saves links, notes and screenshots and brings them back when you can act
on them. Your library is stored on the device.

NO ACCOUNT IS REQUIRED. Everything except the AI features works signed out —
please tap "Not now" on the sign-in screen to review the full app.

SUBSCRIPTIONS. "Silo Premium" (silo_monthly / silo_yearly, 7-day free trial)
unlocks the AI features only: screenshot analysis, the assistant, and smart
schedule suggestions. Saving, extraction, organizing, the calendar, the map and
all reminders are free and unlimited. Terms, price and renewal behaviour are on
the purchase screen, along with Restore Purchases and links to our Terms and
Privacy Policy.

ACCOUNT DELETION (5.1.1(v)) is in Settings → Account → Delete account, which
erases the identity record and all synced rows.

THIRD-PARTY CONTENT. Silo never downloads media. Playback uses each platform's
own official embed (YouTube, TikTok, X, Vimeo) in a WebView, and link previews
come from public oEmbed / Open Graph metadata only.

PERMISSIONS are all optional and requested in context: Calendar (schedule an
item and find free time), Photos (import a screenshot), Camera (capture),
Location while-in-use (sort saved places by distance — never leaves the device),
Notifications (local reminders only; there is no push server).
```

## 4. Screenshots

Apple requires one 6.9" set (**1320 × 2868**). `scripts/capture-store-screenshots.sh`
boots an iPhone 17 Pro Max, installs the current build, copies a seeded library
across from another simulator so you don't shoot an empty app, and skips
onboarding. You then tap to each screen and run `… shoot <name>`.

Two things the script deliberately does not do, because it can't:

- **Navigate.** `simctl openurl` raises iOS's "Open in Silo?" confirmation sheet,
  and simctl has no tap primitive — every deep-linked capture photographs that
  dialog. Drive it from the simulator panel instead.
- **Guarantee a clean frame.** A Debug build draws React Native's LogBox warning
  toast across the bottom, and Apple rejects screenshots containing development
  UI. Build Release first:
  `npx expo run:ios --configuration Release --device "iPhone 17 Pro Max"`.

Suggested order — lead with the payoff, not the file cabinet:

1. **Today** — "3 things you could do today", with a fired trigger visible.
2. **Stacks** — the library, showing extracted titles and thumbnails.
3. **Your Silo** — the level, save→do rate and streak.
4. **Calendar** — a saved thing turned into a plan.
5. **Map** — saved places near you.

Screenshots must show the real app. Add captions in App Store Connect rather
than baking marketing text into the images.

## 5. Age rating

**4+.** Silo displays third-party web content in embeds, so answer
"Unrestricted Web Access: **Yes**" — that alone does not raise the rating, but
answering it wrongly is a rejection.

## 6. Export compliance

Silo uses only standard HTTPS/TLS. In App Store Connect answer:

- Uses encryption: **Yes**
- Qualifies for the exemption (limited to standard encryption in the OS): **Yes**

`ITSAppUsesNonExemptEncryption: false` can be set in `app.json` under
`ios.infoPlist` to skip the question on every upload.
