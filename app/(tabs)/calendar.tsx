/**
 * Silo tab — Today, Calendar, Map, Bucket List.
 *
 * Four panes behind one segmented control:
 * - Today (default): the recommendation surface (components/TodayView).
 * - Calendar: a day/week strip plus the merged list of Silo items and native
 *   calendar events for the selected date. Silo's own mirrored "Review: …"
 *   events are filtered out so a scheduled item appears exactly once.
 * - Map: pins for saved places (addresses are geocoded lazily, paced so
 *   CLGeocoder doesn't rate-limit us) with an in-context location prompt.
 * - Bucket List: things to do when the circumstances are right, incomplete
 *   first, with a progress track.
 *
 * Location is only ever requested from the Map pane or an explicit tap on
 * Today's "Near you" row — never on tab open.
 *
 * Dependencies:
 * - react-native-maps: map + markers
 * - expo-calendar / expo-location: native calendar reads, geocoding, position
 * - date-fns: date formatting and manipulation
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  ScrollView,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  TextInput,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
// Platform-default map provider: Apple Maps on iOS (no SDK pod, no API key,
// native look). Forcing PROVIDER_GOOGLE without the Google Maps SDK renders a
// blank map + red error on iOS; revisit only if Android ships (it needs a key).
import MapView, { Marker, Region } from 'react-native-maps';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  format,
  addDays,
  startOfWeek,
  isSameDay,
} from 'date-fns';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import ItemCard from '@/components/ItemCard';
import PressableScale from '@/components/ui/PressableScale';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import TodayView, { LocationStatus, TodayEvent } from '@/components/TodayView';
import {
  ACCENT,
  BRAND,
  DURATION,
  GRADIENTS,
  HAIRLINE,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  STATUS,
  TEXT,
  TYPE,
} from '@/lib/theme';
import { Item, ScheduledEvent } from '@/lib/types';
import { getItems, getItemById, updateItem, addItem, getEvents, touchSeen } from '@/lib/storage';
import { buildReview, ReviewOutcome } from '@/lib/resurface';
import { createItem } from '@/lib/items';
import { requestCalendarPermissions, scheduleItemReview, REVIEW_PREFIX } from '@/lib/scheduler';
import { celebrationHaptic } from '@/lib/haptics';
import { parseLocalDate, toLocalDateString } from '@/lib/datetime';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Map camera zoom used for "centre on me" and the initial region. */
const REGION_DELTA = { latitudeDelta: 0.0922, longitudeDelta: 0.0421 };

/**
 * Addresses that geocoding has already failed on, remembered for the session.
 * Failed lookups never gain coordinates, so without this they get re-selected
 * and re-geocoded on every `allItems` change — which is exactly the burst that
 * trips CLGeocoder's rate limiter and makes ALL lookups start failing.
 */
const geocodeFailed = new Set<string>();

// 'today' was added as the FIRST option (and default) so the Silo tab opens
// onto a recommendation-first surface; the legacy calendar/map/bucket views are
// preserved untouched behind their own segments.
type ViewMode = 'today' | 'calendar' | 'map' | 'bucketlist';
type CalendarViewMode = 'day' | 'week';

const MODES: { key: ViewMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'today', label: 'Today', icon: 'sparkles' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline' },
  { key: 'map', label: 'Map', icon: 'map-outline' },
  { key: 'bucketlist', label: 'Bucket List', icon: 'list-outline' },
];

interface CalendarEvent {
  id: string;
  /** Already stripped of REVIEW_PREFIX — never render "Review: …" at the user. */
  title: string;
  startDate: Date;
  endDate: Date;
  isSiloEvent: boolean;
  itemId?: string;
}

/**
 * One sort key for both row kinds. The old comparator returned 0 for every
 * Item↔Event pair and `Array.sort` is stable, so a 9pm item listed above an 8am
 * meeting.
 */
function startKey(row: Item | CalendarEvent): number {
  return 'startDate' in row
    ? row.startDate.getTime()
    : parseLocalDate(row.scheduled_date!, row.scheduled_time ?? '09:00').getTime();
}

export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>('day');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [bucketlistItems, setBucketlistItems] = useState<Item[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [newEventDate, setNewEventDate] = useState(new Date());
  const [newEventTime, setNewEventTime] = useState(new Date());
  const [newEventTitle, setNewEventTitle] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const mapRef = useRef<MapView | null>(null);
  const [mapRegion, setMapRegion] = useState<Region>({
    latitude: 37.7749,
    longitude: -122.4194,
    ...REGION_DELTA,
  });

  /**
   * Ask for foreground location. Only ever called from the Map pane or an
   * explicit tap on Today's "Near you" row — a cold-start dialog is hostile UX
   * and an App Review flag. Once denied, iOS won't re-prompt, so we hand the
   * user off to Settings instead of firing a request that silently no-ops.
   */
  const requestLocation = useCallback(async () => {
    if (locationStatus === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    setLocationStatus('requesting');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('denied');
        return;
      }
      setLocationStatus('granted');
      const location = await Location.getCurrentPositionAsync({});
      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      setCurrentLocation(coords);
      setMapRegion({ ...coords, ...REGION_DELTA });
    } catch (error) {
      console.error('Failed to get location:', error);
      setLocationStatus('idle');
    }
  }, [locationStatus]);

  // Map pane asks on open (the map is meaningless without it); Today never does.
  useEffect(() => {
    if (viewMode !== 'map' || locationStatus !== 'idle') return;
    void requestLocation();
  }, [viewMode, locationStatus, requestLocation]);

  // The map mounts with `initialRegion`, so a position that resolves after the
  // first frame would never move the camera. Drive it imperatively instead.
  useEffect(() => {
    if (viewMode !== 'map' || !currentLocation) return;
    mapRef.current?.animateToRegion({ ...currentLocation, ...REGION_DELTA }, 600);
  }, [viewMode, currentLocation]);

  /**
   * Load all items from storage and calendar events
   */
  const loadItems = useCallback(async () => {
    try {
      const loadedItems = await getItems();
      setAllItems(loadedItems.filter(item => !item.archived));

      // Filter items that have scheduled dates for calendar view
      const scheduledItems = loadedItems.filter(
        item => item.scheduled_date && !item.archived
      );
      setItems(scheduledItems);

      // Filter bucket list items
      const bucketItems = loadedItems.filter(
        item => item.bucketlist && !item.archived
      );
      setBucketlistItems(bucketItems);

      // Load calendar events (after items are set)
      await loadCalendarEvents();

      // Match calendar events with Silo items
      setCalendarEvents(prevEvents => {
        return prevEvents.map(event => {
          // Try to find matching item by date/time
          let matchingItem = scheduledItems.find(
            i => i.scheduled_date &&
            format(parseLocalDate(i.scheduled_date), 'yyyy-MM-dd') === format(event.startDate, 'yyyy-MM-dd') &&
            i.scheduled_time === format(event.startDate, 'HH:mm')
          );

          // If no match by time, try matching by title (for Silo events)
          if (!matchingItem && event.isSiloEvent) {
            matchingItem = scheduledItems.find(
              i => {
                const titleMatch = i.title === event.title ||
                                 event.title.includes(i.title) ||
                                 i.title.includes(event.title);
                const dateMatch = i.scheduled_date &&
                                format(parseLocalDate(i.scheduled_date), 'yyyy-MM-dd') === format(event.startDate, 'yyyy-MM-dd');
                return titleMatch && dateMatch;
              }
            );
          }

          if (matchingItem) {
            return { ...event, itemId: matchingItem.id };
          }
          return event;
        });
      });
    } catch (error) {
      console.error('Failed to load items:', error);
      toast.show({ message: "Couldn't load your saves", tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  /**
   * Load events from the phone calendar.
   *
   * The window reaches BACK 30 days as well as forward — with a `now` start,
   * every past date read "No events scheduled" no matter what was on it.
   */
  async function loadCalendarEvents() {
    try {
      const hasPermission = await requestCalendarPermissions();
      if (!hasPermission) {
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const now = new Date();
      const windowStart = addDays(now, -30);
      const windowEnd = addDays(now, 60);

      const allEvents: CalendarEvent[] = [];

      for (const calendar of calendars) {
        try {
          const events = await Calendar.getEventsAsync(
            [calendar.id],
            windowStart,
            windowEnd
          );

          // Import ALL calendar events, not just Silo ones. Strip REVIEW_PREFIX
          // at the boundary so no surface downstream ever shows "Review: Sushi
          // Bar" — the Today hero in particular reads titles verbatim.
          const imported = events.map((event: Calendar.Event) => {
            const raw = event.title || 'Untitled Event';
            const isSiloEvent = raw.startsWith(REVIEW_PREFIX);
            return {
              id: event.id,
              title: isSiloEvent ? raw.slice(REVIEW_PREFIX.length).trim() : raw,
              startDate: new Date(event.startDate),
              endDate: new Date(event.endDate),
              isSiloEvent,
              itemId: undefined, // Will be set if we find a matching Silo item
            };
          });

          allEvents.push(...imported);
        } catch (error) {
          console.error(`Failed to get events from calendar ${calendar.id}:`, error);
        }
      }

      setCalendarEvents(allEvents);
    } catch (error) {
      console.error('Failed to load calendar events:', error);
    }
  }

  // Load items when screen comes into focus. (No haptic here — the tab bar owns
  // the tab-change feedback; firing a second one reads as a stutter.)
  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems])
  );

  /**
   * Items with location data for the map, plus lazy geocoding of items that
   * have an address but no coordinates.
   */
  const [itemsWithLocations, setItemsWithLocations] = useState<Item[]>([]);

  useEffect(() => {
    let alive = true;

    const withCoords = (list: Item[]) =>
      list.filter(
        item =>
          (item.place_name || item.place_address) &&
          item.place_latitude != null &&
          item.place_longitude != null
      );

    (async () => {
      setItemsWithLocations(withCoords(allItems));

      const itemsToGeocode = allItems.filter(
        item =>
          (item.place_name || item.place_address) &&
          item.place_latitude == null &&
          item.place_longitude == null &&
          !geocodeFailed.has(item.id)
      );
      if (itemsToGeocode.length === 0) return;

      let geocodedCount = 0;
      for (const item of itemsToGeocode) {
        if (!alive) return;
        const addressToGeocode = item.place_address || item.place_name || '';
        if (!addressToGeocode) {
          geocodeFailed.add(item.id);
          continue;
        }
        try {
          const geocoded = await Location.geocodeAsync(addressToGeocode);
          if (geocoded && geocoded.length > 0) {
            const { latitude, longitude } = geocoded[0];
            await updateItem(item.id, { place_latitude: latitude, place_longitude: longitude });
            geocodedCount++;
          } else {
            geocodeFailed.add(item.id);
          }
        } catch (error) {
          geocodeFailed.add(item.id);
          console.warn(`Failed to geocode ${item.title}:`, error);
        }
        // Pace the queue — a tight loop is what trips CLGeocoder's limiter.
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      // Re-read once, at the end: setAllItems re-runs this effect, and the
      // items we just resolved now carry coordinates so they drop out of the
      // work queue instead of being geocoded all over again.
      if (!alive || geocodedCount === 0) return;
      const reloadedItems = await getItems();
      if (!alive) return;
      setAllItems(reloadedItems.filter(item => !item.archived));
    })();

    return () => {
      alive = false;
    };
  }, [allItems]);

  /**
   * Get items scheduled for a specific date
   */
  function getItemsForDate(date: Date): Item[] {
    return items.filter(item => {
      if (!item.scheduled_date) return false;
      // parseLocalDate avoids the UTC off-by-one of `new Date('YYYY-MM-DD')`.
      const itemDate = parseLocalDate(item.scheduled_date);
      return isSameDay(itemDate, date);
    });
  }

  /**
   * Native calendar events for a date, minus Silo's own mirrored review events
   * — those already render as the Item row, and showing both listed every
   * scheduled save twice.
   */
  function getCalendarEventsForDate(date: Date, dateItems: Item[]): CalendarEvent[] {
    const siloIds = new Set(dateItems.map(i => i.id));
    const siloTitles = new Set(dateItems.map(i => i.title.trim().toLowerCase()));
    return calendarEvents.filter(event => {
      if (!isSameDay(event.startDate, date)) return false;
      if (!event.isSiloEvent) return true;
      if (event.itemId) return !siloIds.has(event.itemId);
      return !siloTitles.has(event.title.trim().toLowerCase());
    });
  }

  /** Merged, time-ordered rows for a date: Silo items + native events. */
  function getAllEventsForDate(date: Date): (Item | CalendarEvent)[] {
    const dateItems = getItemsForDate(date);
    const dateEvents = getCalendarEventsForDate(date, dateItems);
    return [...dateItems, ...dateEvents].sort((a, b) => startKey(a) - startKey(b));
  }

  /**
   * Get week days for week view
   */
  function getWeekDays(): Date[] {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(currentWeekStart, i));
    }
    return days;
  }

  /**
   * Create new event
   */
  async function handleCreateEvent() {
    if (!newEventTitle.trim()) {
      toast.show({ message: 'Give the event a title first', tone: 'danger' });
      return;
    }

    try {
      const dateStr = format(newEventDate, 'yyyy-MM-dd');
      const timeStr = format(newEventTime, 'HH:mm');

      // createItem fills id/created_at/updated_at/status + defaults.
      const newItem = createItem({
        type: 'note',
        classification: 'idea',
        title: newEventTitle,
        scheduled_date: dateStr,
        scheduled_time: timeStr,
        duration: 15,
      });

      await addItem(newItem);
      await scheduleItemReview(newItem, dateStr, timeStr, 15);
      await loadItems();
      setShowAddEventModal(false);
      setNewEventTitle('');
      toast.show({ message: 'Event created', tone: 'success' });
    } catch (error) {
      console.error('Failed to create event:', error);
      toast.show({ message: "Couldn't create that event", tone: 'danger' });
    }
  }

  /**
   * Handle item press
   */
  function handleItemPress(itemId: string) {
    router.push(`/item/${itemId}?from=calendar`);
  }

  /**
   * Toggle bucket list status for an item. Applied optimistically with an Undo
   * toast — removing something you long-pressed by accident shouldn't need a
   * confirm dialog, and shouldn't be unrecoverable either.
   */
  async function handleToggleBucketlist(itemId: string) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    const newBucketlistStatus = !item.bucketlist;

    if (!newBucketlistStatus) {
      setBucketlistItems(prev => prev.filter(i => i.id !== itemId));
    }
    Haptics.notificationAsync(
      newBucketlistStatus
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning
    );

    try {
      await updateItem(itemId, { bucketlist: newBucketlistStatus });
      toast.show({
        message: newBucketlistStatus ? 'Added to bucket list' : 'Removed from bucket list',
        tone: newBucketlistStatus ? 'success' : 'neutral',
        action: {
          label: 'Undo',
          onPress: async () => {
            await updateItem(itemId, { bucketlist: !newBucketlistStatus });
            await loadItems();
          },
        },
      });
      await loadItems();
    } catch (error) {
      console.error('Failed to toggle bucket list:', error);
      toast.show({ message: "Couldn't update the bucket list", tone: 'danger' });
      await loadItems();
    }
  }

  /**
   * Toggle bucket list completion status for an item
   */
  async function handleToggleBucketlistComplete(itemId: string) {
    try {
      const item = bucketlistItems.find(i => i.id === itemId);
      if (!item) return;

      const newCompletedStatus = !item.bucketlist_completed;
      await updateItem(itemId, { bucketlist_completed: newCompletedStatus });
      await loadItems();

      if (newCompletedStatus) {
        // Celebration haptic for completion
        await celebrationHaptic();
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error('Failed to toggle bucket list completion:', error);
      toast.show({ message: "Couldn't update that item", tone: 'danger' });
    }
  }

  const weekDays = getWeekDays();

  // Bucket list: incomplete first (raw storage order interleaved done and
  // undone), and the header counts progress instead of a total that only grows.
  const sortedBucketlist = useMemo(
    () =>
      [...bucketlistItems].sort(
        (a, b) => Number(!!a.bucketlist_completed) - Number(!!b.bucketlist_completed)
      ),
    [bucketlistItems]
  );
  const bucketDone = useMemo(
    () => bucketlistItems.filter(i => i.bucketlist_completed).length,
    [bucketlistItems]
  );
  const bucketProgress = useSharedValue(0);
  useEffect(() => {
    bucketProgress.value = withSpring(
      bucketlistItems.length ? bucketDone / bucketlistItems.length : 0,
      SPRING.settle
    );
  }, [bucketDone, bucketlistItems.length, bucketProgress]);
  const bucketFillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, bucketProgress.value)) * 100}%` as `${number}%`,
  }));

  // ---------------------------------------------------------------------------
  // Segmented control: a spring-driven pill behind the labels, and the active
  // segment scrolled into view (four segments overflow a 4"-wide phone).
  // ---------------------------------------------------------------------------
  const segScrollRef = useRef<ScrollView | null>(null);
  const [segLayouts, setSegLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const [segViewWidth, setSegViewWidth] = useState(0);
  const [segContentWidth, setSegContentWidth] = useState(0);
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillPlaced = useRef(false);

  useEffect(() => {
    const layout = segLayouts[viewMode];
    if (!layout) return;
    if (pillPlaced.current) {
      pillX.value = withSpring(layout.x, SPRING.snappy);
      pillWidth.value = withSpring(layout.width, SPRING.snappy);
    } else {
      // First measurement: place it, don't animate in from x=0.
      pillX.value = layout.x;
      pillWidth.value = layout.width;
      pillPlaced.current = true;
    }
    segScrollRef.current?.scrollTo({ x: Math.max(0, layout.x - SPACE.xl), animated: true });
  }, [viewMode, segLayouts, pillX, pillWidth]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
  }));

  // ---------------------------------------------------------------------------
  // Today-view glue: storage events for today + a few small handlers that wire
  // the Today recommendation rows to the same code paths used elsewhere in this
  // screen. Pure facade — no new business logic.
  // ---------------------------------------------------------------------------

  const [todayScheduledEvents, setTodayScheduledEvents] = useState<TodayEvent[]>([]);
  useEffect(() => {
    if (viewMode !== 'today') return;
    let alive = true;
    (async () => {
      const evs = await getEvents();
      const todayKey = toLocalDateString(new Date());
      const mapped: TodayEvent[] = evs
        .filter((e: ScheduledEvent) => e.date === todayKey)
        .map((e: ScheduledEvent) => {
          const [h, m] = (e.time || '00:00').split(':').map(Number);
          const start = parseLocalDate(e.date);
          start.setHours(h, m, 0, 0);
          const end = new Date(start.getTime() + (e.duration || 15) * 60_000);
          return { title: e.title, startDate: start, endDate: end, itemId: e.item_id };
        });
      if (alive) setTodayScheduledEvents(mapped);
    })();
    return () => {
      alive = false;
    };
  }, [viewMode, items]);

  /**
   * Today's event feed. A Silo-scheduled item exists twice — as our stored
   * event and as the mirrored native calendar entry — so dedupe on
   * start-time + title. The stored copy goes first because it carries the
   * item id the hero's open button needs.
   */
  const todayFeed = useMemo<TodayEvent[]>(() => {
    const merged: TodayEvent[] = [
      ...todayScheduledEvents,
      ...calendarEvents.map(e => ({
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
        itemId: e.itemId,
      })),
    ];
    const seen = new Set<string>();
    return merged.filter(e => {
      const key = `${e.startDate.getTime()}|${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [todayScheduledEvents, calendarEvents]);

  /** Open an item detail screen. */
  const openItem = useCallback(
    (itemId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(`/item/${itemId}`);
    },
    [router]
  );

  /** Route into the item-detail schedule picker — same modal the rest of the app uses. */
  const openScheduleForItem = useCallback(
    (item: Item) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push(`/item/${item.id}?schedule=true`);
    },
    [router]
  );

  /**
   * Mark a Today recommendation done. This routes through buildReview so a
   * check-off records what "done" actually means — status, completed_at,
   * times_done, last_done_at. Setting `viewed` alone left computeStatus at
   * 'saved', so the app went on nudging "Still want this?" three weeks later
   * and the repeatables lane never saw the completion.
   */
  const markItemDone = useCallback(async (itemId: string) => {
    try {
      const item = await getItemById(itemId);
      if (!item) return;
      await updateItem(itemId, buildReview(item, 'good'));
      celebrationHaptic();
      await loadItems();
    } catch (err) {
      console.error('mark done failed', err);
    }
  }, [loadItems]);

  /**
   * Snooze a Today recommendation to tomorrow. Writes the time and duration
   * too: the native event it creates is pinned to 09:00, and an item with a
   * date but no time rendered as " (15 min)" with no clock and could never be
   * matched back to its calendar entry.
   */
  const snoozeItemToTomorrow = useCallback(async (itemId: string) => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = toLocalDateString(tomorrow);
      const item = await getItemById(itemId);
      const duration = item?.duration || 15;
      await updateItem(itemId, {
        scheduled_date: dateStr,
        scheduled_time: '09:00',
        duration,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Best-effort calendar entry so the snooze actually shows up tomorrow.
      if (item) {
        try {
          await scheduleItemReview(item, dateStr, '09:00', duration);
        } catch {
          // Calendar permission may be denied; the snooze still persists.
        }
      }
      await loadItems();
    } catch (err) {
      console.error('snooze failed', err);
    }
  }, [loadItems]);

  /** After-event report verdict from the Today check-in zone (lib/resurface). */
  const reviewItem = useCallback(async (item: Item, outcome: ReviewOutcome) => {
    try {
      await updateItem(item.id, buildReview(item, outcome));
      if (outcome === 'loved' || outcome === 'good') celebrationHaptic();
      else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await loadItems();
    } catch (err) {
      console.error('review failed', err);
    }
  }, [loadItems]);

  /** Keep a stale item: reset its seen-clock (local, unsynced) so it stops nudging. */
  const keepStaleItem = useCallback(async (id: string) => {
    try {
      await touchSeen(id);
      Haptics.selectionAsync();
      await loadItems();
    } catch (err) {
      console.error('keep stale failed', err);
    }
  }, [loadItems]);

  /** Archive a stale item from the nudge. */
  const archiveStaleItem = useCallback(async (id: string) => {
    try {
      await updateItem(id, { archived: true, status: 'archived' });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await loadItems();
    } catch (err) {
      console.error('archive stale failed', err);
    }
  }, [loadItems]);

  const closeAddEventModal = useCallback(() => {
    setShowAddEventModal(false);
    setShowDatePicker(false);
    setShowTimePicker(false);
  }, []);

  return (
    <View style={styles.container}>
      {/* Gradient Background */}
      <LinearGradient
        colors={GRADIENTS.page}
        style={StyleSheet.absoluteFill}
      />

      {/* Header with Segmented Control */}
      <View style={[styles.header, { paddingTop: insets.top + SPACE.md }]}>
        <View style={styles.segmentShadow}>
          <View style={styles.segmentClip}>
            <ScrollView
              ref={segScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              // flexGrow: 0 keeps a horizontal ScrollView from claiming vertical
              // flex space (it silently expands inside column layouts otherwise).
              style={{ flexGrow: 0, flexShrink: 0 }}
              contentContainerStyle={styles.segmentedControl}
              onLayout={e => setSegViewWidth(e.nativeEvent.layout.width)}
              onContentSizeChange={w => setSegContentWidth(w)}
            >
              <View style={styles.segmentRow}>
                {/* Rendered first so it sits behind the labels. */}
                <Animated.View style={[styles.segmentPill, pillStyle]} pointerEvents="none" />
                {MODES.map(mode => {
                  const active = viewMode === mode.key;
                  return (
                    <View
                      key={mode.key}
                      onLayout={e => {
                        const { x, width } = e.nativeEvent.layout;
                        setSegLayouts(prev =>
                          prev[mode.key]?.x === x && prev[mode.key]?.width === width
                            ? prev
                            : { ...prev, [mode.key]: { x, width } }
                        );
                      }}
                    >
                      <PressableScale
                        haptic="selection"
                        selected={active}
                        style={styles.segment}
                        onPress={() => setViewMode(mode.key)}
                        accessibilityLabel={mode.label}
                      >
                        <Ionicons
                          name={mode.icon}
                          size={18}
                          color={active ? '#fff' : INK[500]}
                        />
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                          {mode.label}
                        </Text>
                      </PressableScale>
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            {/* Right-edge fade: the honest hint that the control scrolls. */}
            {segContentWidth > segViewWidth + 1 && (
              <LinearGradient
                colors={['rgba(255,255,255,0)', '#ffffff']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.segmentFade}
                pointerEvents="none"
              />
            )}
          </View>
        </View>
      </View>

      {viewMode === 'today' && (
        <Animated.View style={styles.pane} entering={FadeIn.duration(DURATION.fast)}>
          <TodayView
            allItems={allItems}
            events={todayFeed}
            currentLocation={currentLocation}
            loading={loading}
            locationStatus={locationStatus}
            onRequestLocation={requestLocation}
            onScheduleItem={openScheduleForItem}
            onDoneItem={markItemDone}
            onSnoozeItem={snoozeItemToTomorrow}
            onReview={reviewItem}
            onKeepStale={keepStaleItem}
            onArchiveStale={archiveStaleItem}
            onOpenItem={openItem}
          />
        </Animated.View>
      )}

      {viewMode === 'calendar' && (
        <Animated.View style={styles.calendarContainer} entering={FadeIn.duration(DURATION.fast)}>
          {/* View Mode Toggle (Day/Week) */}
          <View style={styles.viewModeToggle}>
            <PressableScale
              haptic="selection"
              selected={calendarViewMode === 'day'}
              containerStyle={{ flex: 1 }}
              style={[
                styles.viewModeButton,
                calendarViewMode === 'day' && styles.viewModeButtonActive,
              ]}
              onPress={() => {
                setCalendarViewMode('day');
                setSelectedDate(new Date());
              }}
            >
              <Text
                style={[
                  styles.viewModeText,
                  calendarViewMode === 'day' && styles.viewModeTextActive,
                ]}
              >
                Day
              </Text>
            </PressableScale>
            <PressableScale
              haptic="selection"
              selected={calendarViewMode === 'week'}
              containerStyle={{ flex: 1 }}
              style={[
                styles.viewModeButton,
                calendarViewMode === 'week' && styles.viewModeButtonActive,
              ]}
              onPress={() => {
                setCalendarViewMode('week');
                setCurrentWeekStart(startOfWeek(selectedDate, { weekStartsOn: 0 }));
              }}
            >
              <Text
                style={[
                  styles.viewModeText,
                  calendarViewMode === 'week' && styles.viewModeTextActive,
                ]}
              >
                Week
              </Text>
            </PressableScale>
          </View>

          {calendarViewMode === 'day' ? (
            /* Day View */
            <View style={styles.dayViewContainer}>
              {/* Day Navigation */}
              <View style={styles.dayHeader}>
                <PressableScale
                  haptic="light"
                  onPress={() => setSelectedDate(addDays(selectedDate, -1))}
                  style={styles.dayNavButton}
                  accessibilityLabel="Previous day"
                >
                  <Ionicons name="chevron-back" size={24} color={INK[700]} />
                </PressableScale>
                <View style={styles.dayTitleContainer}>
                  <Text style={styles.dayTitle}>
                    {format(selectedDate, 'EEEE, MMMM d')}
                  </Text>
                  <PressableScale
                    haptic="selection"
                    onPress={() => setSelectedDate(new Date())}
                    style={styles.todayButton}
                    accessibilityLabel="Jump to today"
                  >
                    <Text style={styles.todayButtonText}>Today</Text>
                  </PressableScale>
                </View>
                <PressableScale
                  haptic="light"
                  onPress={() => setSelectedDate(addDays(selectedDate, 1))}
                  style={styles.dayNavButton}
                  accessibilityLabel="Next day"
                >
                  <Ionicons name="chevron-forward" size={24} color={INK[700]} />
                </PressableScale>
              </View>
            </View>
          ) : (
            /* Week View */
            <View style={styles.weekViewContainer}>
              {/* Week Navigation */}
              <View style={styles.weekViewHeader}>
                <PressableScale
                  haptic="light"
                  onPress={() => {
                    const prevWeek = addDays(currentWeekStart, -7);
                    setCurrentWeekStart(prevWeek);
                    setSelectedDate(prevWeek);
                  }}
                  style={styles.weekNavButton}
                  accessibilityLabel="Previous week"
                >
                  <Ionicons name="chevron-back" size={24} color={INK[700]} />
                </PressableScale>
                <View style={styles.weekTitleContainer}>
                  <Text style={styles.weekTitle}>
                    {format(currentWeekStart, 'MMM d')} - {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
                  </Text>
                  <PressableScale
                    haptic="selection"
                    onPress={() => {
                      const today = new Date();
                      setCurrentWeekStart(startOfWeek(today, { weekStartsOn: 0 }));
                      setSelectedDate(today);
                    }}
                    style={styles.todayButton}
                    accessibilityLabel="Jump to this week"
                  >
                    <Text style={styles.todayButtonText}>Today</Text>
                  </PressableScale>
                </View>
                <PressableScale
                  haptic="light"
                  onPress={() => {
                    const nextWeek = addDays(currentWeekStart, 7);
                    setCurrentWeekStart(nextWeek);
                    setSelectedDate(nextWeek);
                  }}
                  style={styles.weekNavButton}
                  accessibilityLabel="Next week"
                >
                  <Ionicons name="chevron-forward" size={24} color={INK[700]} />
                </PressableScale>
              </View>

              {/* Week Days */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.weekDaysContainer}>
                  {weekDays.map((date, index) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const isToday = isSameDay(date, new Date());
                    const eventCount = getAllEventsForDate(date).length;

                    return (
                      <PressableScale
                        key={index}
                        haptic="selection"
                        selected={isSelected}
                        style={[
                          styles.weekDayCell,
                          isToday && styles.weekDayCellToday,
                          isSelected && styles.weekDayCellSelected,
                        ]}
                        onPress={() => setSelectedDate(date)}
                        accessibilityLabel={format(date, 'EEEE, MMMM d')}
                      >
                        <Text style={styles.weekDayName}>
                          {format(date, 'EEE')}
                        </Text>
                        <Text
                          style={[
                            styles.weekDayNumber,
                            isToday && styles.weekDayNumberToday,
                            isSelected && styles.weekDayNumberSelected,
                          ]}
                        >
                          {format(date, 'd')}
                        </Text>
                        {eventCount > 0 && (
                          <View
                            style={[
                              styles.weekEventIndicator,
                              isSelected && styles.weekEventIndicatorSelected,
                            ]}
                          />
                        )}
                      </PressableScale>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Selected Date Events List */}
          <View style={styles.eventsContainer}>
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>
                {format(selectedDate, 'EEEE, MMMM d')}
              </Text>
              <PressableScale
                haptic="light"
                style={styles.addButton}
                onPress={() => {
                  setNewEventDate(selectedDate);
                  setShowAddEventModal(true);
                }}
                accessibilityLabel="Add event"
              >
                <LinearGradient
                  colors={GRADIENTS.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.addButtonGradient}
                >
                  <Ionicons name="add" size={20} color="#fff" />
                </LinearGradient>
              </PressableScale>
            </View>

            {(() => {
              const allEvents = getAllEventsForDate(selectedDate);

              if (loading && allEvents.length === 0) {
                return (
                  <View style={styles.eventsList}>
                    {[0, 1, 2].map(i => (
                      <Skeleton
                        key={i}
                        height={64}
                        radius={RADIUS.lg}
                        style={{ marginBottom: SPACE.md }}
                      />
                    ))}
                  </View>
                );
              }

              if (allEvents.length === 0) {
                return (
                  <EmptyState
                    icon="calendar-outline"
                    title="Nothing on this day"
                    subtitle="Tap + to put something in the calendar."
                    cta={{
                      label: 'Add an event',
                      onPress: () => {
                        setNewEventDate(selectedDate);
                        setShowAddEventModal(true);
                      },
                    }}
                  />
                );
              }

              return (
                <FlatList
                  data={allEvents}
                  renderItem={({ item }) => {
                    if ('startDate' in item) {
                      const event = item as CalendarEvent;
                      return (
                        <PressableScale
                          style={styles.eventCard}
                          scaleTo={0.985}
                          onPress={() => {
                            // Silo events link back to their item where we can
                            // resolve one; everything else opens a detail sheet.
                            if (event.itemId) {
                              handleItemPress(event.itemId);
                              return;
                            }
                            if (event.isSiloEvent) {
                              const matchingItem = items.find(
                                i => i.scheduled_date &&
                                format(parseLocalDate(i.scheduled_date), 'yyyy-MM-dd') === format(event.startDate, 'yyyy-MM-dd') &&
                                (i.title === event.title || event.title.includes(i.title))
                              );
                              if (matchingItem) {
                                handleItemPress(matchingItem.id);
                                return;
                              }
                            }

                            Alert.alert(
                              event.title,
                              `${format(event.startDate, 'EEEE, MMMM d, yyyy')}\n${format(event.startDate, 'h:mm a')} - ${format(event.endDate, 'h:mm a')}`,
                              [
                                { text: 'OK', style: 'default' },
                                ...(event.isSiloEvent ? [] : [{
                                  text: 'Create Item',
                                  style: 'default' as const,
                                  onPress: () => {
                                    // Create a new Silo item from this calendar event
                                    const dateStr = format(event.startDate, 'yyyy-MM-dd');
                                    const timeStr = format(event.startDate, 'HH:mm');
                                    const duration = Math.round((event.endDate.getTime() - event.startDate.getTime()) / (1000 * 60));

                                    // createItem fills id/created_at/updated_at/status + defaults.
                                    const newItem = createItem({
                                      type: 'note',
                                      classification: 'event',
                                      title: event.title,
                                      scheduled_date: dateStr,
                                      scheduled_time: timeStr,
                                      duration: duration || 15,
                                    });

                                    addItem(newItem).then(() => {
                                      scheduleItemReview(newItem, dateStr, timeStr, duration || 15);
                                      loadItems();
                                      toast.show({ message: 'Imported to Silo', tone: 'success' });
                                    }).catch((error) => {
                                      console.error('Failed to create item:', error);
                                      toast.show({ message: "Couldn't import that event", tone: 'danger' });
                                    });
                                  }
                                }])
                              ]
                            );
                          }}
                        >
                          <View style={styles.eventCardIcon}>
                            <Ionicons
                              name={event.isSiloEvent ? 'checkmark-circle' : 'calendar-outline'}
                              size={20}
                              color={event.isSiloEvent ? STATUS.success : BRAND[600]}
                            />
                          </View>
                          <View style={styles.eventCardContent}>
                            <Text style={styles.eventCardTitle} numberOfLines={1}>
                              {event.title}
                            </Text>
                            <Text style={styles.eventCardTime}>
                              {format(event.startDate, 'h:mm a')} - {format(event.endDate, 'h:mm a')}
                              {event.isSiloEvent && ' • Silo'}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={20} color={INK[400]} />
                        </PressableScale>
                      );
                    }

                    const row = item as Item;
                    return (
                      <PressableScale
                        style={styles.eventCard}
                        scaleTo={0.985}
                        onPress={() => handleItemPress(row.id)}
                      >
                        <View style={styles.eventCardIcon}>
                          <Ionicons name="time" size={20} color={BRAND[600]} />
                        </View>
                        <View style={styles.eventCardContent}>
                          <Text style={styles.eventCardTitle} numberOfLines={1}>
                            {row.title}
                          </Text>
                          <Text style={styles.eventCardTime}>
                            {format(
                              parseLocalDate(row.scheduled_date!, row.scheduled_time ?? '09:00'),
                              'h:mm a'
                            )}
                            {` · ${row.duration || 15} min`}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={INK[400]} />
                      </PressableScale>
                    );
                  }}
                  keyExtractor={(item) => {
                    if ('startDate' in item) {
                      return `event-${(item as CalendarEvent).id}`;
                    }
                    return (item as Item).id;
                  }}
                  contentContainerStyle={[
                    styles.eventsList,
                    { paddingBottom: insets.bottom + 120 }
                  ]}
                  contentInsetAdjustmentBehavior="automatic"
                />
              );
            })()}
          </View>
        </Animated.View>
      )}

      {viewMode === 'map' && (
        /* Map View */
        <Animated.View style={styles.mapContainer} entering={FadeIn.duration(DURATION.fast)}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={mapRegion}
            showsUserLocation={locationStatus === 'granted'}
            showsMyLocationButton={locationStatus === 'granted'}
            onRegionChangeComplete={(region) => {
              // Only update if user manually changed region (not on initial load)
              if (Math.abs(region.latitude - mapRegion.latitude) > 0.001 ||
                  Math.abs(region.longitude - mapRegion.longitude) > 0.001) {
                setMapRegion(region);
              }
            }}
            scrollEnabled={true}
            zoomEnabled={true}
            pitchEnabled={false}
            rotateEnabled={false}
          >
            {/* Item location markers */}
            {itemsWithLocations.map((item) => (
              <Marker
                key={item.id}
                coordinate={{
                  latitude: item.place_latitude!,
                  longitude: item.place_longitude!,
                }}
                title={item.title}
                description={item.place_name || item.place_address}
                onPress={() => handleItemPress(item.id)}
              >
                <View style={styles.markerContainer}>
                  <Ionicons name="location" size={24} color={ACCENT[500]} />
                </View>
              </Marker>
            ))}
          </MapView>

          {/* Location refused: say so, and offer the only route back. */}
          {locationStatus === 'denied' && (
            <GlassCard tint="light" intensity={60} radius={RADIUS.lg} style={styles.locationNotice}>
              <View style={styles.locationNoticeInner}>
                <Ionicons name="navigate-circle-outline" size={22} color={BRAND[600]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.locationNoticeTitle}>Location is off</Text>
                  <Text style={styles.locationNoticeSub}>
                    Silo can still map your saved places — it just can&apos;t centre on you.
                  </Text>
                </View>
                <PressableScale
                  haptic="light"
                  style={styles.locationNoticeBtn}
                  onPress={() => Linking.openSettings().catch(() => {})}
                  accessibilityLabel="Open location settings"
                >
                  <Text style={styles.locationNoticeBtnText}>Settings</Text>
                </PressableScale>
              </View>
            </GlassCard>
          )}

          {/* Map Items List */}
          {itemsWithLocations.length > 0 ? (
            <View style={styles.mapItemsList}>
              <Text style={styles.mapSectionTitle}>
                Saved Places ({itemsWithLocations.length})
              </Text>
              <FlatList
                data={itemsWithLocations}
                renderItem={({ item }) => (
                  <PressableScale
                    style={styles.mapItemCard}
                    scaleTo={0.985}
                    onPress={() => handleItemPress(item.id)}
                  >
                    <Ionicons name="location" size={20} color={BRAND[600]} />
                    <View style={styles.mapItemContent}>
                      <Text style={styles.mapItemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.mapItemLocation} numberOfLines={1}>
                        {item.place_name || item.place_address || 'Location'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={INK[400]} />
                  </PressableScale>
                )}
                keyExtractor={item => item.id}
                contentContainerStyle={[
                  { paddingBottom: insets.bottom + 120 }
                ]}
                contentInsetAdjustmentBehavior="automatic"
              />
            </View>
          ) : (
            <View style={[styles.mapItemsList, styles.mapEmptyPanel]}>
              <EmptyState
                icon="location-outline"
                title="No places pinned yet"
                subtitle="Save something with an address and it lands on this map."
              />
            </View>
          )}
        </Animated.View>
      )}

      {viewMode === 'bucketlist' && (
        <Animated.View style={styles.bucketlistContainer} entering={FadeIn.duration(DURATION.fast)}>
          <View style={styles.bucketlistHeader}>
            <Text style={styles.bucketlistTitle}>
              {bucketlistItems.length > 0
                ? `${bucketDone} of ${bucketlistItems.length} done`
                : 'Bucket List'}
            </Text>
            <Text style={styles.bucketlistSubtitle}>
              Things you want to do when the circumstances are right
            </Text>
            {bucketlistItems.length > 0 && (
              <View style={styles.progressTrack}>
                <Animated.View style={[styles.progressFill, bucketFillStyle]} />
              </View>
            )}
          </View>

          {bucketlistItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <EmptyState
                icon="list-outline"
                title="No bucket list items yet"
                subtitle="Hold down on any card to add it to your bucket list."
              />
            </View>
          ) : (
            <FlatList
              data={sortedBucketlist}
              renderItem={({ item }) => (
                <View style={styles.bucketlistItemWrapper}>
                  <PressableScale
                    haptic="selection"
                    style={styles.bucketlistCheckbox}
                    onPress={() => handleToggleBucketlistComplete(item.id)}
                    accessibilityLabel={
                      item.bucketlist_completed
                        ? `Mark ${item.title} not done`
                        : `Mark ${item.title} done`
                    }
                  >
                    <Ionicons
                      name={item.bucketlist_completed ? 'checkbox' : 'checkbox-outline'}
                      size={24}
                      color={item.bucketlist_completed ? STATUS.success : INK[500]}
                    />
                  </PressableScale>
                  <View style={styles.bucketlistItemContent}>
                    <ItemCard
                      item={item}
                      onPress={handleItemPress}
                      onLongPress={handleToggleBucketlist}
                    />
                  </View>
                </View>
              )}
              keyExtractor={item => item.id}
              contentContainerStyle={[
                styles.bucketlistContent,
                { paddingBottom: insets.bottom + 120 }
              ]}
              contentInsetAdjustmentBehavior="automatic"
            />
          )}
        </Animated.View>
      )}

      {/* Add Event Modal */}
      <Modal
        visible={showAddEventModal}
        animationType="slide"
        transparent={true}
        onRequestClose={closeAddEventModal}
      >
        <View style={styles.modalOverlay}>
          {/* Tap-outside-to-dismiss. A plain Pressable, not PressableScale —
              scaling the scrim on touch would look like a glitch. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeAddEventModal}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Event</Text>
              <PressableScale
                haptic="light"
                onPress={closeAddEventModal}
                style={styles.modalCloseButton}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={INK[700]} />
              </PressableScale>
            </View>

            {/* Scrollable: two open 200pt spinners used to push "Create Event"
                off the bottom of an 80%-height sheet with no way to reach it. */}
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <TextInput
                style={styles.input}
                placeholder="Event title"
                value={newEventTitle}
                onChangeText={setNewEventTitle}
                placeholderTextColor={INK[400]}
              />

              <PressableScale
                haptic="light"
                style={styles.pickerButton}
                // Mutually exclusive with the time picker — two open spinners
                // don't fit the sheet.
                onPress={() => {
                  setShowTimePicker(false);
                  setShowDatePicker(v => !v);
                }}
                accessibilityLabel="Choose date"
              >
                <Ionicons name="calendar-outline" size={24} color={BRAND[600]} />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Date</Text>
                  <Text style={styles.pickerValue}>
                    {format(newEventDate, 'MMMM d, yyyy')}
                  </Text>
                </View>
                <Ionicons
                  name={showDatePicker ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={INK[400]}
                />
              </PressableScale>

              {showDatePicker && (
                <View style={styles.pickerContainer}>
                  <DateTimePicker
                    value={newEventDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="light"
                    onChange={(event, selectedDate) => {
                      if (Platform.OS === 'android') {
                        setShowDatePicker(false);
                      }
                      if (selectedDate) {
                        setNewEventDate(selectedDate);
                      }
                    }}
                    minimumDate={new Date()}
                    style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
                    textColor={Platform.OS === 'ios' ? INK[900] : undefined}
                  />
                  {Platform.OS === 'ios' && (
                    <PressableScale
                      haptic="light"
                      style={styles.pickerDoneButton}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </PressableScale>
                  )}
                </View>
              )}

              <PressableScale
                haptic="light"
                style={styles.pickerButton}
                onPress={() => {
                  setShowDatePicker(false);
                  setShowTimePicker(v => !v);
                }}
                accessibilityLabel="Choose time"
              >
                <Ionicons name="time-outline" size={24} color={BRAND[600]} />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Time</Text>
                  <Text style={styles.pickerValue}>
                    {format(newEventTime, 'h:mm a')}
                  </Text>
                </View>
                <Ionicons
                  name={showTimePicker ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={INK[400]}
                />
              </PressableScale>

              {showTimePicker && (
                <View style={styles.pickerContainer}>
                  <DateTimePicker
                    value={newEventTime}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="light"
                    onChange={(event, selectedTime) => {
                      if (Platform.OS === 'android') {
                        setShowTimePicker(false);
                      }
                      if (selectedTime) {
                        setNewEventTime(selectedTime);
                      }
                    }}
                    style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
                    textColor={Platform.OS === 'ios' ? INK[900] : undefined}
                  />
                  {Platform.OS === 'ios' && (
                    <PressableScale
                      haptic="light"
                      style={styles.pickerDoneButton}
                      onPress={() => setShowTimePicker(false)}
                    >
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </PressableScale>
                  )}
                </View>
              )}

              <PressableScale
                haptic="light"
                style={styles.saveButton}
                onPress={handleCreateEvent}
                accessibilityLabel="Create event"
              >
                <LinearGradient
                  colors={GRADIENTS.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.saveButtonGradient}
                >
                  <Text style={styles.saveButtonText}>Create Event</Text>
                </LinearGradient>
              </PressableScale>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: INK[50],
  },
  pane: { flex: 1 },
  header: {
    backgroundColor: 'transparent',
    paddingBottom: SPACE.md,
    paddingHorizontal: SPACE.base,
  },
  // Shadow and clipping have to be separate views: `overflow: hidden` (needed
  // for the scroll fade + pill) clips an iOS shadow off the same node.
  segmentShadow: {
    borderRadius: RADIUS.pill,
    backgroundColor: '#ffffff',
    ...SHADOW.card,
  },
  segmentClip: {
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  segmentedControl: {
    padding: SPACE.xs,
  },
  segmentRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  segmentPill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  segmentFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACE.sm,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    gap: 6,
  },
  segmentText: {
    ...TYPE.subhead,
    color: INK[500],
  },
  segmentTextActive: {
    color: TEXT.inverse,
  },
  calendarContainer: {
    flex: 1,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.pill,
    padding: SPACE.xs,
    margin: SPACE.md,
    marginBottom: SPACE.sm,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  viewModeButton: {
    paddingVertical: SPACE.sm,
    paddingHorizontal: SPACE.base,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModeButtonActive: {
    backgroundColor: BRAND[600],
  },
  viewModeText: {
    ...TYPE.subhead,
    color: INK[500],
  },
  viewModeTextActive: {
    color: TEXT.inverse,
  },
  dayViewContainer: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.lg,
    margin: SPACE.md,
    marginTop: SPACE.sm,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACE.base,
  },
  dayNavButton: {
    padding: SPACE.sm,
  },
  dayTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  dayTitle: {
    ...TYPE.title3,
    color: TEXT.primary,
    marginBottom: SPACE.xs,
  },
  todayButton: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs,
    backgroundColor: BRAND[600],
    borderRadius: RADIUS.pill,
  },
  todayButtonText: {
    ...TYPE.caption,
    color: TEXT.inverse,
  },
  weekViewContainer: {
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.lg,
    margin: SPACE.md,
    marginTop: SPACE.sm,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  weekViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACE.base,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  weekNavButton: {
    padding: SPACE.sm,
  },
  weekTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  weekTitle: {
    ...TYPE.headline,
    color: TEXT.primary,
    marginBottom: SPACE.xs,
  },
  weekDaysContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.md,
  },
  weekDayCell: {
    width: (SCREEN_WIDTH - 32) / 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.sm,
    marginHorizontal: SPACE.xxs,
  },
  weekDayCellToday: {
    backgroundColor: BRAND[100],
  },
  weekDayCellSelected: {
    backgroundColor: BRAND[600],
  },
  weekDayName: {
    ...TYPE.overline,
    letterSpacing: 0.2,
    color: TEXT.tertiary,
    marginBottom: SPACE.xs,
  },
  weekDayNumber: {
    ...TYPE.title3,
    color: TEXT.primary,
  },
  weekDayNumberToday: {
    color: BRAND[700],
  },
  weekDayNumberSelected: {
    color: TEXT.inverse,
  },
  weekEventIndicator: {
    position: 'absolute',
    bottom: SPACE.xs,
    width: 4,
    height: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  weekEventIndicatorSelected: {
    backgroundColor: TEXT.inverse,
  },
  eventsContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACE.base,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  timelineTitle: {
    ...TYPE.title3,
    color: TEXT.primary,
  },
  addButton: {
    borderRadius: RADIUS.pill,
    ...SHADOW.brandCard,
  },
  addButtonGradient: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventsList: {
    padding: SPACE.base,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: SPACE.md,
    borderRadius: RADIUS.lg,
    marginBottom: SPACE.md,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  eventCardIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACE.md,
  },
  eventCardContent: {
    flex: 1,
  },
  eventCardTitle: {
    ...TYPE.bodyStrong,
    color: TEXT.primary,
    marginBottom: SPACE.xs,
  },
  eventCardTime: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No shadow token here: GlassCard clips to its radius (overflow: hidden),
  // which would swallow an iOS shadow drawn on the same node.
  locationNotice: {
    position: 'absolute',
    top: SPACE.md,
    left: SPACE.base,
    right: SPACE.base,
  },
  locationNoticeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: 14,
    paddingVertical: SPACE.md,
  },
  locationNoticeTitle: {
    ...TYPE.subhead,
    fontWeight: '700',
    color: TEXT.primary,
  },
  locationNoticeSub: {
    ...TYPE.caption,
    fontWeight: '500',
    color: TEXT.secondary,
    marginTop: SPACE.xxs,
  },
  locationNoticeBtn: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  locationNoticeBtnText: {
    ...TYPE.caption,
    color: TEXT.inverse,
  },
  mapItemsList: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_HEIGHT * 0.4,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    paddingTop: SPACE.base,
    ...SHADOW.floating,
  },
  // EmptyState is `flex: 1`, which collapses to zero inside an auto-height
  // parent — the panel needs a concrete height for it to lay out.
  mapEmptyPanel: {
    height: 300,
    paddingTop: 0,
  },
  mapSectionTitle: {
    ...TYPE.title3,
    color: TEXT.primary,
    marginBottom: SPACE.md,
    paddingHorizontal: SPACE.base,
  },
  mapItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  mapItemContent: {
    flex: 1,
    marginLeft: SPACE.md,
  },
  mapItemTitle: {
    ...TYPE.bodyStrong,
    color: TEXT.primary,
    marginBottom: SPACE.xs,
  },
  mapItemLocation: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    paddingBottom: SPACE.xxl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACE.base,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  modalTitle: {
    ...TYPE.title2,
    color: TEXT.primary,
  },
  modalCloseButton: {
    padding: SPACE.xs,
  },
  // flexShrink is not the RN default; without it the ScrollView refuses to
  // shrink inside the sheet's maxHeight and never scrolls.
  modalBody: {
    flexShrink: 1,
  },
  modalBodyContent: {
    padding: SPACE.base,
  },
  input: {
    backgroundColor: INK[100],
    borderRadius: RADIUS.md,
    padding: SPACE.base,
    ...TYPE.body,
    color: TEXT.primary,
    marginBottom: SPACE.md,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INK[100],
    padding: SPACE.base,
    borderRadius: RADIUS.md,
    marginBottom: SPACE.md,
  },
  pickerContent: {
    marginLeft: SPACE.md,
    flex: 1,
  },
  pickerLabel: {
    ...TYPE.overline,
    textTransform: 'uppercase',
    color: TEXT.tertiary,
    marginBottom: SPACE.xs,
  },
  pickerValue: {
    ...TYPE.body,
    color: TEXT.primary,
  },
  pickerContainer: {
    marginBottom: SPACE.base,
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
    ...SHADOW.card,
  },
  iosPicker: {
    height: 200,
    width: '100%',
  },
  pickerDoneButton: {
    marginTop: SPACE.sm,
    paddingVertical: SPACE.md,
    backgroundColor: BRAND[600],
    borderRadius: RADIUS.sm,
    alignItems: 'center',
  },
  pickerDoneText: {
    ...TYPE.bodyStrong,
    color: TEXT.inverse,
  },
  saveButton: {
    borderRadius: RADIUS.pill,
    marginTop: SPACE.sm,
    ...SHADOW.brandCard,
  },
  saveButtonGradient: {
    padding: SPACE.base,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    overflow: 'hidden',
  },
  saveButtonText: {
    ...TYPE.bodyStrong,
    color: TEXT.inverse,
  },
  bucketlistContainer: {
    flex: 1,
  },
  bucketlistHeader: {
    padding: SPACE.base,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  bucketlistTitle: {
    ...TYPE.title1,
    color: TEXT.primary,
    marginBottom: SPACE.xs,
  },
  bucketlistSubtitle: {
    ...TYPE.footnote,
    color: TEXT.secondary,
  },
  progressTrack: {
    height: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: INK[100],
    marginTop: SPACE.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  bucketlistContent: {
    padding: SPACE.base,
  },
  bucketlistItemWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACE.md,
  },
  bucketlistCheckbox: {
    marginRight: SPACE.md,
    marginTop: SPACE.sm,
    padding: SPACE.xs,
  },
  bucketlistItemContent: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },
});
