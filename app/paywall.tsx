/**
 * Paywall — what premium buys, and what stays free.
 *
 * Design decisions worth keeping:
 *
 * - **It names what is still free.** The free tier is the whole habit loop, and
 *   hiding that to make the upgrade look better would misrepresent the product
 *   and read as a dark pattern to a reviewer.
 * - **"Not now" is a real, visible control**, matching `sign-in.tsx`. Silo works
 *   without a subscription; a dismissable-only-by-hunting paywall would be lying.
 * - **The terms are on the screen, not behind a tap.** App Review requires the
 *   price, the period, the renewal behaviour and links to ToS/privacy to be
 *   visible at the point of purchase (Guideline 3.1.2).
 * - One glass card on the brand gradient — the same single-surface treatment as
 *   sign-in, so the two "decision" screens feel like one family. No opacity
 *   animation on the card or any ancestor: that stops the material rendering.
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import { useToast } from '@/components/ui/Toast';
import { usePremium } from '@/components/PremiumProvider';
import {
  BillingPackage,
  getPackages,
  purchasePackage,
  restorePurchases,
} from '@/lib/billing';
import { celebrationHaptic } from '@/lib/haptics';
import { PRICE_MONTHLY, PRICE_YEARLY, PRIVACY_URL, TERMS_URL, TRIAL_DAYS } from '@/lib/config';
import { BRAND, DURATION, RADIUS, SHADOW, SPACE, TYPE } from '@/lib/theme';
import { usePrefersReducedMotion } from '@/lib/motion';

/** What the subscription actually buys. Mirrors `FREE_TASKS` in `lib/api.ts`. */
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

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const toast = useToast();
  const { configured, unavailable, isPremium, refresh } = usePremium();

  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPackages()
      .then((list) => alive && setPackages(list))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  async function buy(pkg: BillingPackage) {
    setBusy(pkg.identifier);
    try {
      const result = await purchasePackage(pkg);
      if (result.ok) {
        await refresh();
        await celebrationHaptic().catch(() => {});
        toast.show({ message: 'You’re on Silo Premium', tone: 'success' });
        leave();
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
        leave();
      } else if (result.message) {
        toast.show({ message: result.message, tone: 'danger' });
      }
    } finally {
      setBusy(null);
    }
  }

  // Fallback copy so the screen is still truthful before offerings load (or if
  // the store is unreachable) — the config constants are the same ones mirrored
  // into App Store Connect.
  const monthly = packages.find((p) => p.packageType === 'MONTHLY');
  const annual = packages.find((p) => p.packageType === 'ANNUAL');

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
        <Animated.View entering={FadeInDown.duration(DURATION.slow)} style={styles.hero}>
          <View style={styles.mark}>
            <Ionicons name="sparkles" size={28} color="#fff" />
          </View>
          <Text style={styles.title}>Silo Premium</Text>
          <Text style={styles.subtitle}>
            Saving, organizing and resurfacing stay free, forever. Premium adds the AI layer on top.
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(reduced ? 0 : 90).duration(DURATION.slow)}
          style={styles.cardShadow}
        >
          <Glass variant="regular" tint="dark" radius={RADIUS.xxl} style={styles.card}>
            {PREMIUM_LINES.map((line) => (
              <View key={line.text} style={styles.row}>
                <Ionicons name={line.icon} size={18} color="#fff" style={styles.rowIcon} />
                <Text style={styles.rowText}>{line.text}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            {!configured || unavailable ? (
              <View style={styles.notice}>
                <Ionicons name="information-circle" size={20} color="#fff" />
                <Text style={styles.noticeText}>
                  {unavailable
                    ? 'Subscriptions need a development build — everything in Silo is unlocked here.'
                    : 'Subscriptions aren’t set up in this build. Everything in Silo is unlocked.'}
                </Text>
              </View>
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
                  price={annual?.product.priceString ?? PRICE_YEARLY}
                  note="Best value"
                  highlighted
                  busy={busy === annual?.identifier}
                  disabled={!annual || busy !== null}
                  onPress={() => annual && buy(annual)}
                />
                <PlanButton
                  label="Monthly"
                  price={monthly?.product.priceString ?? PRICE_MONTHLY}
                  busy={busy === monthly?.identifier}
                  disabled={!monthly || busy !== null}
                  onPress={() => monthly && buy(monthly)}
                />
                {packages.length === 0 && (
                  <Text style={styles.noticeText}>
                    Couldn’t load plans right now. Check your connection and try again.
                  </Text>
                )}
              </>
            )}
          </Glass>
        </Animated.View>

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
          {`A ${TRIAL_DAYS}-day free trial, then ${annual?.product.priceString ?? PRICE_YEARLY}/year or ${monthly?.product.priceString ?? PRICE_MONTHLY}/month. `}
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

        <PressableScale
          haptic="light"
          onPress={leave}
          accessibilityLabel="Not now, continue without a subscription"
          style={styles.notNow}
        >
          <Text style={styles.notNowText}>Not now</Text>
        </PressableScale>
      </ScrollView>
    </View>
  );
}

function PlanButton({
  label,
  price,
  note,
  highlighted,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  price: string;
  note?: string;
  highlighted?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="medium"
      onPress={onPress}
      disabled={disabled}
      style={[styles.plan, highlighted && styles.planHighlighted, disabled && styles.planDisabled]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.planLabel, highlighted && styles.planLabelHighlighted]}>{label}</Text>
        {note ? <Text style={styles.planNote}>{note}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={highlighted ? BRAND[700] : '#fff'} />
      ) : (
        <Text style={[styles.planPrice, highlighted && styles.planLabelHighlighted]}>{price}</Text>
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
  planHighlighted: { backgroundColor: '#fff', borderColor: '#fff' },
  planDisabled: { opacity: 0.5 },
  planLabel: { ...TYPE.headline, color: '#fff' },
  planLabelHighlighted: { color: BRAND[700] },
  planNote: { ...TYPE.caption, color: 'rgba(124,58,237,0.75)' },
  planPrice: { ...TYPE.headline, color: '#fff' },

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
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  link: { ...TYPE.footnote, color: '#fff', textDecorationLine: 'underline' },
  linkDot: { ...TYPE.footnote, color: 'rgba(255,255,255,0.6)' },

  notNow: { alignItems: 'center', paddingVertical: SPACE.lg, marginTop: SPACE.sm },
  notNowText: { ...TYPE.headline, color: '#fff' },
});
