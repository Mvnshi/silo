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

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Alert,
  RefreshControl,
  Dimensions,
  TouchableOpacity,
  Text,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import StreamCard from '@/components/StreamCard';
import { Item, Classification } from '@/lib/types';
import { getItems, updateItem } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ReelScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Classification | 'all'>('all');
  
  // Schedule modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleItem, setScheduleItem] = useState<Item | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleDuration, setScheduleDuration] = useState(15);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const durationOptions = [15, 30, 45, 60];

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
      applyCategoryFilter(feedItems, selectedCategory);
    } catch (error) {
      console.error('Failed to load items:', error);
      Alert.alert('Error', 'Failed to load content');
    }
  }

  /**
   * Apply category filter
   */
  function applyCategoryFilter(allItems: Item[], category: Classification | 'all') {
    if (category === 'all') {
      setFilteredItems(allItems);
    } else {
      setFilteredItems(allItems.filter(item => item.classification === category));
    }
  }

  /**
   * Handle category selection
   */
  function handleCategorySelect(category: Classification | 'all') {
    setSelectedCategory(category);
    applyCategoryFilter(items, category);
  }

  // Load items when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadItems();
      // Haptic feedback when tab is focused
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [])
  );

  // Update filtered items when category changes
  useEffect(() => {
    applyCategoryFilter(items, selectedCategory);
  }, [selectedCategory, items]);

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
      Alert.alert('Error', 'Failed to archive item');
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
      const date = new Date(item.scheduled_date);
      setScheduleDate(date);
      if (item.scheduled_time) {
        const [hours, minutes] = item.scheduled_time.split(':').map(Number);
        const time = new Date();
        time.setHours(hours, minutes, 0, 0);
        setScheduleTime(time);
      }
    } else {
      // Default to tomorrow 9 AM
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      setScheduleDate(tomorrow);
      setScheduleTime(tomorrow);
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
        Alert.alert('Error', 'Failed to schedule item. Please check calendar permissions.');
      }
    } catch (error) {
      console.error('Failed to schedule item:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to schedule item');
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
      Alert.alert('Error', 'Failed to remove schedule');
    }
  }

  /**
   * Celebration haptic - accelerated vibration pattern
   */
  async function celebrationHaptic() {
    try {
      // Pattern: light -> medium -> heavy -> success notification
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await new Promise(resolve => setTimeout(resolve, 50));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await new Promise(resolve => setTimeout(resolve, 50));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise(resolve => setTimeout(resolve, 100));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      // Fallback if haptics fail
      console.error('Haptic error:', error);
    }
  }

  /**
   * Mark item as completed/viewed - removes from stream
   */
  async function handleComplete(itemId: string) {
    try {
      await updateItem(itemId, { viewed: true });
      // Remove from current feed
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
      setFilteredItems(prevItems => prevItems.filter(item => item.id !== itemId));
      // Celebration haptic for completion
      celebrationHaptic();
    } catch (error) {
      console.error('Failed to mark item as completed:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to mark item as completed');
    }
  }

  const categories: Array<{ label: string; value: Classification | 'all'; icon: keyof typeof Ionicons.glyphMap }> = [
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
      <FlatList
        data={filteredItems}
        renderItem={({ item }) => (
          <StreamCard
            item={item}
            onArchive={handleArchive}
            onSchedule={handleSchedule}
            onComplete={handleComplete}
          />
        )}
        keyExtractor={item => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(data, index) => ({
          length: SCREEN_HEIGHT,
          offset: SCREEN_HEIGHT * index,
          index,
        })}
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
          <View style={styles.emptyContainer}>
            <Ionicons name="videocam-outline" size={64} color="#666" />
            <Text style={styles.emptyText}>No content found</Text>
            <Text style={styles.emptySubtext}>
              Try selecting a different category
            </Text>
          </View>
        }
      />
      
      {/* Floating Category Filter Bar */}
      <View style={[styles.floatingCategories, { paddingTop: insets.top + 8 }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.value}
              style={[
                styles.categoryChip,
                selectedCategory === cat.value && styles.categoryChipActive,
              ]}
              onPress={() => handleCategorySelect(cat.value)}
            >
              <Ionicons 
                name={cat.icon} 
                size={16} 
                color={selectedCategory === cat.value ? '#fff' : '#999'} 
              />
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === cat.value && styles.categoryChipTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Schedule Modal - Floating Popup */}
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
                <Ionicons name="close" size={24} color="#333" />
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
                <Ionicons name="calendar-outline" size={24} color="#007AFF" />
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
                <Ionicons name="time-outline" size={24} color="#007AFF" />
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
                <TouchableOpacity
                  style={[styles.modalButton, styles.saveButton]}
                  onPress={handleSaveSchedule}
                >
                  <Text style={styles.saveButtonText}>Schedule</Text>
                </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: '#007AFF',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
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
    borderRadius: 20,
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
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalItemPreview: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  modalItemDescription: {
    fontSize: 14,
    color: '#666',
  },
  modalBody: {
    padding: 20,
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
    color: '#666',
    marginBottom: 4,
    fontWeight: '600',
  },
  pickerValue: {
    fontSize: 16,
    color: '#333',
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
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  durationOptionActive: {
    backgroundColor: '#007AFF',
  },
  durationOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
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
    borderRadius: 12,
    alignItems: 'center',
  },
  removeButton: {
    backgroundColor: '#f5f5f5',
  },
  removeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff3b30',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

