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
  type ViewStyle,
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
  FadeOut,
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
import Glass from '@/components/ui/Glass';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import TodayView, { LocationStatus, TodayEvent } from '@/components/TodayView';
import {
  ACCENT,
  BRAND,
  DURATION,
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { Item, ScheduledEvent } from '@/lib/types';
import { getItems, getItemById, updateItem, addItem, getEvents, touchSeen } from '@/lib/storage';
import { useDataVersion } from '@/lib/dataVersion';
import { buildReview, ReviewOutcome } from '@/lib/resurface';
import { buildReadinessPatch, evaluateItem, freeMinutesFrom } from '@/lib/triggers';
import { createItem } from '@/lib/items';
import { requestCalendarPermissions, scheduleItemReview, REVIEW_PREFIX } from '@/lib/scheduler';
import { celebrationHaptic } from '@/lib/haptics';
import { parseLocalDate, toLocalDateString } from '@/lib/datetime';
import { enterFromBottom, exitToBottom, usePrefersReducedMotion } from '@/lib/motion';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Alpha suffixes appended to the palette's own `card` colour — both palettes
 * state it as a 6-digit hex, so the `#rrggbbaa` form is all this needs.
 *
 * - `TINT` (~18%) is the chrome tint: enough for a small label to hold its
 *   contrast on bare material, far too little to read as a fill.
 * - `VEIL` (~65%) is for the two surfaces whose ground is LIVE MAP TILES. The
 *   map can be anything from white water to a dark park, so those overlays get
 *   a heavier wash than app chrome does — still far thinner than the opaque
 *   panel they replace.
 */
const GLASS_TINT = '2e';
const GLASS_VEIL = 'a6';

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
  const c = useThemeColors();
  const dataVersion = useDataVersion();
  const reduced = usePrefersReducedMotion();
  // Rebuilt only when the appearance flips — this screen paints four panes of
  // small coloured chrome and re-deriving it every render would churn.
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);
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
  /**
   * Whether the phone calendar is readable. null = not asked yet.
   *
   * The trigger engine needs this to tell "your day is clear" apart from "I
   * can't see your day": with permission refused, `calendarEvents` is empty,
   * which is indistinguishable from a genuinely free afternoon unless we track
   * the grant separately. Passing null makes `calendar_free` evaluate to
   * `unknown` instead of silently claiming free time.
   */
  const [calendarAccess, setCalendarAccess] = useState<boolean | null>(null);
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
      setCalendarAccess(hasPermission);
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
  // `dataVersion` so the assistant's actions land here too — it is an overlay,
  // not a route, so this tab never blurs. See lib/dataVersion.ts.
  useFocusEffect(
    useCallback(() => {
      loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadItems, dataVersion])
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

  /**
   * Right-edge scroll fade. It used to end on the opaque card colour, which was
   * right when the control was an opaque pill — on glass it would be a solid
   * plate stuck to the material's right edge. So the ramp now ends on the same
   * card colour at ~65%: the material densifies and the label dissolves into
   * it, which is what "there is more to scroll" should look like on glass. The
   * transparent stop is that colour at zero alpha, so the ramp never travels
   * through grey.
   */
  const segmentFadeColors = useMemo(
    () => [`${c.card}00`, `${c.card}${GLASS_VEIL}`] as [string, string],
    [c.card]
  );

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

  /**
   * Persist what the trigger engine computed.
   *
   * `TodayView` evaluates readiness for display on every render — that is pure
   * and free. This is the other half: when an item actually crosses into (or out
   * of) "ready", write it down, so the state survives a relaunch and so a
   * notification can be fired against it later without re-deriving anything.
   *
   * `buildReadinessPatch` returns null when nothing meaningful changed, which is
   * what stops this from writing (and syncing) a row on every foreground. It
   * also means the pass converges: the writes it makes produce no patch on the
   * next run.
   */
  const evaluatingRef = useRef(false);
  useEffect(() => {
    if (evaluatingRef.current || allItems.length === 0) return;
    let alive = true;

    (async () => {
      evaluatingRef.current = true;
      try {
        const ctx = {
          now: new Date(),
          location: currentLocation,
          freeMinutes: calendarAccess ? freeMinutesFrom(todayFeed, new Date()) : null,
        };
        const patched: { id: string; patch: Partial<Item> }[] = [];
        for (const item of allItems) {
          if (!item.bucketlist_meta) continue;
          const patch = buildReadinessPatch(item, evaluateItem(item, ctx));
          if (patch) patched.push({ id: item.id, patch });
        }
        if (patched.length === 0 || !alive) return;

        for (const { id, patch } of patched) await updateItem(id, patch);
        if (!alive) return;
        const byId = new Map(patched.map((p) => [p.id, p.patch]));
        setAllItems((prev) =>
          prev.map((item) => (byId.has(item.id) ? { ...item, ...byId.get(item.id) } : item))
        );
      } catch (error) {
        // A failed readiness write is not worth interrupting the screen for —
        // the next foreground re-derives it from scratch.
        console.error('[silo] trigger evaluation failed:', error);
      } finally {
        evaluatingRef.current = false;
      }
    })();

    return () => {
      alive = false;
    };
  }, [allItems, currentLocation, todayFeed, calendarAccess]);

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
    <View style={[styles.container, dyn.container]}>
      {/* Gradient Background */}
      <LinearGradient
        colors={[...c.pageGradient]}
        style={StyleSheet.absoluteFill}
      />

      {/* Header with Segmented Control.

          This is the tab's floating chrome, so it is the material rather than a
          white pill: the page gradient reads through it and the control stops
          competing with the content it sits over. The shadow stays on the outer
          wrapper — glass clips to its own rounded bounds and would swallow it. */}
      <View style={[styles.header, { paddingTop: insets.top + SPACE.md }]}>
        <View style={styles.segmentShadow}>
          <Glass
            variant="regular"
            radius={RADIUS.pill}
            // The control's own 1pt rim is drawn in `segmentClip`, so the
            // material must not add a second one on top of it.
            bordered={false}
            tintColor={dyn.chromeTint}
            style={[styles.segmentClip, dyn.segmentClip]}
          >
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
                          color={active ? '#fff' : c.textSecondary}
                        />
                        <Text
                          style={[
                            styles.segmentText,
                            dyn.segmentText,
                            active && styles.segmentTextActive,
                          ]}
                        >
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
                colors={segmentFadeColors}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.segmentFade}
                pointerEvents="none"
              />
            )}
          </Glass>
        </View>
      </View>

      {/* None of the four panes cross-fades on entry any more. Each one now
          contains Liquid Glass, and an opacity animation on an ancestor of a
          glass surface stops the material rendering instead of fading it — the
          pane would arrive with holes where its chrome should be. The segments
          swap instantly, which is what a segmented control does anyway; Today's
          own rows keep their staggered entrances. */}
      {viewMode === 'today' && (
        <Animated.View style={styles.pane}>
          <TodayView
            allItems={allItems}
            events={todayFeed}
            currentLocation={currentLocation}
            calendarAccess={calendarAccess}
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
        <Animated.View style={styles.calendarContainer}>
          {/* View Mode Toggle (Day/Week) — floating chrome over the page, so it
              takes the material. The active segment keeps its brand fill: that
              is a surface, not a material. */}
          <Glass
            variant="regular"
            radius={RADIUS.pill}
            bordered={false}
            tintColor={dyn.chromeTint}
            style={[styles.viewModeToggle, dyn.viewModeToggle]}
          >
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
                  dyn.viewModeText,
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
                  dyn.viewModeText,
                  calendarViewMode === 'week' && styles.viewModeTextActive,
                ]}
              >
                Week
              </Text>
            </PressableScale>
          </Glass>

          {calendarViewMode === 'day' ? (
            /* Day View. The shadow that separated this panel lives on the outer
               wrapper now — a glass surface can't cast one from inside its own
               clipped bounds. */
            <View style={styles.panelLift}>
              <Glass
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.chromeTint}
                style={[styles.dayViewContainer, dyn.dayViewContainer]}
              >
                {/* Day Navigation */}
                <View style={styles.dayHeader}>
                  <PressableScale
                    haptic="light"
                    onPress={() => setSelectedDate(addDays(selectedDate, -1))}
                    style={styles.dayNavButton}
                    accessibilityLabel="Previous day"
                  >
                    <Ionicons name="chevron-back" size={24} color={c.textSecondary} />
                  </PressableScale>
                  <View style={styles.dayTitleContainer}>
                    <Text style={[styles.dayTitle, dyn.dayTitle]}>
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
                    <Ionicons name="chevron-forward" size={24} color={c.textSecondary} />
                  </PressableScale>
                </View>
              </Glass>
            </View>
          ) : (
            /* Week View — same treatment: lift outside, material inside. */
            <View style={styles.panelLift}>
              <Glass
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.chromeTint}
                style={[styles.weekViewContainer, dyn.weekViewContainer]}
              >
                {/* Week Navigation */}
                <View style={[styles.weekViewHeader, dyn.weekViewHeader]}>
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
                    <Ionicons name="chevron-back" size={24} color={c.textSecondary} />
                  </PressableScale>
                  <View style={styles.weekTitleContainer}>
                    <Text style={[styles.weekTitle, dyn.weekTitle]}>
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
                    <Ionicons name="chevron-forward" size={24} color={c.textSecondary} />
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
                            dyn.weekDayCell,
                            isToday && dyn.weekDayCellToday,
                            // Brand fill last: the selected cell outranks both the
                            // resting card surface and today's soft tint.
                            isSelected && styles.weekDayCellSelected,
                          ]}
                          onPress={() => setSelectedDate(date)}
                          accessibilityLabel={format(date, 'EEEE, MMMM d')}
                        >
                          <Text style={[styles.weekDayName, dyn.weekDayName]}>
                            {format(date, 'EEE')}
                          </Text>
                          <Text
                            style={[
                              styles.weekDayNumber,
                              dyn.weekDayNumber,
                              isToday && dyn.weekDayNumberToday,
                              isSelected && styles.weekDayNumberSelected,
                            ]}
                          >
                            {format(date, 'd')}
                          </Text>
                          {eventCount > 0 && (
                            <View
                              style={[
                                styles.weekEventIndicator,
                                dyn.weekEventIndicator,
                                isSelected && styles.weekEventIndicatorSelected,
                              ]}
                            />
                          )}
                        </PressableScale>
                      );
                    })}
                  </View>
                </ScrollView>
              </Glass>
            </View>
          )}

          {/* Selected Date Events List */}
          <View style={styles.eventsContainer}>
            <View style={[styles.timelineHeader, dyn.timelineHeader]}>
              <Text style={[styles.timelineTitle, dyn.timelineTitle]}>
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
                          style={[styles.eventCard, dyn.eventCard]}
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
                          <View style={[styles.eventCardIcon, dyn.eventCardIcon]}>
                            <Ionicons
                              name={event.isSiloEvent ? 'checkmark-circle' : 'calendar-outline'}
                              size={20}
                              color={event.isSiloEvent ? c.success : c.brand}
                            />
                          </View>
                          <View style={styles.eventCardContent}>
                            <Text
                              style={[styles.eventCardTitle, dyn.eventCardTitle]}
                              numberOfLines={1}
                            >
                              {event.title}
                            </Text>
                            <Text style={[styles.eventCardTime, dyn.eventCardTime]}>
                              {format(event.startDate, 'h:mm a')} - {format(event.endDate, 'h:mm a')}
                              {event.isSiloEvent && ' • Silo'}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={20} color={c.decorative} />
                        </PressableScale>
                      );
                    }

                    const row = item as Item;
                    return (
                      <PressableScale
                        style={[styles.eventCard, dyn.eventCard]}
                        scaleTo={0.985}
                        onPress={() => handleItemPress(row.id)}
                      >
                        <View style={[styles.eventCardIcon, dyn.eventCardIcon]}>
                          <Ionicons name="time" size={20} color={c.brand} />
                        </View>
                        <View style={styles.eventCardContent}>
                          <Text style={[styles.eventCardTitle, dyn.eventCardTitle]} numberOfLines={1}>
                            {row.title}
                          </Text>
                          <Text style={[styles.eventCardTime, dyn.eventCardTime]}>
                            {format(
                              parseLocalDate(row.scheduled_date!, row.scheduled_time ?? '09:00'),
                              'h:mm a'
                            )}
                            {` · ${row.duration || 15} min`}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={c.decorative} />
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
        <Animated.View style={styles.mapContainer}>
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

          {/* Location refused: say so, and offer the only route back.

              The textbook case for `clear`: chrome floating over live content,
              where the map has to keep reading through. No `tint` prop — the
              notice is app chrome sitting on the map, not an overlay on media,
              so it follows the appearance. The veil is the heavier of the two
              tints because the ground here is map tiles, which can be anything
              from white water to a dark park. */}
          {locationStatus === 'denied' && (
            <Glass
              variant="clear"
              intensity={60}
              radius={RADIUS.lg}
              tintColor={dyn.mapVeil}
              style={styles.locationNotice}
            >
              <View style={styles.locationNoticeInner}>
                <Ionicons name="navigate-circle-outline" size={22} color={c.brand} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.locationNoticeTitle, dyn.locationNoticeTitle]}>
                    Location is off
                  </Text>
                  <Text style={[styles.locationNoticeSub, dyn.locationNoticeSub]}>
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
            </Glass>
          )}

          {/* Map Items List — the other overlay sitting on live map tiles, so
              the same `clear` material and the same veil. The floating shadow
              moved to the wrapper: glass clips it. What used to be a 92% white
              wash on light and a fully opaque sheet on dark is now one surface
              in both appearances, with a top hairline where the shadow used to
              do the separating. */}
          {itemsWithLocations.length > 0 ? (
            <View style={styles.mapPanelLift}>
              <Glass
                variant="clear"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.mapVeil}
                style={[styles.mapItemsList, dyn.mapItemsList]}
              >
                <Text style={[styles.mapSectionTitle, dyn.mapSectionTitle]}>
                  Saved Places ({itemsWithLocations.length})
                </Text>
                <FlatList
                  data={itemsWithLocations}
                  renderItem={({ item }) => (
                    <PressableScale
                      style={[styles.mapItemCard, dyn.mapItemCard]}
                      scaleTo={0.985}
                      onPress={() => handleItemPress(item.id)}
                    >
                      <Ionicons name="location" size={20} color={c.brand} />
                      <View style={styles.mapItemContent}>
                        <Text style={[styles.mapItemTitle, dyn.mapItemTitle]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text
                          style={[styles.mapItemLocation, dyn.mapItemLocation]}
                          numberOfLines={1}
                        >
                          {item.place_name || item.place_address || 'Location'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={c.decorative} />
                    </PressableScale>
                  )}
                  keyExtractor={item => item.id}
                  contentContainerStyle={[
                    { paddingBottom: insets.bottom + 120 }
                  ]}
                  contentInsetAdjustmentBehavior="automatic"
                />
              </Glass>
            </View>
          ) : (
            <View style={styles.mapPanelLift}>
              <Glass
                variant="clear"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.mapVeil}
                style={[styles.mapItemsList, dyn.mapItemsList, styles.mapEmptyPanel]}
              >
                <EmptyState
                  icon="location-outline"
                  title="No places pinned yet"
                  subtitle="Save something with an address and it lands on this map."
                />
              </Glass>
            </View>
          )}
        </Animated.View>
      )}

      {viewMode === 'bucketlist' && (
        <Animated.View style={styles.bucketlistContainer}>
          {/* The pane's header block: edge-to-edge chrome the list runs beneath,
              so it takes the material and its bottom hairline does the
              separating. `radius={0}` because it spans the full width — the
              default rounds corners that have no edge to round. The progress
              track inside stays opaque: it sits ON the material. */}
          <Glass
            variant="regular"
            radius={0}
            bordered={false}
            tintColor={dyn.chromeTint}
            style={[styles.bucketlistHeader, dyn.bucketlistHeader]}
          >
            <Text style={[styles.bucketlistTitle, dyn.bucketlistTitle]}>
              {bucketlistItems.length > 0
                ? `${bucketDone} of ${bucketlistItems.length} done`
                : 'Bucket List'}
            </Text>
            <Text style={[styles.bucketlistSubtitle, dyn.bucketlistSubtitle]}>
              Things you want to do when the circumstances are right
            </Text>
            {bucketlistItems.length > 0 && (
              <View style={[styles.progressTrack, dyn.progressTrack]}>
                <Animated.View style={[styles.progressFill, dyn.progressFill, bucketFillStyle]} />
              </View>
            )}
          </Glass>

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
                      // The empty box is the row's tap target, so it takes the
                      // secondary text role rather than the dimmer decorative one.
                      color={item.bucketlist_completed ? c.success : c.textSecondary}
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

      {/* Add Event Modal — the same sheet treatment as ItemActionSheet.
          `animationType="none"` because the sheet now brings its own entrance:
          the OS slide would have been fine, but the scrim has to fade as a
          SIBLING of the material rather than as its parent, and that only works
          if this component owns both animations. */}
      <Modal
        visible={showAddEventModal}
        animationType="none"
        transparent={true}
        onRequestClose={closeAddEventModal}
      >
        <View style={styles.modalRoot}>
          {/* The scrim fades on its own; an opacity animation above the glass
              would delete the sheet instead of fading it in with the scrim.
              Tap-outside-to-dismiss lives here — a plain Pressable, not
              PressableScale, since scaling a scrim reads as a glitch. */}
          <Animated.View
            entering={FadeIn.duration(DURATION.fast)}
            exiting={FadeOut.duration(DURATION.instant)}
            style={[StyleSheet.absoluteFill, dyn.scrim]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeAddEventModal}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            />
          </Animated.View>

          {/* Transform-only entrance, and the lift that separated the opaque
              sheet — glass can't cast a shadow past its own clipped bounds. The
              80% cap lives out here too: a percentage height needs a parent
              with a definite one, which the flex:1 root is and the sheet is
              not. */}
          <Animated.View
            entering={enterFromBottom(0, reduced)}
            exiting={exitToBottom(reduced)}
            style={styles.modalLift}
          >
            <Glass
              variant="regular"
              radius={RADIUS.lg}
              // Only the top edge is on screen, and it's drawn in `dyn`.
              bordered={false}
              tintColor={dyn.sheetTint}
              style={[styles.modalContent, dyn.modalContent]}
            >
              <View style={[styles.modalHeader, dyn.modalHeader]}>
                <Text style={[styles.modalTitle, dyn.modalTitle]}>New Event</Text>
                <PressableScale
                  haptic="light"
                  onPress={closeAddEventModal}
                  style={styles.modalCloseButton}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={24} color={c.textSecondary} />
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
                  style={[styles.input, dyn.input]}
                  placeholder="Event title"
                  value={newEventTitle}
                  onChangeText={setNewEventTitle}
                  placeholderTextColor={c.textPlaceholder}
                />

                <PressableScale
                  haptic="light"
                  style={[styles.pickerButton, dyn.pickerButton]}
                  // Mutually exclusive with the time picker — two open spinners
                  // don't fit the sheet.
                  onPress={() => {
                    setShowTimePicker(false);
                    setShowDatePicker(v => !v);
                  }}
                  accessibilityLabel="Choose date"
                >
                  <Ionicons name="calendar-outline" size={24} color={c.brand} />
                  <View style={styles.pickerContent}>
                    <Text style={[styles.pickerLabel, dyn.pickerLabel]}>Date</Text>
                    <Text style={[styles.pickerValue, dyn.pickerValue]}>
                      {format(newEventDate, 'MMMM d, yyyy')}
                    </Text>
                  </View>
                  <Ionicons
                    name={showDatePicker ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={c.decorative}
                  />
                </PressableScale>

                {showDatePicker && (
                  <View style={[styles.pickerContainer, dyn.pickerContainer]}>
                    <DateTimePicker
                      value={newEventDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      // The spinner is a native view: it can't inherit our palette,
                      // so it's told which appearance it is being drawn into.
                      themeVariant={c.appearance}
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
                      textColor={Platform.OS === 'ios' ? c.text : undefined}
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
                  style={[styles.pickerButton, dyn.pickerButton]}
                  onPress={() => {
                    setShowDatePicker(false);
                    setShowTimePicker(v => !v);
                  }}
                  accessibilityLabel="Choose time"
                >
                  <Ionicons name="time-outline" size={24} color={c.brand} />
                  <View style={styles.pickerContent}>
                    <Text style={[styles.pickerLabel, dyn.pickerLabel]}>Time</Text>
                    <Text style={[styles.pickerValue, dyn.pickerValue]}>
                      {format(newEventTime, 'h:mm a')}
                    </Text>
                  </View>
                  <Ionicons
                    name={showTimePicker ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={c.decorative}
                  />
                </PressableScale>

                {showTimePicker && (
                  <View style={[styles.pickerContainer, dyn.pickerContainer]}>
                    <DateTimePicker
                      value={newEventTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      themeVariant={c.appearance}
                      onChange={(event, selectedTime) => {
                        if (Platform.OS === 'android') {
                          setShowTimePicker(false);
                        }
                        if (selectedTime) {
                          setNewEventTime(selectedTime);
                        }
                      }}
                      style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
                      textColor={Platform.OS === 'ios' ? c.text : undefined}
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
            </Glass>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Colour-only companions to `styles`. A plain object, NOT StyleSheet.create —
 * this is rebuilt whenever the appearance flips, and registering fresh
 * stylesheet ids on every flip would just leak them.
 */
function makeDynamicStyles(c: ThemeColors) {
  // On dark the card and the page are both near-black, so a drop shadow
  // separates nothing: surfaces that got their edge from SHADOW.* take a
  // hairline instead. (Surfaces that already carry a 1px border in both
  // appearances aren't listed here — they'd end up double-edged.)
  const darkEdge: ViewStyle =
    c.appearance === 'dark'
      ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }
      : {};
  return {
    container: { backgroundColor: c.page },
    /**
     * The tint every glass surface on this screen carries. Glass borrows its
     * colour from whatever is behind it, and on light that is a pale violet
     * page — small labels on bare material drift under AA. ~18% of the
     * palette's own card colour holds them without reading as a fill.
     */
    chromeTint: `${c.card}${GLASS_TINT}`,
    /** The heavier wash, for the two overlays whose ground is live map tiles. */
    mapVeil: `${c.card}${GLASS_VEIL}`,
    /** The add-event sheet: same tint, named for what it is. */
    sheetTint: `${c.card}${GLASS_TINT}`,
    // Border only, on every surface that became glass: an opaque fill on the
    // same node would paint straight over the material.
    segmentClip: { borderColor: c.hairline },
    segmentText: { color: c.textSecondary },
    viewModeToggle: { borderColor: c.hairline },
    viewModeText: { color: c.textSecondary },
    dayViewContainer: { borderColor: c.hairline },
    dayTitle: { color: c.text },
    weekViewContainer: { borderColor: c.hairline },
    weekViewHeader: { borderBottomColor: c.hairline },
    weekTitle: { color: c.text },
    // No resting fill: the cell used to be the same card colour as the panel it
    // sits on, so it painted nothing — and on glass that same fill would turn
    // every day into a visible opaque chip. Today's tint and the selected
    // brand fill still paint. On dark the hairline keeps each day reading as
    // its own tap target.
    weekDayCell: { ...darkEdge },
    // Today's tint: BRAND[100] verbatim on light, and the palette's soft violet
    // on dark, where an opaque BRAND[100] block would glow.
    weekDayCellToday: {
      backgroundColor: c.appearance === 'dark' ? c.brandSoft : BRAND[100],
    },
    weekDayName: { color: c.textTertiary },
    weekDayNumber: { color: c.text },
    // Keeps the deeper BRAND[700] on light; dark lifts to the palette's
    // text-on-dark brand step so violet-on-near-black keeps its chroma.
    weekDayNumberToday: { color: c.appearance === 'dark' ? c.textBrand : BRAND[700] },
    weekEventIndicator: { backgroundColor: c.brand },
    timelineHeader: { borderBottomColor: c.hairline },
    timelineTitle: { color: c.text },
    eventCard: { backgroundColor: c.card, borderColor: c.hairline },
    // BRAND[50] verbatim on light; on dark that near-white lavender would read
    // as a lit chip, so it takes the palette's translucent violet instead.
    eventCardIcon: { backgroundColor: c.appearance === 'dark' ? c.brandSoft : BRAND[50] },
    eventCardTitle: { color: c.text },
    eventCardTime: { color: c.textTertiary },
    locationNoticeTitle: { color: c.text },
    locationNoticeSub: { color: c.textSecondary },
    // One surface in both appearances now: the material carries the
    // translucency that a hand-mixed 92% white used to fake on light, and the
    // top hairline is the only edge on screen (the panel is flush with the
    // bottom of the phone).
    mapItemsList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
    mapSectionTitle: { color: c.text },
    mapItemCard: { borderBottomColor: c.hairline },
    mapItemTitle: { color: c.text },
    mapItemLocation: { color: c.textTertiary },
    scrim: { backgroundColor: c.scrim },
    // No fill: the glass IS the sheet. What is left to draw is the rim on the
    // one edge you can see — the top.
    modalContent: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
    modalHeader: { borderBottomColor: c.hairline },
    modalTitle: { color: c.text },
    input: { backgroundColor: c.field, color: c.text },
    pickerButton: { backgroundColor: c.field },
    pickerLabel: { color: c.textTertiary },
    pickerValue: { color: c.text },
    // Card-on-card inside the sheet: on dark only the hairline says where the
    // spinner's panel starts.
    pickerContainer: { backgroundColor: c.card, ...darkEdge },
    bucketlistHeader: { borderBottomColor: c.hairline },
    bucketlistTitle: { color: c.text },
    bucketlistSubtitle: { color: c.textSecondary },
    progressTrack: { backgroundColor: c.field },
    progressFill: { backgroundColor: c.brand },
  };
}

const styles = StyleSheet.create({
  // Every rule below is appearance-independent; the colour half of each one
  // lives in `makeDynamicStyles`, except the brand surfaces called out inline.
  container: {
    flex: 1,
  },
  pane: { flex: 1 },
  header: {
    backgroundColor: 'transparent',
    paddingBottom: SPACE.md,
    paddingHorizontal: SPACE.base,
  },
  // Shadow and material have to be separate views: the glass clips to its own
  // rounded bounds, and `overflow: hidden` on that node takes an iOS shadow
  // with it.
  segmentShadow: {
    borderRadius: RADIUS.pill,
    ...SHADOW.card,
  },
  segmentClip: {
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    borderWidth: 1,
  },
  // Shared by the day and week panels: the lift the glass can't carry.
  panelLift: {
    borderRadius: RADIUS.lg,
    margin: SPACE.md,
    marginTop: SPACE.sm,
    ...SHADOW.card,
  },
  segmentedControl: {
    padding: SPACE.xs,
  },
  segmentRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  // Brand surfaces below stay BRAND[600] in both appearances: the lighter
  // dark-mode brand would drop white-on-violet under 3:1.
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
  },
  // White, not `textInverse`: it sits on the violet pill, which never flips.
  segmentTextActive: {
    color: '#fff',
  },
  calendarContainer: {
    flex: 1,
  },
  viewModeToggle: {
    flexDirection: 'row',
    borderRadius: RADIUS.pill,
    padding: SPACE.xs,
    margin: SPACE.md,
    marginBottom: SPACE.sm,
    borderWidth: 1,
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
  },
  viewModeTextActive: {
    color: '#fff',
  },
  dayViewContainer: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
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
    color: '#fff',
  },
  weekViewContainer: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  weekViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACE.base,
    borderBottomWidth: 1,
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
  weekDayCellSelected: {
    backgroundColor: BRAND[600],
  },
  weekDayName: {
    ...TYPE.overline,
    letterSpacing: 0.2,
    marginBottom: SPACE.xs,
  },
  weekDayNumber: {
    ...TYPE.title3,
  },
  weekDayNumberSelected: {
    color: '#fff',
  },
  weekEventIndicator: {
    position: 'absolute',
    bottom: SPACE.xs,
    width: 4,
    height: 4,
    borderRadius: RADIUS.pill,
  },
  // On the violet selected cell, so it stays white in both appearances.
  weekEventIndicatorSelected: {
    backgroundColor: '#fff',
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
  },
  timelineTitle: {
    ...TYPE.title3,
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
    padding: SPACE.md,
    borderRadius: RADIUS.lg,
    marginBottom: SPACE.md,
    borderWidth: 1,
    ...SHADOW.card,
  },
  eventCardIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACE.md,
  },
  eventCardContent: {
    flex: 1,
  },
  eventCardTitle: {
    ...TYPE.bodyStrong,
    marginBottom: SPACE.xs,
  },
  eventCardTime: {
    ...TYPE.footnote,
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
  // No shadow token here: the glass clips to its radius (overflow: hidden),
  // which would swallow an iOS shadow drawn on the same node. The rim it draws
  // is what separates it from the map.
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
  },
  locationNoticeSub: {
    ...TYPE.caption,
    fontWeight: '500',
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
    color: '#fff',
  },
  // Position + lift; the material and its clipping live on the child.
  mapPanelLift: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    ...SHADOW.floating,
  },
  mapItemsList: {
    maxHeight: SCREEN_HEIGHT * 0.4,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    // Flush with the bottom of the screen, so the corners the `radius` prop
    // rounds by default get squared off again.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: SPACE.base,
  },
  // EmptyState is `flex: 1`, which collapses to zero inside an auto-height
  // parent — the panel needs a concrete height for it to lay out.
  mapEmptyPanel: {
    height: 300,
    paddingTop: 0,
  },
  mapSectionTitle: {
    ...TYPE.title3,
    marginBottom: SPACE.md,
    paddingHorizontal: SPACE.base,
  },
  mapItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    borderBottomWidth: 1,
  },
  mapItemContent: {
    flex: 1,
    marginLeft: SPACE.md,
  },
  mapItemTitle: {
    ...TYPE.bodyStrong,
    marginBottom: SPACE.xs,
  },
  mapItemLocation: {
    ...TYPE.footnote,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // The sheet's lift and its height cap. `maxHeight` needs a parent with a
  // definite height to resolve a percentage against, which `modalRoot` (flex:1)
  // is and the auto-height sheet is not.
  modalLift: {
    maxHeight: '80%',
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    ...SHADOW.floating,
  },
  modalContent: {
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    // Flush with the bottom of the screen: square off the corners the `radius`
    // prop rounds by default.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: SPACE.xxl,
    // Lets the sheet shrink inside the wrapper's 80% cap instead of overflowing
    // it (flexShrink is not the RN default).
    flexShrink: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACE.base,
    borderBottomWidth: 1,
  },
  modalTitle: {
    ...TYPE.title2,
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
    borderRadius: RADIUS.md,
    padding: SPACE.base,
    ...TYPE.body,
    marginBottom: SPACE.md,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginBottom: SPACE.xs,
  },
  pickerValue: {
    ...TYPE.body,
  },
  pickerContainer: {
    marginBottom: SPACE.base,
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
    color: '#fff',
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
  // On the brand gradient, which is identical in both appearances.
  saveButtonText: {
    ...TYPE.bodyStrong,
    color: '#fff',
  },
  bucketlistContainer: {
    flex: 1,
  },
  bucketlistHeader: {
    padding: SPACE.base,
    borderBottomWidth: 1,
  },
  bucketlistTitle: {
    ...TYPE.title1,
    marginBottom: SPACE.xs,
  },
  bucketlistSubtitle: {
    ...TYPE.footnote,
  },
  progressTrack: {
    height: 6,
    borderRadius: RADIUS.pill,
    marginTop: SPACE.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
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
