/**
 * Reel Screen (Streams Feed)
 * 
 * TikTok-style vertical swipeable feed for browsing content.
 * Users can swipe through items, play audio narrations, and take actions
 * (schedule, add to stack, archive).
 * 
 * Features:
 * - Full-screen vertical scrolling
 * - Audio playback for each item
 * - Quick actions (schedule, stack, archive)
 * - Filters by classification
 * 
 * Dependencies:
 * - React Native FlatList with pagination
 * - StreamCard component
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  useWindowDimensions,
  TouchableOpacity,
  Text,
  ScrollView,
  Modal,
  Platform,
  type ViewToken,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import StreamCard from '@/components/StreamCard';
import EmptyState from '@/components/ui/EmptyState';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import { useToast } from '@/components/ui/Toast';
import { BRAND, INK, HAIRLINE, RADIUS, GRADIENTS } from '@/lib/theme';
import { Item, Classification } from '@/lib/types';
import { getItems, updateItem } from '@/lib/storage';
import { useDataVersion } from '@/lib/dataVersion';
import { scheduleItemReview } from '@/lib/scheduler';
import { celebrationHaptic } from '@/lib/haptics';
import { parseLocalDate, defaultReviewSlot } from '@/lib/datetime';

export default function ReelScreen() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const dataVersion = useDataVersion();
  const { height: WINDOW_HEIGHT } = useWindowDimensions();
  /**
   * One page = the height the list actually got, not the window.
   *
   * `NativeTabs` is a real UITabBar, so this screen is inset by it and the
   * feed's viewport is ~90pt shorter than the window. Sizing pages to the
   * window made each card taller than its page: `pagingEnabled` scrolls by the
   * VIEWPORT, so every swipe left the next card ~90pt further up, and after a
   * swipe or two a card's title was sitting behind the floating category
   * chips. Measuring once and using that number for the card, the snap
   * interval and `getItemLayout` keeps all three in agreement.
   */
  const [pageHeight, setPageHeight] = useState(0);
  const SCREEN_HEIGHT = pageHeight > 0 ? pageHeight : WINDOW_HEIGHT;
  const [items, setItems] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Classification | 'all'>('all');
  // Id of the card currently filling the screen. Only that card mounts a
  // WebView, so the feed never holds more than one live player.
  const [activeId, setActiveId] = useState<string | null>(null);
  // False while the tab is backgrounded, so a playing embed is torn down when
  // the user switches tabs rather than continuing to play out of sight.
  const [tabFocused, setTabFocused] = useState(true);

  // Schedule modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleItem, setScheduleItem] = useState<Item | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleDuration, setScheduleDuration] = useState(15);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const durationOptions = [15, 30, 45, 60];
  // Guards against a fast double-tap on "Schedule" creating duplicate events.
  const savingScheduleRef = useRef(false);

  /**
   * Load items from storage
   */
  async function loadItems() {
    try {
      const allItems = await getItems();
      // Show all non-archived, unviewed items (completed items don't show in stream)
      // Prioritize videos and unviewed items
      const feedItems = allItems
        .filter(item => !item.archived && !item.viewed)
        .sort((a, b) => {
          // Prioritize videos
          if (a.classification === 'video' && b.classification !== 'video') return -1;
          if (b.classification === 'video' && a.classification !== 'video') return 1;
          // Then by creation date (newest first)
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      setItems(feedItems);
    } catch (error) {
      console.error('Failed to load items:', error);
      toast.show({ message: 'Couldn’t load your saves. Pull to try again.', tone: 'danger' });
    }
  }

  /** Derived, not stored — a second copy of the list only drifts out of sync. */
  const filteredItems = useMemo(
    () =>
      selectedCategory === 'all'
        ? items
        : items.filter((item) => item.classification === selectedCategory),
    [items, selectedCategory]
  );

  /**
   * Handle category selection
   */
  function handleCategorySelect(category: Classification | 'all') {
    setSelectedCategory(category);
  }

  // Load items when screen comes into focus; pause playback when it leaves.
  // `dataVersion` so the assistant's actions land here too — it is an overlay,
  // not a route, so this tab never blurs. See lib/dataVersion.ts.
  useFocusEffect(
    useCallback(() => {
      setTabFocused(true);
      loadItems();
      return () => setTabFocused(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataVersion])
  );

  /**
   * Track which card fills the screen. 80% coverage means the card is
   * unambiguously "the" page, so playback never flips mid-swipe.
   */
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.item as Item | undefined;
    if (first) setActiveId(first.id);
  }).current;

  // Seed the active card so the very first item plays without a swipe.
  useEffect(() => {
    if (!activeId && filteredItems.length > 0) setActiveId(filteredItems[0].id);
  }, [filteredItems, activeId]);

  /**
   * Handle pull to refresh
   */
  async function handleRefresh() {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }

  /**
   * Archive an item
   */
  async function handleArchive(itemId: string) {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await updateItem(itemId, { archived: true, viewed: true });
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to archive item:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show({ message: 'Couldn’t archive that. Try again.', tone: 'danger' });
    }
  }

  /**
   * Schedule an item - show floating popup modal
   */
  function handleSchedule(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Pre-fill with existing schedule if available
    if (item.scheduled_date) {
      // parseLocalDate avoids the UTC off-by-one of `new Date('YYYY-MM-DD')`.
      setScheduleDate(parseLocalDate(item.scheduled_date));
      if (item.scheduled_time) {
        const [hours, minutes] = item.scheduled_time.split(':').map(Number);
        const time = new Date();
        time.setHours(hours, minutes, 0, 0);
        setScheduleTime(time);
      }
    } else {
      // Default to tomorrow 9 AM
      const slot = defaultReviewSlot();
      const date = parseLocalDate(slot.date, slot.time);
      setScheduleDate(date);
      setScheduleTime(date);
    }
    
    // Pre-fill duration if available
    if (item.duration) {
      setScheduleDuration(item.duration);
    }
    
    setScheduleItem(item);
    setShowScheduleModal(true);
  }

  /**
   * Save schedule from modal
   */
  async function handleSaveSchedule() {
    if (!scheduleItem) return;

    // In-flight guard: a fast double-tap must not create two calendar events.
    if (savingScheduleRef.current) return;
    savingScheduleRef.current = true;

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const dateStr = format(scheduleDate, 'yyyy-MM-dd');
      const timeStr = format(scheduleTime, 'HH:mm');

      // Schedule in calendar
      const scheduledEvent = await scheduleItemReview(scheduleItem, dateStr, timeStr, scheduleDuration);

      if (scheduledEvent) {
        // Update item with schedule
        await updateItem(scheduleItem.id, {
          scheduled_date: dateStr,
          scheduled_time: timeStr,
          duration: scheduleDuration,
        });

        // Reload items
        await loadItems();
        setShowScheduleModal(false);
        setScheduleItem(null);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toast.show({ message: 'Couldn’t add it to your calendar — check calendar access in Settings.', tone: 'danger' });
      }
    } catch (error) {
      console.error('Failed to schedule item:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show({ message: 'Couldn’t schedule that. Try again.', tone: 'danger' });
    } finally {
      savingScheduleRef.current = false;
    }
  }

  /**
   * Remove schedule
   */
  async function handleRemoveSchedule() {
    if (!scheduleItem) return;
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await updateItem(scheduleItem.id, {
        scheduled_date: undefined,
        scheduled_time: undefined,
      });
      await loadItems();
      setShowScheduleModal(false);
      setScheduleItem(null);
    } catch (error) {
      console.error('Failed to remove schedule:', error);
      toast.show({ message: 'Couldn’t unschedule that. Try again.', tone: 'danger' });
    }
  }

  /**
   * Mark item as completed/viewed - removes from stream
   */
  async function handleComplete(itemId: string) {
    try {
      await updateItem(itemId, { viewed: true });
      // Remove from current feed (filteredItems is derived, so it follows).
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
      // Celebration haptic for completion
      celebrationHaptic();
    } catch (error) {
      console.error('Failed to mark item as completed:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show({ message: 'Couldn’t mark that done. Try again.', tone: 'danger' });
    }
  }

  const categories: { label: string; value: Classification | 'all'; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: 'All', value: 'all', icon: 'apps' },
    { label: 'Videos', value: 'video', icon: 'play-circle' },
    { label: 'Fitness', value: 'fitness', icon: 'fitness' },
    { label: 'Food', value: 'food', icon: 'restaurant' },
    { label: 'Career', value: 'career', icon: 'briefcase' },
    { label: 'Academia', value: 'academia', icon: 'school' },
    { label: 'Articles', value: 'article', icon: 'newspaper' },
  ];

  return (
    <View style={styles.container}>
      {/* Full-bleed media needs light status-bar glyphs. expo-status-bar's
          last-mounted instance wins, so this overrides the root's "dark". */}
      <StatusBar style="light" animated />
      <FlatList
        data={filteredItems}
        renderItem={({ item }) => (
          <StreamCard
            item={item}
            active={tabFocused && item.id === activeId}
            pageHeight={SCREEN_HEIGHT}
            onArchive={handleArchive}
            onSchedule={handleSchedule}
            onComplete={handleComplete}
          />
        )}
        keyExtractor={item => item.id}
        onLayout={(e) => {
          const next = Math.round(e.nativeEvent.layout.height);
          setPageHeight((h) => (Math.abs(h - next) > 1 ? next : h));
        }}
        showsVerticalScrollIndicator={false}
        // A full-bleed feed insets itself: StreamCard already pads for the
        // status bar and the chip strip. UIKit's automatic adjustment would add
        // the safe area on top of that, pushing page 1 down by ~60pt (a white
        // band above the first card) and shifting every snap point with it.
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        // `pagingEnabled` scrolls by the viewport and would fight the explicit
        // interval below; now that the interval IS the measured viewport, the
        // interval is the one to keep. `disableIntervalMomentum` stops a hard
        // flick from skipping several cards at once.
        snapToInterval={SCREEN_HEIGHT}
        snapToAlignment="start"
        disableIntervalMomentum
        decelerationRate="fast"
        getItemLayout={(data, index) => ({
          length: SCREEN_HEIGHT,
          offset: SCREEN_HEIGHT * index,
          index,
        })}
        // Windowing: keep the neighbours warm for an instant swipe, and let
        // everything further out be recycled. Combined with the single-active
        // WebView in StreamCard this keeps memory flat over a long feed.
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
          />
        }
        ListEmptyComponent={
          <EmptyState
            dark
            icon="play-circle"
            title="Your stream is empty"
            subtitle="Saved videos and reels appear here as a scrollable feed."
            colors={['#ec4899', '#8b5cf6']}
          />
        }
      />
      
      {/* Floating Category Filter Bar */}
      <View style={[styles.floatingCategories, { paddingTop: insets.top + 8 }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          {categories.map((cat) => {
            const active = selectedCategory === cat.value;
            return (
              <PressableScale
                key={cat.value}
                haptic="selection"
                onPress={() => handleCategorySelect(cat.value)}
              >
                {/* Dark glass pill; active swaps the interior for a brand gradient
                    fill. `clear` because this strip floats over the media itself —
                    the thin material keeps the frame behind it readable. */}
                <Glass tint="dark" variant="clear" intensity={35} radius={RADIUS.pill}>
                  {active ? (
                    <LinearGradient
                      colors={GRADIENTS.brand}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.categoryChip}
                    >
                      <Ionicons name={cat.icon} size={16} color="#fff" />
                      <Text style={[styles.categoryChipText, styles.categoryChipTextActive]}>
                        {cat.label}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.categoryChip}>
                      <Ionicons name={cat.icon} size={16} color="rgba(255,255,255,0.75)" />
                      <Text style={styles.categoryChipText}>{cat.label}</Text>
                    </View>
                  )}
                </Glass>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {/* Schedule Modal - Floating Popup.
          The sheet stays an opaque surface, deliberately. `animationType="fade"`
          is a UIKit cross-dissolve, i.e. an alpha animation on the presented
          view — glass inside it would blank out for the whole transition rather
          than fade. Its interior is also pinned light (INK text, light-variant
          pickers), so a material that follows the appearance would lose its
          contrast in dark mode. */}
      <Modal
        visible={showScheduleModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShowScheduleModal(false);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowScheduleModal(false);
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {scheduleItem?.scheduled_date ? 'Reschedule' : 'Schedule'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowScheduleModal(false);
                }}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={INK[900]} />
              </TouchableOpacity>
            </View>

            {scheduleItem && (
              <View style={styles.modalItemPreview}>
                <Text style={styles.modalItemTitle} numberOfLines={2}>
                  {scheduleItem.title}
                </Text>
                {scheduleItem.description && (
                  <Text style={styles.modalItemDescription} numberOfLines={1}>
                    {scheduleItem.description}
                  </Text>
                )}
              </View>
            )}

            <View style={styles.modalBody}>
              {/* Date Picker */}
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowDatePicker(true);
                }}
              >
                <Ionicons name="calendar-outline" size={24} color={BRAND[600]} />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Date</Text>
                  <Text style={styles.pickerValue}>
                    {format(scheduleDate, 'MMMM d, yyyy')}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Time Picker */}
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowTimePicker(true);
                }}
              >
                <Ionicons name="time-outline" size={24} color={BRAND[600]} />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Time</Text>
                  <Text style={styles.pickerValue}>
                    {format(scheduleTime, 'h:mm a')}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Duration Picker */}
              <View style={styles.durationSection}>
                <Text style={styles.pickerLabel}>Duration</Text>
                <View style={styles.durationOptions}>
                  {durationOptions.map((duration) => (
                    <TouchableOpacity
                      key={duration}
                      style={[
                        styles.durationOption,
                        scheduleDuration === duration && styles.durationOptionActive,
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setScheduleDuration(duration);
                      }}
                    >
                      <Text
                        style={[
                          styles.durationOptionText,
                          scheduleDuration === duration && styles.durationOptionTextActive,
                        ]}
                      >
                        {duration} min
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Date Picker Component */}
              {showDatePicker && (
                <View style={styles.pickerContainer}>
                  <DateTimePicker
                    value={scheduleDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="light"
                    onChange={(event, selectedDate) => {
                      setShowDatePicker(Platform.OS === 'android');
                      if (selectedDate) {
                        Haptics.selectionAsync();
                        setScheduleDate(selectedDate);
                      }
                    }}
                    minimumDate={new Date()}
                    textColor={Platform.OS === 'ios' ? '#000000' : undefined}
                  />
                </View>
              )}

              {/* Time Picker Component */}
              {showTimePicker && (
                <View style={styles.pickerContainer}>
                  <DateTimePicker
                    value={scheduleTime}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    themeVariant="light"
                    onChange={(event, selectedTime) => {
                      setShowTimePicker(Platform.OS === 'android');
                      if (selectedTime) {
                        Haptics.selectionAsync();
                        setScheduleTime(selectedTime);
                      }
                    }}
                    textColor={Platform.OS === 'ios' ? '#000000' : undefined}
                  />
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                {scheduleItem?.scheduled_date && (
                  <TouchableOpacity
                    style={[styles.modalButton, styles.removeButton]}
                    onPress={handleRemoveSchedule}
                  >
                    <Text style={styles.removeButtonText}>Remove Schedule</Text>
                  </TouchableOpacity>
                )}
                {/* Flex wrapper: PressableScale's outer Pressable can't take flex itself. */}
                <View style={styles.saveButtonWrap}>
                  <PressableScale haptic="light" onPress={handleSaveSchedule}>
                    <LinearGradient
                      colors={GRADIENTS.brand}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.saveButton}
                    >
                      <Text style={styles.saveButtonText}>Schedule</Text>
                    </LinearGradient>
                  </PressableScale>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  listContent: {
    backgroundColor: 'transparent',
  },
  floatingCategories: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  categoryScroll: {
    paddingHorizontal: 0,
    gap: 8,
  },
  categoryChip: {
    // Glass surface + radius come from the Glass wrapper.
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: INK[900],
  },
  modalCloseButton: {
    padding: 4,
  },
  modalItemPreview: {
    padding: 16,
    backgroundColor: INK[50],
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  modalItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: INK[900],
    marginBottom: 4,
  },
  modalItemDescription: {
    fontSize: 14,
    color: INK[500],
  },
  modalBody: {
    padding: 20,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INK[100],
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
    color: INK[500],
    marginBottom: 4,
    fontWeight: '600',
  },
  pickerValue: {
    fontSize: 16,
    color: INK[900],
    fontWeight: '600',
  },
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
  durationSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  durationOptions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  durationOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: INK[100],
    alignItems: 'center',
  },
  durationOptionActive: {
    backgroundColor: BRAND[600],
  },
  durationOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: INK[500],
  },
  durationOptionTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  removeButton: {
    backgroundColor: INK[100],
  },
  removeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff3b30',
  },
  saveButtonWrap: {
    flex: 1,
  },
  saveButton: {
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

