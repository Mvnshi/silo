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
