/**
 * Settings / Profile screen.
 * Profile + stats, real preferences (persisted to UserSettings), data export +
 * delete-all (privacy/trust), and About. Reached from the Stacks header.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Text,
  View,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  Share,
  Linking,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import PressableScale from '@/components/ui/PressableScale';
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
import { BRAND, GRADIENTS, HAIRLINE, INK } from '@/lib/theme';
import { UserSettings } from '@/lib/types';
import { APP_VERSION, SUPPORT_EMAIL } from '@/lib/config';

/** Same env default lib/api.ts + lib/sync.ts read; shown as the URL prefill. */
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';

/** Monospace for the space code / join input — codes must read unambiguously. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Must match the server's SPACE_KEY_RE (workers/sync.ts). */
const SPACE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-7">
      <Text className="mb-2 ml-5 text-[12px] font-bold uppercase tracking-wider text-ink-400">
        {title}
      </Text>
      <View
        className="mx-4 overflow-hidden rounded-3xl bg-white"
        style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12 }}
      >
        {children}
      </View>
    </View>
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
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center px-4 py-3 active:bg-ink-50"
      style={divider ? { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' } : undefined}
    >
      <View className="h-8 w-8 items-center justify-center rounded-[10px]" style={{ backgroundColor: tint + '1A' }}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View className="ml-3 flex-1">
        <Text className={`text-[15px] font-semibold ${danger ? 'text-red-500' : 'text-ink-900'}`}>{label}</Text>
        {!!sub && <Text className="mt-0.5 text-[12px] text-ink-400">{sub}</Text>}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color="#cbd5e1" /> : null)}
    </Pressable>
  );
}

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState({ items: 0, stacks: 0, since: '' });

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
        const since = ts ? format(new Date(ts), 'MMM yyyy') : '—';
        setStats({ items: items.length, stacks: stacks.length, since });
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
      setSyncResult(`Up ${r.pushed} / Down ${r.pulled}`);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSyncResult(null), 2500);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
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
      await Share.share({ message: payload }, { dialogTitle: 'Export your Silo data' });
    } catch {
      Alert.alert('Export failed', 'Could not export your data. Please try again.');
    }
  };

  const confirmClear = () => {
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

  return (
    <View className="flex-1 bg-ink-50">
      {/* Header */}
      <LinearGradient colors={['#ede9fe', '#f5f3ff']} style={{ paddingTop: insets.top + 6 }}>
        <View className="flex-row items-center px-3 pb-3">
          <Pressable onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full active:bg-white/60">
            <Ionicons name="chevron-back" size={24} color="#4c1d95" />
          </Pressable>
          <Text className="text-[18px] font-bold text-ink-900">Settings</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* Profile card */}
        <View className="mx-4 mt-4 flex-row items-center rounded-3xl bg-white p-4" style={{ shadowColor: '#8b5cf6', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 18 }}>
          <LinearGradient colors={['#8b5cf6', '#6366f1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person" size={28} color="#fff" />
          </LinearGradient>
          <View className="ml-4 flex-1">
            <Text className="text-[18px] font-bold text-ink-900">Your Silo</Text>
            <Text className="mt-0.5 text-[13px] text-ink-400">On this device · since {stats.since}</Text>
          </View>
        </View>

        {/* Stats */}
        <View className="mx-4 mt-3 flex-row gap-3">
          {[
            { n: stats.items, l: 'Items', i: 'documents' as const, c: '#8b5cf6' },
            { n: stats.stacks, l: 'Stacks', i: 'albums' as const, c: '#ec4899' },
          ].map((s) => (
            <View key={s.l} className="flex-1 items-center rounded-3xl bg-white py-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 }}>
              <Ionicons name={s.i} size={18} color={s.c} />
              <Text className="mt-1.5 text-[22px] font-extrabold text-ink-900">{s.n}</Text>
              <Text className="text-[12px] font-medium text-ink-400">{s.l}</Text>
            </View>
          ))}
        </View>

        {/* Sync across devices (S1 — pairing code + server + manual sync) */}
        <Section title="Sync across devices">
          {/* Status header: paired state + relative last-synced time */}
          <View
            className="flex-row items-center px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}
          >
            <View
              className="h-9 w-9 items-center justify-center rounded-xl"
              style={{ backgroundColor: BRAND[50] }}
            >
              <Ionicons name="cloud-outline" size={18} color={BRAND[600]} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-[15px] font-semibold text-ink-900">
                {sync.spaceKey ? 'Paired' : 'Not paired yet'}
              </Text>
              <Text className="mt-0.5 text-[12px] text-ink-400">
                {sync.lastSyncAt ? `Synced ${relTime(sync.lastSyncAt)}` : 'Never synced'}
              </Text>
            </View>
          </View>

          {/* Space code: monospace pill + copy + regenerate */}
          <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
              Space code
            </Text>
            <View className="mt-2 flex-row items-center">
              <View
                className="flex-1 justify-center rounded-full px-4 py-2"
                style={{ backgroundColor: BRAND[50], borderWidth: 1, borderColor: HAIRLINE }}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: MONO, fontSize: 13, color: sync.spaceKey ? BRAND[700] : INK[400] }}
                >
                  {sync.spaceKey ?? 'created on first sync'}
                </Text>
              </View>
              <PressableScale
                haptic="light"
                onPress={copyCode}
                disabled={!sync.spaceKey}
                className="ml-2 rounded-full px-3.5 py-2"
                style={{ backgroundColor: sync.spaceKey ? BRAND[600] : INK[200] }}
              >
                <Text className="text-[13px] font-bold text-white">{copied ? 'Copied' : 'Copy'}</Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                onPress={confirmRegenerate}
                className="ml-2 h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: INK[100] }}
              >
                <Ionicons name="refresh" size={16} color={INK[600]} />
              </PressableScale>
            </View>
          </View>

          {/* Join an existing space (typed/pasted from another device) */}
          <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
              Join existing space
            </Text>
            <View className="mt-2 flex-row items-center">
              <TextInput
                value={joinCode}
                onChangeText={(t) => {
                  setJoinCode(t);
                  if (joinError) setJoinError(null);
                }}
                placeholder="silo-…"
                placeholderTextColor={INK[300]}
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 rounded-full px-4 py-2 text-ink-900"
                style={{ fontFamily: MONO, fontSize: 13, backgroundColor: INK[50], borderWidth: 1, borderColor: HAIRLINE }}
              />
              <PressableScale
                haptic="light"
                onPress={joinSpace}
                className="ml-2 rounded-full px-4 py-2"
                style={{ backgroundColor: BRAND[600] }}
              >
                <Text className="text-[13px] font-bold text-white">Join</Text>
              </PressableScale>
            </View>
            {!!joinError && <Text className="mt-1.5 text-[12px] text-red-500">{joinError}</Text>}
          </View>

          {/* Server URL (saved on blur; empty = env default) */}
          <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
              Server URL
            </Text>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              onBlur={saveServerUrl}
              placeholder="http://192.168.1.20:8787"
              placeholderTextColor={INK[300]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="mt-2 rounded-full px-4 py-2 text-ink-900"
              style={{ fontFamily: MONO, fontSize: 13, backgroundColor: INK[50], borderWidth: 1, borderColor: HAIRLINE }}
            />
            <Text className="ml-1 mt-1.5 text-[12px] text-ink-400">
              Your laptop on Wi-Fi (Mode 1) or your deployed Worker (Mode 2) — see SYNC.md
            </Text>
          </View>

          {/* Sync now: spinner while running, then a brief "Up N / Down M" flash */}
          <View className="px-4 pb-4 pt-3">
            <PressableScale haptic="light" onPress={runSync} disabled={syncing}>
              <LinearGradient
                colors={GRADIENTS.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  paddingVertical: 13,
                  shadowColor: '#8b5cf6',
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                }}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name={syncResult ? 'checkmark-circle' : 'sync'} size={16} color="#fff" />
                    <Text className="ml-2 text-[15px] font-bold text-white">
                      {syncResult ?? 'Sync now'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </PressableScale>
            {!!syncError && (
              <Text className="mt-2 text-center text-[12px] text-red-500">{syncError}</Text>
            )}
          </View>
        </Section>

        {/* Preferences */}
        <Section title="Preferences">
          <Row
            icon="time"
            tint="#6366f1"
            label="Default review length"
            sub="How long to block out when scheduling"
            right={
              <View className="flex-row items-center">
                <Pressable onPress={() => adjustDuration(-5)} className="h-7 w-7 items-center justify-center rounded-full bg-ink-100 active:bg-ink-200">
                  <Ionicons name="remove" size={16} color="#475569" />
                </Pressable>
                <Text className="mx-3 w-12 text-center text-[14px] font-bold text-ink-900">{settings.default_duration}m</Text>
                <Pressable onPress={() => adjustDuration(5)} className="h-7 w-7 items-center justify-center rounded-full bg-ink-100 active:bg-ink-200">
                  <Ionicons name="add" size={16} color="#475569" />
                </Pressable>
              </View>
            }
          />
          <Row
            icon="sparkles"
            tint="#ec4899"
            label="Auto-suggest review time"
            sub="Let AI propose when to revisit a save"
            right={
              <Switch
                value={settings.auto_schedule}
                onValueChange={(v) => update({ auto_schedule: v })}
                trackColor={{ true: '#8b5cf6', false: '#e2e8f0' }}
              />
            }
          />
          <Row
            icon="notifications"
            tint="#f59e0b"
            label="Notifications"
            sub="Bucket-list & review reminders (when available)"
            divider={false}
            right={
              <Switch
                value={settings.notifications_enabled}
                onValueChange={(v) => update({ notifications_enabled: v })}
                trackColor={{ true: '#8b5cf6', false: '#e2e8f0' }}
              />
            }
          />
        </Section>

        {/* Data */}
        <Section title="Your data">
          <Row icon="download-outline" tint="#10b981" label="Export my data" sub="Download everything as JSON" onPress={exportData} />
          <Row icon="trash-outline" tint="#ef4444" label="Delete all data" sub="Wipe this device — can't be undone" danger divider={false} onPress={confirmClear} />
        </Section>

        {/* About */}
        <Section title="About">
          <Row icon="shield-checkmark-outline" tint="#06b6d4" label="Privacy Policy" onPress={() => comingSoon('Privacy Policy')} />
          <Row icon="document-text-outline" tint="#64748b" label="Terms of Service" onPress={() => comingSoon('Terms of Service')} />
          <Row
            icon="mail-outline"
            tint="#8b5cf6"
            label="Send feedback"
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Silo%20feedback`)}
          />
          <Row icon="information-circle-outline" tint="#94a3b8" label="Version" right={<Text className="text-[14px] text-ink-400">{APP_VERSION}</Text>} divider={false} />
        </Section>

        <Text className="mt-8 text-center text-[12px] text-ink-300">Silo · all your saves, organized</Text>
      </ScrollView>
    </View>
  );
}
