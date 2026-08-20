/**
 * Billing fixtures — a development-only store, so the funnel can be built and
 * verified without a RevenueCat account.
 *
 * ## Why this exists
 *
 * Purchases, trials and offers cannot be exercised in a simulator: they need a
 * RevenueCat project, App Store Connect products, an EAS build and a sandbox
 * tester. But almost everything that goes *wrong* with a paywall is layout —
 * a price colliding with its label at the accessibility text sizes, a trial
 * timeline that overflows, a retention screen with nothing to say. None of that
 * needs a real store; it needs realistic data.
 *
 * Entitlement shapes in particular are just data, so every retention state
 * (trialing, cancelled-but-still-active, lapsed, failed charge) can be driven
 * directly and looked at.
 *
 * ## Safety
 *
 * Two independent guards, matching the convention `lib/seed.ts` already
 * follows for demo content:
 *
 *   1. `__DEV__` — false in every EAS preview and release build, so this cannot
 *      reach a user even if the env var were set.
 *   2. `EXPO_PUBLIC_BILLING_FIXTURE` — absent by default, so an ordinary `npx
 *      expo start` behaves exactly as it always has.
 *
 * `scripts/verify-degradation.mjs` pins both: with the variable unset, every
 * function here is inert.
 *
 * ## Use
 *
 *   EXPO_PUBLIC_BILLING_FIXTURE=none        # signed out of premium — the offer
 *   EXPO_PUBLIC_BILLING_FIXTURE=trialing    # day 2 of the free trial
 *   EXPO_PUBLIC_BILLING_FIXTURE=subscribed  # paying and renewing
 *   EXPO_PUBLIC_BILLING_FIXTURE=cancelled   # renewal off, 6 days left
 *   EXPO_PUBLIC_BILLING_FIXTURE=lapsed      # ended last month
 *   EXPO_PUBLIC_BILLING_FIXTURE=billing     # Apple reported a failed charge
 *
 * Prices here are the ones mirrored into App Store Connect, so the computed
 * saving and the trial length read exactly as they will in production.
 */
import type { BillingPackage, Entitlement, RedeemableOffer, SubscriptionHistory } from './billing';
import { PREMIUM_ENTITLEMENT } from './config';

export type FixtureState =
  | 'none'
  | 'trialing'
  | 'subscribed'
  | 'cancelled'
  | 'lapsed'
  | 'billing';

const RAW = process.env.EXPO_PUBLIC_BILLING_FIXTURE ?? '';

const STATES: FixtureState[] = ['none', 'trialing', 'subscribed', 'cancelled', 'lapsed', 'billing'];

/**
 * True only inside a Metro-bundled development build.
 *
 * `__DEV__` is injected by Metro and simply does not exist anywhere else — so a
 * bare reference throws a ReferenceError under plain Node, which is exactly
 * where `scripts/verify-degradation.mjs` and `scripts/verify-funnel.mjs` load
 * this module from. `typeof` first, then read: outside a bundler the answer is
 * "not a dev build", which is both true and the safe direction.
 */
function isDevBuild(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * The active fixture, or null in any build that must behave normally.
 *
 * The dev-build check is first and is the load-bearing guard; the env var only
 * decides which scenario a developer wanted.
 */
export function fixtureState(): FixtureState | null {
  if (!isDevBuild()) return null;
  const value = RAW.trim().toLowerCase();
  return (STATES as string[]).includes(value) ? (value as FixtureState) : null;
}

/** True when this process should serve fixtures instead of the real store. */
export function fixturesEnabled(): boolean {
  return fixtureState() !== null;
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** The two products, shaped exactly as RevenueCat returns them. */
export function fixturePackages(): BillingPackage[] {
  return [
    {
      identifier: '$rc_annual',
      packageType: 'ANNUAL',
      product: {
        identifier: 'silo_premium_yearly',
        price: 39.99,
        priceString: '$39.99',
        title: 'Silo Premium (Yearly)',
        description: 'The AI layer, billed yearly',
        introPrice: {
          price: 0,
          priceString: '$0.00',
          periodUnit: 'DAY',
          periodNumberOfUnits: 7,
          cycles: 1,
        },
        discounts: null,
      },
    },
    {
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      product: {
        identifier: 'silo_premium_monthly',
        price: 6.99,
        priceString: '$6.99',
        title: 'Silo Premium (Monthly)',
        description: 'The AI layer, billed monthly',
        introPrice: {
          price: 0,
          priceString: '$0.00',
          periodUnit: 'DAY',
          periodNumberOfUnits: 7,
          cycles: 1,
        },
        discounts: null,
      },
    },
  ];
}

/**
 * Whether the fixture user can still be given the introductory trial.
 *
 * Anyone who has held a subscription has used theirs, which is what makes the
 * lapsed and cancelled screens interesting: they must NOT show trial language.
 */
export function fixtureIntroEligible(): boolean {
  const state = fixtureState();
  return state === 'none';
}

/**
 * A win-back offer, for the states where Apple would actually have one.
 *
 * Deliberately absent for `cancelled`, so that path renders its other branch —
 * "turn renewal back on in the App Store" — which is the honest action when no
 * real discounted product exists.
 */
export function fixtureOffer(): RedeemableOffer | null {
  return fixtureState() === 'lapsed'
    ? {
        kind: 'winback',
        priceString: '$19.99',
        periodUnit: 'YEAR',
        periodNumberOfUnits: 1,
        cycles: 1,
        payload: { fixture: true },
      }
    : null;
}

/** The entitlement each scenario produces. */
export function fixtureEntitlement(): Entitlement | null {
  const state = fixtureState();
  if (!state) return null;
  const base: Entitlement = {
    active: true,
    willRenew: true,
    expiresAt: null,
    productId: 'silo_premium_yearly',
    inTrial: false,
    managementUrl: 'https://apps.apple.com/account/subscriptions',
    billingIssueAt: null,
    unsubscribedAt: null,
  };
  switch (state) {
    case 'trialing':
      return { ...base, inTrial: true, expiresAt: daysFromNow(5) };
    case 'subscribed':
      return { ...base, expiresAt: daysFromNow(210) };
    case 'cancelled':
      return {
        ...base,
        willRenew: false,
        expiresAt: daysFromNow(6),
        unsubscribedAt: daysFromNow(-1),
      };
    case 'billing':
      return { ...base, expiresAt: daysFromNow(4), billingIssueAt: daysFromNow(-2) };
    case 'lapsed':
    case 'none':
    default:
      return {
        ...base,
        active: false,
        willRenew: false,
        expiresAt: null,
        productId: null,
      };
  }
}

/** History, so a lapsed fixture is distinguishable from a brand-new user. */
export function fixtureHistory(): SubscriptionHistory {
  const state = fixtureState();
  const everSubscribed = state !== null && state !== 'none';
  return {
    everSubscribed,
    lastExpiry: everSubscribed ? daysFromNow(-30) : null,
    productId: everSubscribed ? 'silo_premium_yearly' : null,
  };
}

/** Named so a reader of `lib/billing.ts` can see which entitlement key is meant. */
export const FIXTURE_ENTITLEMENT_KEY = PREMIUM_ENTITLEMENT;
