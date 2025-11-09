/**
 * Item Detail Screen
 * 
 * Displays full details for a single content item. Shows all metadata,
 * allows editing, playing audio, scheduling, and taking actions.
 * 
 * Features:
 * - Full item information display
 * - Audio playback
 * - Edit title, description, tags
 * - Schedule or reschedule
 * - Add to stack
 * - Archive or delete
 * - Share content
 * 
 * Dependencies:
 * - expo-av: Audio playback
 * - expo-router: Navigation
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Item } from '@/lib/types';
import { getItemById, updateItem, deleteItem } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 100; // Minimum swipe distance to trigger back
const EDGE_WIDTH = 20; // Width of the left edge detection area

export default function ItemDetailScreen() {
  const { id, schedule, from } = useLocalSearchParams<{ id: string; schedule?: string; from?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<Item | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showScheduleModal, setShowScheduleModal] = useState(schedule === 'true');
  
  // Swipe gesture values
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleDuration, setScheduleDuration] = useState(15);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const durationOptions = [15, 30, 45, 60];

  /**
   * Load item from storage
   */
  useEffect(() => {
    loadItem();
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [id]);

  async function loadItem() {
    try {
      const loadedItem = await getItemById(id);
      setItem(loadedItem);
      
      // Don't auto-mark as viewed - user marks as done via swipe
      
      // If schedule param is true, open schedule modal after item loads
      if (schedule === 'true' && loadedItem) {
        // Pre-fill with existing schedule if available
        if (loadedItem.scheduled_date) {
          const date = new Date(loadedItem.scheduled_date);
          setScheduleDate(date);
          if (loadedItem.scheduled_time) {
            const [hours, minutes] = loadedItem.scheduled_time.split(':').map(Number);
            const time = new Date();
            time.setHours(hours, minutes, 0, 0);
            setScheduleTime(time);
          }
        }
        // Pre-fill duration if available
        if (loadedItem.duration) {
          setScheduleDuration(loadedItem.duration);
        }
        setShowScheduleModal(true);
      }
    } catch (error) {
      console.error('Failed to load item:', error);
      Alert.alert('Error', 'Failed to load item');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Load and play audio
   */
  async function toggleAudio() {
    if (!item?.audio_url) return;

    try {
      if (sound) {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          if (isPlaying) {
            await sound.pauseAsync();
            setIsPlaying(false);
          } else {
            await sound.playAsync();
            setIsPlaying(true);
          }
        }
      } else {
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: item.audio_url },
          { shouldPlay: true }
        );
        setSound(newSound);
        setIsPlaying(true);

        newSound.setOnPlaybackStatusUpdate(status => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        });
      }
    } catch (error) {
      console.error('Failed to play audio:', error);
      Alert.alert('Error', 'Failed to play audio');
    }
  }

  /**
   * Open URL in browser
   */
  function openUrl() {
    if (item?.url) {
      Linking.openURL(item.url);
    }
  }

  /**
   * Archive item
   */
  async function handleArchive() {
    Alert.alert(
      'Archive Item',
      'Move this item to archive?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateItem(id, { archived: true });
              router.back();
            } catch (error) {
              console.error('Failed to archive item:', error);
              Alert.alert('Error', 'Failed to archive item');
            }
          },
        },
      ]
    );
  }

  /**
   * Delete item permanently
   */
  async function handleDelete() {
    Alert.alert(
      'Delete Item',
      'Permanently delete this item? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem(id);
              router.back();
            } catch (error) {
              console.error('Failed to delete item:', error);
              Alert.alert('Error', 'Failed to delete item');
            }
          },
        },
      ]
    );
  }

  /**
   * Handle schedule button press
   */
  function handleSchedulePress() {
    if (item) {
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
      }
      // Pre-fill duration if available
      if (item.duration) {
        setScheduleDuration(item.duration);
      }
      setShowScheduleModal(true);
    }
  }

  /**
   * Save schedule
   */
  async function handleSaveSchedule() {
    if (!item) return;

    try {
      const dateStr = format(scheduleDate, 'yyyy-MM-dd');
      const timeStr = format(scheduleTime, 'HH:mm');

      // Schedule in calendar
      const scheduledEvent = await scheduleItemReview(item, dateStr, timeStr, scheduleDuration);
      
      if (scheduledEvent) {
        // Update item with schedule
        await updateItem(id, {
          scheduled_date: dateStr,
          scheduled_time: timeStr,
          duration: scheduleDuration,
        });
        
        // Reload item to show updated schedule
        await loadItem();
        setShowScheduleModal(false);
        Alert.alert('Success', 'Item scheduled successfully!');
      } else {
        Alert.alert('Error', 'Failed to schedule item. Please check calendar permissions.');
      }
    } catch (error) {
      console.error('Failed to schedule item:', error);
      Alert.alert('Error', 'Failed to schedule item');
    }
  }

  /**
   * Remove schedule
   */
  async function handleRemoveSchedule() {
    try {
      await updateItem(id, {
        scheduled_date: undefined,
        scheduled_time: undefined,
      });
      await loadItem();
      setShowScheduleModal(false);
      Alert.alert('Success', 'Schedule removed');
    } catch (error) {
      console.error('Failed to remove schedule:', error);
      Alert.alert('Error', 'Failed to remove schedule');
    }
  }

  /**
   * Handle back navigation
   */
  function handleBack() {
    // Navigate back to the source tab if specified
    if (from === 'stacks') {
      router.replace('/(tabs)' as any);
    } else if (from === 'streams' || from === 'reel') {
      router.replace('/(tabs)/reel' as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      // Default to stacks tab
      router.replace('/(tabs)' as any);
    }
  }

  /**
   * Swipe gesture handler
   * Only activates from the left edge and doesn't interfere with buttons
   */
  const panGesture = Gesture.Pan()
    .activeOffsetX([15, SCREEN_WIDTH]) // Only activate for rightward swipes
    .failOffsetY([-20, 20]) // Fail if vertical movement is too much
    .onStart((event) => {
      // Only activate if starting from the left edge (first 20px)
      // And not in the header area (where back button is)
      if (event.x <= EDGE_WIDTH && event.y > insets.top + 60) {
        translateX.value = 0;
        opacity.value = 1;
      }
    })
    .onUpdate((event) => {
      // Only process if started from left edge or already swiping
      if ((event.x <= EDGE_WIDTH && event.y > insets.top + 60) || translateX.value > 0) {
        translateX.value = Math.max(0, event.translationX);
        // Fade out as we swipe
        opacity.value = Math.max(0.3, 1 - translateX.value / SCREEN_WIDTH);
      }
    })
    .onEnd((event) => {
      if (translateX.value > SWIPE_THRESHOLD) {
        // Swipe was far enough, trigger back navigation
        translateX.value = withSpring(SCREEN_WIDTH, {
          damping: 20,
          stiffness: 90,
        }, () => {
          runOnJS(handleBack)();
        });
        opacity.value = withSpring(0);
      } else {
        // Swipe wasn't far enough, spring back
        translateX.value = withSpring(0);
        opacity.value = withSpring(1);
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
      opacity: opacity.value,
    };
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#ccc" />
        <Text style={styles.errorText}>Item not found</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={[styles.container, animatedStyle]}>
        {/* Header with Back Button - Outside gesture detector to ensure it works */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
            <Text style={styles.headerTitle}>Item Details</Text>
            <View style={styles.headerSpacer} />
          </View>

        {/* Gesture detector only wraps the scrollable content, not the header */}
        <GestureDetector gesture={panGesture}>
          <View style={{ flex: 1 }}>
            <ScrollView 
              style={styles.scrollView} 
              contentContainerStyle={styles.content}
              bounces={true}
              showsVerticalScrollIndicator={true}
            >
        {/* Image */}
        {item.imageUri && (
          <Image source={{ uri: item.imageUri }} style={styles.image} />
        )}

      {/* Item Header */}
      <View style={styles.itemHeader}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.classification}</Text>
        </View>
        <Text style={styles.timestamp}>
          {format(new Date(item.created_at), 'MMM d, yyyy · h:mm a')}
        </Text>
      </View>

      {/* Title */}
      <Text style={styles.title}>{item.title}</Text>

      {/* Description */}
      {item.description && (
        <Text style={styles.description}>{item.description}</Text>
      )}

      {/* Audio Player */}
      {item.audio_url && (
        <TouchableOpacity style={styles.audioPlayer} onPress={toggleAudio}>
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={48}
            color="#007AFF"
          />
          <Text style={styles.audioText}>
            {isPlaying ? 'Pause narration' : 'Play narration'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Metadata */}
      <View style={styles.metadata}>
        {item.duration && (
          <View style={styles.metadataItem}>
            <Ionicons name="time-outline" size={20} color="#666" />
            <Text style={styles.metadataText}>{item.duration} min</Text>
          </View>
        )}

        {item.url && (
          <TouchableOpacity style={styles.metadataItem} onPress={openUrl}>
            <Ionicons name="link-outline" size={20} color="#007AFF" />
            <Text style={[styles.metadataText, styles.link]}>Open link</Text>
          </TouchableOpacity>
        )}

        {item.place_name && (
          <View style={styles.metadataItem}>
            <Ionicons name="location-outline" size={20} color="#666" />
            <Text style={styles.metadataText}>{item.place_name}</Text>
          </View>
        )}
      </View>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <View style={styles.tagsSection}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <View style={styles.tags}>
            {item.tags.map((tag, index) => (
              <View key={index} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Scheduled Info */}
      {item.scheduled_date && (
        <View style={styles.scheduledSection}>
          <Ionicons name="calendar" size={24} color="#007AFF" />
          <View style={styles.scheduledInfo}>
            <Text style={styles.scheduledLabel}>Scheduled</Text>
            <Text style={styles.scheduledDate}>
              {format(new Date(item.scheduled_date), 'MMMM d, yyyy')}
              {item.scheduled_time && ` at ${item.scheduled_time}`}
            </Text>
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={handleSchedulePress}>
          <Ionicons name="calendar-outline" size={24} color="#007AFF" />
          <Text style={[styles.actionText, styles.scheduleText]}>
            {item.scheduled_date ? 'Reschedule' : 'Schedule'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleArchive}>
          <Ionicons name="archive-outline" size={24} color="#666" />
          <Text style={styles.actionText}>Archive</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={24} color="#ff3b30" />
          <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
        </TouchableOpacity>
      </View>
            </ScrollView>

            {/* Schedule Modal */}
            <Modal
        visible={showScheduleModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowScheduleModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Schedule Item</Text>
              <TouchableOpacity
                onPress={() => setShowScheduleModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {/* Date Picker */}
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowDatePicker(true)}
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
                onPress={() => setShowTimePicker(true)}
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
                      onPress={() => setScheduleDuration(duration)}
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
                        setScheduleTime(selectedTime);
                      }
                    }}
                    textColor={Platform.OS === 'ios' ? '#000000' : undefined}
                  />
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                {item.scheduled_date && (
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
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
            </Modal>
          </View>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    zIndex: 1000,
    elevation: 1000, // Android
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginLeft: -32, // Center by offsetting back button
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
  },
  image: {
    width: '100%',
    height: 300,
    backgroundColor: '#e0e0e0',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  badge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  audioText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginLeft: 12,
  },
  metadata: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataText: {
    fontSize: 16,
    color: '#666',
    marginLeft: 12,
  },
  link: {
    color: '#007AFF',
  },
  tagsSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  scheduledSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  scheduledInfo: {
    marginLeft: 12,
    flex: 1,
  },
  scheduledLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
  },
  scheduledDate: {
    fontSize: 16,
    color: '#333',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginLeft: 8,
  },
  deleteText: {
    color: '#ff3b30',
  },
  scheduleText: {
    color: '#007AFF',
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
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  removeButton: {
    backgroundColor: '#ff3b30',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  durationSection: {
    marginTop: 8,
    marginBottom: 12,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  durationOptionTextActive: {
    color: '#fff',
  },
});

