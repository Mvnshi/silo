/**
 * Settings / Profile screen.
 * Profile + stats, real preferences (persisted to UserSettings), data export +
 * delete-all (privacy/trust), and About. Reached from the Stacks header.
 */
import React, { useCallback, useState } from 'react';
import { Text, View, Pressable, ScrollView, Switch, Alert, Share, Linking } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import {
  getItems,
  getStacks,
  getSettings,
  saveSettings,
  getUserId,
  clearAll,
  DEFAULT_SETTINGS,
} from '@/lib/storage';
import { UserSettings } from '@/lib/types';
import { APP_VERSION, SUPPORT_EMAIL } from '@/lib/config';

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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [s, items, stacks, uid] = await Promise.all([
          getSettings(),
          getItems(),
          getStacks(),
          getUserId(),
        ]);
        if (!active) return;
        setSettings(s);
        const ts = parseInt(uid.split('_')[1] || '0', 10);
        const since = ts ? format(new Date(ts), 'MMM yyyy') : '—';
        setStats({ items: items.length, stacks: stacks.length, since });
      })();
      return () => {
        active = false;
      };
    }, [])
  );

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
