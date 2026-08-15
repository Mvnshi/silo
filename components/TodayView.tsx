/**
 * TodayView — the Silo tab's recommendation home.
 *
 * This is where Silo's "AI decides with you" thesis becomes a product surface:
 * we read what you've saved (L1) + your calendar free/busy + (when permitted)
 * your location (L2) and turn it into a short list of things you could act on
 * right now, plus context. See VISION.md.
 *
 * The "Picked for you" block is the headline claim and gets a hero treatment
 * (overline + title + one bordered card) rather than looking like every other
 * section. Its heading counts the actual picks so it never over-promises.
 *
 * Location is NEVER requested on mount — the "Near you" slot shows a priming
 * row and the OS dialog only follows an explicit tap.
 *
 * Pure presentation + a couple of small helpers — all data is passed in from
 * the parent so the source of truth stays in calendar.tsx (single fetch path).
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import Animated from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import GlassCard from '@/components/ui/GlassCard';
import Skeleton from '@/components/ui/Skeleton';
import {
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { enterList, exitFade, LAYOUT, usePrefersReducedMotion } from '@/lib/motion';
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

export interface TodayEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  itemId?: string;
}

/** Foreground-location permission as this screen sees it. */
export type LocationStatus = 'idle' | 'requesting' | 'granted' | 'denied';

interface Props {
  allItems: Item[];
  /** All events relevant to today — calendar imports + Silo scheduled events. */
  events: TodayEvent[];
  currentLocation: { latitude: number; longitude: number } | null;
  /** First load still in flight — render skeletons rather than "inbox is clear". */
  loading?: boolean;
  /** Foreground-location permission; drives the "Near you" priming row. */
  locationStatus: LocationStatus;
  /** Ask for location (or route to Settings once denied). */
  onRequestLocation: () => void;
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

/**
 * Heading for the picks block. It counts, because the list is a `slice(0, 3)`
 * and a static "3 things" over one row is the product lying to the user.
 */
function picksHeading(count: number): string {
  if (count === 0) return 'Nothing queued yet';
  if (count === 1) return 'One thing you could do today';
  if (count === 2) return 'Two things you could do today';
  return '3 things you could do today';
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

/** Classification → rough time-of-day fit (used to rank the picks). */
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
  loading = false,
  locationStatus,
  onRequestLocation,
  onScheduleItem,
  onDoneItem,
  onSnoozeItem,
  onOpenItem,
  onReview,
  onKeepStale,
  onArchiveStale,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  // This screen paints a lot of surfaces; build the colour overlays once per
  // appearance change rather than allocating them on every render.
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);
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

  // The picks: not done/archived/scheduled, ranked by loved-repeatable >
  // bucketlist > time-of-day fit > recency. A "loved" item off its cooldown is
  // the strongest pick — that's the habit loop paying off.
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

  // Only skeleton the very first load; a refresh keeps the current content.
  const showSkeleton = loading && allItems.length === 0;
  const locationDenied = locationStatus === 'denied';
  // Once granted, an empty "Near you" means nothing IS near you — don't beg.
  const showNearPrime = locationStatus !== 'granted';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <Animated.View entering={enterList(0, reduced)} style={styles.greeting}>
        <Text style={[styles.greetingTitle, dyn.greetingTitle]}>Today</Text>
        <Text style={[styles.greetingSub, dyn.greetingSub]}>{format(now, 'EEEE, MMMM d')}</Text>
      </Animated.View>

      {showSkeleton ? (
        <>
          <Skeleton height={92} radius={RADIUS.xl} style={styles.heroSkeleton} />
          <Text style={[styles.picksOverline, dyn.picksOverline]}>PICKED FOR YOU</Text>
          <View style={[styles.picksCard, dyn.picksCard, styles.picksCardSpaced]}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[styles.picksRow, i > 0 && [styles.picksDivider, dyn.picksDivider]]}
              >
                <Skeleton height={58} radius={RADIUS.md} />
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          {/* Check-in: close the loop on things you scheduled. */}
          {pendingReviews.length > 0 && (
            <Animated.View entering={enterList(1, reduced)}>
              <Text style={[styles.sectionTitle, dyn.sectionTitle]}>How did it go?</Text>
              {pendingReviews.map((item) => (
                <EventReviewCard
                  key={item.id}
                  item={item}
                  onOutcome={onReview}
                  onReschedule={onScheduleItem}
                />
              ))}
            </Animated.View>
          )}

          {/* Resurface: things going stale in the pile. */}
          {staleItems.length > 0 && (
            <Animated.View entering={enterList(2, reduced)}>
              <Text style={[styles.sectionTitle, dyn.sectionTitle]}>Still want these?</Text>
              {staleItems.map((item) => (
                <StaleCard
                  key={item.id}
                  item={item}
                  ageLabel={ageLabel(item.created_at)}
                  onKeep={onKeepStale}
                  onArchive={onArchiveStale}
                />
              ))}
            </Animated.View>
          )}

          {/* Now / Next Up */}
          <Animated.View entering={enterList(3, reduced)} layout={LAYOUT} exiting={exitFade(reduced)}>
            <GlassCard tint={c.glassTint} intensity={50} radius={RADIUS.xl} style={styles.heroCard}>
              <View style={styles.heroInner}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.eyebrow, { color: isNow ? c.textBrand : c.textTertiary }]}
                  >
                    {nextEvent ? (isNow ? 'NOW' : 'NEXT UP') : 'YOUR DAY'}
                  </Text>
                  <Text style={[styles.heroTitle, dyn.heroTitle]} numberOfLines={2}>
                    {nextEvent ? nextEvent.title : 'No plans yet'}
                  </Text>
                  <Text style={[styles.heroSub, dyn.heroSub]}>
                    {nextEvent
                      ? `${format(nextEvent.startDate, 'h:mm a')} – ${format(nextEvent.endDate, 'h:mm a')}`
                      : 'Pick something below.'}
                  </Text>
                </View>
                {nextEvent?.itemId && (
                  <PressableScale
                    haptic="light"
                    onPress={() => onOpenItem(nextEvent.itemId as string)}
                    accessibilityLabel={`Open ${nextEvent.title}`}
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
          </Animated.View>

          {/* Free time */}
          {freeTime && (
            <Animated.View entering={enterList(4, reduced)} style={[styles.freeCard, dyn.freeCard]}>
              <View style={[styles.freeIcon, dyn.freeIcon]}>
                <Ionicons name="time-outline" size={18} color={c.brand} />
              </View>
              <Text style={[styles.freeText, dyn.freeText]}>
                <Text style={[styles.freeNum, dyn.freeNum]}>{freeTime.minutes} min</Text>{' '}
                free {freeTimeLabel(freeTime.start)}
              </Text>
            </Animated.View>
          )}

          {/* The picks — the product's headline claim, so it gets a hero block
              rather than looking like the fifth section header on the page. */}
          <Animated.View entering={enterList(5, reduced)} style={styles.picksBlock}>
            <Text style={[styles.picksOverline, dyn.picksOverline]}>PICKED FOR YOU</Text>
            <Text style={[styles.picksHeading, dyn.picksHeading]}>
              {picksHeading(topThree.length)}
            </Text>

            {topThree.length === 0 ? (
              <View style={[styles.emptyRow, dyn.emptyRow]}>
                <Text style={[styles.emptyText, dyn.emptyText]}>
                  Inbox is clear — share a link into Silo to get started.
                </Text>
              </View>
            ) : (
              <View style={[styles.picksCard, dyn.picksCard]}>
                {topThree.map(({ item, repeat }, index) => {
                  const cfg = classConfig(item.classification);
                  return (
                    <Animated.View
                      key={item.id}
                      layout={LAYOUT}
                      exiting={exitFade(reduced)}
                      style={[
                        styles.picksRow,
                        index > 0 && [styles.picksDivider, dyn.picksDivider],
                      ]}
                    >
                      {/* PressableScale's outer Pressable doesn't carry `flex`,
                          so containerStyle is what takes the row width. */}
                      <PressableScale
                        haptic="light"
                        onPress={() => onOpenItem(item.id)}
                        containerStyle={{ flex: 1 }}
                        style={styles.rowMain}
                      >
                        <LinearGradient
                          colors={[cfg.from, cfg.to]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.rowIcon}
                        >
                          <Ionicons name={cfg.icon} size={22} color="#fff" />
                        </LinearGradient>
                        <View style={{ flex: 1, marginLeft: SPACE.md, minWidth: 0 }}>
                          <Text style={[styles.rowTitle, dyn.rowTitle]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          {repeat ? (
                            <View style={styles.lovedTag}>
                              <Ionicons name="heart" size={11} color={c.textBrand} />
                              <Text style={[styles.lovedTagText, dyn.lovedTagText]}>
                                You loved this last time
                              </Text>
                            </View>
                          ) : item.description ? (
                            <Text style={[styles.rowSub, dyn.rowSub]} numberOfLines={1}>
                              {item.description}
                            </Text>
                          ) : null}
                        </View>
                      </PressableScale>
                      <View style={styles.rowActions}>
                        <PressableScale
                          haptic="light"
                          onPress={() => onScheduleItem(item)}
                          style={[styles.actionBtn, dyn.actionBtn]}
                          accessibilityLabel={`Schedule ${item.title}`}
                        >
                          <Ionicons name="calendar-outline" size={18} color={c.brand} />
                        </PressableScale>
                        <PressableScale
                          haptic="selection"
                          onPress={() => onDoneItem(item.id)}
                          style={[styles.actionBtn, dyn.actionBtn]}
                          accessibilityLabel={`Mark ${item.title} done`}
                        >
                          <Ionicons name="checkmark" size={20} color={c.brand} />
                        </PressableScale>
                        <PressableScale
                          haptic="light"
                          onPress={() => onSnoozeItem(item.id)}
                          style={[styles.actionBtn, dyn.actionBtn]}
                          accessibilityLabel={`Snooze ${item.title} to tomorrow`}
                        >
                          <Ionicons name="moon-outline" size={18} color={c.brand} />
                        </PressableScale>
                      </View>
                    </Animated.View>
                  );
                })}
              </View>
            )}
          </Animated.View>

          {/* Near you — or the row that primes for location. The OS dialog only
              ever follows an explicit tap here, never a tab open. */}
          {(nearYou.length > 0 || showNearPrime) && (
            <Animated.View entering={enterList(6, reduced)}>
              <Text style={[styles.sectionTitle, dyn.sectionTitle]}>Near you</Text>
              {nearYou.length > 0
                ? nearYou.map(({ item, miles }) => {
                    const cfg = classConfig(item.classification);
                    return (
                      <PressableScale
                        key={item.id}
                        haptic="light"
                        onPress={() => onOpenItem(item.id)}
                        style={[styles.nearRow, dyn.nearRow]}
                      >
                        <LinearGradient
                          colors={[cfg.from, cfg.to]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.nearIcon}
                        >
                          <Ionicons name="location" size={18} color="#fff" />
                        </LinearGradient>
                        <View style={{ flex: 1, marginLeft: SPACE.md, minWidth: 0 }}>
                          <Text style={[styles.rowTitle, dyn.rowTitle]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={[styles.rowSub, dyn.rowSub]} numberOfLines={1}>
                            {item.place_name || item.place_address || 'Saved place'}
                          </Text>
                        </View>
                        <Text style={[styles.nearDist, dyn.nearDist]}>
                          {miles < 1 ? '<1' : Math.round(miles)} mi
                        </Text>
                      </PressableScale>
                    );
                  })
                : (
                  <PressableScale
                    haptic="light"
                    onPress={onRequestLocation}
                    disabled={locationStatus === 'requesting'}
                    style={[styles.nearRow, dyn.nearRow]}
                    accessibilityLabel={
                      locationDenied ? 'Open location settings' : 'Turn on location'
                    }
                  >
                    <View style={[styles.primeIcon, dyn.primeIcon]}>
                      <Ionicons name="navigate" size={18} color={c.brand} />
                    </View>
                    <View style={{ flex: 1, marginLeft: SPACE.md, minWidth: 0 }}>
                      <Text style={[styles.rowTitle, dyn.rowTitle]} numberOfLines={1}>
                        {locationDenied ? 'Location is off' : 'See what’s near you'}
                      </Text>
                      <Text style={[styles.rowSub, dyn.rowSub]} numberOfLines={2}>
                        {locationDenied
                          ? 'Turn it back on in Settings to surface saved places nearby.'
                          : 'Silo will surface saved places within 25 miles.'}
                      </Text>
                    </View>
                    <Text style={[styles.primeCta, dyn.primeCta]}>
                      {locationStatus === 'requesting'
                        ? 'Checking…'
                        : locationDenied
                          ? 'Settings'
                          : 'Turn on'}
                    </Text>
                  </PressableScale>
                )}
            </Animated.View>
          )}

          {/* This week */}
          {thisWeek.length > 0 && (
            <Animated.View entering={enterList(7, reduced)}>
              <Text style={[styles.sectionTitle, dyn.sectionTitle]}>This week</Text>
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
                      style={[styles.weekTile, dyn.weekTile]}
                    >
                      <LinearGradient
                        colors={[cfg.from, cfg.to]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.weekTileIcon}
                      >
                        <Ionicons name={cfg.icon} size={20} color="#fff" />
                      </LinearGradient>
                      <Text style={[styles.weekTitle, dyn.weekTitle]} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>
            </Animated.View>
          )}
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

/**
 * Appearance-INDEPENDENT styles only: layout, spacing, radii, type. Colour is
 * layered on from `makeDynamicStyles` below, because StyleSheet.create runs
 * once at module scope and can never see the live palette.
 */
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: SPACE.base, paddingTop: SPACE.md },
  greeting: { marginBottom: SPACE.base },
  greetingTitle: { ...TYPE.display },
  greetingSub: { ...TYPE.callout, marginTop: SPACE.xxs },

  heroSkeleton: { marginBottom: SPACE.lg },
  heroCard: { marginBottom: SPACE.md },
  heroInner: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: SPACE.md },
  eyebrow: { ...TYPE.overline },
  heroTitle: { ...TYPE.title3, marginTop: SPACE.xs },
  heroSub: { ...TYPE.footnote, marginTop: SPACE.xs },
  heroBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  freeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: SPACE.md,
    gap: 10,
    marginBottom: 22,
  },
  freeIcon: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freeText: { ...TYPE.subhead, fontWeight: '500', flex: 1 },
  freeNum: { fontWeight: '700' },

  sectionTitle: {
    ...TYPE.headline,
    marginTop: SPACE.xs,
    marginBottom: 10,
  },

  /* --- the picks hero block --- */
  picksBlock: { marginBottom: SPACE.lg },
  picksOverline: { ...TYPE.overline, marginBottom: SPACE.xs },
  picksHeading: { ...TYPE.title1, marginBottom: SPACE.md },
  picksCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    ...SHADOW.brandCard,
  },
  picksCardSpaced: { marginTop: SPACE.md },
  picksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: SPACE.md,
  },
  picksDivider: { borderTopWidth: 1 },

  emptyRow: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: 18,
  },
  emptyText: { ...TYPE.subhead, fontWeight: '500', textAlign: 'center' },

  rowMain: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { ...TYPE.bodyStrong },
  rowSub: { ...TYPE.footnote, marginTop: SPACE.xxs },
  lovedTag: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: 3 },
  lovedTagText: { ...TYPE.caption, fontWeight: '700' },
  rowActions: { flexDirection: 'row', gap: SPACE.xs, marginLeft: SPACE.sm },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  nearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 10,
    marginBottom: SPACE.sm,
  },
  nearIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearDist: { ...TYPE.subhead },
  primeIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primeCta: { ...TYPE.subhead, fontWeight: '700', marginLeft: SPACE.sm },

  weekStrip: { gap: 10, paddingRight: SPACE.base, paddingBottom: SPACE.xs },
  weekTile: {
    width: 110,
    height: 140,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  weekTileIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTitle: { ...TYPE.caption },
});

/**
 * The colour half of the sheet above, resolved for the live appearance.
 *
 * A plain object on purpose — StyleSheet.create here would register a fresh
 * sheet on every appearance flip and leak the old one.
 *
 * The picks card, the empty row, the "near you" rows and the week tiles all
 * already carried a 1pt border in light, so nothing extra is needed on dark:
 * that border is what separates them from the page once `SHADOW.brandCard` /
 * `SHADOW.card` stop being visible.
 */
function makeDynamicStyles(c: ThemeColors) {
  return {
    greetingTitle: { color: c.text },
    greetingSub: { color: c.textTertiary },

    heroTitle: { color: c.text },
    heroSub: { color: c.textTertiary },

    freeCard: { backgroundColor: c.brandSoft, borderColor: c.brandBorder },
    // Card, not white: a white disc on the dark violet wash would glow.
    freeIcon: { backgroundColor: c.card },
    freeText: { color: c.textSecondary },
    freeNum: { color: c.textBrand },

    sectionTitle: { color: c.text },

    picksOverline: { color: c.textBrand },
    picksHeading: { color: c.text },
    picksCard: { backgroundColor: c.card, borderColor: c.brandBorder },
    picksDivider: { borderTopColor: c.hairline },

    emptyRow: { backgroundColor: c.card, borderColor: c.brandBorder },
    emptyText: { color: c.textTertiary },

    rowTitle: { color: c.text },
    rowSub: { color: c.textTertiary },
    lovedTagText: { color: c.textBrand },
    actionBtn: { backgroundColor: c.brandSoft },

    nearRow: { backgroundColor: c.card, borderColor: c.hairline },
    nearDist: { color: c.textBrand },
    primeIcon: { backgroundColor: c.brandSoft },
    primeCta: { color: c.textBrand },

    weekTile: { backgroundColor: c.card, borderColor: c.hairline },
    weekTitle: { color: c.text },
  };
}
