/**
 * TodayView — the Silo tab's recommendation home.
 *
 * This is where Silo's "AI decides with you" thesis becomes a product surface:
 * we read what you've saved (L1) + your calendar free/busy + (when permitted)
 * your location (L2) and turn it into 3 things you could act on right now,
 * plus context. See VISION.md.
 *
 * Pure presentation + a couple of small helpers — all data is passed in from
 * the parent so the source of truth stays in calendar.tsx (single fetch path).
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import PressableScale from '@/components/ui/PressableScale';
import GlassCard from '@/components/ui/GlassCard';
import { BRAND, INK, HAIRLINE, RADIUS, GRADIENTS } from '@/lib/theme';
import { Item, Classification } from '@/lib/types';
import { classConfig } from '@/lib/classification';
import { toLocalDateString } from '@/lib/datetime';
import { EventReviewCard, StaleCard } from '@/components/ReviewCard';
import {
  getPendingReviews,
  getStaleItems,
  isRepeatableDue,
  ReviewOutcome,
} from '@/lib/resurface';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface TodayEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  itemId?: string;
}

interface Props {
  allItems: Item[];
  /** All events relevant to today — calendar imports + Silo scheduled events. */
  events: TodayEvent[];
  currentLocation: { latitude: number; longitude: number } | null;
  onScheduleItem: (item: Item) => void;
  onDoneItem: (itemId: string) => void;
  onSnoozeItem: (itemId: string) => void;
  onOpenItem: (itemId: string) => void;
  /** After-event report verdict (lib/resurface). */
  onReview: (item: Item, outcome: ReviewOutcome) => void;
  /** Keep a stale item (resets its seen-clock). */
  onKeepStale: (id: string) => void;
  /** Archive a stale item. */
  onArchiveStale: (id: string) => void;
}

/** "saved 3mo ago"-style age label from an ISO date. */
function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 30) return `saved ${days}d ago`;
  if (days < 365) return `saved ${Math.floor(days / 30)}mo ago`;
  return `saved ${Math.floor(days / 365)}y ago`;
}

/** Great-circle distance in miles. Inline to avoid pulling a geo dep. */
function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 3958.8; // miles
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Classification → rough time-of-day fit (used to rank "3 to do today"). */
function timeOfDayFit(c: Classification, hour: number): number {
  // morning 5-11, midday 11-15, afternoon 15-18, evening 18-22
  const isMorning = hour >= 5 && hour < 11;
  const isMidday = hour >= 11 && hour < 15;
  const isAfternoon = hour >= 15 && hour < 18;
  const isEvening = hour >= 18 && hour < 22;
  switch (c) {
    case 'fitness':
      return isMorning || isAfternoon ? 2 : 0;
    case 'food':
      return isMidday || isEvening ? 2 : 0;
    case 'career':
    case 'academia':
      return isMorning || isMidday ? 2 : 0;
    case 'recipe':
      return isMidday || isEvening ? 2 : 0;
    case 'place':
    case 'event':
      return isAfternoon || isEvening ? 1 : 0;
    case 'idea':
      return 1;
    default:
      return 0;
  }
}

/**
 * Find the longest open gap between now and 23:00 that's not blocked by an
 * event. Returns null if everything's booked. Pure UI for v1 — no booking.
 */
function longestFreeMinutes(events: TodayEvent[], now: Date): { minutes: number; start: Date } | null {
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 0, 0, 0);
  if (now >= endOfDay) return null;

  // Sort by startDate, restrict to events ending after `now`.
  const blocks = events
    .filter((e) => e.endDate > now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  let cursor = now;
  let best: { minutes: number; start: Date } | null = null;
  for (const e of blocks) {
    const blockStart = e.startDate < now ? now : e.startDate;
    if (blockStart > cursor) {
      const gap = (blockStart.getTime() - cursor.getTime()) / 60000;
      if (!best || gap > best.minutes) best = { minutes: Math.round(gap), start: cursor };
    }
    if (e.endDate > cursor) cursor = e.endDate;
  }
  if (endOfDay > cursor) {
    const gap = (endOfDay.getTime() - cursor.getTime()) / 60000;
    if (!best || gap > best.minutes) best = { minutes: Math.round(gap), start: cursor };
  }
  return best && best.minutes >= 15 ? best : null;
}

function freeTimeLabel(start: Date): string {
  const h = start.getHours();
  if (h < 12) return 'this morning';
  if (h < 17) return 'this afternoon';
  return 'tonight';
}

export default function TodayView({
  allItems,
  events,
  currentLocation,
  onScheduleItem,
  onDoneItem,
  onSnoozeItem,
  onOpenItem,
  onReview,
  onKeepStale,
  onArchiveStale,
}: Props) {
  const now = useMemo(() => new Date(), []);
  const todayKey = toLocalDateString(now);

  // Resurfacing lanes (lib/resurface): "how did it go?" + "still want this?".
  const pendingReviews = useMemo(() => getPendingReviews(allItems, now), [allItems, now]);
  const staleItems = useMemo(() => getStaleItems(allItems, now), [allItems, now]);

  // Filter events down to today, sorted.
  const todayEvents = useMemo(
    () =>
      events
        .filter((e) => toLocalDateString(e.startDate) === todayKey)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
    [events, todayKey]
  );

  // Now / Next Up: the next event that hasn't already ended.
  const nextEvent = useMemo(
    () => todayEvents.find((e) => e.endDate >= now) || null,
    [todayEvents, now]
  );
  const minutesUntilNext = nextEvent
    ? Math.round((nextEvent.startDate.getTime() - now.getTime()) / 60000)
    : null;
  const isNow = minutesUntilNext !== null && minutesUntilNext >= -30 && minutesUntilNext <= 30;

  // 3 things you could do today: not done/archived/scheduled, ranked by
  // loved-repeatable > bucketlist > time-of-day fit > recency. A "loved" item
  // off its cooldown is the strongest pick — that's the habit loop paying off.
  const topThree = useMemo(() => {
    const hour = now.getHours();
    return allItems
      .filter(
        (i) =>
          !i.archived &&
          i.rating !== 'retired' &&
          !i.bucketlist_completed &&
          // A loved repeatable is 'done' but deliberately resurfaced again.
          (i.status !== 'done' || isRepeatableDue(i, now)) &&
          (!i.viewed || isRepeatableDue(i, now)) &&
          !i.scheduled_date
      )
      .map((i) => ({
        item: i,
        repeat: isRepeatableDue(i, now),
        score:
          (isRepeatableDue(i, now) ? 1000 : 0) +
          (i.bucketlist ? 100 : 0) +
          timeOfDayFit(i.classification, hour) * 10 +
          new Date(i.created_at).getTime() / 1e12,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => ({ item: x.item, repeat: x.repeat }));
  }, [allItems, now]);

  // Near you: items with coordinates within ~25 mi, sorted ascending. Up to 2.
  const nearYou = useMemo(() => {
    if (!currentLocation) return [] as { item: Item; miles: number }[];
    return allItems
      .filter(
        (i) =>
          !i.archived &&
          i.place_latitude != null &&
          i.place_longitude != null
      )
      .map((i) => ({
        item: i,
        miles: haversineMiles(currentLocation, {
          latitude: i.place_latitude as number,
          longitude: i.place_longitude as number,
        }),
      }))
      .filter((x) => x.miles <= 25)
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 2);
  }, [allItems, currentLocation]);

  // This week strip: items created in the last 7 days, max 8.
  const thisWeek = useMemo(() => {
    const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    return allItems
      .filter((i) => !i.archived && new Date(i.created_at).getTime() >= cutoff)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 8);
  }, [allItems, now]);

  const freeTime = useMemo(() => longestFreeMinutes(todayEvents, now), [todayEvents, now]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <View style={styles.greeting}>
        <Text style={styles.greetingTitle}>Today</Text>
        <Text style={styles.greetingSub}>{format(now, 'EEEE, MMMM d')}</Text>
      </View>

      {/* Check-in: close the loop on things you scheduled. */}
      {pendingReviews.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>How did it go?</Text>
          {pendingReviews.map((item) => (
            <EventReviewCard
              key={item.id}
              item={item}
              onOutcome={onReview}
              onReschedule={onScheduleItem}
            />
          ))}
        </>
      )}

      {/* Resurface: things going stale in the pile. */}
      {staleItems.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Still want these?</Text>
          {staleItems.map((item) => (
            <StaleCard
              key={item.id}
              item={item}
              ageLabel={ageLabel(item.created_at)}
              onKeep={onKeepStale}
              onArchive={onArchiveStale}
            />
          ))}
        </>
      )}

      {/* Now / Next Up */}
      <GlassCard tint="light" intensity={50} radius={RADIUS.xl} style={styles.heroCard}>
        <View style={styles.heroInner}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.eyebrow, { color: isNow ? BRAND[600] : INK[400] }]}>
              {nextEvent ? (isNow ? 'NOW' : 'NEXT UP') : 'YOUR DAY'}
            </Text>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {nextEvent ? nextEvent.title : 'No plans yet'}
            </Text>
            <Text style={styles.heroSub}>
              {nextEvent
                ? `${format(nextEvent.startDate, 'h:mm a')} – ${format(nextEvent.endDate, 'h:mm a')}`
                : 'Pick something below.'}
            </Text>
          </View>
          {nextEvent?.itemId && (
            <PressableScale
              haptic="light"
              onPress={() => onOpenItem(nextEvent.itemId as string)}
              style={styles.heroBtnWrap}
            >
              <LinearGradient
                colors={[...GRADIENTS.brand]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroBtn}
              >
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </LinearGradient>
            </PressableScale>
          )}
        </View>
      </GlassCard>

      {/* Free time */}
      {freeTime && (
        <View style={styles.freeCard}>
          <View style={styles.freeIcon}>
            <Ionicons name="time-outline" size={18} color={BRAND[600]} />
          </View>
          <Text style={styles.freeText}>
            <Text style={styles.freeNum}>{freeTime.minutes} min</Text>{' '}
            free {freeTimeLabel(freeTime.start)}
          </Text>
        </View>
      )}

      {/* 3 things you could do today */}
      <Text style={styles.sectionTitle}>3 things you could do today</Text>
      {topThree.length === 0 ? (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>
            Inbox is clear — share a link into Silo to get started.
          </Text>
        </View>
      ) : (
        topThree.map(({ item, repeat }) => {
          const cfg = classConfig(item.classification);
          return (
            <View key={item.id} style={styles.row}>
              {/* PressableScale's outer Pressable doesn't carry `flex`, so we
                  wrap it in a flex:1 View to take the available row width. */}
              <View style={{ flex: 1 }}>
                <PressableScale
                  haptic="light"
                  onPress={() => onOpenItem(item.id)}
                  style={styles.rowMain}
                >
                  <LinearGradient
                    colors={[cfg.from, cfg.to]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.rowIcon}
                  >
                    <Ionicons name={cfg.icon} size={18} color="#fff" />
                  </LinearGradient>
                  <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {repeat ? (
                      <View style={styles.lovedTag}>
                        <Ionicons name="heart" size={11} color={BRAND[600]} />
                        <Text style={styles.lovedTagText}>You loved this last time</Text>
                      </View>
                    ) : item.description ? (
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                </PressableScale>
              </View>
              <View style={styles.rowActions}>
                <PressableScale
                  haptic="light"
                  onPress={() => onScheduleItem(item)}
                  style={styles.actionBtn}
                  accessibilityLabel="Schedule"
                >
                  <Ionicons name="calendar-outline" size={18} color={BRAND[600]} />
                </PressableScale>
                <PressableScale
                  haptic="selection"
                  onPress={() => onDoneItem(item.id)}
                  style={styles.actionBtn}
                  accessibilityLabel="Mark done"
                >
                  <Ionicons name="checkmark" size={20} color={BRAND[600]} />
                </PressableScale>
                <PressableScale
                  haptic="light"
                  onPress={() => onSnoozeItem(item.id)}
                  style={styles.actionBtn}
                  accessibilityLabel="Snooze to tomorrow"
                >
                  <Ionicons name="moon-outline" size={18} color={BRAND[600]} />
                </PressableScale>
              </View>
            </View>
          );
        })
      )}

      {/* Near you */}
      {nearYou.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Near you</Text>
          {nearYou.map(({ item, miles }) => {
            const cfg = classConfig(item.classification);
            return (
              <PressableScale
                key={item.id}
                haptic="light"
                onPress={() => onOpenItem(item.id)}
                style={styles.nearRow}
              >
                <LinearGradient
                  colors={[cfg.from, cfg.to]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.nearIcon}
                >
                  <Ionicons name="location" size={18} color="#fff" />
                </LinearGradient>
                <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.place_name || item.place_address || 'Saved place'}
                  </Text>
                </View>
                <Text style={styles.nearDist}>{miles < 1 ? '<1' : Math.round(miles)} mi</Text>
              </PressableScale>
            );
          })}
        </>
      )}

      {/* This week */}
      {thisWeek.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>This week</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.weekStrip}
          >
            {thisWeek.map((item) => {
              const cfg = classConfig(item.classification);
              return (
                <PressableScale
                  key={item.id}
                  haptic="light"
                  onPress={() => onOpenItem(item.id)}
                  style={styles.weekTile}
                >
                  <LinearGradient
                    colors={[cfg.from, cfg.to]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.weekTileIcon}
                  >
                    <Ionicons name={cfg.icon} size={20} color="#fff" />
                  </LinearGradient>
                  <Text style={styles.weekTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  greeting: { marginBottom: 16 },
  greetingTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: INK[900],
    letterSpacing: -0.6,
  },
  greetingSub: { fontSize: 15, color: INK[500], marginTop: 2 },
  heroCard: { marginBottom: 12 },
  heroInner: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  heroTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: INK[900],
    marginTop: 4,
    letterSpacing: -0.2,
  },
  heroSub: { fontSize: 13, color: INK[500], marginTop: 4 },
  heroBtnWrap: {},
  heroBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND[50],
    borderWidth: 1,
    borderColor: BRAND[100],
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 22,
  },
  freeIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeText: { fontSize: 14, color: INK[700], flex: 1 },
  freeNum: { fontWeight: '700', color: BRAND[700] },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: INK[900],
    marginTop: 4,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  emptyRow: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 18,
  },
  emptyText: { fontSize: 14, color: INK[500], textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 10,
    marginBottom: 8,
    shadowColor: INK[900],
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  rowMain: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: INK[900] },
  rowSub: { fontSize: 12, color: INK[500], marginTop: 2 },
  lovedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  lovedTagText: { fontSize: 11, fontWeight: '700', color: BRAND[600] },
  rowActions: { flexDirection: 'row', gap: 4, marginLeft: 8 },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND[50],
  },
  nearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 10,
    marginBottom: 8,
  },
  nearIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearDist: { fontSize: 13, fontWeight: '600', color: BRAND[600] },
  weekStrip: { gap: 10, paddingRight: 16, paddingBottom: 4 },
  weekTile: {
    width: 110,
    height: 140,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 10,
    justifyContent: 'space-between',
  },
  weekTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTitle: { fontSize: 12, fontWeight: '600', color: INK[900], lineHeight: 16 },
});
