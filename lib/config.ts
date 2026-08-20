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
 */
export const TRIAL_DAYS = 7;
export const PRICE_MONTHLY = '$6.99';
export const PRICE_YEARLY = '$39.99';
export const PREMIUM_ENTITLEMENT = 'premium';

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
