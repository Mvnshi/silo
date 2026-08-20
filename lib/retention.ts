/**
 * Where a subscriber stands, and what we are allowed to say about it.
 *
 * ## Why this is a module and not a few ternaries in Settings
 *
 * On iOS you cannot intercept a cancellation. It happens in Settings →
 * Subscriptions, outside the app, and the first Silo hears of it is a changed
 * `willRenew` on the next entitlement refresh. So every retention moment Silo
 * *can* act on is really a question about the shape of an entitlement, and
 * getting that shape wrong produces the two worst outcomes in subscription
 * software: telling a paying customer their payment failed, or telling someone
 * who cancelled that their subscription renews. Both generate support mail and
 * refund requests. So the classification is pure, exhaustive and verified
 * (`scripts/verify-funnel.mjs`) rather than inferred at each call site.
 *
 * ## The four real moments, in the order they are worth building
 *
 * 1. **`billingIssue`** — Apple reported a failed charge. The user never chose
 *    to leave, so this is not a persuasion problem, it is a broken card. It
 *    ranks first because it is the cheapest churn there is to recover and the
 *    only one where doing nothing is indefensible.
 * 2. **`cancelled`** — auto-renew off, still inside the paid period. The
 *    highest-intent moment we can actually see, with 100% coverage: however
 *    they cancelled, we learn about it on the next foreground refresh. There is
 *    a window of up to a full period to change their mind.
 * 3. **`lapsed`** — it ended. Win-back territory (iOS 18+ win-back offers, or a
 *    promotional offer), and the reason `subscriptionHistory()` exists at all.
 * 4. **`trialCancelled`** — they turned the trial off before it converted. Rare
 *    but very high signal: they engaged enough to start, then decided against.
 *
 * ## What this module refuses to do
 *
 * It never produces a price, a discount, or a percentage. Those come from the
 * store via `lib/billing.ts` and only ever from a real product. This module
 * decides *whether* to make an offer and what to say around it; the store
 * decides what the offer is, and if the store has nothing, the surface renders
 * without a number rather than inventing one.
 */
import type { Entitlement, SubscriptionHistory } from './billing';
import { OFFERING_DEFAULT, OFFERING_RETENTION, OFFERING_WINBACK } from './config';

export type RetentionState =
  /** Billing is not configured in this build — there is no subscription at all. */
  | 'open'
  /** Never subscribed, not subscribed now. */
  | 'none'
  /** Inside the introductory free trial, converting at the end. */
  | 'trialing'
  /** Inside the trial, but auto-renew is already off — it will not convert. */
  | 'trialCancelled'
  /** Paying and renewing. Nothing to ask for. */
  | 'subscribed'
  /** Still entitled, but Apple reported a failed charge. */
  | 'billingIssue'
  /** Paid period still running, auto-renew off. The retention moment. */
  | 'cancelled'
  /** It ended. The win-back moment. */
  | 'lapsed';

export interface RetentionSituation {
  state: RetentionState;
  /** Whole days until the entitlement ends; null when there is no known expiry. */
  daysLeft: number | null;
  /** ISO expiry, carried through so screens don't re-derive it. */
  endsAt: string | null;
  /** True when this warrants an unprompted banner rather than waiting for Settings. */
  urgent: boolean;
  /** Which RevenueCat offering this situation should load. */
  offering: string;
  /** `?context=` for app/paywall.tsx. */
  paywallContext: PaywallContext;
}

/**
 * Paywall variants. One screen renders all of them so the Guideline 3.1.2
 * furniture — price, period, renewal terms, ToS, Privacy, Restore, a real
 * "Not now" — physically cannot regress in one variant while surviving in
 * another.
 */
export type PaywallContext =
  | 'default'
  | 'onboarding'
  | 'screenshot'
  | 'assistant'
  | 'schedule'
  | 'allowance'
  | 'retention'
  | 'winback';

/** Whole days from `now` to `iso`, rounded up. Null on a missing/bad date. */
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

/**
 * Classify an entitlement.
 *
 * `configured` is passed rather than read so this stays pure and the verifier
 * can drive every branch without a RevenueCat key.
 */
export function situationFor(
  entitlement: Entitlement,
  history: SubscriptionHistory,
  configured: boolean,
  now: Date = new Date()
): RetentionSituation {
  if (!configured) {
    return {
      state: 'open',
      daysLeft: null,
      endsAt: null,
      urgent: false,
      offering: OFFERING_DEFAULT,
      paywallContext: 'default',
    };
  }

  const endsAt = entitlement.expiresAt;
  const daysLeft = daysUntil(endsAt, now);

  if (entitlement.active) {
    // A failed charge outranks everything else: it is involuntary, it is
    // fixable in one tap, and it is the only state where the user is about to
    // lose something they did not choose to give up.
    if (entitlement.billingIssueAt) {
      return {
        state: 'billingIssue',
        daysLeft,
        endsAt,
        urgent: true,
        offering: OFFERING_DEFAULT,
        paywallContext: 'default',
      };
    }
    if (entitlement.inTrial) {
      return entitlement.willRenew
        ? {
            state: 'trialing',
            daysLeft,
            endsAt,
            urgent: false,
            offering: OFFERING_DEFAULT,
            paywallContext: 'default',
          }
        : {
            state: 'trialCancelled',
            daysLeft,
            endsAt,
            urgent: true,
            offering: OFFERING_RETENTION,
            paywallContext: 'retention',
          };
    }
    if (!entitlement.willRenew) {
      return {
        state: 'cancelled',
        daysLeft,
        endsAt,
        urgent: true,
        offering: OFFERING_RETENTION,
        paywallContext: 'retention',
      };
    }
    return {
      state: 'subscribed',
      daysLeft,
      endsAt,
      urgent: false,
      offering: OFFERING_DEFAULT,
      paywallContext: 'default',
    };
  }

  if (history.everSubscribed) {
    return {
      state: 'lapsed',
      daysLeft: null,
      endsAt: history.lastExpiry,
      urgent: true,
      offering: OFFERING_WINBACK,
      paywallContext: 'winback',
    };
  }

  return {
    state: 'none',
    daysLeft: null,
    endsAt: null,
    urgent: false,
    offering: OFFERING_DEFAULT,
    paywallContext: 'default',
  };
}

/* ---------------------------------------------------------------------------
 * Copy
 *
 * Kept beside the state machine so a new state cannot be added without someone
 * having to decide what it says. Every string here is true for every user in
 * that state — nothing is conditional on a price, because prices come from the
 * store.
 * ------------------------------------------------------------------------- */

export interface RetentionCopy {
  /** Short status line, e.g. in Settings. */
  status: string;
  /** Banner headline, when `urgent`. */
  title: string;
  /** Banner body. */
  body: string;
  /** Label for the primary action. */
  action: string;
}

/**
 * Two forms on purpose. The compact one keeps the Settings row reading
 * "Ends 4 Sep" as it always has; the long one is for banner prose, where
 * "ends 4 Sep" scans worse than "ends September 4".
 */
function dateOf(iso: string | null, long = false): string {
  if (!iso) return 'soon';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'soon';
  return d.toLocaleDateString(
    undefined,
    long ? { month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' }
  );
}

export function retentionCopy(s: RetentionSituation): RetentionCopy {
  const when = dateOf(s.endsAt);
  const whenLong = dateOf(s.endsAt, true);
  switch (s.state) {
    case 'billingIssue':
      return {
        status: 'Payment problem',
        title: 'Your payment didn’t go through',
        // Deliberately not "you have been downgraded" — they haven't been.
        // Apple retries for days, and alarming someone whose card simply
        // expired is how you turn a fixable lapse into a real one.
        body: `Apple couldn’t charge your payment method. Silo Premium keeps working while they retry, but it ends ${whenLong} if it can’t be fixed.`,
        action: 'Update payment method',
      };
    case 'cancelled':
      return {
        // No expiry means a lifetime or otherwise open-ended entitlement, where
        // "Ends soon" would be alarming and false.
        status: s.endsAt ? `Ends ${when}` : 'Active',
        title: 'Your Premium ends soon',
        body: `You’ve turned off renewal, so Silo Premium ends ${whenLong}. Everything you’ve saved stays — it’s the AI layer that switches off.`,
        action: 'Keep Premium',
      };
    case 'trialCancelled':
      return {
        status: `Trial ends ${when}`,
        title: 'Your trial won’t convert',
        body: `You won’t be charged. Premium stops ${whenLong} and Silo carries on free — saving, stacks, the calendar and every nudge.`,
        action: 'Keep Premium',
      };
    case 'lapsed':
      return {
        status: 'Premium ended',
        title: 'Pick up where you left off',
        body: 'Everything you saved is still here. Turn the AI layer back on whenever you want it.',
        action: 'See options',
      };
    case 'trialing':
      return {
        status: `Trial — first charge ${when}`,
        title: 'You’re on the free trial',
        body: `Full access until ${whenLong}.`,
        action: 'Manage',
      };
    case 'subscribed':
      return {
        status: s.endsAt ? `Renews ${when}` : 'Renews automatically',
        title: 'Silo Premium',
        body: 'Thanks for supporting Silo.',
        action: 'Manage',
      };
    case 'none':
    case 'open':
    default:
      return {
        status: 'Free',
        title: 'Silo Premium',
        body: 'The AI layer on top of everything you save.',
        action: 'See Premium',
      };
  }
}

/**
 * Headline + subhead for each paywall variant.
 *
 * The contextual ones name the thing the user was *just* trying to do. A
 * paywall that says "Unlock Premium" after someone tapped a screenshot is a
 * different, and much worse, screen than one that says "Silo can read your
 * screenshots" — the second is an answer to a question they actually asked.
 */
export function paywallHeadline(context: PaywallContext): { title: string; subtitle: string } {
  switch (context) {
    case 'onboarding':
      return {
        title: 'Try the whole thing',
        subtitle:
          'Silo is free to use forever. Premium adds the AI layer — start with a free trial and see if it earns its place.',
      };
    case 'screenshot':
      return {
        title: 'Let Silo read your screenshots',
        subtitle:
          'Premium titles, tags and files every screenshot the moment you save it, so you never scroll a wall of thumbnails looking for one.',
      };
    case 'assistant':
      return {
        title: 'Ask Silo what you saved',
        subtitle:
          'Premium turns everything in your library into something you can just ask a question about.',
      };
    case 'schedule':
      return {
        title: 'Let Silo pick the time',
        subtitle:
          'Premium reads your calendar and suggests when you could actually do the thing, instead of leaving you to find a slot.',
      };
    case 'allowance':
      return {
        title: 'You’ve used your free AI actions',
        subtitle:
          'Saving, stacks, the calendar and every nudge stay free forever. Premium keeps the AI layer running.',
      };
    case 'retention':
      return {
        title: 'Before you go',
        subtitle:
          'Everything you’ve saved stays yours either way. This is just the AI layer — here’s what turning it off costs you.',
      };
    case 'winback':
      return {
        title: 'Welcome back',
        subtitle:
          'Your library is exactly where you left it. Turning Premium back on picks up the AI layer where it stopped.',
      };
    case 'default':
    default:
      return {
        title: 'Silo Premium',
        subtitle:
          'Saving, organizing and resurfacing stay free, forever. Premium adds the AI layer on top.',
      };
  }
}
