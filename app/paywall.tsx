/**
 * Paywall — what premium buys, what stays free, and every variant of the ask.
 *
 * ## One screen, seven contexts
 *
 * `?context=` swaps the headline and the emphasis; everything else is shared.
 * That is deliberate. The App Review furniture — price, period, renewal terms,
 * working ToS and Privacy links, Restore, and a genuinely reachable "Not now" —
 * lives in exactly one place, so it cannot quietly regress in the contextual
 * variant while surviving in the default one. A second paywall file is how an
 * app ends up with a compliant screen nobody sees and a non-compliant one
 * everybody does.
 *
 * ## The rules this screen will not break
 *
 * - **Every price comes from the store.** `priceString` when offerings have
 *   loaded, the `lib/config` constants only as pre-load fallback copy. The
 *   annual saving is computed from NUMERIC prices and simply does not render if
 *   either is missing — a localised `priceString` cannot be parsed into maths.
 * - **The trial is only promised to someone who can have it.** Apple allows one
 *   introductory offer per subscription group per Apple ID. `introEligibility()`
 *   is checked before any trial language appears; when the answer is unknown we
 *   say nothing rather than guess, because "start your free trial" shown to an
 *   ineligible user is a false claim at the point of purchase.
 * - **A discount is shown only when a real, signed, eligible offer exists.**
 *   `bestOfferFor()` returns null unless the store confirmed one, and null means
 *   the standard price — never a placeholder percentage.
 * - **"Not now" is a full-width, full-height control in the reading order.** A
 *   hidden or delayed dismiss is an App Review rejection and the reason funnels
 *   convert once and churn forever.
 *
 * ## Motion
 *
 * The card enters with `enterRise`, not a fade. An opacity animation on a glass
 * view — or any ancestor of one — stops the material rendering rather than
 * fading it, so the card would arrive as an empty hole.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import TrialTimeline from '@/components/TrialTimeline';
import { useToast } from '@/components/ui/Toast';
import { usePremium } from '@/components/PremiumProvider';
import {
  BillingPackage,
  RedeemableOffer,
  annualSavingPercent,
  bestOfferFor,
  getPackages,
  introEligibility,
  purchasePackage,
  purchaseWithOffer,
  restorePurchases,
  trialDaysFor,
} from '@/lib/billing';
import { isAuthConfigured } from '@/lib/auth';
import { hasNotificationPermission } from '@/lib/notifications';
import { paywallHeadline, situationFor, type PaywallContext } from '@/lib/retention';
import { computeStats, type SiloStats } from '@/lib/stats';
import { getItems, setOnboarded } from '@/lib/storage';
import { celebrationHaptic } from '@/lib/haptics';
import {
  OFFERING_DEFAULT,
  PRICE_MONTHLY,
  PRICE_YEARLY,
  PRIVACY_URL,
  TERMS_URL,
  TRIAL_DAYS,
  TRIAL_REMINDER_DAYS_BEFORE,
} from '@/lib/config';
import { BRAND, MAX_DISPLAY_SCALE, RADIUS, SHADOW, SPACE, TYPE } from '@/lib/theme';
import { enterRise, usePrefersReducedMotion } from '@/lib/motion';
import Animated from 'react-native-reanimated';

/** What the subscription actually buys. Mirrors `METERED_TASKS` in `lib/api.ts`. */
const PREMIUM_LINES = [
  { icon: 'sparkles' as const, text: 'AI titles, tags and categories for screenshots' },
  { icon: 'chatbubbles-outline' as const, text: 'Ask Silo anything about what you’ve saved' },
  { icon: 'calendar-outline' as const, text: 'Smart suggestions for when to actually do it' },
];

/** Named explicitly so the free tier is never misrepresented. */
const FREE_LINES = [
  'Unlimited saves, links, screenshots and notes',
  'Link titles, thumbnails and inline playback',
  'Stacks, search, the calendar and the map',
  'Every reminder and resurfacing nudge',
];

/**
 * Above this text scale the plan rows stack instead of sitting side by side.
 * A label and a price on one line collide somewhere around here, and a price
 * the user cannot read is worse than one that costs a little vertical space.
 */
const STACK_ABOVE_FONT_SCALE = 1.35;

/** 'year' / 'month' from a RevenueCat package type. */
function periodLabel(packageType: string | undefined): 'year' | 'month' {
  return packageType === 'ANNUAL' ? 'year' : 'month';
}

/**
 * A true sentence describing a discounted offer, built only from real values.
 * Falls back to a vaguer but still accurate form when the shape is unusual,
 * rather than asserting a cadence the store didn't describe.
 */
function offerTerms(offer: RedeemableOffer, pkg: BillingPackage): string {
  const base = `${pkg.product.priceString}/${periodLabel(pkg.packageType)}`;
  const unit = offer.periodUnit.toLowerCase();
  const n = offer.periodNumberOfUnits;
  const per = n === 1 ? unit : `${n} ${unit}s`;
  if (offer.cycles === 1) {
    return `${offer.priceString} for your first ${per}, then ${base}.`;
  }
  if (n === 1) {
    return `${offer.priceString} per ${unit} for ${offer.cycles} ${unit}s, then ${base}.`;
  }
  return `${offer.priceString} per ${per} for ${offer.cycles} periods, then ${base}.`;
}

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const { fontScale } = useWindowDimensions();
  const toast = useToast();
  const { configured, unavailable, isPremium, entitlement, history, refresh } = usePremium();

  const params = useLocalSearchParams<{ context?: string; first?: string; manage?: string }>();
  const context = (params.context ?? 'default') as PaywallContext;
  /** Arrived as the last beat of onboarding — leaving must continue the chain. */
  const fromOnboarding = params.first === '1';
  /**
   * Arrived from Settings → "Manage subscription". One beat before handing off
   * to Apple, never instead of it: the route to the App Store stays a single,
   * clearly-labelled tap on this screen, alongside the ordinary dismiss.
   * Obstructing subscription management is both an App Review problem and the
   * thing that makes people cancel angrily rather than quietly.
   */
  const fromManage = params.manage === '1';

  const situation = situationFor(entitlement, history, configured);
  /** Retention and win-back load their own offering when one is configured. */
  const offeringId =
    context === 'retention' || context === 'winback' ? situation.offering : OFFERING_DEFAULT;

  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  /** null = not yet known, and "not yet known" must not promise a trial. */
  const [trialOk, setTrialOk] = useState<boolean | null>(null);
  const [offer, setOffer] = useState<RedeemableOffer | null>(null);
  const [stats, setStats] = useState<SiloStats | null>(null);
  /** Whether we can actually keep the "we'll remind you" promise. */
  const [canRemind, setCanRemind] = useState(false);

  const monthly = packages.find((p) => p.packageType === 'MONTHLY');
  const annual = packages.find((p) => p.packageType === 'ANNUAL');
  const headline = paywallHeadline(context);
  const stacked = fontScale > STACK_ABOVE_FONT_SCALE;
  const showLoss = context === 'retention' && !!stats && stats.totalSaves > 0;
  /**
   * Still entitled, but on the way out. This branch exists because such a user
   * CANNOT simply buy again — they already hold an active subscription in the
   * group, so the store would refuse it. The only two real paths are a
   * promotional offer (which is precisely what promotional offers are for) or
   * Apple's own manage page to switch renewal back on. Rendering plan buttons
   * here would be an offer we cannot honour.
   */
  const stillEntitled = context === 'retention' && entitlement.active;
  const manageUrl = entitlement.managementUrl ?? 'https://apps.apple.com/account/subscriptions';

  /* Offerings, then everything that depends on knowing the real products. */
  useEffect(() => {
    let alive = true;
    getPackages(offeringId)
      .then(async (list) => {
        if (!alive) return;
        setPackages(list);
        const primary = list.find((p) => p.packageType === 'ANNUAL') ?? list[0];
        if (!primary) return;
        // Eligibility and offers are independent; neither should block the other.
        const [eligible, best] = await Promise.all([
          introEligibility(primary.product.identifier),
          context === 'retention' || context === 'winback'
            ? bestOfferFor(primary)
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setTrialOk(eligible);
        setOffer(best);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [offeringId, context]);

  /* The timeline claims we will send a reminder; only say so if we can. */
  useEffect(() => {
    let alive = true;
    hasNotificationPermission()
      .then((ok) => alive && setCanRemind(ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* Their own numbers — the most persuasive thing a retention screen can show. */
  useEffect(() => {
    if (context !== 'retention') return;
    let alive = true;
    getItems()
      .then((items) => alive && setStats(computeStats(items)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [context]);

  /**
   * Leaving. From onboarding this continues the first-run chain rather than
   * popping — a `back()` there would land on a screen no longer in the stack.
   */
  const leave = useCallback(async () => {
    if (fromOnboarding) {
      if (isAuthConfigured()) {
        router.replace('/sign-in?first=1');
      } else {
        await setOnboarded();
        router.replace('/(tabs)');
      }
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [fromOnboarding, router]);

  async function buy(pkg: BillingPackage) {
    setBusy(pkg.identifier);
    try {
      // A discounted purchase only happens when the store actually issued an
      // offer for this package; otherwise this is the ordinary price.
      const result =
        offer && pkg === (annual ?? packages[0])
          ? await purchaseWithOffer(pkg, offer)
          : await purchasePackage(pkg);
      if (result.ok) {
        // Refreshing is also what schedules the trial reminder the timeline
        // promises — PremiumProvider owns that lane, keyed off the entitlement.
        await refresh();
        await celebrationHaptic().catch(() => {});
        toast.show({ message: 'You’re on Silo Premium', tone: 'success' });
        void leave();
      } else if (result.message) {
        toast.show({ message: result.message, tone: 'danger' });
      }
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy('restore');
    try {
      const result = await restorePurchases();
      if (result.ok) {
        await refresh();
        toast.show({ message: 'Subscription restored', tone: 'success' });
        void leave();
      } else if (result.message) {
        toast.show({ message: result.message, tone: 'danger' });
      }
    } finally {
      setBusy(null);
    }
  }

  /* --- Truthful copy, assembled from whatever the store actually told us --- */

  const annualPrice = annual?.product.priceString ?? PRICE_YEARLY;
  const monthlyPrice = monthly?.product.priceString ?? PRICE_MONTHLY;
  const saving = annualSavingPercent(annual, monthly);
  // The store's own trial length wins over the constant, so the screen can
  // never disagree with what App Store Connect is configured to give.
  const trialDays = trialDaysFor(annual) ?? trialDaysFor(monthly) ?? TRIAL_DAYS;
  const showTrial = trialOk === true && !isPremium;

  const termsLine = offer
    ? offerTerms(offer, annual ?? packages[0])
    : showTrial
      ? `A ${trialDays}-day free trial, then ${annualPrice}/year or ${monthlyPrice}/month.`
      : `${annualPrice}/year or ${monthlyPrice}/month.`;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[BRAND[700], BRAND[500], '#6366f1']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[styles.orb, styles.orbTop]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbBottom]} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + SPACE.xl, paddingBottom: insets.bottom + SPACE.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.mark}>
            <Ionicons
              name={context === 'winback' ? 'refresh' : 'sparkles'}
              size={28}
              color="#fff"
            />
          </View>
          {/* Display text is capped per the rule in lib/theme: body copy scales
              without limit, but a 34pt heading at the accessibility sizes wraps
              mid-word and pushes everything below it off the screen. */}
          <Text
            style={styles.title}
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_DISPLAY_SCALE}
          >
            {headline.title}
          </Text>
          <Text style={styles.subtitle}>{headline.subtitle}</Text>
        </View>

        {/* Retention: their own numbers, not ours. Nothing here is a claim about
            the product — it is a record of what this person already did. */}
        {showLoss && stats && (
          <View style={styles.lossRow}>
            <LossStat value={String(stats.totalSaves)} label="saved" />
            <LossStat value={String(stats.totalUses)} label="actually done" />
            <LossStat
              value={stats.streakWeeks > 0 ? `${stats.streakWeeks}w` : stats.level.name}
              label={stats.streakWeeks > 0 ? 'streak' : 'level'}
            />
          </View>
        )}

        <Animated.View entering={enterRise(1, reduced)} style={styles.cardShadow}>
          <Glass variant="regular" tint="dark" radius={RADIUS.xxl} style={styles.card}>
            {PREMIUM_LINES.map((line) => (
              <View key={line.text} style={styles.row}>
                <Ionicons name={line.icon} size={18} color="#fff" style={styles.rowIcon} />
                <Text style={styles.rowText}>{line.text}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            {/* A real, store-issued offer. Absent this, no discount is shown. */}
            {offer && !isPremium && (
              <View style={styles.offerPill}>
                <Ionicons name="pricetag" size={14} color={BRAND[700]} />
                <Text style={styles.offerText}>
                  {offer.kind === 'winback' ? 'Welcome-back offer' : 'Offer for you'} ·{' '}
                  {offer.priceString}
                </Text>
              </View>
            )}

            {!configured || unavailable ? (
              <View style={styles.notice}>
                <Ionicons name="information-circle" size={20} color="#fff" />
                <Text style={styles.noticeText}>
                  {unavailable
                    ? 'Subscriptions need a development build — everything in Silo is unlocked here.'
                    : 'Subscriptions aren’t set up in this build. Everything in Silo is unlocked.'}
                </Text>
              </View>
            ) : stillEntitled ? (
              offer ? (
                <PlanButton
                  label="Keep Premium"
                  price={offer.priceString}
                  note="Offer applied"
                  highlighted
                  stacked={stacked}
                  busy={busy === (annual ?? packages[0])?.identifier}
                  disabled={!packages.length || busy !== null}
                  onPress={() => {
                    const pkg = annual ?? packages[0];
                    if (pkg) buy(pkg);
                  }}
                />
              ) : (
                <PressableScale
                  haptic="medium"
                  onPress={() => Linking.openURL(manageUrl)}
                  accessibilityLabel="Turn renewal back on in the App Store"
                  style={[styles.plan, styles.planHighlighted, stacked && styles.planStacked]}
                >
                  <View style={stacked ? undefined : { flex: 1 }}>
                    <Text style={[styles.planLabel, styles.planLabelHighlighted]}>
                      Turn renewal back on
                    </Text>
                    <Text style={styles.planNote}>In the App Store</Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color={BRAND[700]} />
                </PressableScale>
              )
            ) : isPremium ? (
              <View style={styles.notice}>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.noticeText}>You’re already subscribed. Thank you.</Text>
              </View>
            ) : loading ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: SPACE.lg }} />
            ) : (
              <>
                <PlanButton
                  label="Yearly"
                  price={annualPrice}
                  note={saving !== null ? `Save ${saving}%` : 'Best value'}
                  highlighted
                  stacked={stacked}
                  busy={busy === annual?.identifier}
                  disabled={!annual || busy !== null}
                  onPress={() => annual && buy(annual)}
                />
                <PlanButton
                  label="Monthly"
                  price={monthlyPrice}
                  stacked={stacked}
                  busy={busy === monthly?.identifier}
                  disabled={!monthly || busy !== null}
                  onPress={() => monthly && buy(monthly)}
                />
                {packages.length === 0 && (
                  <Text style={styles.noticeText}>
                    Couldn’t load plans right now. Check your connection and try again.
                  </Text>
                )}
                {showTrial && (
                  <Text style={styles.trialNote}>
                    {`Starts with ${trialDays} days free. Cancel any time.`}
                  </Text>
                )}
              </>
            )}
          </Glass>
        </Animated.View>

        {/* Only when a trial is genuinely on offer to this Apple ID. */}
        {showTrial && packages.length > 0 && (
          <TrialTimeline
            days={trialDays}
            reminderDaysBefore={TRIAL_REMINDER_DAYS_BEFORE}
            priceLabel={annualPrice}
            period="year"
            reminder={canRemind}
          />
        )}

        <View style={styles.freeBlock}>
          <Text style={styles.freeHeading}>Always free</Text>
          {FREE_LINES.map((line) => (
            <View key={line} style={styles.freeRow}>
              <Ionicons name="checkmark" size={15} color="rgba(255,255,255,0.85)" />
              <Text style={styles.freeText}>{line}</Text>
            </View>
          ))}
        </View>

        {/*
          App Review 3.1.2: length of subscription, price, and renewal terms must
          be on the purchase screen itself, with functional ToS + privacy links.
        */}
        <Text style={styles.terms}>
          {`${termsLine} `}
          {Platform.OS === 'ios'
            ? 'Payment is charged to your Apple ID at confirmation. It renews automatically unless cancelled at least 24 hours before the period ends; manage or cancel in Settings → Apple ID → Subscriptions.'
            : 'It renews automatically unless cancelled; manage or cancel in the Play Store.'}
        </Text>

        <View style={styles.links}>
          <PressableScale haptic="light" onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.link}>Terms of Service</Text>
          </PressableScale>
          <Text style={styles.linkDot}>·</Text>
          <PressableScale haptic="light" onPress={() => Linking.openURL(PRIVACY_URL)}>
            <Text style={styles.link}>Privacy Policy</Text>
          </PressableScale>
          {configured && !unavailable && (
            <>
              <Text style={styles.linkDot}>·</Text>
              <PressableScale haptic="light" onPress={restore} disabled={busy !== null}>
                <Text style={styles.link}>{busy === 'restore' ? 'Restoring…' : 'Restore'}</Text>
              </PressableScale>
            </>
          )}
        </View>

        {fromManage && (
          <PressableScale
            haptic="light"
            onPress={() => Linking.openURL(manageUrl)}
            accessibilityLabel="Manage subscription in the App Store"
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Manage subscription</Text>
            <Ionicons name="open-outline" size={15} color="#fff" />
          </PressableScale>
        )}

        <PressableScale
          haptic="light"
          onPress={leave}
          accessibilityLabel="Not now, continue without a subscription"
          style={styles.notNow}
        >
          <Text style={styles.notNowText}>{fromOnboarding ? 'Maybe later' : 'Not now'}</Text>
        </PressableScale>
      </ScrollView>
    </View>
  );
}

/** One of the user's own numbers, on the retention screen. */
function LossStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.lossStat}>
      <Text style={styles.lossValue} maxFontSizeMultiplier={MAX_DISPLAY_SCALE}>
        {value}
      </Text>
      <Text style={styles.lossLabel}>{label}</Text>
    </View>
  );
}

function PlanButton({
  label,
  price,
  note,
  highlighted,
  stacked,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  price: string;
  note?: string;
  highlighted?: boolean;
  /** Lay label above price — the accessibility text sizes need the room. */
  stacked?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="medium"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={`${label}, ${price}${note ? `, ${note}` : ''}`}
      style={[
        styles.plan,
        stacked && styles.planStacked,
        highlighted && styles.planHighlighted,
        disabled && styles.planDisabled,
      ]}
    >
      <View style={stacked ? undefined : { flex: 1 }}>
        <Text style={[styles.planLabel, highlighted && styles.planLabelHighlighted]}>
          {label}
        </Text>
        {note ? <Text style={styles.planNote}>{note}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={highlighted ? BRAND[700] : '#fff'} />
      ) : (
        <Text style={[styles.planPrice, highlighted && styles.planLabelHighlighted]}>
          {price}
        </Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BRAND[700] },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACE.xl },

  orb: { position: 'absolute', borderRadius: RADIUS.pill, backgroundColor: 'rgba(255,255,255,0.10)' },
  orbTop: { width: 320, height: 320, top: -110, right: -120 },
  orbBottom: { width: 260, height: 260, bottom: -80, left: -90 },

  hero: { alignItems: 'center', marginBottom: SPACE.xl },
  mark: {
    width: 62,
    height: 62,
    borderRadius: RADIUS.xl,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACE.lg,
  },
  title: { ...TYPE.display, color: '#fff', textAlign: 'center' },
  subtitle: {
    ...TYPE.callout,
    color: 'rgba(255,255,255,0.82)',
    textAlign: 'center',
    marginTop: SPACE.md,
    paddingHorizontal: SPACE.sm,
  },

  lossRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    // `stretch` (the default) asks each tile to match the row's height while the
    // row is asking the tiles how tall it should be. Inside a ScrollView content
    // container that is itself centred and flex-grown, Yoga resolves that
    // circularity to zero and the whole row disappears — rendered, laid out, and
    // 0pt tall. Sizing the tiles from their own content breaks the cycle, and it
    // is also what keeps them legible when the text scales.
    alignItems: 'flex-start',
    gap: SPACE.sm,
    marginBottom: SPACE.lg,
  },
  lossStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  lossValue: { ...TYPE.title2, color: '#fff' },
  lossLabel: { ...TYPE.caption, color: 'rgba(255,255,255,0.75)', marginTop: SPACE.xxs },

  cardShadow: { ...SHADOW.floating },
  card: { padding: SPACE.lg },

  row: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.md },
  rowIcon: { marginRight: SPACE.md },
  rowText: { ...TYPE.callout, color: '#fff', flex: 1 },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginVertical: SPACE.md,
  },

  offerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACE.xs,
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    marginBottom: SPACE.md,
  },
  offerText: { ...TYPE.caption, color: BRAND[700] },

  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.base,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: SPACE.sm,
  },
  // At the accessibility text sizes a pill cannot hold a label and a price side
  // by side; stacking keeps both readable instead of truncating the price.
  planStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: SPACE.xs,
    borderRadius: RADIUS.lg,
  },
  planHighlighted: { backgroundColor: '#fff', borderColor: '#fff' },
  planDisabled: { opacity: 0.5 },
  planLabel: { ...TYPE.headline, color: '#fff' },
  planLabelHighlighted: { color: BRAND[700] },
  planNote: { ...TYPE.caption, color: 'rgba(124,58,237,0.75)' },
  planPrice: { ...TYPE.headline, color: '#fff' },

  trialNote: {
    ...TYPE.footnote,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginTop: SPACE.xs,
  },

  notice: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm },
  noticeText: { ...TYPE.footnote, color: 'rgba(255,255,255,0.9)', flex: 1 },

  freeBlock: { marginTop: SPACE.xl },
  freeHeading: {
    ...TYPE.caption,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACE.sm,
  },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.xs },
  freeText: { ...TYPE.footnote, color: 'rgba(255,255,255,0.85)', flex: 1 },

  terms: {
    ...TYPE.caption,
    color: 'rgba(255,255,255,0.66)',
    marginTop: SPACE.lg,
    lineHeight: 16,
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  link: { ...TYPE.footnote, color: '#fff', textDecorationLine: 'underline' },
  linkDot: { ...TYPE.footnote, color: 'rgba(255,255,255,0.6)' },

  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.md,
    marginTop: SPACE.base,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  secondaryText: { ...TYPE.bodyStrong, color: '#fff' },

  notNow: { alignItems: 'center', paddingVertical: SPACE.lg, marginTop: SPACE.sm },
  notNowText: { ...TYPE.headline, color: '#fff' },
});
