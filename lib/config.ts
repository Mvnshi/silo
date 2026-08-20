/**
 * App-wide feature flags + product config.
 *
 * Flags let us park a capability cleanly (default off) instead of dead-coding
 * it, so the feature can return later without a paid dependency.
 */

/**
 * Voice narration / transcription. OFF by default — Silo ships with NO paid
 * text-to-speech (ElevenLabs was a sponsor prize, now removed). When this is
 * turned on, implement it with Apple's on-device Speech framework (free,
 * private, no network), NOT a hosted TTS service. Roadmap.
 */
export const FEATURE_VOICE = false;

/**
 * Subscription config — single source of truth (Phase 5 / RevenueCat).
 * Mirror these exact values in App Store Connect + RevenueCat.
 *
 * The prices here are FALLBACK COPY ONLY, for the frame before StoreKit
 * answers. Anything a user is asked to pay is rendered from the live
 * `priceString` when one exists; see `lib/billing.ts`. Never compute or display
 * a price that no real product backs.
 */
export const TRIAL_DAYS = 7;
export const PRICE_MONTHLY = '$6.99';
export const PRICE_YEARLY = '$39.99';
export const PREMIUM_ENTITLEMENT = 'premium';

/**
 * RevenueCat offering identifiers.
 *
 * `default` is whatever is marked current in the dashboard — the standard
 * yearly/monthly pair. The other two are OPTIONAL named offerings; when they
 * do not exist, the surfaces that would use them fall back to the standard
 * offering and simply show no discount. A retention screen that cannot resolve
 * a real discounted product shows no number at all rather than inventing one.
 */
export const OFFERING_DEFAULT = 'default';
/** Shown to someone who has cancelled but is still inside their paid period. */
export const OFFERING_RETENTION = 'retention';
/** Shown to someone whose subscription has already lapsed. */
export const OFFERING_WINBACK = 'winback';

/**
 * Free AI actions before the gate closes — the "earn the ask" allowance.
 *
 * Silo's free tier is the whole habit loop (capture, extraction, stacks,
 * calendar, map, resurfacing) and that does not change. What this meters is the
 * three Gemini-backed extras: screenshot analysis, the assistant, and schedule
 * suggestions. Metering them rather than hard-gating them means the upgrade ask
 * arrives after the feature has visibly worked several times, instead of the
 * first time a user taps it — which is the difference between an offer and a
 * wall.
 *
 * LIFETIME, not monthly: a monthly reset teaches people to wait rather than to
 * decide, and it caps the value of subscribing at "the thing I get early".
 *
 * Set to 0 to restore a hard gate on the first premium call.
 */
export const FREE_AI_ACTIONS = 10;

/**
 * How many actions remain before the UI starts saying so. Above this the
 * counter stays out of the way; at or below it, the remaining count is shown
 * on the capture and screenshot surfaces.
 */
export const ALLOWANCE_WARN_AT = 3;

/**
 * Days before a trial's first charge to send the "your week in Silo" reminder.
 *
 * Reminding people that they are about to be charged loses a few conversions
 * and prevents the refund requests, chargebacks and one-star "they charged me"
 * reviews that cost considerably more. It is also the honest thing to do. The
 * notification leads with what the user actually did that week — their own
 * usage is the most persuasive thing we could put in front of them.
 */
export const TRIAL_REMINDER_DAYS_BEFORE = 2;

/**
 * Public legal URLs. App Review requires BOTH to be reachable from inside the
 * app and from the App Store listing, and a subscription app must link them on
 * the purchase screen itself (Guideline 3.1.2).
 *
 * The documents live in `docs/legal/` — publish that directory (GitHub Pages
 * works) and point these at it. They must be live before submission.
 */
export const PRIVACY_URL = 'https://mvnshi.github.io/silo/privacy';
export const TERMS_URL = 'https://mvnshi.github.io/silo/terms';

/** Shown in Settings → About. Keep in sync with app.json `expo.version`. */
export const APP_VERSION = '1.0.0';
/** Where "Send feedback" routes (placeholder — set the real address before launch). */
export const SUPPORT_EMAIL = 'hello@silo.app';
