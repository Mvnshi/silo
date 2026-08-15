/**
 * Your Silo — the resurfacing scoreboard.
 *
 * VISION.md's north-star metric ("actions taken per week from saved items"),
 * made visible and made the thing you level up. The framing matters: **saving
 * earns you nothing here.** Every number on this screen moves only when a save
 * turns into something you actually did, which is the opposite of what a
 * save-it-later app usually rewards.
 *
 * It also owns the anti-hoarding flow: when saves go stale, this is where the
 * app offers to help you let go of them, a few at a time.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import ScreenHeader from '@/components/ui/ScreenHeader';
import PressableScale from '@/components/ui/PressableScale';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import CleanupSheet from '@/components/CleanupSheet';
import { getItems } from '@/lib/storage';
import { Item } from '@/lib/types';
import {
  computeStats,
  describeRate,
  getCleanupCandidates,
  LEVELS,
  usesByWeek,
  type SiloStats,
  type WeekBucket,
} from '@/lib/stats';
import { enterList, usePrefersReducedMotion } from '@/lib/motion';
import {
  BRAND,
  DURATION,
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

export default function StatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const [items, setItems] = useState<Item[] | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await getItems());
    } catch (error) {
      console.error('Failed to load stats:', error);
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const stats: SiloStats | null = useMemo(() => (items ? computeStats(items) : null), [items]);
  const weeks = useMemo(() => (items ? usesByWeek(items, 12) : []), [items]);
  const cleanupCandidates = useMemo(
    () => (items ? getCleanupCandidates(items) : []),
    [items]
  );

  const loading = items === null;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...GRADIENTS.page]} style={StyleSheet.absoluteFill} />
      <ScreenHeader
        title="Your Silo"
        transparent
        right={
          <PressableScale
            haptic="light"
            scaleTo={0.9}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={22} color={INK[700]} />
          </PressableScale>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACE.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <>
            <Skeleton height={188} radius={RADIUS.xxl} />
            <View style={styles.metricGrid}>
              {Array.from({ length: 4 }).map((_, i) => (
                <View key={i} style={styles.metricCell}>
                  <Skeleton height={96} radius={RADIUS.xl} />
                </View>
              ))}
            </View>
            <Skeleton height={172} radius={RADIUS.xl} style={{ marginTop: SPACE.base }} />
          </>
        ) : stats && stats.totalSaves === 0 ? (
          <EmptyState
            icon="stats-chart"
            title="Nothing to measure yet"
            subtitle="Save a few things, do one of them, and this becomes the only number that matters."
            cta={{ label: 'Save something', onPress: () => router.replace('/(tabs)/add') }}
          />
        ) : stats ? (
          <>
            <Animated.View entering={enterList(0, reduced)}>
              <LevelCard stats={stats} />
            </Animated.View>

            <Animated.View entering={enterList(1, reduced)} style={styles.metricGrid}>
              <Metric
                icon="checkmark-done"
                value={String(stats.usedThisWeek)}
                label="Done this week"
                delta={stats.usedThisWeek - stats.usedLastWeek}
                tone="brand"
              />
              <Metric
                icon="flame"
                value={stats.streakWeeks > 0 ? `${stats.streakWeeks}w` : '—'}
                label="Streak"
                tone="accent"
              />
              <Metric
                icon="bookmark"
                value={String(stats.savedThisWeek)}
                label="Saved this week"
              />
              <Metric
                icon="hourglass-outline"
                value={String(stats.staleCount)}
                label="Going stale"
                tone={stats.staleCount > 0 ? 'warn' : 'default'}
              />
            </Animated.View>

            <Animated.View entering={enterList(2, reduced)}>
              <RateCard stats={stats} />
            </Animated.View>

            <Animated.View entering={enterList(3, reduced)}>
              <WeeklyChart weeks={weeks} />
            </Animated.View>

            {cleanupCandidates.length > 0 && (
              <Animated.View entering={enterList(4, reduced)}>
                <CleanupCard
                  count={cleanupCandidates.length}
                  onPress={() => setCleanupOpen(true)}
                />
              </Animated.View>
            )}
          </>
        ) : null}
      </ScrollView>

      <CleanupSheet
        visible={cleanupOpen}
        candidates={cleanupCandidates}
        onClose={() => setCleanupOpen(false)}
        onChanged={load}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function LevelCard({ stats }: { stats: SiloStats }) {
  const { level } = stats;
  const remaining = level.next !== null ? Math.max(0, level.next - stats.totalUses) : 0;
  const nextName =
    level.next !== null ? (LEVELS.find((l) => l.at === level.next)?.name ?? 'the next level') : null;

  return (
    <LinearGradient
      colors={[...GRADIENTS.brand]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.levelCard}
    >
      <View style={styles.levelTopRow}>
        <View>
          <Text style={styles.levelEyebrow}>LEVEL {level.level}</Text>
          <Text style={styles.levelName}>{level.name}</Text>
        </View>
        <View style={styles.levelNumeral}>
          <Text style={styles.levelNumeralText}>{stats.totalUses}</Text>
          <Text style={styles.levelNumeralLabel}>done</Text>
        </View>
      </View>

      <View style={styles.levelTrack}>
        <View style={[styles.levelFill, { width: `${Math.round(level.progress * 100)}%` }]} />
      </View>

      <Text style={styles.levelCaption}>
        {nextName
          ? `${remaining} more ${remaining === 1 ? 'thing' : 'things'} done to reach ${nextName}`
          : 'You’ve done everything this scoreboard can measure.'}
      </Text>
    </LinearGradient>
  );
}

function Metric({
  icon,
  value,
  label,
  delta,
  tone = 'default',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  delta?: number;
  tone?: 'default' | 'brand' | 'accent' | 'warn';
}) {
  const color =
    tone === 'brand'
      ? BRAND[600]
      : tone === 'accent'
        ? '#ec4899'
        : tone === 'warn'
          ? STATUS.warning
          : INK[600];

  return (
    <View style={styles.metricCell}>
      <View style={styles.metricCard}>
        <Ionicons name={icon} size={18} color={color} />
        <View style={styles.metricValueRow}>
          <Text style={styles.metricValue}>{value}</Text>
          {typeof delta === 'number' && delta !== 0 && (
            <Text
              style={[
                styles.metricDelta,
                { color: delta > 0 ? STATUS.success : TEXT.tertiary },
              ]}
            >
              {delta > 0 ? `+${delta}` : delta}
            </Text>
          )}
        </View>
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
    </View>
  );
}

function RateCard({ stats }: { stats: SiloStats }) {
  const pct = stats.resurfacingRate === null ? null : Math.round(stats.resurfacingRate * 100);
  return (
    <View style={styles.card}>
      <Text style={styles.cardEyebrow}>SAVE → DO RATE</Text>
      <View style={styles.rateRow}>
        <Text style={styles.rateValue}>{pct === null ? '—' : `${pct}%`}</Text>
        <Text style={styles.rateWindow}>last 30 days</Text>
      </View>
      <View style={styles.rateTrack}>
        <LinearGradient
          colors={[...GRADIENTS.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.rateFill, { width: `${pct ?? 0}%` }]}
        />
      </View>
      <Text style={styles.cardCaption}>{describeRate(stats.resurfacingRate)}</Text>
    </View>
  );
}

/**
 * 12 weeks of activity. Saves are the pale bar, things you actually did are the
 * solid one — so the gap between them IS the problem the product exists to fix.
 */
function WeeklyChart({ weeks }: { weeks: WeekBucket[] }) {
  const peak = Math.max(1, ...weeks.map((w) => Math.max(w.saves, w.uses)));
  return (
    <Animated.View entering={FadeIn.duration(DURATION.base)} style={styles.card}>
      <Text style={styles.cardEyebrow}>LAST 12 WEEKS</Text>
      <View style={styles.chart}>
        {weeks.map((w) => (
          <View key={w.start} style={styles.chartColumn}>
            <View style={styles.chartStack}>
              <View
                style={[styles.chartBarSaves, { height: `${(w.saves / peak) * 100}%` }]}
              />
              <View style={[styles.chartBarUses, { height: `${(w.uses / peak) * 100}%` }]} />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        <Legend color={BRAND[200]} label="Saved" />
        <Legend color={BRAND[600]} label="Done" />
      </View>
    </Animated.View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function CleanupCard({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <PressableScale
      haptic="light"
      scaleTo={0.985}
      style={styles.cleanupCard}
      onPress={onPress}
      accessibilityLabel={`Tidy up ${count} stale saves`}
    >
      <View style={styles.cleanupIcon}>
        <Ionicons name="sparkles" size={20} color={STATUS.warning} />
      </View>
      <View style={styles.cleanupBody}>
        <Text style={styles.cleanupTitle}>
          {count} {count === 1 ? 'save is' : 'saves are'} going stale
        </Text>
        <Text style={styles.cleanupSub}>
          Keep the ones you still want. Let the rest go — it takes a minute.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={TEXT.decorative} />
    </PressableScale>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: SPACE.base,
    paddingTop: SPACE.sm,
    flexGrow: 1,
  },

  levelCard: {
    borderRadius: RADIUS.xxl,
    padding: SPACE.xl,
    ...SHADOW.brandFloating,
  },
  levelTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  levelEyebrow: {
    ...TYPE.overline,
    color: 'rgba(255,255,255,0.75)',
  },
  levelName: {
    ...TYPE.display,
    color: '#fff',
    marginTop: 2,
  },
  levelNumeral: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    minWidth: 78,
  },
  levelNumeralText: {
    ...TYPE.title1,
    color: '#fff',
  },
  levelNumeralLabel: {
    ...TYPE.overline,
    color: 'rgba(255,255,255,0.8)',
  },
  levelTrack: {
    height: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.24)',
    marginTop: SPACE.lg,
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
  },
  levelCaption: {
    ...TYPE.footnote,
    color: 'rgba(255,255,255,0.9)',
    marginTop: SPACE.md,
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACE.md,
    marginHorizontal: -SPACE.xs,
  },
  metricCell: {
    width: '50%',
    padding: SPACE.xs,
  },
  metricCard: {
    backgroundColor: SURFACE.card,
    borderRadius: RADIUS.xl,
    padding: SPACE.base,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACE.xs,
    marginTop: SPACE.sm,
  },
  metricValue: {
    ...TYPE.title1,
    color: TEXT.primary,
  },
  metricDelta: {
    ...TYPE.caption,
    fontWeight: '800',
  },
  metricLabel: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
    marginTop: 2,
  },

  card: {
    backgroundColor: SURFACE.card,
    borderRadius: RADIUS.xl,
    padding: SPACE.lg,
    marginTop: SPACE.base,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  cardEyebrow: {
    ...TYPE.overline,
    color: TEXT.tertiary,
  },
  cardCaption: {
    ...TYPE.footnote,
    color: TEXT.secondary,
    marginTop: SPACE.md,
  },

  rateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
  },
  rateValue: {
    ...TYPE.display,
    color: TEXT.primary,
  },
  rateWindow: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
  },
  rateTrack: {
    height: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: INK[100],
    marginTop: SPACE.md,
    overflow: 'hidden',
  },
  rateFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
  },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 96,
    gap: 5,
    marginTop: SPACE.md,
  },
  chartColumn: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartStack: {
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartBarSaves: {
    width: '100%',
    minHeight: 3,
    borderRadius: RADIUS.xs,
    backgroundColor: BRAND[200],
  },
  chartBarUses: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    borderRadius: RADIUS.xs,
    backgroundColor: BRAND[600],
  },
  legend: {
    flexDirection: 'row',
    gap: SPACE.base,
    marginTop: SPACE.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: RADIUS.xs,
  },
  legendLabel: {
    ...TYPE.caption,
    color: TEXT.tertiary,
  },

  cleanupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    backgroundColor: STATUS.warningSoft,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.22)',
    padding: SPACE.base,
    marginTop: SPACE.base,
  },
  cleanupIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(217, 119, 6, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cleanupBody: { flex: 1 },
  cleanupTitle: {
    ...TYPE.bodyStrong,
    color: TEXT.primary,
  },
  cleanupSub: {
    ...TYPE.footnote,
    color: TEXT.secondary,
    marginTop: 2,
  },
});
