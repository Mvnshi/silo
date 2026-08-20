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
 *
 * ## Retention offers, and the one rule that governs them
 *
 * **Never render a price that no real StoreKit product backs.** iOS gives us
 * exactly three mechanisms, all of which resolve to real products:
 *
 * - *Introductory offers* — the 7-day trial. Apple applies it automatically and
 *   allows ONE per subscription group per Apple ID, which is why
 *   `introEligibility()` exists: promising a trial to someone who has already
 *   used theirs is a false claim at the point of purchase.
 * - *Promotional offers* — a discount for an existing or lapsed subscriber,
 *   signed server-side. RevenueCat does the signing; we surface whatever
 *   `product.discounts` actually contains and nothing else.
 * - *Win-back offers* (iOS 18+) — Apple's native churn recovery, configured in
 *   App Store Connect and read back through `winBackOffersFor()`.
 *
 * Every one of those helpers returns null/empty when nothing is configured, and
 * the screens above them are written to show no discount at all in that case
 * rather than a number we made up. That is the difference between an aggressive
 * funnel and a rejected one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { PREMIUM_ENTITLEMENT } from './config';
import {
  fixtureEntitlement,
  fixtureHistory,
  fixtureIntroEligible,
  fixtureOffer,
  fixturePackages,
  fixturesEnabled,
} from './billingFixtures';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

/** Days a known-good entitlement survives past its expiry (billing retry / offline). */
const GRACE_DAYS = 3;
const CACHE_KEY = 'silo:entitlement:v1';
/**
 * Durable "this Apple ID once paid us" marker.
 *
 * Needed because a lapse resolves to LOCKED, which by design carries no expiry
 * and no product id — so the moment a subscription ends, the entitlement itself
 * stops remembering there ever was one. Win-back has to know the difference
 * between someone who never subscribed and someone who just left; without this
 * both look identical and the lapsed user gets pitched as a stranger.
 */
const HISTORY_KEY = 'silo:subHistory:v1';

function apiKey(): string {
  return Platform.OS === 'android' ? ANDROID_KEY : IOS_KEY;
}

/**
 * True when this build can actually sell something.
 *
 * A fixture build counts, so the whole subscription surface renders and can be
 * looked at. `fixturesEnabled()` is `__DEV__`-only — see `lib/billingFixtures`.
 */
export function isBillingConfigured(): boolean {
  return fixturesEnabled() || apiKey().length > 0;
}

/* ---------------------------------------------------------------------------
 * The SDK, behind a narrow surface
 *
 * Only the handful of calls Silo makes are typed here. The alternative — typing
 * against the SDK's exported types at module scope — would make this file fail
 * to compile in an environment where the native module isn't installed, which is
 * exactly the environment the degradation contract exists to serve.
 * ------------------------------------------------------------------------- */

/** One period of a discount or introductory offer, as the store describes it. */
export interface BillingOfferPeriod {
  price: number;
  priceString: string;
  /** 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' */
  periodUnit: string;
  periodNumberOfUnits: number;
  /** How many billing periods the offer runs for. */
  cycles: number;
}

/** A promotional/win-back discount attached to a product. */
export interface BillingDiscount extends BillingOfferPeriod {
  identifier: string;
}

export interface BillingPackage {
  identifier: string;
  /** 'MONTHLY' | 'ANNUAL' | … */
  packageType: string;
  product: {
    identifier: string;
    /** Numeric price in the local currency — the only safe basis for maths. */
    price: number;
    priceString: string;
    title: string;
    description: string;
    /** The introductory offer (free trial), when the product has one. */
    introPrice?: BillingOfferPeriod | null;
    /** Promotional offers configured for this product. iOS only; null on Android. */
    discounts?: BillingDiscount[] | null;
  };
}

/** An offer the store has confirmed this user can actually be given. */
export interface RedeemableOffer {
  kind: 'winback' | 'promotional';
  /** The store's own formatted price for the discounted period. */
  priceString: string;
  periodUnit: string;
  periodNumberOfUnits: number;
  cycles: number;
  /** Opaque SDK payload — passed straight back into the purchase call. */
  payload: unknown;
}

interface CustomerInfo {
  entitlements: {
    active: Record<string, {
      identifier: string;
      willRenew: boolean;
      periodType: string;
      expirationDate: string | null;
      productIdentifier: string;
      /** Set once Apple reports a failed charge — a real, recoverable churn state. */
      billingIssueDetectedAt?: string | null;
      /** Set the moment the user turns off auto-renew, while still entitled. */
      unsubscribeDetectedAt?: string | null;
    }>;
  };
  managementURL: string | null;
}

interface BillingOffering {
  availablePackages: BillingPackage[];
}

interface PurchasesSdk {
  configure(opts: { apiKey: string; appUserID?: string | null }): void;
  getCustomerInfo(): Promise<CustomerInfo>;
  getOfferings(): Promise<{
    current: BillingOffering | null;
    all?: Record<string, BillingOffering>;
  }>;
  purchasePackage(pkg: BillingPackage): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<CustomerInfo>;
  logIn(userId: string): Promise<{ customerInfo: CustomerInfo }>;
  logOut(): Promise<CustomerInfo>;
  addCustomerInfoUpdateListener(cb: (info: CustomerInfo) => void): void;
  /** iOS only, and absent on older SDKs — always call through `optional()`. */
  checkTrialOrIntroductoryPriceEligibility?(
    productIds: string[]
  ): Promise<Record<string, { status: number }>>;
  getEligibleWinBackOffersForPackage?(
    pkg: BillingPackage
  ): Promise<BillingDiscount[] | undefined>;
  purchasePackageWithWinBackOffer?(
    pkg: BillingPackage,
    offer: unknown
  ): Promise<{ customerInfo: CustomerInfo }>;
  getPromotionalOffer?(
    product: BillingPackage['product'],
    discount: BillingDiscount
  ): Promise<unknown>;
  purchaseDiscountedPackage?(
    pkg: BillingPackage,
    offer: unknown
  ): Promise<{ customerInfo: CustomerInfo }>;
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
  return fixturesEnabled() || purchases() !== null;
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
  /**
   * When Apple reported a failed charge, if it has. Distinct from a cancel:
   * the user did not choose to leave, so the fix is a payment method rather
   * than an offer, and saying "your payment didn't go through" is only honest
   * when this is actually set.
   */
  billingIssueAt: string | null;
  /** When auto-renew was switched off, if it has been. */
  unsubscribedAt: string | null;
}

/** An unconfigured build is entitled to everything: no gate exists to fail. */
export const OPEN: Entitlement = {
  active: true,
  willRenew: false,
  expiresAt: null,
  productId: null,
  inTrial: false,
  managementUrl: null,
  billingIssueAt: null,
  unsubscribedAt: null,
};

const LOCKED: Entitlement = { ...OPEN, active: false };

/* ---------------------------------------------------------------------------
 * Subscription history
 * ------------------------------------------------------------------------- */

export interface SubscriptionHistory {
  /** True once we have ever seen this install hold an active entitlement. */
  everSubscribed: boolean;
  /** The last expiry we saw while they were still entitled. */
  lastExpiry: string | null;
  /** The last product they held — the one a win-back offer should target. */
  productId: string | null;
}

const NO_HISTORY: SubscriptionHistory = {
  everSubscribed: false,
  lastExpiry: null,
  productId: null,
};

let history: SubscriptionHistory = NO_HISTORY;

/** What we know about this install's past subscriptions. Synchronous. */
export function subscriptionHistory(): SubscriptionHistory {
  return fixturesEnabled() ? fixtureHistory() : history;
}

async function loadHistory(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (raw) history = { ...NO_HISTORY, ...(JSON.parse(raw) as SubscriptionHistory) };
  } catch {
    // No history just means we treat a lapsed user as new — the safe direction.
  }
}

/**
 * Remember an active entitlement so a later lapse is recognisable.
 *
 * Only ever writes while the entitlement IS active: reconstructing history from
 * the locked state is what we are trying to avoid, and an expiry recorded after
 * the fact would be the grace-window expiry rather than the real one.
 */
async function rememberActive(e: Entitlement): Promise<void> {
  if (!e.active) return;
  const next: SubscriptionHistory = {
    everSubscribed: true,
    lastExpiry: e.expiresAt ?? history.lastExpiry,
    productId: e.productId ?? history.productId,
  };
  if (
    next.everSubscribed === history.everSubscribed &&
    next.lastExpiry === history.lastExpiry &&
    next.productId === history.productId
  ) {
    return;
  }
  history = next;
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
}

/**
 * Last known entitlement, readable synchronously.
 *
 * `lib/api.ts` gates on this: an async check there would mean every AI call
 * awaits the network before deciding whether it is even allowed to happen.
 */
let cached: Entitlement = OPEN;

export function cachedEntitlement(): Entitlement {
  const fixture = fixtureEntitlement();
  if (fixture) return fixture;
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
    billingIssueAt: e.billingIssueDetectedAt ?? null,
    unsubscribedAt: e.unsubscribeDetectedAt ?? null,
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
  // Every entitlement write funnels through here, so this is the one place
  // history can be recorded without a caller being able to forget to.
  await rememberActive(e);
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
  const fixture = fixtureEntitlement();
  if (fixture) return fixture;
  if (!isBillingConfigured()) return OPEN;

  await loadHistory();
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
  const fixture = fixtureEntitlement();
  if (fixture) return fixture;
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

/**
 * The packages to show on a paywall, in the order RevenueCat returns them.
 *
 * `offeringId` selects a NAMED offering — the retention and win-back surfaces
 * ask for their own so a discounted product can be swapped in from the
 * dashboard without an app update. A named offering that does not exist falls
 * back to the current one, which is the honest default: the user sees the
 * standard price rather than a discount that was never configured.
 */
export async function getPackages(offeringId?: string): Promise<BillingPackage[]> {
  if (fixturesEnabled()) return fixturePackages();
  const P = purchases();
  if (!P) return [];
  try {
    const offerings = await P.getOfferings();
    if (offeringId) {
      const named = offerings.all?.[offeringId]?.availablePackages;
      if (named && named.length > 0) return named;
    }
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

/** True when a named offering actually exists in the dashboard. */
export async function hasOffering(offeringId: string): Promise<boolean> {
  const P = purchases();
  if (!P) return false;
  try {
    const offerings = await P.getOfferings();
    return (offerings.all?.[offeringId]?.availablePackages?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Offers
 *
 * Everything here answers the same question — "what is this specific user
 * actually allowed to be shown?" — and every one of them returns nothing when
 * the answer is unknown. A screen that gets null renders no offer, never a
 * placeholder discount.
 * ------------------------------------------------------------------------- */

/** RevenueCat's INTRO_ELIGIBILITY_STATUS. 2 = eligible. */
const ELIGIBLE = 2;

/**
 * Can this Apple ID still be given the introductory free trial?
 *
 * Apple allows one intro offer per subscription group per Apple ID, so a
 * returning user is often ineligible — and telling them "start your 7-day free
 * trial" when Apple will charge them immediately is a false claim at the point
 * of purchase, which is exactly what Guideline 3.1.2 is about.
 *
 * Returns `null` when we genuinely cannot tell (older SDK, Android, a store
 * error). Callers treat null as "don't promise a trial", not as "no trial".
 */
export async function introEligibility(productId: string): Promise<boolean | null> {
  if (fixturesEnabled()) return fixtureIntroEligible();
  const P = purchases();
  if (!P?.checkTrialOrIntroductoryPriceEligibility) return null;
  try {
    const result = await P.checkTrialOrIntroductoryPriceEligibility([productId]);
    const status = result?.[productId]?.status;
    if (typeof status !== 'number') return null;
    return status === ELIGIBLE;
  } catch {
    return null;
  }
}

/**
 * The best offer Apple will actually honour for this package right now.
 *
 * Tries win-back offers first (iOS 18+, configured in App Store Connect, and
 * the only mechanism aimed squarely at someone who has already lapsed), then
 * falls back to a signed promotional offer built from the product's own
 * discounts. Null means: show the standard price.
 */
export async function bestOfferFor(pkg: BillingPackage): Promise<RedeemableOffer | null> {
  if (fixturesEnabled()) return fixtureOffer();
  const P = purchases();
  if (!P) return null;

  if (P.getEligibleWinBackOffersForPackage) {
    try {
      const offers = await P.getEligibleWinBackOffersForPackage(pkg);
      const offer = offers?.[0];
      if (offer) {
        return {
          kind: 'winback',
          priceString: offer.priceString,
          periodUnit: offer.periodUnit,
          periodNumberOfUnits: offer.periodNumberOfUnits,
          cycles: offer.cycles,
          payload: offer,
        };
      }
    } catch {
      // Not on iOS 18, or none configured — fall through to promotional.
    }
  }

  const discount = pkg.product.discounts?.[0];
  if (discount && P.getPromotionalOffer) {
    try {
      // RevenueCat signs this with the subscription key; an unsigned discount
      // is rejected by StoreKit, so a null here must not become a rendered price.
      const signed = await P.getPromotionalOffer(pkg.product, discount);
      if (signed) {
        return {
          kind: 'promotional',
          priceString: discount.priceString,
          periodUnit: discount.periodUnit,
          periodNumberOfUnits: discount.periodNumberOfUnits,
          cycles: discount.cycles,
          payload: signed,
        };
      }
    } catch {
      // Signing failed — show the standard price rather than a broken offer.
    }
  }

  return null;
}

/**
 * The annual saving against the monthly plan, as a whole percent.
 *
 * Computed from the NUMERIC prices, never from `priceString` — that is
 * localised ("39,99 €", "¥4,800") and parsing it would produce wrong numbers in
 * most of the world. Returns null unless both real prices are present and the
 * annual plan genuinely costs less, so the badge simply does not render rather
 * than claiming a saving that isn't there.
 */
export function annualSavingPercent(
  annual: BillingPackage | undefined,
  monthly: BillingPackage | undefined
): number | null {
  const yearly = annual?.product.price;
  const perMonth = monthly?.product.price;
  if (!yearly || !perMonth || yearly <= 0 || perMonth <= 0) return null;
  const full = perMonth * 12;
  if (yearly >= full) return null;
  return Math.round((1 - yearly / full) * 100);
}

/**
 * The real length of a package's free trial, in days.
 *
 * Read from the store rather than from `TRIAL_DAYS` so the screen can never
 * disagree with what App Store Connect is configured to give. Null when the
 * product carries no introductory offer.
 */
export function trialDaysFor(pkg: BillingPackage | undefined): number | null {
  const intro = pkg?.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const n = intro.periodNumberOfUnits;
  switch (intro.periodUnit) {
    case 'DAY':
      return n;
    case 'WEEK':
      return n * 7;
    case 'MONTH':
      return n * 30;
    case 'YEAR':
      return n * 365;
    default:
      return null;
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
 * Buy a package with a store-issued offer applied.
 *
 * The offer must have come from `bestOfferFor` — that is what guarantees the
 * discount is real, signed and eligible. If the SDK on this build has no
 * discounted-purchase entry point, this falls back to the standard price rather
 * than failing: charging the normal amount is recoverable, showing a discount
 * that cannot be honoured is not.
 */
export async function purchaseWithOffer(
  pkg: BillingPackage,
  offer: RedeemableOffer
): Promise<BillingResult> {
  const P = purchases();
  if (!P) return NOT_AVAILABLE;

  const buy =
    offer.kind === 'winback' ? P.purchasePackageWithWinBackOffer : P.purchaseDiscountedPackage;
  if (!buy) return purchasePackage(pkg);

  try {
    const { customerInfo } = await buy.call(P, pkg, offer.payload);
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
