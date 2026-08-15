/**
 * Settings / Profile screen (presented as a modal from the Stacks header).
 * Profile + stats, real preferences (persisted to UserSettings), device sync
 * ("Your devices"), data export + delete-all (privacy/trust), and About.
 *
 * Sections fade/rise in on mount (index-staggered) and the profile + stat tiles
 * hold Skeletons until the first storage read lands, so the screen never shows
 * a frame of placeholder zeroes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import PressableScale from '@/components/ui/PressableScale';
import ScreenHeader from '@/components/ui/ScreenHeader';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { enterList, usePrefersReducedMotion } from '@/lib/motion';
import {
  getItems,
  getStacks,
  getSettings,
  saveSettings,
  getUserId,
  clearAll,
  getSyncState,
  setSyncState,
  SyncState,
  DEFAULT_SETTINGS,
} from '@/lib/storage';
import { syncNow, newSpaceKey } from '@/lib/sync';
import {
  ACCENT,
  BRAND,
  GRADIENTS,
  HAIRLINE,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  STATUS,
  SURFACE,
  TEXT,
  TYPE,
} from '@/lib/theme';
import { UserSettings } from '@/lib/types';
import { APP_VERSION, SUPPORT_EMAIL } from '@/lib/config';

/** Same env default lib/api.ts + lib/sync.ts read; shown as the URL prefill. */
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';

/** Monospace for the space code / join input — codes must read unambiguously. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Must match the server's SPACE_KEY_RE (workers/sync.ts). */
const SPACE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;

/**
 * Entrance order — every block on this screen animates in with the same
 * stagger, so the indices have to be declared in one place to stay in sync.
 */
const ORDER = { profile: 0, stats: 1, preferences: 2, devices: 3, data: 4, about: 5 } as const;

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
  const reduced = usePrefersReducedMotion();
  return (
    <Animated.View style={styles.section} entering={enterList(index, reduced)}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {/* Shadow lives on the outer view: the inner one clips its rows to the
          corner radius, and `overflow: hidden` would clip the shadow too. */}
      <View style={styles.cardShadow}>
        <View style={styles.card}>{children}</View>
      </View>
    </Animated.View>
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
  const body = (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={INK[300]} /> : null)}
    </View>
  );

  // Rows that only host a control (switch, stepper, version string) are not
  // buttons — rendering them as a Pressable would announce a dead tap target.
  if (!onPress) return <View style={divider ? styles.rowDivider : undefined}>{body}</View>;

  return (
    <PressableScale
      onPress={onPress}
      haptic="light"
      scaleTo={0.985}
      // Rows already clear the 44pt minimum; the default slop would spill into
      // the neighbouring row and steal its taps.
      hitSlop={0}
      containerStyle={divider ? styles.rowDivider : undefined}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
    >
      {body}
    </PressableScale>
  );
}

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState({ items: 0, stacks: 0, since: '' });
  // Until the first storage read resolves, the counts are meaningless zeroes —
  // show Skeletons instead of "0 Items".
  const [ready, setReady] = useState(false);

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
            await clearAll();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          },
        },
      ]
    );
  };

  const comingSoon = (what: string) =>
    Alert.alert(what, `${what} will be published before the App Store launch (required for subscriptions).`);

  // The server URL is a self-hoster's escape hatch: only surface it in dev, or
  // once this device has actually been pointed at a custom server.
  const showAdvanced = __DEV__ || !!sync.serverUrl;

  return (
    <View style={styles.page}>
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + SPACE.xxxl }}>
        {/* Profile card */}
        <Animated.View style={styles.profileCard} entering={enterList(ORDER.profile, reduced)}>
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
                <Text style={styles.profileName}>Your Silo</Text>
                <Text style={styles.profileMeta}>
                  {stats.since ? `On this device · since ${stats.since}` : 'On this device'}
                </Text>
              </>
            ) : (
              <>
                <Skeleton width={110} height={19} radius={RADIUS.xs} />
                <Skeleton width={170} height={13} radius={RADIUS.xs} style={styles.skeletonLine} />
              </>
            )}
          </View>
        </Animated.View>

        {/* Stats */}
        <Animated.View style={styles.statRow} entering={enterList(ORDER.stats, reduced)}>
          {[
            { n: stats.items, l: 'Items', i: 'documents' as const, c: BRAND[500] },
            { n: stats.stacks, l: 'Stacks', i: 'albums' as const, c: ACCENT[500] },
          ].map((s) => (
            <View key={s.l} style={styles.statTile}>
              <Ionicons name={s.i} size={18} color={s.c} />
              {ready ? (
                <Text style={styles.statNum}>{s.n}</Text>
              ) : (
                <Skeleton width={34} height={22} radius={RADIUS.xs} style={styles.skeletonStat} />
              )}
              <Text style={styles.statLabel}>{s.l}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Preferences */}
        <Section title="Preferences" index={ORDER.preferences}>
          <Row
            icon="time"
            tint={BRAND[500]}
            label="Default review length"
            sub="How long to block out when scheduling"
            right={
              <View style={styles.stepperRow}>
                <PressableScale
                  haptic="selection"
                  scaleTo={0.9}
                  onPress={() => adjustDuration(-5)}
                  style={styles.stepper}
                  accessibilityLabel="Decrease review length by 5 minutes"
                >
                  <Ionicons name="remove" size={16} color={INK[600]} />
                </PressableScale>
                <Text style={styles.stepperValue}>{settings.default_duration}m</Text>
                <PressableScale
                  haptic="selection"
                  scaleTo={0.9}
                  onPress={() => adjustDuration(5)}
                  style={styles.stepper}
                  accessibilityLabel="Increase review length by 5 minutes"
                >
                  <Ionicons name="add" size={16} color={INK[600]} />
                </PressableScale>
              </View>
            }
          />
          <Row
            icon="sparkles"
            tint={ACCENT[500]}
            label="Auto-suggest review time"
            sub="Let AI propose when to revisit a save"
            right={
              <Switch
                value={settings.auto_schedule}
                onValueChange={(v) => update({ auto_schedule: v })}
                trackColor={{ true: BRAND[600], false: INK[200] }}
              />
            }
          />
          <Row
            icon="notifications"
            tint={STATUS.warning}
            label="Notifications"
            sub="Bucket-list & review reminders (when available)"
            divider={false}
            right={
              <Switch
                value={settings.notifications_enabled}
                onValueChange={(v) => update({ notifications_enabled: v })}
                trackColor={{ true: BRAND[600], false: INK[200] }}
              />
            }
          />
        </Section>

        {/* Your devices (S1 — pairing code + manual sync; server URL under Advanced) */}
        <Section title="Your devices" index={ORDER.devices}>
          {/* Status header: paired state + relative last-synced time */}
          <View style={[styles.syncStatus, styles.rowDivider]}>
            <View style={styles.syncBadge}>
              <Ionicons name="cloud-outline" size={18} color={BRAND[600]} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{sync.spaceKey ? 'Paired' : 'Not paired yet'}</Text>
              <Text style={styles.rowSub}>
                {sync.lastSyncAt ? `Synced ${relTime(sync.lastSyncAt)}` : 'Never synced'}
              </Text>
            </View>
          </View>

          {/* Space code: monospace pill + copy + regenerate */}
          <View style={[styles.field, styles.rowDivider]}>
            <Text style={styles.fieldLabel}>Space code</Text>
            <View style={styles.fieldRow}>
              <View style={styles.codePill}>
                <Text
                  numberOfLines={1}
                  style={[styles.codeText, !sync.spaceKey && styles.codeTextEmpty]}
                >
                  {sync.spaceKey ?? 'created on first sync'}
                </Text>
              </View>
              <PressableScale
                haptic="light"
                onPress={copyCode}
                disabled={!sync.spaceKey}
                style={[styles.pillButton, !sync.spaceKey && styles.pillButtonDisabled]}
                containerStyle={styles.pillButtonSpacing}
              >
                <Text style={styles.pillButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                onPress={confirmRegenerate}
                style={styles.iconButton}
                containerStyle={styles.pillButtonSpacing}
                accessibilityLabel="Regenerate space code"
              >
                <Ionicons name="refresh" size={16} color={INK[600]} />
              </PressableScale>
            </View>
          </View>

          {/* Join an existing space (typed/pasted from another device) */}
          <View style={[styles.field, styles.rowDivider]}>
            <Text style={styles.fieldLabel}>Join existing space</Text>
            <View style={styles.fieldRow}>
              <TextInput
                value={joinCode}
                onChangeText={(t) => {
                  setJoinCode(t);
                  if (joinError) setJoinError(null);
                }}
                placeholder="silo-…"
                placeholderTextColor={INK[400]}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.inputFlex]}
                accessibilityLabel="Space code from your other device"
              />
              <PressableScale
                haptic="light"
                onPress={joinSpace}
                style={styles.pillButton}
                containerStyle={styles.pillButtonSpacing}
              >
                <Text style={styles.pillButtonText}>Join</Text>
              </PressableScale>
            </View>
            {!!joinError && <Text style={styles.errorText}>{joinError}</Text>}
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
                containerStyle={styles.advancedWrap}
                accessibilityLabel="Advanced sync settings"
              >
                <View style={styles.advancedRow}>
                  <Text style={styles.advancedLabel}>Advanced</Text>
                  <Ionicons
                    name={advancedOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={INK[300]}
                  />
                </View>
              </PressableScale>
              {advancedOpen && (
                <View style={styles.advancedPanel}>
                  <Text style={styles.fieldLabel}>Server URL</Text>
                  <TextInput
                    value={serverUrl}
                    onChangeText={setServerUrl}
                    onBlur={saveServerUrl}
                    placeholder="https://your-server.example"
                    placeholderTextColor={INK[400]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[styles.input, styles.inputBlock]}
                    accessibilityLabel="Sync server URL"
                  />
                  <Text style={styles.fieldHelp}>
                    Only change this if you’re running your own Silo server.
                  </Text>
                  {!!syncError && <Text style={styles.errorText}>{syncError}</Text>}
                </View>
              )}
            </>
          )}
        </Section>

        {/* Data */}
        <Section title="Your data" index={ORDER.data}>
          <Row
            icon="download-outline"
            tint={STATUS.success}
            label="Export my data"
            sub="Download everything as JSON"
            onPress={exportData}
          />
          <Row
            icon="trash-outline"
            tint={STATUS.danger}
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
            tint={BRAND[600]}
            label="Privacy Policy"
            onPress={() => comingSoon('Privacy Policy')}
          />
          <Row
            icon="document-text-outline"
            tint={INK[500]}
            label="Terms of Service"
            onPress={() => comingSoon('Terms of Service')}
          />
          <Row
            icon="mail-outline"
            tint={ACCENT[500]}
            label="Send feedback"
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Silo%20feedback`)}
          />
          <Row
            icon="information-circle-outline"
            tint={INK[400]}
            label="Version"
            right={<Text style={styles.versionText}>{APP_VERSION}</Text>}
            divider={false}
          />
        </Section>

        <Text style={styles.footer}>Silo · all your saves, organized</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: SURFACE.sunken },

  section: { marginTop: SPACE.xxl },
  sectionTitle: {
    ...TYPE.overline,
    color: TEXT.tertiary,
    textTransform: 'uppercase',
    marginBottom: SPACE.sm,
    marginLeft: SPACE.lg,
  },
  cardShadow: {
    marginHorizontal: SPACE.base,
    borderRadius: RADIUS.xl,
    backgroundColor: SURFACE.card,
    ...SHADOW.card,
  },
  card: { borderRadius: RADIUS.xl, overflow: 'hidden' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  rowIcon: {
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  rowText: { marginLeft: SPACE.md, flex: 1 },
  rowLabel: { ...TYPE.callout, fontWeight: '600', color: TEXT.primary },
  rowLabelDanger: { color: STATUS.danger },
  rowSub: { ...TYPE.caption, fontWeight: '400', color: TEXT.tertiary, marginTop: 2 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACE.base,
    marginTop: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.xl,
    backgroundColor: SURFACE.card,
    ...SHADOW.brandCard,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { marginLeft: SPACE.base, flex: 1 },
  profileName: { ...TYPE.title3, color: TEXT.primary },
  profileMeta: { ...TYPE.footnote, fontWeight: '400', color: TEXT.tertiary, marginTop: 2 },
  skeletonLine: { marginTop: SPACE.sm },

  statRow: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginHorizontal: SPACE.base,
    marginTop: SPACE.md,
  },
  statTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACE.base,
    borderRadius: RADIUS.xl,
    backgroundColor: SURFACE.card,
    ...SHADOW.card,
  },
  statNum: { ...TYPE.title2, color: TEXT.primary, marginTop: 6 },
  skeletonStat: { marginTop: 8, marginBottom: 4 },
  statLabel: { ...TYPE.caption, color: TEXT.tertiary },

  stepperRow: { flexDirection: 'row', alignItems: 'center' },
  stepper: {
    height: 28,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: INK[100],
  },
  stepperValue: {
    ...TYPE.subhead,
    fontWeight: '700',
    color: TEXT.primary,
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
    backgroundColor: BRAND[50],
  },

  field: { paddingHorizontal: SPACE.base, paddingVertical: SPACE.md },
  fieldRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACE.sm },
  fieldLabel: { ...TYPE.overline, color: TEXT.tertiary, textTransform: 'uppercase' },
  fieldHelp: { ...TYPE.caption, fontWeight: '400', color: TEXT.tertiary, marginTop: 6 },
  errorText: { ...TYPE.caption, fontWeight: '400', color: STATUS.danger, marginTop: 6 },

  codePill: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[50],
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  codeText: { ...TYPE.footnote, fontFamily: MONO, color: BRAND[700] },
  codeTextEmpty: { color: TEXT.tertiary },

  input: {
    ...TYPE.footnote,
    fontFamily: MONO,
    color: TEXT.primary,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: INK[50],
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  inputFlex: { flex: 1 },
  inputBlock: { marginTop: SPACE.sm },

  pillButton: {
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  pillButtonDisabled: { backgroundColor: INK[200] },
  pillButtonSpacing: { marginLeft: SPACE.sm },
  pillButtonText: { ...TYPE.footnote, fontWeight: '700', color: TEXT.inverse },
  iconButton: {
    height: 36,
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    backgroundColor: INK[100],
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

  advancedWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  advancedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
  },
  advancedLabel: { ...TYPE.caption, color: TEXT.tertiary, textTransform: 'uppercase' },
  advancedPanel: { paddingHorizontal: SPACE.base, paddingBottom: SPACE.base },

  versionText: { ...TYPE.footnote, fontWeight: '400', color: TEXT.tertiary },
  footer: {
    ...TYPE.caption,
    fontWeight: '400',
    color: TEXT.tertiary,
    textAlign: 'center',
    marginTop: SPACE.xxl,
  },
});
