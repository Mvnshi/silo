/**
 * Calendar & Map Screen
 * 
 * Full-featured calendar view with month grid, drag-to-reschedule,
 * and map view with location-based pins.
 * 
 * Features:
 * - Full month calendar grid view
 * - Drag events up/down to change time
 * - Add events directly from calendar
 * - Map view with current location and saved places
 * 
 * Dependencies:
 * - react-native-maps: Map display
 * - react-native-gesture-handler: Drag and drop
 * - expo-location: Current location
 * - date-fns: Date formatting and manipulation
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ScrollView,
  Dimensions,
  Modal,
  Platform,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { 
  format, 
  addDays, 
  startOfWeek, 
  startOfMonth,
  endOfMonth,
  isSameDay,
  isSameMonth,
  addMonths,
  subMonths,
  getDaysInMonth,
  getDay,
} from 'date-fns';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import ItemCard from '@/components/ItemCard';
import { Item } from '@/lib/types';
import { getItems, updateItem, addItem } from '@/lib/storage';
import { requestCalendarPermissions, scheduleItemReview } from '@/lib/scheduler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type ViewMode = 'calendar' | 'map' | 'bucketlist';
type CalendarViewMode = 'day' | 'week';

interface CalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  isSiloEvent: boolean;
  itemId?: string;
}


export default function CalendarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>('day');
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
  const [mapRegion, setMapRegion] = useState({
    latitude: 37.7749,
    longitude: -122.4194,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });

  /**
   * Get current location
   */
  useEffect(() => {
    async function getLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }

        const location = await Location.getCurrentPositionAsync({});
        setCurrentLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        
        // Center map on current location
        setMapRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      } catch (error) {
        console.error('Failed to get location:', error);
      }
    }
    getLocation();
  }, []);

  /**
   * Load all items from storage and calendar events
   */
  async function loadItems() {
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
            format(new Date(i.scheduled_date), 'yyyy-MM-dd') === format(event.startDate, 'yyyy-MM-dd') &&
            i.scheduled_time === format(event.startDate, 'HH:mm')
          );
          
          // If no match by time, try matching by title (for Silo events)
          if (!matchingItem && event.isSiloEvent) {
            const itemTitle = event.title.replace('Review: ', '').trim();
            matchingItem = scheduledItems.find(
              i => {
                const titleMatch = i.title === itemTitle || 
                                 itemTitle.includes(i.title) || 
                                 i.title.includes(itemTitle);
                const dateMatch = i.scheduled_date && 
                                format(new Date(i.scheduled_date), 'yyyy-MM-dd') === format(event.startDate, 'yyyy-MM-dd');
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
      Alert.alert('Error', 'Failed to load items');
    }
  }

  /**
   * Load events from phone calendar
   */
  async function loadCalendarEvents() {
    try {
      const hasPermission = await requestCalendarPermissions();
      if (!hasPermission) {
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const now = new Date();
      const thirtyDaysFromNow = addDays(now, 30);

      const allEvents: CalendarEvent[] = [];
      
      for (const calendar of calendars) {
        try {
          const events = await Calendar.getEventsAsync(
            [calendar.id],
            now,
            thirtyDaysFromNow
          );

          // Import ALL calendar events, not just Silo ones
          const calendarEvents = events.map((event: Calendar.Event) => ({
            id: event.id,
            title: event.title || 'Untitled Event',
            startDate: new Date(event.startDate),
            endDate: new Date(event.endDate),
            isSiloEvent: event.title?.startsWith('Review:') || false,
            itemId: undefined, // Will be set if we find a matching Silo item
          }));

          allEvents.push(...calendarEvents);
        } catch (error) {
          console.error(`Failed to get events from calendar ${calendar.id}:`, error);
        }
      }

      setCalendarEvents(allEvents);
    } catch (error) {
      console.error('Failed to load calendar events:', error);
    }
  }

  // Load items when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadItems();
      // Haptic feedback when tab is focused
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [])
  );

  /**
   * Get items with location data for map view
   * Also geocode items that have addresses but no coordinates
   */
  const [itemsWithLocations, setItemsWithLocations] = useState<Item[]>([]);

  // Geocode items with addresses but no coordinates
  useEffect(() => {
    async function geocodeItems() {
      const itemsToGeocode = allItems.filter(
        item => (item.place_name || item.place_address) && !item.place_latitude && !item.place_longitude
      );

      if (itemsToGeocode.length === 0) {
        // No items to geocode, just set the locations list
        const itemsWithCoords = allItems.filter(
          item => (item.place_name || item.place_address) && item.place_latitude && item.place_longitude
        );
        setItemsWithLocations(itemsWithCoords);
        return;
      }

      // Geocode items that need coordinates
      let geocodedCount = 0;
      for (const item of itemsToGeocode) {
        try {
          const addressToGeocode = item.place_address || item.place_name || '';
          if (addressToGeocode) {
            const geocoded = await Location.geocodeAsync(addressToGeocode);
            if (geocoded && geocoded.length > 0) {
              const { latitude, longitude } = geocoded[0];
              await updateItem(item.id, {
                place_latitude: latitude,
                place_longitude: longitude,
              });
              console.log(`📍 Geocoded ${addressToGeocode}: ${latitude}, ${longitude}`);
              geocodedCount++;
            }
          }
        } catch (error) {
          console.warn(`Failed to geocode ${item.title}:`, error);
        }
      }

      // Reload items if we geocoded any
      if (geocodedCount > 0) {
        const reloadedItems = await getItems();
        setAllItems(reloadedItems.filter(item => !item.archived));
      }

      // Update items with locations (now includes newly geocoded items)
      const reloadedItems = geocodedCount > 0 ? await getItems() : allItems;
      const itemsWithCoords = reloadedItems.filter(
        item => (item.place_name || item.place_address) && item.place_latitude && item.place_longitude
      );
      setItemsWithLocations(itemsWithCoords);
    }

    if (allItems.length > 0) {
      geocodeItems();
    }
  }, [allItems]);

  /**
   * Get items scheduled for a specific date
   */
  function getItemsForDate(date: Date): Item[] {
    return items.filter(item => {
      if (!item.scheduled_date) return false;
      const itemDate = new Date(item.scheduled_date);
      return isSameDay(itemDate, date);
    });
  }

  /**
   * Get calendar events for a specific date
   */
  function getCalendarEventsForDate(date: Date): CalendarEvent[] {
    return calendarEvents.filter(event => {
      return isSameDay(event.startDate, date);
    });
  }

  /**
   * Get all events (items + calendar events) for a specific date
   */
  function getAllEventsForDate(date: Date): (Item | CalendarEvent)[] {
    const dateItems = getItemsForDate(date);
    const dateEvents = getCalendarEventsForDate(date);
    return [...dateItems, ...dateEvents];
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
      Alert.alert('Error', 'Please enter a title');
      return;
    }

    try {
      const dateStr = format(newEventDate, 'yyyy-MM-dd');
      const timeStr = format(newEventTime, 'HH:mm');

      const newItem: Item = {
        id: `item_${Date.now()}`,
        type: 'note',
        classification: 'idea',
        title: newEventTitle,
        scheduled_date: dateStr,
        scheduled_time: timeStr,
        duration: 15,
        tags: [],
        created_at: new Date().toISOString(),
        viewed: false,
        archived: false,
      };

      await addItem(newItem);
      await scheduleItemReview(newItem, dateStr, timeStr, 15);
      await loadItems();
      setShowAddEventModal(false);
      setNewEventTitle('');
      Alert.alert('Success', 'Event created!');
    } catch (error) {
      console.error('Failed to create event:', error);
      Alert.alert('Error', 'Failed to create event');
    }
  }

  /**
   * Handle item press
   */
  function handleItemPress(itemId: string) {
    router.push(`/item/${itemId}?from=calendar`);
  }

  /**
   * Toggle bucket list status for an item
   */
  async function handleToggleBucketlist(itemId: string) {
    try {
      const item = allItems.find(i => i.id === itemId);
      if (!item) return;

      const newBucketlistStatus = !item.bucketlist;
      await updateItem(itemId, { bucketlist: newBucketlistStatus });
      await loadItems();
      
      Haptics.notificationAsync(
        newBucketlistStatus 
          ? Haptics.NotificationFeedbackType.Success 
          : Haptics.NotificationFeedbackType.Warning
      );
    } catch (error) {
      console.error('Failed to toggle bucket list:', error);
      Alert.alert('Error', 'Failed to update bucket list');
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
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await new Promise(resolve => setTimeout(resolve, 50));
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await new Promise(resolve => setTimeout(resolve, 50));
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await new Promise(resolve => setTimeout(resolve, 100));
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error('Failed to toggle bucket list completion:', error);
      Alert.alert('Error', 'Failed to update completion status');
    }
  }

  const weekDays = getWeekDays();

  return (
    <View style={styles.container}>
      {/* Gradient Background */}
      <LinearGradient
        colors={['#B4E8F5', '#D7F5FF', '#F0F9FF']}
        style={StyleSheet.absoluteFill}
      />
      {/* Header with Segmented Control */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[
              styles.segment,
              viewMode === 'calendar' && styles.segmentActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode('calendar');
            }}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={viewMode === 'calendar' ? '#fff' : '#666'}
            />
            <Text
              style={[
                styles.segmentText,
                viewMode === 'calendar' && styles.segmentTextActive,
              ]}
            >
              Calendar
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.segment,
              viewMode === 'map' && styles.segmentActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode('map');
            }}
          >
            <Ionicons
              name="map-outline"
              size={18}
              color={viewMode === 'map' ? '#fff' : '#666'}
            />
            <Text
              style={[
                styles.segmentText,
                viewMode === 'map' && styles.segmentTextActive,
              ]}
            >
              Map
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.segment,
              viewMode === 'bucketlist' && styles.segmentActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode('bucketlist');
            }}
          >
            <Ionicons
              name="list-outline"
              size={18}
              color={viewMode === 'bucketlist' ? '#fff' : '#666'}
            />
            <Text
              style={[
                styles.segmentText,
                viewMode === 'bucketlist' && styles.segmentTextActive,
              ]}
            >
              Bucket List
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {viewMode === 'calendar' && (
        <View style={styles.calendarContainer}>
          {/* View Mode Toggle (Day/Week) */}
          <View style={styles.viewModeToggle}>
            <TouchableOpacity
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
            </TouchableOpacity>
            <TouchableOpacity
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
            </TouchableOpacity>
          </View>

          {calendarViewMode === 'day' ? (
            /* Day View */
            <View style={styles.dayViewContainer}>
              {/* Day Navigation */}
              <View style={styles.dayHeader}>
                <TouchableOpacity
                  onPress={() => {
                    const prevDay = addDays(selectedDate, -1);
                    setSelectedDate(prevDay);
                  }}
                  style={styles.dayNavButton}
                >
                  <Ionicons name="chevron-back" size={24} color="#333" />
                </TouchableOpacity>
                <View style={styles.dayTitleContainer}>
                  <Text style={styles.dayTitle}>
                    {format(selectedDate, 'EEEE, MMMM d')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedDate(new Date())}
                    style={styles.todayButton}
                  >
                    <Text style={styles.todayButtonText}>Today</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    const nextDay = addDays(selectedDate, 1);
                    setSelectedDate(nextDay);
                  }}
                  style={styles.dayNavButton}
                >
                  <Ionicons name="chevron-forward" size={24} color="#333" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* Week View */
            <View style={styles.weekViewContainer}>
              {/* Week Navigation */}
              <View style={styles.weekViewHeader}>
                <TouchableOpacity
                  onPress={() => {
                    const prevWeek = addDays(currentWeekStart, -7);
                    setCurrentWeekStart(prevWeek);
                    setSelectedDate(prevWeek);
                  }}
                  style={styles.weekNavButton}
                >
                  <Ionicons name="chevron-back" size={24} color="#333" />
                </TouchableOpacity>
                <View style={styles.weekTitleContainer}>
                  <Text style={styles.weekTitle}>
                    {format(currentWeekStart, 'MMM d')} - {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const today = new Date();
                      setCurrentWeekStart(startOfWeek(today, { weekStartsOn: 0 }));
                      setSelectedDate(today);
                    }}
                    style={styles.todayButton}
                  >
                    <Text style={styles.todayButtonText}>Today</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    const nextWeek = addDays(currentWeekStart, 7);
                    setCurrentWeekStart(nextWeek);
                    setSelectedDate(nextWeek);
                  }}
                  style={styles.weekNavButton}
                >
                  <Ionicons name="chevron-forward" size={24} color="#333" />
                </TouchableOpacity>
              </View>

              {/* Week Days */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.weekDaysContainer}>
                  {weekDays.map((date, index) => {
                    const isSelected = isSameDay(date, selectedDate);
                    const isToday = isSameDay(date, new Date());
                    const eventCount = getAllEventsForDate(date).length;

                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.weekDayCell,
                          isToday && styles.weekDayCellToday,
                          isSelected && styles.weekDayCellSelected,
                        ]}
                        onPress={() => setSelectedDate(date)}
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
                          <View style={styles.weekEventIndicator} />
                        )}
                      </TouchableOpacity>
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
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => {
                  setNewEventDate(selectedDate);
                  setShowAddEventModal(true);
                }}
              >
                <Ionicons name="add-circle" size={24} color="#007AFF" />
              </TouchableOpacity>
            </View>

            {(() => {
              const dateItems = getItemsForDate(selectedDate);
              const dateEvents = getCalendarEventsForDate(selectedDate);
              const allEvents = [...dateItems, ...dateEvents].sort((a, b) => {
                if ('startDate' in a && 'startDate' in b) {
                  return a.startDate.getTime() - b.startDate.getTime();
                }
                if ('scheduled_time' in a && 'scheduled_time' in b) {
                  return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
                }
                return 0;
              });

              if (allEvents.length > 0) {
                return (
                  <FlatList
                    data={allEvents}
                    renderItem={({ item }) => {
                      if ('startDate' in item) {
                        const event = item as CalendarEvent;
                        return (
                          <TouchableOpacity
                            style={styles.eventCard}
                            onPress={() => {
                              // If it's a Silo event (starts with "Review:"), try to find the matching item
                              if (event.isSiloEvent) {
                                // Try to find the item by matching the event title and date/time
                                const matchingItem = items.find(
                                  i => i.scheduled_date && 
                                  format(new Date(i.scheduled_date), 'yyyy-MM-dd') === format(event.startDate, 'yyyy-MM-dd') &&
                                  i.scheduled_time === format(event.startDate, 'HH:mm') &&
                                  (i.title === event.title.replace('Review: ', '') || event.title.includes(i.title))
                                );
                                
                                if (matchingItem) {
                                  handleItemPress(matchingItem.id);
                                  return;
                                }
                                
                                // If itemId is set, use it
                                if (event.itemId) {
                                  handleItemPress(event.itemId);
                                  return;
                                }
                              }
                              
                              // If it's linked to a Silo item via itemId, navigate to it
                              if (event.itemId) {
                                handleItemPress(event.itemId);
                                return;
                              }
                              
                              // Otherwise, show event details
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
                                      
                                      const newItem: Item = {
                                        id: `item_${Date.now()}`,
                                        type: 'note',
                                        classification: 'event',
                                        title: event.title.replace('Review: ', ''),
                                        scheduled_date: dateStr,
                                        scheduled_time: timeStr,
                                        duration: duration || 15,
                                        tags: [],
                                        created_at: new Date().toISOString(),
                                        viewed: false,
                                        archived: false,
                                      };
                                      
                                      addItem(newItem).then(() => {
                                        scheduleItemReview(newItem, dateStr, timeStr, duration || 15);
                                        loadItems();
                                        Alert.alert('Success', 'Event imported to Silo!');
                                      }).catch((error) => {
                                        console.error('Failed to create item:', error);
                                        Alert.alert('Error', 'Failed to import event');
                                      });
                                    }
                                  }])
                                ]
                              );
                            }}
                          >
                            <View style={styles.eventCardIcon}>
                              <Ionicons 
                                name={event.isSiloEvent ? "checkmark-circle" : "calendar-outline"} 
                                size={20} 
                                color={event.isSiloEvent ? "#4CAF50" : "#007AFF"} 
                              />
                            </View>
                            <View style={styles.eventCardContent}>
                              <Text style={styles.eventCardTitle}>
                                {event.title.replace('Review: ', '')}
                              </Text>
                              <Text style={styles.eventCardTime}>
                                {format(event.startDate, 'h:mm a')} - {format(event.endDate, 'h:mm a')}
                                {event.isSiloEvent && ' • Silo'}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#999" />
                          </TouchableOpacity>
                        );
                      } else {
                        return (
                          <TouchableOpacity
                            style={styles.eventCard}
                            onPress={() => handleItemPress((item as Item).id)}
                          >
                            <View style={styles.eventCardIcon}>
                              <Ionicons name="time" size={20} color="#007AFF" />
                            </View>
                            <View style={styles.eventCardContent}>
                              <Text style={styles.eventCardTitle}>
                                {(item as Item).title}
                              </Text>
                              <Text style={styles.eventCardTime}>
                                {(item as Item).scheduled_time} ({(item as Item).duration || 15} min)
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#999" />
                          </TouchableOpacity>
                        );
                      }
                    }}
                    keyExtractor={(item, index) => {
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
              } else {
                return (
                  <View style={styles.emptyEventsContainer}>
                    <Ionicons name="calendar-outline" size={48} color="#ccc" />
                    <Text style={styles.emptyEventsText}>No events scheduled</Text>
                    <Text style={styles.emptyEventsSubtext}>
                      Tap the + button to add an event
                    </Text>
                  </View>
                );
              }
            })()}
          </View>
        </View>
      )}

      {viewMode === 'map' && (
        /* Map View */
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            initialRegion={mapRegion}
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
            {/* Current location marker */}
            {currentLocation && (
              <Marker
                coordinate={currentLocation}
                title="Your Location"
                pinColor="#007AFF"
              >
                <View style={styles.currentLocationMarker}>
                  <Ionicons name="location" size={32} color="#007AFF" />
                </View>
              </Marker>
            )}

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
                  <Ionicons name="location" size={24} color="#FF6B6B" />
                </View>
              </Marker>
            ))}
          </MapView>

          {/* Map Items List */}
          {itemsWithLocations.length > 0 && (
            <View style={styles.mapItemsList}>
              <Text style={styles.mapSectionTitle}>
                Saved Places ({itemsWithLocations.length})
              </Text>
              <FlatList
                data={itemsWithLocations}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.mapItemCard}
                    onPress={() => handleItemPress(item.id)}
                  >
                    <Ionicons name="location" size={20} color="#007AFF" />
                    <View style={styles.mapItemContent}>
                      <Text style={styles.mapItemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.mapItemLocation} numberOfLines={1}>
                        {item.place_name || item.place_address || 'Location'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#999" />
                  </TouchableOpacity>
                )}
                keyExtractor={item => item.id}
                contentContainerStyle={[
                  { paddingBottom: insets.bottom + 120 }
                ]}
                contentInsetAdjustmentBehavior="automatic"
              />
            </View>
          )}
        </View>
      )}

      {viewMode === 'bucketlist' && (
        <View style={styles.bucketlistContainer}>
          <View style={styles.bucketlistHeader}>
            <Text style={styles.bucketlistTitle}>
              Bucket List ({bucketlistItems.length})
            </Text>
            <Text style={styles.bucketlistSubtitle}>
              Things you want to do when the circumstances are right
            </Text>
          </View>

          {bucketlistItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="list-outline" size={64} color="#ccc" />
              <Text style={styles.emptyText}>No bucket list items yet</Text>
              <Text style={styles.emptySubtext}>
                Hold down on any card to add it to your bucket list
              </Text>
            </View>
          ) : (
            <FlatList
              data={bucketlistItems}
              renderItem={({ item }) => (
                <View style={styles.bucketlistItemWrapper}>
                  <TouchableOpacity
                    style={styles.bucketlistCheckbox}
                    onPress={() => handleToggleBucketlistComplete(item.id)}
                  >
                    <Ionicons
                      name={item.bucketlist_completed ? 'checkbox' : 'checkbox-outline'}
                      size={24}
                      color={item.bucketlist_completed ? '#4cd964' : '#999'}
                    />
                  </TouchableOpacity>
                  <View style={styles.bucketlistItemContent}>
                    <ItemCard
                      item={item}
                      onPress={handleItemPress}
                      onLongPress={handleToggleBucketlist}
                      isCompleted={item.bucketlist_completed}
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
        </View>
      )}

      {/* Add Event Modal */}
      <Modal
        visible={showAddEventModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddEventModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Event</Text>
              <TouchableOpacity
                onPress={() => setShowAddEventModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <TextInput
                style={styles.input}
                placeholder="Event title"
                value={newEventTitle}
                onChangeText={setNewEventTitle}
                placeholderTextColor="#999"
              />

              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={24} color="#007AFF" />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Date</Text>
                  <Text style={styles.pickerValue}>
                    {format(newEventDate, 'MMMM d, yyyy')}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="time-outline" size={24} color="#007AFF" />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Time</Text>
                  <Text style={styles.pickerValue}>
                    {format(newEventTime, 'h:mm a')}
                  </Text>
                </View>
              </TouchableOpacity>

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
                        if (Platform.OS === 'ios') {
                          // On iOS, keep picker open but allow closing
                        }
                      }
                    }}
                    minimumDate={new Date()}
                    style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
                    textColor={Platform.OS === 'ios' ? '#000000' : undefined}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      style={styles.pickerDoneButton}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

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
                    textColor={Platform.OS === 'ios' ? '#000000' : undefined}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      style={styles.pickerDoneButton}
                      onPress={() => setShowTimePicker(false)}
                    >
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleCreateEvent}
              >
                <Text style={styles.saveButtonText}>Create Event</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}


const styles = StyleSheet.create({
  pickerContainer: {
    marginVertical: 16,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iosPicker: {
    height: 200,
    width: '100%',
  },
  pickerDoneButton: {
    marginTop: 8,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
  },
  pickerDoneText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 10,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  segmentActive: {
    backgroundColor: '#007AFF',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  segmentTextActive: {
    color: '#fff',
  },
  calendarContainer: {
    flex: 1,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    padding: 4,
    margin: 12,
    marginBottom: 8,
  },
  viewModeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModeButtonActive: {
    backgroundColor: '#007AFF',
  },
  viewModeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  viewModeTextActive: {
    color: '#fff',
  },
  dayViewContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 20,
    margin: 12,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  dayNavButton: {
    padding: 8,
  },
  dayTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  dayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  todayButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#007AFF',
    borderRadius: 12,
  },
  todayButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  weekViewContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 20,
    margin: 12,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  weekViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  weekNavButton: {
    padding: 8,
  },
  weekTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  weekTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  weekDaysContainer: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  weekDayCell: {
    width: (SCREEN_WIDTH - 32) / 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  weekDayCellToday: {
    backgroundColor: '#E3F2FD',
  },
  weekDayCellSelected: {
    backgroundColor: '#007AFF',
  },
  weekDayName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  weekDayNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  weekDayNumberToday: {
    color: '#007AFF',
    fontWeight: '700',
  },
  weekDayNumberSelected: {
    color: '#fff',
  },
  weekEventIndicator: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#007AFF',
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  monthNavButton: {
    padding: 8,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  eventsContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  timelineTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  addButton: {
    padding: 4,
  },
  eventsList: {
    padding: 16,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  eventCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  eventCardContent: {
    flex: 1,
  },
  eventCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  eventCardTime: {
    fontSize: 14,
    color: '#666',
  },
  emptyEventsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyEventsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptyEventsSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  currentLocationMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapItemsList: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_HEIGHT * 0.4,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  mapSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  mapItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  mapItemContent: {
    flex: 1,
    marginLeft: 12,
  },
  mapItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  mapItemLocation: {
    fontSize: 14,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalBody: {
    padding: 16,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333',
    marginBottom: 12,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  pickerContent: {
    marginLeft: 12,
    flex: 1,
  },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pickerValue: {
    fontSize: 16,
    color: '#333',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  bucketlistContainer: {
    flex: 1,
  },
  bucketlistHeader: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  bucketlistTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  bucketlistSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  bucketlistContent: {
    padding: 16,
  },
  bucketlistItemWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  bucketlistCheckbox: {
    marginRight: 12,
    marginTop: 8,
    padding: 4,
  },
  bucketlistItemContent: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});

