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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import Glass from '@/components/ui/Glass';
import ScreenHeader from '@/components/ui/ScreenHeader';
import PressableScale from '@/components/ui/PressableScale';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import CleanupSheet from '@/components/CleanupSheet';
import { getItems } from '@/lib/storage';
import { useDataVersion } from '@/lib/dataVersion';
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
import { staggerDelay, usePrefersReducedMotion } from '@/lib/motion';
import {
  ACCENT,
  BRAND,
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

/**
 * The tint the metric / rate / chart cards hand to `Glass`.
 *
 * Bare material borrows its colour from whatever is behind it — here a violet
 * page wash with other cards scrolling under it — and these cards carry the
 * screen's biggest numbers. `2e` ≈ 18% of the palette's own card colour: enough
 * to hold the type, far too little to read as a fill. (Both palettes state
 * `card` as a 6-digit hex, so the alpha suffix is all this needs.)
 */
function cardTint(c: ThemeColors): string {
  return `${c.card}2e`;
}

/**
 * Staggered entrance for a block that holds glass.
 *
 * `enterList` is a FADE, and an opacity animation on a glass surface — or on
 * ANY ancestor of one — stops the material rendering rather than fading it, so
 * every card on this screen would arrive as a hole. The scoreboard rises on a
 * transform instead, keeping `enterList`'s stagger.
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

export default function StatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const dataVersion = useDataVersion();
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

  // `dataVersion` so the assistant's actions land here too — it is an overlay,
  // not a route, so this screen never blurs. See lib/dataVersion.ts.
  useFocusEffect(
    useCallback(() => {
      load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, dataVersion])
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
      <LinearGradient colors={[...c.pageGradient]} style={StyleSheet.absoluteFill} />
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
            <Ionicons name="settings-outline" size={22} color={c.text} />
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
            <RiseIn index={0}>
              <LevelCard stats={stats} />
            </RiseIn>

            <RiseIn index={1} style={styles.metricGrid}>
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
            </RiseIn>

            <RiseIn index={2}>
              <RateCard stats={stats} />
            </RiseIn>

            <RiseIn index={3}>
              <WeeklyChart weeks={weeks} />
            </RiseIn>

            {cleanupCandidates.length > 0 && (
              <RiseIn index={4}>
                <CleanupCard
                  count={cleanupCandidates.length}
                  onPress={() => setCleanupOpen(true)}
                />
              </RiseIn>
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
  const c = useThemeColors();
  // The accent pink has no role in the palette; it lightens a step on dark for
  // the same reason `brand` does — the 500 step goes muddy on a near-black card.
  const color =
    tone === 'brand'
      ? c.brand
      : tone === 'accent'
        ? c.appearance === 'dark'
          ? ACCENT[400]
          : ACCENT[500]
        : tone === 'warn'
          ? c.warning
          : c.textSecondary;

  return (
    <View style={styles.metricCell}>
      {/* Lift on the wrapper, material inside: glass clips to its own bounds,
          so a shadow set on it would never leave them. */}
      <View style={styles.cardLift}>
        <Glass radius={RADIUS.xl} tintColor={cardTint(c)} style={styles.metricCard}>
          <Ionicons name={icon} size={18} color={color} />
          <View style={styles.metricValueRow}>
            <Text style={[styles.metricValue, { color: c.text }]}>{value}</Text>
            {typeof delta === 'number' && delta !== 0 && (
              <Text
                style={[
                  styles.metricDelta,
                  { color: delta > 0 ? c.success : c.textTertiary },
                ]}
              >
                {delta > 0 ? `+${delta}` : delta}
              </Text>
            )}
          </View>
          <Text style={[styles.metricLabel, { color: c.textTertiary }]}>{label}</Text>
        </Glass>
      </View>
    </View>
  );
}

function RateCard({ stats }: { stats: SiloStats }) {
  const c = useThemeColors();
  const pct = stats.resurfacingRate === null ? null : Math.round(stats.resurfacingRate * 100);
  return (
    <View style={[styles.cardLift, styles.cardSpacing]}>
      <Glass radius={RADIUS.xl} tintColor={cardTint(c)} style={styles.card}>
        <Text style={[styles.cardEyebrow, { color: c.textTertiary }]}>SAVE → DO RATE</Text>
        <View style={styles.rateRow}>
          <Text style={[styles.rateValue, { color: c.text }]}>
            {pct === null ? '—' : `${pct}%`}
          </Text>
          <Text style={[styles.rateWindow, { color: c.textTertiary }]}>last 30 days</Text>
        </View>
        {/* Track stays an opaque field and the fill stays a brand gradient —
            a meter is a surface, not a material. */}
        <View style={[styles.rateTrack, { backgroundColor: c.field }]}>
          <LinearGradient
            colors={[...GRADIENTS.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.rateFill, { width: `${pct ?? 0}%` }]}
          />
        </View>
        <Text style={[styles.cardCaption, { color: c.textSecondary }]}>
          {describeRate(stats.resurfacingRate)}
        </Text>
      </Glass>
    </View>
  );
}

/**
 * 12 weeks of activity. Saves are the pale bar, things you actually did are the
 * solid one — so the gap between them IS the problem the product exists to fix.
 */
function WeeklyChart({ weeks }: { weeks: WeekBucket[] }) {
  const c = useThemeColors();
  const peak = Math.max(1, ...weeks.map((w) => Math.max(w.saves, w.uses)));
  // Saves are the quiet bar, Done the loud one. On dark that means going DOWN
  // the violet scale for saves — the pale tint that recedes on white would
  // out-shout the solid bar on a near-black card and invert the whole reading.
  const savesColor = c.appearance === 'dark' ? BRAND[800] : BRAND[200];

  return (
    // The card used to fade itself in on top of the screen's own entrance. It is
    // glass now, and a fade above glass deletes the material — the stagger it
    // already gets from `RiseIn` is the entrance.
    <View style={[styles.cardLift, styles.cardSpacing]}>
      <Glass radius={RADIUS.xl} tintColor={cardTint(c)} style={styles.card}>
        <Text style={[styles.cardEyebrow, { color: c.textTertiary }]}>LAST 12 WEEKS</Text>
        <View style={styles.chart}>
          {weeks.map((w) => (
            <View key={w.start} style={styles.chartColumn}>
              <View style={styles.chartStack}>
                <View
                  style={[
                    styles.chartBar,
                    { backgroundColor: savesColor, height: `${(w.saves / peak) * 100}%` },
                  ]}
                />
                <View
                  style={[
                    styles.chartBarUses,
                    { backgroundColor: c.brand, height: `${(w.uses / peak) * 100}%` },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          <Legend color={savesColor} label="Saved" />
          <Legend color={c.brand} label="Done" />
        </View>
      </Glass>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const c = useThemeColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={[styles.legendLabel, { color: c.textTertiary }]}>{label}</Text>
    </View>
  );
}

function CleanupCard({ count, onPress }: { count: number; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <PressableScale
      haptic="light"
      scaleTo={0.985}
      containerStyle={styles.cleanupSpacing}
      onPress={onPress}
      accessibilityLabel={`Tidy up ${count} stale saves`}
    >
      {/* The warning still comes through the material, as a tint rather than a
          fill: `24` ≈ 14%, which is the alpha the dark palette's own
          `warningSoft` uses. `bordered={false}` because the amber edge below is
          doing that job — the plain rim would read as ordinary chrome, and this
          card is the one thing on the page asking for attention. It IS a
          control, so the glass takes the press. */}
      <Glass
        interactive
        bordered={false}
        radius={RADIUS.xl}
        tintColor={c.warning + '24'}
        style={[styles.cleanupCard, { borderColor: c.warning + '38' }]}
      >
        <View style={[styles.cleanupIcon, { backgroundColor: c.warning + '1F' }]}>
          <Ionicons name="sparkles" size={20} color={c.warning} />
        </View>
        <View style={styles.cleanupBody}>
          <Text style={[styles.cleanupTitle, { color: c.text }]}>
            {count} {count === 1 ? 'save is' : 'saves are'} going stale
          </Text>
          <Text style={[styles.cleanupSub, { color: c.textSecondary }]}>
            Keep the ones you still want. Let the rest go — it takes a minute.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.decorative} />
      </Glass>
    </PressableScale>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Layout only, plus the level card — that one is a brand surface, so its violet
 * gradient and white-on-violet text are the same in both appearances. Every
 * other colour is applied as a second style entry at the call site.
 */
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
  // Lift + radius on the wrapper (glass clips a shadow away), padding inside.
  cardLift: {
    borderRadius: RADIUS.xl,
    ...SHADOW.card,
  },
  cardSpacing: {
    marginTop: SPACE.base,
  },
  metricCard: {
    padding: SPACE.base,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACE.xs,
    marginTop: SPACE.sm,
  },
  metricValue: {
    ...TYPE.title1,
  },
  metricDelta: {
    ...TYPE.caption,
    fontWeight: '800',
  },
  metricLabel: {
    ...TYPE.footnote,
    marginTop: 2,
  },

  card: {
    padding: SPACE.lg,
  },
  cardEyebrow: {
    ...TYPE.overline,
  },
  cardCaption: {
    ...TYPE.footnote,
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
  },
  rateWindow: {
    ...TYPE.footnote,
  },
  rateTrack: {
    height: 10,
    borderRadius: RADIUS.pill,
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
  chartBar: {
    width: '100%',
    minHeight: 3,
    borderRadius: RADIUS.xs,
  },
  chartBarUses: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    borderRadius: RADIUS.xs,
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
  },

  cleanupSpacing: {
    marginTop: SPACE.base,
  },
  cleanupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    // Its own amber edge instead of the material's neutral rim — the colour is
    // half of what makes this read as "attention".
    borderWidth: 1,
    padding: SPACE.base,
  },
  cleanupIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cleanupBody: { flex: 1 },
  cleanupTitle: {
    ...TYPE.bodyStrong,
  },
  cleanupSub: {
    ...TYPE.footnote,
    marginTop: 2,
  },
});
