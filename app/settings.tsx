/**
 * Settings / Profile screen (presented as a modal from the Stacks header).
 * Profile + stats, real preferences (persisted to UserSettings), device sync
 * ("Your devices"), data export + delete-all (privacy/trust), and About.
 *
 * Every card here is glass (see `RiseIn` for why that changes the entrance),
 * sections rise in on mount (index-staggered), and the profile + stat tiles
 * hold Skeletons until the first storage read lands, so the screen never shows
 * a frame of placeholder zeroes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Text,
  View,
  ScrollView,
  Switch,
  Alert,
  Share,
  Linking,
  TextInput,
  ActivityIndicator,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import ScreenHeader from '@/components/ui/ScreenHeader';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { staggerDelay, usePrefersReducedMotion } from '@/lib/motion';
import {
  getItems,
  getStacks,
  getSettings,
  saveSettings,
  getUserId,
  clearAll,
  deleteItem,
  getSyncState,
  setSyncState,
  SyncState,
  DEFAULT_SETTINGS,
} from '@/lib/storage';
import { syncNow, newSpaceKey } from '@/lib/sync';
import { useAuth } from '@/components/AuthProvider';
import { deleteAccount, displayName } from '@/lib/auth';
import { usePremium } from '@/components/PremiumProvider';
import { restorePurchases } from '@/lib/billing';
import {
  cancelSiloNotifications,
  requestNotificationPermission,
  syncNotifications,
} from '@/lib/notifications';
import {
  ACCENT,
  BRAND,
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  TEXT,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useTheme, useThemeColors, type AppearancePreference } from '@/lib/useTheme';
import { UserSettings } from '@/lib/types';
import {
  APP_VERSION,
  PRICE_MONTHLY,
  PRICE_YEARLY,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  TERMS_URL,
} from '@/lib/config';

/** Same env default lib/api.ts + lib/sync.ts read; shown as the URL prefill. */
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';

/** Monospace for the space code / join input — codes must read unambiguously. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Must match the server's SPACE_KEY_RE (workers/sync.ts). */
const SPACE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;

/**
 * "Renews 4 Sep" vs "Ends 4 Sep" — a cancelled subscription that still says
 * "renews" is the kind of copy that generates support mail and refund requests.
 */
function subscriptionStatus(e: { willRenew: boolean; expiresAt: string | null; inTrial: boolean }): string {
  if (!e.expiresAt) return e.willRenew ? 'Renews automatically' : 'Active';
  const when = new Date(e.expiresAt);
  if (Number.isNaN(when.getTime())) return 'Active';
  const date = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (e.inTrial) return e.willRenew ? `Trial — first charge ${date}` : `Trial ends ${date}`;
  return e.willRenew ? `Renews ${date}` : `Ends ${date}`;
}

/**
 * Entrance order — every block on this screen animates in with the same
 * stagger, so the indices have to be declared in one place to stay in sync.
 */
const ORDER = { profile: 0, stats: 1, account: 2, subscription: 3, preferences: 4, devices: 5, data: 6, about: 7 } as const;

/** The three things the Appearance picker can be set to, in segment order. */
const APPEARANCE_OPTIONS: { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The tint every card on this page hands to `Glass`.
 *
 * Bare material borrows its colour from whatever is behind it, and this is a
 * long scroll of body text over a flat page wash — on the light palette that
 * lands too close to the text. `2e` ≈ 18% of the palette's own card colour:
 * enough to hold a row label, far too little to read as a fill. (Both palettes
 * state `card` as a 6-digit hex, so the alpha suffix is all this needs.)
 */
function cardTint(c: ThemeColors): string {
  return `${c.card}2e`;
}

/**
 * Staggered entrance for a block that holds glass.
 *
 * `enterList` is a FADE, and an opacity animation on a glass surface — or on
 * ANY ancestor of one — stops the material rendering rather than fading it: the
 * card would arrive as a hole. Every card on this page is glass now, so the
 * whole screen rises on a transform instead, keeping `enterList`'s stagger.
 */
function RiseIn({
  index,
  style,
  children,
}: {
  index: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const offset = useSharedValue<number>(SPACE.md);

  useEffect(() => {
    offset.value = reduced ? 0 : withDelay(staggerDelay(index), withSpring(0, SPRING.enter));
  }, [index, offset, reduced]);

  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return <Animated.View style={[style, rise]}>{children}</Animated.View>;
}

/**
 * Mirror of add.tsx's lazy expo-clipboard require (see that file's WHY: a
 * binary built before the pod landed throws on module-load-time import).
 */
function writeClipboardString(text: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard');
    return Clipboard.setStringAsync(text);
  } catch {
    return Promise.resolve();
  }
}

/** "just now" / "4m ago" / "3h ago" / "2d ago" — settings-row friendly. */
function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Section({
  title,
  index,
  children,
}: {
  title: string;
  /** Position in the entrance stagger — see ORDER. */
  index: number;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <RiseIn index={index} style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.textTertiary }]}>{title}</Text>
      {/* Shadow lives on the outer view: the glass clips its rows to the corner
          radius, and `overflow: hidden` would clip the shadow too. The rim the
          material draws is also what replaces the dark-mode hairline. */}
      <View style={styles.cardShadow}>
        <Glass radius={RADIUS.xl} tintColor={cardTint(c)}>
          {children}
        </Glass>
      </View>
    </RiseIn>
  );
}

function Row({
  icon,
  tint,
  label,
  sub,
  right,
  onPress,
  danger,
  divider = true,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  divider?: boolean;
}) {
  const c = useThemeColors();
  // `tint` must stay a 6-digit hex: the icon wash is an 8-digit hex built from it.
  const divide = divider ? [styles.rowDivider, { borderBottomColor: c.hairline }] : undefined;

  const body = (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: danger ? c.danger : c.text }]}>{label}</Text>
        {!!sub && <Text style={[styles.rowSub, { color: c.textTertiary }]}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={c.decorative} /> : null)}
    </View>
  );

  // Rows that only host a control (switch, stepper, version string) are not
  // buttons — rendering them as a Pressable would announce a dead tap target.
  if (!onPress) return <View style={divide}>{body}</View>;

  return (
    <PressableScale
      onPress={onPress}
      haptic="light"
      scaleTo={0.985}
      // Rows already clear the 44pt minimum; the default slop would spill into
      // the neighbouring row and steal its taps.
      hitSlop={0}
      containerStyle={divide}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
    >
      {body}
    </PressableScale>
  );
}

/**
 * Appearance picker — the user-facing half of dark mode, and the first row in
 * Preferences because it is the setting people go looking for.
 *
 * "System" is not a third palette: it defers to the OS and keeps following it,
 * which is why the preference (not the resolved appearance) drives selection.
 * The segments sit below the label rather than in the row's right slot — three
 * words do not fit next to a label at any comfortable tap size.
 */
function AppearanceRow({ tint }: { tint: string }) {
  const c = useThemeColors();
  const { preference, setPreference } = useTheme();

  return (
    <View style={[styles.rowDivider, { borderBottomColor: c.hairline }]}>
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
          <Ionicons name="contrast" size={17} color={tint} />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowLabel, { color: c.text }]}>Appearance</Text>
          <Text style={[styles.rowSub, { color: c.textTertiary }]}>
            Follow your device, or pick one
          </Text>
        </View>
      </View>

      {/* The track stays an opaque field, not a second material: it sits INSIDE
          the section's glass, and two stacked materials read as mud. The active
          segment is a brand fill either way. */}
      <View style={[styles.segment, { backgroundColor: c.field }]}>
        {APPEARANCE_OPTIONS.map((opt) => {
          const active = preference === opt.value;
          return (
            <PressableScale
              key={opt.value}
              haptic="selection"
              scaleTo={0.96}
              // Segments are adjacent; the default slop would overlap the neighbour.
              hitSlop={0}
              selected={active}
              onPress={() => setPreference(opt.value)}
              containerStyle={styles.segmentSlot}
              style={[styles.segmentItem, active && { backgroundColor: c.brand }]}
              accessibilityLabel={`${opt.label} appearance`}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? c.textInverse : c.textSecondary },
                ]}
              >
                {opt.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const c = useThemeColors();
  // Row glyph tints. The brand/accent steps tuned for white go muddy on the
  // dark card, so each lightens a step; the status roles already flip themselves.
  const tint = useMemo(
    () => ({
      brand: c.appearance === 'dark' ? BRAND[400] : BRAND[500],
      accent: c.appearance === 'dark' ? ACCENT[400] : ACCENT[500],
      // Neutral + destructive rows. Both must stay 6-digit hex — the icon wash
      // is built by appending an alpha pair.
      ink: c.textSecondary,
      danger: c.danger,
    }),
    [c.appearance, c.textSecondary, c.danger]
  );
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState({ items: 0, stacks: 0, since: '' });
  // Until the first storage read resolves, the counts are meaningless zeroes —
  // show Skeletons instead of "0 Items".
  const [ready, setReady] = useState(false);
  const { user, configured: authConfigured, signOut } = useAuth();
  const {
    configured: billingConfigured,
    unavailable: billingUnavailable,
    isPremium,
    entitlement,
    refresh: refreshPremium,
  } = usePremium();
  const [accountBusy, setAccountBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // --- Sync section state (S1) ---
  const [sync, setSync] = useState<SyncState>({
    spaceKey: null,
    cursor: 0,
    serverUrl: null,
    lastSyncAt: null,
  });
  const [serverUrl, setServerUrl] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending flash timers on unmount so they can't set state on a dead screen.
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [s, items, stacks, uid, ss] = await Promise.all([
          getSettings(),
          getItems(),
          getStacks(),
          getUserId(),
          getSyncState(),
        ]);
        if (!active) return;
        setSettings(s);
        setSync(ss);
        setServerUrl(ss.serverUrl ?? ENV_BASE_URL);
        const ts = parseInt(uid.split('_')[1] || '0', 10);
        // Empty string when the id carries no timestamp: the profile line drops
        // the "since …" clause entirely rather than printing a placeholder.
        const since = ts ? format(new Date(ts), 'MMM yyyy') : '';
        setStats({ items: items.length, stacks: stacks.length, since });
        setReady(true);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const copyCode = async () => {
    if (!sync.spaceKey) return;
    await writeClipboardString(sync.spaceKey);
    Haptics.selectionAsync();
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const regenerate = async () => {
    const fresh = newSpaceKey();
    // A new code is a new space: cursor restarts so the next sync re-uploads everything.
    await setSyncState({ spaceKey: fresh, cursor: 0 });
    setSync((prev) => ({ ...prev, spaceKey: fresh, cursor: 0 }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmRegenerate = () => {
    // No code yet → nothing to unpair; mint one silently.
    if (!sync.spaceKey) {
      regenerate();
      return;
    }
    Alert.alert(
      'Regenerate space code?',
      'This unpairs your other devices. They keep their data but stop syncing until they join the new code.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Regenerate', style: 'destructive', onPress: () => regenerate() },
      ]
    );
  };

  const joinSpace = async () => {
    const code = joinCode.trim();
    if (!SPACE_KEY_RE.test(code)) {
      setJoinError('Codes are 6–128 letters, numbers, “-” or “_”.');
      return;
    }
    // Adopting another device's space: cursor restarts so the first sync pulls all of it.
    await setSyncState({ spaceKey: code, cursor: 0 });
    setSync((prev) => ({ ...prev, spaceKey: code, cursor: 0 }));
    setJoinCode('');
    setJoinError(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const saveServerUrl = () => {
    const url = serverUrl.trim();
    // Empty input = "use the env default" (stored as null, like unset).
    setSyncState({ serverUrl: url || null }).catch(() => {});
    setSync((prev) => ({ ...prev, serverUrl: url || null }));
  };

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      // Make sure what's typed in the URL field is what's used, even if the
      // input never blurred (tapping the CTA can dismiss the keyboard without
      // delivering the blur-save first).
      const url = serverUrl.trim();
      if (url !== (sync.serverUrl ?? ENV_BASE_URL)) {
        await setSyncState({ serverUrl: url || null });
      }
      const r = await syncNow();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Re-read: syncNow may have minted the space code + bumped lastSyncAt.
      setSync(await getSyncState());
      setSyncResult(`Synced ${r.pushed} up, ${r.pulled} down`);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSyncResult(null), 2500);
    } catch (e) {
      // The raw message is developer-facing (URLs, status codes) and now lives
      // under Advanced; the user gets a plain-language toast.
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
      toast.show({ message: 'Couldn’t sync. Check your connection.', tone: 'danger' });
    } finally {
      setSyncing(false);
    }
  };

  const update = (patch: Partial<UserSettings>) => {
    const prev = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    // Optimistic write: if persistence fails, roll the UI back so it never
    // diverges from what's actually on disk.
    saveSettings(next).catch(() => {
      setSettings(prev);
      Alert.alert('Couldn’t save', 'Your change wasn’t saved. Please try again.');
    });
    Haptics.selectionAsync();
  };

  /**
   * The toggle is the ONLY place Silo asks for notification permission — the
   * user has just expressed intent, which is the moment with the best chance of
   * a yes. Turning it on with permission denied would leave a switch that says
   * "on" and does nothing, so a refusal snaps it back and points at Settings.
   */
  const toggleNotifications = async (enabled: boolean) => {
    if (!enabled) {
      update({ notifications_enabled: false });
      await cancelSiloNotifications();
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      toast.show({
        message: 'Notifications are off for Silo in iOS Settings',
        tone: 'danger',
        action: { label: 'Open', onPress: () => Linking.openSettings().catch(() => {}) },
      });
      return;
    }

    update({ notifications_enabled: true });
    const [items, current] = await Promise.all([getItems(), getSettings()]);
    await syncNotifications(items, { ...current, notifications_enabled: true });
  };

  /**
   * Sign out. The library is local, so nothing is lost — the copy says so,
   * because "sign out" in most apps means "lose your stuff".
   */
  function handleSignOut() {
    Alert.alert('Sign out?', 'Your saves stay on this device. You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          toast.show({ message: 'Signed out', tone: 'neutral' });
        },
      },
    ]);
  }

  /**
   * Delete the account. Genuinely irreversible and server-side, so this keeps a
   * blocking confirm — the Toast+Undo pattern the rest of the app uses can't
   * undo it. Required in-app by App Store Guideline 5.1.1(v).
   */
  function handleDeleteAccount() {
    Alert.alert(
      'Delete your account?',
      'This erases your account and everything synced to it. Saves already on this device are kept — delete those separately from “Delete all data”.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setAccountBusy(true);
            try {
              const result = await deleteAccount(
                sync.serverUrl || ENV_BASE_URL,
                process.env.EXPO_PUBLIC_CLIENT_TOKEN || ''
              );
              if (result.ok) {
                toast.show({ message: 'Account deleted', tone: 'success' });
              } else {
                toast.show({ message: result.message, tone: 'danger' });
              }
            } finally {
              setAccountBusy(false);
            }
          },
        },
      ]
    );
  }

  const adjustDuration = (delta: number) => {
    const next = Math.min(120, Math.max(5, settings.default_duration + delta));
    update({ default_duration: next });
  };

  const exportData = async () => {
    try {
      const [items, stacks] = await Promise.all([getItems(), getStacks()]);
      const payload = JSON.stringify(
        { app: 'Silo', version: APP_VERSION, exportedAt: new Date().toISOString(), settings, stacks, items },
        null,
        2
      );
      const res = await Share.share({ message: payload }, { dialogTitle: 'Export your Silo data' });
      // Dismissing the share sheet isn't a failure — only confirm on a real send.
      if (res.action === Share.sharedAction) {
        toast.show({ message: `Exported ${items.length} items`, tone: 'success' });
      }
    } catch {
      toast.show({ message: 'Couldn’t export your data', tone: 'danger' });
    }
  };

  /**
   * Tell the server about the wipe before it happens. `clearAll` drops the sync
   * bookkeeping along with the items, so a device that only cleared locally
   * would rejoin at cursor 0 and pull the entire library straight back. A
   * tombstone per item (the same one `deleteItem` writes) makes the delete
   * propagate instead. Best effort: offline or unconfigured, the wipe still
   * happens — it must never depend on the network.
   */
  const pushDeletesBeforeClear = async () => {
    const state = await getSyncState();
    if (!state.spaceKey || !(state.serverUrl || ENV_BASE_URL)) return;
    try {
      const items = await getItems();
      for (const item of items) await deleteItem(item.id);
      await syncNow();
    } catch (error) {
      console.error('Failed to push deletes before clearing:', error);
    }
  };

  const confirmClear = () => {
    // Deliberately still a blocking confirm rather than an undo toast: this is
    // irreversible and wipes everything, so a second tap is the right cost.
    Alert.alert(
      'Delete all data?',
      'This permanently removes every saved item, stack, and setting on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            await pushDeletesBeforeClear();
            await clearAll();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          },
        },
      ]
    );
  };

  /**
   * Open a legal document. App Review requires both to be reachable from inside
   * the app, and a subscription app must link them at the point of purchase too
   * (`app/paywall.tsx` does). The URLs are in `lib/config.ts`; the documents
   * they point at live in `docs/legal/` and have to be published before
   * submission — until they are, this fails honestly rather than silently.
   */
  const openLegal = async (what: string, url: string) => {
    try {
      const opened = await Linking.canOpenURL(url);
      if (!opened) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      toast.show({ message: `Couldn’t open the ${what}.`, tone: 'danger' });
    }
  };

  // The server URL is a self-hoster's escape hatch: only surface it in dev, or
  // once this device has actually been pointed at a custom server.
  const showAdvanced = __DEV__ || !!sync.serverUrl;

  return (
    <View style={[styles.page, { backgroundColor: c.sunken }]}>
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACE.xxxl }}>
        {/* Profile card. The brand lift stays on the wrapper — glass clips to
            its own bounds and would swallow a shadow set on it. */}
        <RiseIn index={ORDER.profile}>
          <View style={styles.profileLift}>
            <Glass radius={RADIUS.xl} tintColor={cardTint(c)} style={styles.profileCard}>
              {/* Brand gradient + white glyph in both appearances — this is a
                  brand surface, not a page surface. */}
              <LinearGradient
                colors={GRADIENTS.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatar}
              >
                <Ionicons name="person" size={28} color={TEXT.inverse} />
              </LinearGradient>
              <View style={styles.profileText}>
                {ready ? (
                  <>
                    <Text style={[styles.profileName, { color: c.text }]}>Your Silo</Text>
                    <Text style={[styles.profileMeta, { color: c.textTertiary }]}>
                      {stats.since ? `On this device · since ${stats.since}` : 'On this device'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Skeleton width={110} height={19} radius={RADIUS.xs} />
                    <Skeleton
                      width={170}
                      height={13}
                      radius={RADIUS.xs}
                      style={styles.skeletonLine}
                    />
                  </>
                )}
              </View>
            </Glass>
          </View>
        </RiseIn>

        {/* Stats */}
        <RiseIn index={ORDER.stats} style={styles.statRow}>
          {[
            { n: stats.items, l: 'Items', i: 'documents' as const, c: tint.brand },
            { n: stats.stacks, l: 'Stacks', i: 'albums' as const, c: tint.accent },
          ].map((s) => (
            <View key={s.l} style={styles.statLift}>
              <Glass radius={RADIUS.xl} tintColor={cardTint(c)} style={styles.statTile}>
                <Ionicons name={s.i} size={18} color={s.c} />
                {ready ? (
                  <Text style={[styles.statNum, { color: c.text }]}>{s.n}</Text>
                ) : (
                  <Skeleton width={34} height={22} radius={RADIUS.xs} style={styles.skeletonStat} />
                )}
                <Text style={[styles.statLabel, { color: c.textTertiary }]}>{s.l}</Text>
              </Glass>
            </View>
          ))}
        </RiseIn>

        {/* Preferences */}
        {/* Account — only when this build has an identity provider. Showing a
            sign-in row that can't work is worse than showing nothing. */}
        {authConfigured && (
          <Section title="Account" index={ORDER.account}>
            {user ? (
              <>
                <Row
                  icon="person-circle"
                  tint={tint.brand}
                  label={displayName(user)}
                  sub={user.email ?? 'Signed in'}
                />
                <Row
                  icon="log-out-outline"
                  tint={tint.ink}
                  label="Sign out"
                  sub="Your saves stay on this device"
                  onPress={handleSignOut}
                />
                <Row
                  icon="trash-outline"
                  tint={tint.danger}
                  label="Delete account"
                  sub="Erases your account and everything synced to it"
                  danger
                  divider={false}
                  onPress={handleDeleteAccount}
                  right={accountBusy ? <ActivityIndicator color={c.danger} /> : undefined}
                />
              </>
            ) : (
              <Row
                icon="cloud-outline"
                tint={tint.brand}
                label="Sign in"
                sub="Sync your saves across devices and restore after a reinstall"
                divider={false}
                onPress={() => router.push('/sign-in')}
              />
            )}
          </Section>
        )}

        {/* Subscription — like Account, hidden entirely when this build can't
            sell anything, so an unconfigured clone shows no dead billing UI. */}
        {billingConfigured && !billingUnavailable && (
          <Section title="Subscription" index={ORDER.subscription}>
            {isPremium ? (
              <>
                <Row
                  icon="sparkles"
                  tint={tint.brand}
                  label={entitlement.inTrial ? 'Premium — free trial' : 'Silo Premium'}
                  sub={subscriptionStatus(entitlement)}
                />
                <Row
                  icon="open-outline"
                  tint={tint.ink}
                  label="Manage subscription"
                  sub="Change plan or cancel in the App Store"
                  divider={false}
                  onPress={() =>
                    Linking.openURL(
                      entitlement.managementUrl ?? 'https://apps.apple.com/account/subscriptions'
                    )
                  }
                />
              </>
            ) : (
              <>
                <Row
                  icon="sparkles"
                  tint={tint.brand}
                  label="Upgrade to Premium"
                  sub={`AI titles, the assistant and smart scheduling · from ${PRICE_YEARLY}/yr or ${PRICE_MONTHLY}/mo`}
                  onPress={() => router.push('/paywall')}
                />
                <Row
                  icon="refresh-outline"
                  tint={tint.ink}
                  label="Restore purchases"
                  sub="Already subscribed? Bring it back on this device"
                  divider={false}
                  right={restoring ? <ActivityIndicator color={c.brand} /> : undefined}
                  onPress={async () => {
                    setRestoring(true);
                    try {
                      const result = await restorePurchases();
                      await refreshPremium();
                      toast.show({
                        message: result.ok
                          ? 'Subscription restored'
                          : result.message || 'Nothing to restore',
                        tone: result.ok ? 'success' : 'neutral',
                      });
                    } finally {
                      setRestoring(false);
                    }
                  }}
                />
              </>
            )}
          </Section>
        )}

        <Section title="Preferences" index={ORDER.preferences}>
          <AppearanceRow tint={tint.brand} />
          <Row
            icon="time"
            tint={tint.brand}
            label="Default review length"
            sub="How long to block out when scheduling"
            right={
              <View style={styles.stepperRow}>
                <PressableScale
                  haptic="selection"
                  scaleTo={0.9}
                  onPress={() => adjustDuration(-5)}
                  style={[styles.stepper, { backgroundColor: c.field }]}
                  accessibilityLabel="Decrease review length by 5 minutes"
                >
                  <Ionicons name="remove" size={16} color={c.textSecondary} />
                </PressableScale>
                <Text style={[styles.stepperValue, { color: c.text }]}>
                  {settings.default_duration}m
                </Text>
                <PressableScale
                  haptic="selection"
                  scaleTo={0.9}
                  onPress={() => adjustDuration(5)}
                  style={[styles.stepper, { backgroundColor: c.field }]}
                  accessibilityLabel="Increase review length by 5 minutes"
                >
                  <Ionicons name="add" size={16} color={c.textSecondary} />
                </PressableScale>
              </View>
            }
          />
          <Row
            icon="sparkles"
            tint={tint.accent}
            label="Auto-suggest review time"
            sub="Let AI propose when to revisit a save"
            right={
              <Switch
                value={settings.auto_schedule}
                onValueChange={(v) => update({ auto_schedule: v })}
                trackColor={{ true: c.brand, false: c.field }}
              />
            }
          />
          <Row
            icon="notifications"
            tint={c.warning}
            label="Notifications"
            sub="A daily nudge, a check-in after each plan, and the odd tidy-up"
            divider={false}
            right={
              <Switch
                value={settings.notifications_enabled}
                onValueChange={toggleNotifications}
                trackColor={{ true: c.brand, false: c.field }}
              />
            }
          />
        </Section>

        {/* Your devices (S1 — pairing code + manual sync; server URL under Advanced) */}
        <Section title="Your devices" index={ORDER.devices}>
          {/* Status header: paired state + relative last-synced time */}
          <View style={[styles.syncStatus, styles.rowDivider, { borderBottomColor: c.hairline }]}>
            <View style={[styles.syncBadge, { backgroundColor: c.brandSoft }]}>
              <Ionicons name="cloud-outline" size={18} color={c.brand} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: c.text }]}>
                {sync.spaceKey ? 'Paired' : 'Not paired yet'}
              </Text>
              <Text style={[styles.rowSub, { color: c.textTertiary }]}>
                {sync.lastSyncAt ? `Synced ${relTime(sync.lastSyncAt)}` : 'Never synced'}
              </Text>
            </View>
          </View>

          {/* Space code: monospace pill + copy + regenerate */}
          <View style={[styles.field, styles.rowDivider, { borderBottomColor: c.hairline }]}>
            <Text style={[styles.fieldLabel, { color: c.textTertiary }]}>Space code</Text>
            <View style={styles.fieldRow}>
              <View
                style={[styles.codePill, { backgroundColor: c.brandSoft, borderColor: c.hairline }]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.codeText, { color: sync.spaceKey ? c.textBrand : c.textTertiary }]}
                >
                  {sync.spaceKey ?? 'created on first sync'}
                </Text>
              </View>
              <PressableScale
                haptic="light"
                onPress={copyCode}
                disabled={!sync.spaceKey}
                style={[styles.pillButton, { backgroundColor: sync.spaceKey ? c.brand : c.field }]}
                containerStyle={styles.pillButtonSpacing}
              >
                {/* textInverse, not white: on dark the brand fill lightens two
                    steps and white on it drops under 3:1. */}
                <Text
                  style={[
                    styles.pillButtonText,
                    { color: sync.spaceKey ? c.textInverse : c.textTertiary },
                  ]}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                onPress={confirmRegenerate}
                style={[styles.iconButton, { backgroundColor: c.field }]}
                containerStyle={styles.pillButtonSpacing}
                accessibilityLabel="Regenerate space code"
              >
                <Ionicons name="refresh" size={16} color={c.textSecondary} />
              </PressableScale>
            </View>
          </View>

          {/* Join an existing space (typed/pasted from another device) */}
          <View style={[styles.field, styles.rowDivider, { borderBottomColor: c.hairline }]}>
            <Text style={[styles.fieldLabel, { color: c.textTertiary }]}>Join existing space</Text>
            <View style={styles.fieldRow}>
              <TextInput
                value={joinCode}
                onChangeText={(t) => {
                  setJoinCode(t);
                  if (joinError) setJoinError(null);
                }}
                placeholder="silo-…"
                placeholderTextColor={c.textPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  styles.inputFlex,
                  { backgroundColor: c.sunken, borderColor: c.hairline, color: c.text },
                ]}
                accessibilityLabel="Space code from your other device"
              />
              <PressableScale
                haptic="light"
                onPress={joinSpace}
                style={[styles.pillButton, { backgroundColor: c.brand }]}
                containerStyle={styles.pillButtonSpacing}
              >
                <Text style={[styles.pillButtonText, { color: c.textInverse }]}>Join</Text>
              </PressableScale>
            </View>
            {!!joinError && (
              <Text style={[styles.errorText, { color: c.danger }]}>{joinError}</Text>
            )}
          </View>

          {/* Sync now: spinner while running, then a brief "Synced N up, M down" flash */}
          <View style={styles.ctaBlock}>
            <PressableScale haptic="light" onPress={runSync} disabled={syncing}>
              <LinearGradient
                colors={GRADIENTS.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.cta, SHADOW.brandCard]}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color={TEXT.inverse} />
                ) : (
                  <>
                    <Ionicons
                      name={syncResult ? 'checkmark-circle' : 'sync'}
                      size={16}
                      color={TEXT.inverse}
                    />
                    <Text style={styles.ctaText}>{syncResult ?? 'Sync now'}</Text>
                  </>
                )}
              </LinearGradient>
            </PressableScale>
          </View>

          {/* Advanced: self-hosting only. Hidden unless this device already
              points at a custom server (or we're in a dev build). */}
          {showAdvanced && (
            <>
              <PressableScale
                haptic="light"
                scaleTo={0.985}
                hitSlop={0}
                onPress={() => setAdvancedOpen((o) => !o)}
                selected={advancedOpen}
                containerStyle={[styles.advancedWrap, { borderTopColor: c.hairline }]}
                accessibilityLabel="Advanced sync settings"
              >
                <View style={styles.advancedRow}>
                  <Text style={[styles.advancedLabel, { color: c.textTertiary }]}>Advanced</Text>
                  <Ionicons
                    name={advancedOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={c.decorative}
                  />
                </View>
              </PressableScale>
              {advancedOpen && (
                <View style={styles.advancedPanel}>
                  <Text style={[styles.fieldLabel, { color: c.textTertiary }]}>Server URL</Text>
                  <TextInput
                    value={serverUrl}
                    onChangeText={setServerUrl}
                    onBlur={saveServerUrl}
                    placeholder="https://your-server.example"
                    placeholderTextColor={c.textPlaceholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[
                      styles.input,
                      styles.inputBlock,
                      { backgroundColor: c.sunken, borderColor: c.hairline, color: c.text },
                    ]}
                    accessibilityLabel="Sync server URL"
                  />
                  <Text style={[styles.fieldHelp, { color: c.textTertiary }]}>
                    Only change this if you’re running your own Silo server.
                  </Text>
                  {!!syncError && (
                    <Text style={[styles.errorText, { color: c.danger }]}>{syncError}</Text>
                  )}
                </View>
              )}
            </>
          )}
        </Section>

        {/* Data */}
        <Section title="Your data" index={ORDER.data}>
          <Row
            icon="download-outline"
            tint={c.success}
            label="Export my data"
            sub="Download everything as JSON"
            onPress={exportData}
          />
          <Row
            icon="trash-outline"
            tint={c.danger}
            label="Delete all data"
            sub="Wipe this device — can't be undone"
            danger
            divider={false}
            onPress={confirmClear}
          />
        </Section>

        {/* About */}
        <Section title="About" index={ORDER.about}>
          <Row
            icon="shield-checkmark-outline"
            tint={c.brand}
            label="Privacy Policy"
            onPress={() => openLegal('Privacy Policy', PRIVACY_URL)}
          />
          <Row
            icon="document-text-outline"
            tint={c.textTertiary}
            label="Terms of Service"
            onPress={() => openLegal('Terms of Service', TERMS_URL)}
          />
          <Row
            icon="mail-outline"
            tint={tint.accent}
            label="Send feedback"
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Silo%20feedback`)}
          />
          <Row
            icon="information-circle-outline"
            tint={c.decorative}
            label="Version"
            right={<Text style={[styles.versionText, { color: c.textTertiary }]}>{APP_VERSION}</Text>}
            divider={false}
          />
        </Section>

        <Text style={[styles.footer, { color: c.textTertiary }]}>
          Silo · all your saves, organized
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * Layout only — every colour on this screen is appearance-dependent and is
 * applied as a second style entry at the call site.
 */
const styles = StyleSheet.create({
  page: { flex: 1 },

  section: { marginTop: SPACE.xxl },
  sectionTitle: {
    ...TYPE.overline,
    textTransform: 'uppercase',
    marginBottom: SPACE.sm,
    marginLeft: SPACE.lg,
  },
  cardShadow: {
    marginHorizontal: SPACE.base,
    borderRadius: RADIUS.xl,
    ...SHADOW.card,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: {
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  rowText: { marginLeft: SPACE.md, flex: 1 },
  rowLabel: { ...TYPE.callout, fontWeight: '600' },
  rowSub: { ...TYPE.caption, fontWeight: '400', marginTop: 2 },

  segment: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.md,
    borderRadius: RADIUS.pill,
  },
  segmentSlot: { flex: 1 },
  segmentItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
  },
  segmentText: { ...TYPE.footnote, fontWeight: '700' },

  // Margin + lift out here, material inside: see `cardShadow`.
  profileLift: {
    marginHorizontal: SPACE.base,
    marginTop: SPACE.base,
    borderRadius: RADIUS.xl,
    ...SHADOW.brandCard,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACE.base,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { marginLeft: SPACE.base, flex: 1 },
  profileName: { ...TYPE.title3 },
  profileMeta: { ...TYPE.footnote, fontWeight: '400', marginTop: 2 },
  skeletonLine: { marginTop: SPACE.sm },

  statRow: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginHorizontal: SPACE.base,
    marginTop: SPACE.md,
  },
  // `flex` has to sit on the wrapper — it is what the row lays out — and the
  // lift with it, for the same reason as `cardShadow`.
  statLift: {
    flex: 1,
    borderRadius: RADIUS.xl,
    ...SHADOW.card,
  },
  statTile: {
    alignItems: 'center',
    paddingVertical: SPACE.base,
  },
  statNum: { ...TYPE.title2, marginTop: 6 },
  skeletonStat: { marginTop: 8, marginBottom: 4 },
  statLabel: { ...TYPE.caption },

  stepperRow: { flexDirection: 'row', alignItems: 'center' },
  stepper: {
    height: 28,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
  },
  stepperValue: {
    ...TYPE.subhead,
    fontWeight: '700',
    width: 48,
    textAlign: 'center',
    marginHorizontal: SPACE.md,
  },

  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  syncBadge: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
  },

  field: { paddingHorizontal: SPACE.base, paddingVertical: SPACE.md },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.sm },
  fieldLabel: { ...TYPE.overline, textTransform: 'uppercase' },
  fieldHelp: { ...TYPE.caption, fontWeight: '400', marginTop: 6 },
  errorText: { ...TYPE.caption, fontWeight: '400', marginTop: 6 },

  codePill: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  codeText: { ...TYPE.footnote, fontFamily: MONO },

  input: {
    ...TYPE.footnote,
    fontFamily: MONO,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  inputFlex: { flex: 1 },
  inputBlock: { marginTop: SPACE.sm },

  pillButton: {
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
  },
  pillButtonSpacing: { marginLeft: SPACE.sm },
  pillButtonText: { ...TYPE.footnote, fontWeight: '700' },
  iconButton: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
  },

  ctaBlock: { paddingHorizontal: SPACE.base, paddingTop: SPACE.md, paddingBottom: SPACE.base },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: RADIUS.pill,
  },
  ctaText: { ...TYPE.callout, fontWeight: '700', color: TEXT.inverse, marginLeft: SPACE.sm },

  advancedWrap: { borderTopWidth: StyleSheet.hairlineWidth },
  advancedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  advancedLabel: { ...TYPE.caption, textTransform: 'uppercase' },
  advancedPanel: { paddingHorizontal: SPACE.base, paddingBottom: SPACE.base },

  versionText: { ...TYPE.footnote, fontWeight: '400' },
  footer: {
    ...TYPE.caption,
    fontWeight: '400',
    textAlign: 'center',
    marginTop: SPACE.xxl,
  },
});
