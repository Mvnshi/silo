/**
 * Subscriptions — optional, and the app is whole without one.
 *
 * ## The model
 *
 * Silo's free tier is the habit: capture, extraction, stacks, the calendar, and
 * the whole resurfacing loop. What premium buys is the layer that costs money to
 * run — the Gemini-backed features (see `PREMIUM_TASKS` in `lib/api.ts`). That
 * line is deliberate: the north-star metric is actions taken per week, so
 * anything that builds the habit has to stay free, and the paywall sits exactly
 * where marginal cost is.
 *
 * ## Degradation contract (important — mirrors lib/auth.ts)
 *
 * With `EXPO_PUBLIC_REVENUECAT_IOS_KEY` unset — a fresh clone, a self-hoster,
 * CI — `isBillingConfigured()` is false, **every gate opens**, and no paywall or
 * subscription UI is reachable. An unconfigured build behaves exactly as the app
 * did before billing existed. Locking features in a build that cannot possibly
 * sell them would be a bug, not a business model.
 *
 * The same applies when the native module is missing: `react-native-purchases`
 * needs a dev/EAS build, so in Expo Go or an older dev client the require fails
 * and billing reports itself unconfigured rather than crashing on import.
 *
 * ## Lapsed handling
 *
 * The entitlement is cached to AsyncStorage with its expiry. A paying user who
 * opens the app on a plane must not be told to subscribe again, so a cached
 * entitlement stays honoured until it actually expires, plus `GRACE_DAYS` of
 * slack for billing-retry states. Past that it lapses closed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { PREMIUM_ENTITLEMENT } from './config';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

/** Days a known-good entitlement survives past its expiry (billing retry / offline). */
const GRACE_DAYS = 3;
const CACHE_KEY = 'silo:entitlement:v1';

function apiKey(): string {
  return Platform.OS === 'android' ? ANDROID_KEY : IOS_KEY;
}

/** True when this build can actually sell something. */
export function isBillingConfigured(): boolean {
  return apiKey().length > 0;
}

/* ---------------------------------------------------------------------------
 * The SDK, behind a narrow surface
 *
 * Only the handful of calls Silo makes are typed here. The alternative — typing
 * against the SDK's exported types at module scope — would make this file fail
 * to compile in an environment where the native module isn't installed, which is
 * exactly the environment the degradation contract exists to serve.
 * ------------------------------------------------------------------------- */

export interface BillingPackage {
  identifier: string;
  /** 'MONTHLY' | 'ANNUAL' | … */
  packageType: string;
  product: {
    identifier: string;
    priceString: string;
    title: string;
    description: string;
  };
}

interface CustomerInfo {
  entitlements: {
    active: Record<string, {
      identifier: string;
      willRenew: boolean;
      periodType: string;
      expirationDate: string | null;
      productIdentifier: string;
    }>;
  };
  managementURL: string | null;
}

interface PurchasesSdk {
  configure(opts: { apiKey: string; appUserID?: string | null }): void;
  getCustomerInfo(): Promise<CustomerInfo>;
  getOfferings(): Promise<{ current: { availablePackages: BillingPackage[] } | null }>;
  purchasePackage(pkg: BillingPackage): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<CustomerInfo>;
  logIn(userId: string): Promise<{ customerInfo: CustomerInfo }>;
  logOut(): Promise<CustomerInfo>;
  addCustomerInfoUpdateListener(cb: (info: CustomerInfo) => void): void;
}

let sdk: PurchasesSdk | null = null;
let configured = false;

function purchases(): PurchasesSdk | null {
  if (!isBillingConfigured()) return null;
  if (sdk) return sdk;
  try {
    // Required: the native module is absent in Expo Go and in any dev client
    // built before this dependency was added.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    const candidate = (mod?.default ?? mod) as PurchasesSdk | undefined;
    if (!candidate || typeof candidate.configure !== 'function') return null;
    sdk = candidate;
    return sdk;
  } catch {
    return null;
  }
}

/** True when billing is configured AND the native module is actually present. */
export function isBillingAvailable(): boolean {
  return purchases() !== null;
}

/* ---------------------------------------------------------------------------
 * Entitlement
 * ------------------------------------------------------------------------- */

export interface Entitlement {
  active: boolean;
  /** False once cancelled — used to say "ends on …" rather than "renews on …". */
  willRenew: boolean;
  /** ISO, or null for a lifetime/unknown expiry. */
  expiresAt: string | null;
  productId: string | null;
  /** True while the introductory free trial is running. */
  inTrial: boolean;
  /** Deep link to the store's manage-subscription page, when the SDK gives one. */
  managementUrl: string | null;
}

/** An unconfigured build is entitled to everything: no gate exists to fail. */
export const OPEN: Entitlement = {
  active: true,
  willRenew: false,
  expiresAt: null,
  productId: null,
  inTrial: false,
  managementUrl: null,
};

const LOCKED: Entitlement = { ...OPEN, active: false };

/**
 * Last known entitlement, readable synchronously.
 *
 * `lib/api.ts` gates on this: an async check there would mean every AI call
 * awaits the network before deciding whether it is even allowed to happen.
 */
let cached: Entitlement = OPEN;

export function cachedEntitlement(): Entitlement {
  return isBillingConfigured() ? cached : OPEN;
}

/** The one question the rest of the app asks. Open when billing is off. */
export function isPremium(): boolean {
  return cachedEntitlement().active;
}

function fromCustomerInfo(info: CustomerInfo): Entitlement {
  const e = info.entitlements?.active?.[PREMIUM_ENTITLEMENT];
  if (!e) return { ...LOCKED, managementUrl: info.managementURL ?? null };
  return {
    active: true,
    willRenew: Boolean(e.willRenew),
    expiresAt: e.expirationDate ?? null,
    productId: e.productIdentifier ?? null,
    inTrial: e.periodType === 'TRIAL' || e.periodType === 'INTRO',
    managementUrl: info.managementURL ?? null,
  };
}

/** Still good? An expired-but-within-grace entitlement counts (billing retry). */
function withinGrace(e: Entitlement, now: Date): boolean {
  if (!e.active) return false;
  if (!e.expiresAt) return true;
  const expiry = new Date(e.expiresAt).getTime();
  if (Number.isNaN(expiry)) return true;
  return now.getTime() <= expiry + GRACE_DAYS * 86_400_000;
}

async function persist(e: Entitlement): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(e));
  } catch {
    // A cache miss costs one network round-trip, never correctness.
  }
}

async function readCache(): Promise<Entitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Entitlement) : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------------- */

/**
 * Configure the SDK and seed the entitlement.
 *
 * Seeds from the cache FIRST so a cold start offline doesn't lock out a paying
 * user for as long as the network takes to fail, then reconciles with the store.
 */
export async function initBilling(userId?: string | null): Promise<Entitlement> {
  if (!isBillingConfigured()) return OPEN;

  const stored = await readCache();
  if (stored && withinGrace(stored, new Date())) cached = stored;
  else if (stored) cached = LOCKED;

  const P = purchases();
  if (!P) {
    // Configured to sell, but this binary can't — treat as locked rather than
    // silently giving the paid tier away.
    cached = stored && withinGrace(stored, new Date()) ? stored : LOCKED;
    return cached;
  }

  if (!configured) {
    try {
      P.configure({ apiKey: apiKey(), appUserID: userId ?? null });
      configured = true;
      P.addCustomerInfoUpdateListener((info) => {
        cached = fromCustomerInfo(info);
        void persist(cached);
      });
    } catch {
      return cached;
    }
  }
  return refreshEntitlement();
}

/** Ask the store what the user actually owns. Falls back to the cache offline. */
export async function refreshEntitlement(): Promise<Entitlement> {
  if (!isBillingConfigured()) return OPEN;
  const P = purchases();
  if (!P) return cached;
  try {
    const next = fromCustomerInfo(await P.getCustomerInfo());
    cached = next;
    await persist(next);
    return next;
  } catch {
    // Offline: keep whatever we last knew, subject to grace.
    if (!withinGrace(cached, new Date())) cached = LOCKED;
    return cached;
  }
}

export type BillingResult =
  | { ok: true; entitlement: Entitlement }
  /** `message: ''` means the user cancelled — never surface that as an error. */
  | { ok: false; message: string };

const NOT_AVAILABLE: BillingResult = {
  ok: false,
  message: 'Subscriptions aren’t available in this build.',
};

/** The packages to show on the paywall, in the order RevenueCat returns them. */
export async function getPackages(): Promise<BillingPackage[]> {
  const P = purchases();
  if (!P) return [];
  try {
    const offerings = await P.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

export async function purchasePackage(pkg: BillingPackage): Promise<BillingResult> {
  const P = purchases();
  if (!P) return NOT_AVAILABLE;
  try {
    const { customerInfo } = await P.purchasePackage(pkg);
    const entitlement = fromCustomerInfo(customerInfo);
    cached = entitlement;
    await persist(entitlement);
    if (!entitlement.active) {
      return { ok: false, message: 'That purchase didn’t activate. Try Restore.' };
    }
    return { ok: true, entitlement };
  } catch (error) {
    if (isUserCancelled(error)) return { ok: false, message: '' };
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Restore purchases. Required by App Review for any non-consumable or
 * subscription, and the only recovery path after a reinstall or a new device.
 */
export async function restorePurchases(): Promise<BillingResult> {
  const P = purchases();
  if (!P) return NOT_AVAILABLE;
  try {
    const entitlement = fromCustomerInfo(await P.restorePurchases());
    cached = entitlement;
    await persist(entitlement);
    if (!entitlement.active) {
      return { ok: false, message: 'No previous subscription found for this Apple ID.' };
    }
    return { ok: true, entitlement };
  } catch (error) {
    if (isUserCancelled(error)) return { ok: false, message: '' };
    return { ok: false, message: readableError(error) };
  }
}

/**
 * Attach purchases to a signed-in identity so they follow the user across
 * devices. Called on sign-in; harmless when billing is off.
 */
export async function linkBillingUser(userId: string): Promise<void> {
  const P = purchases();
  if (!P) return;
  try {
    const { customerInfo } = await P.logIn(userId);
    cached = fromCustomerInfo(customerInfo);
    await persist(cached);
  } catch {
    // Non-fatal: the purchase still belongs to the store account.
  }
}

export async function unlinkBillingUser(): Promise<void> {
  const P = purchases();
  if (!P) return;
  try {
    cached = fromCustomerInfo(await P.logOut());
    await persist(cached);
  } catch {
    /* non-fatal */
  }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function isUserCancelled(error: unknown): boolean {
  const e = error as { userCancelled?: boolean; code?: string | number } | null;
  return Boolean(e?.userCancelled) || e?.code === '1' || e?.code === 1;
}

function readableError(error: unknown): string {
  const e = error as { message?: string; underlyingErrorMessage?: string } | null;
  const message = e?.message || e?.underlyingErrorMessage || '';
  if (/network|offline|connection/i.test(message)) {
    return 'Couldn’t reach the App Store. Check your connection.';
  }
  return message || 'That didn’t go through. Try again.';
}
