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

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  ActivityIndicator,
  Modal,
  Platform,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Item } from '@/lib/types';
import { getItemById, updateItem, deleteItem } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';
import { parseLocalDate } from '@/lib/datetime';
import PressableScale from '@/components/ui/PressableScale';
import { BRAND, GRADIENTS, HAIRLINE, INK, RADIUS } from '@/lib/theme';

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
  
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editingNotes, setEditingNotes] = useState('');
  const [saving, setSaving] = useState(false);
  
  // Swipe gesture values
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleDuration, setScheduleDuration] = useState(15);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const durationOptions = [15, 30, 45, 60];
  // Guards against a fast double-tap on "Save" (schedule) creating duplicate events.
  const savingScheduleRef = useRef(false);

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
      
      // Initialize editing state
      if (loadedItem) {
        setEditingTitle(loadedItem.title);
        setEditingDescription(loadedItem.description || '');
        setEditingNotes(loadedItem.notes || '');
      }
      
      // Don't auto-mark as viewed - user marks as done via swipe
      
      // If schedule param is true, open schedule modal after item loads
      if (schedule === 'true' && loadedItem) {
        // Pre-fill with existing schedule if available
        if (loadedItem.scheduled_date) {
          // parseLocalDate avoids the UTC off-by-one of `new Date('YYYY-MM-DD')`.
          setScheduleDate(parseLocalDate(loadedItem.scheduled_date));
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
   * Start editing mode
   */
  function handleStartEdit() {
    if (item) {
      setIsEditing(true);
      setEditingTitle(item.title);
      setEditingDescription(item.description || '');
      setEditingNotes(item.notes || '');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  /**
   * Cancel editing
   */
  function handleCancelEdit() {
    if (item) {
      setIsEditing(false);
      setEditingTitle(item.title);
      setEditingDescription(item.description || '');
      setEditingNotes(item.notes || '');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  /**
   * Save edits
   */
  async function handleSaveEdit() {
    if (!item || !editingTitle.trim()) {
      Alert.alert('Error', 'Title cannot be empty');
      return;
    }

    try {
      setSaving(true);
      await updateItem(id, {
        title: editingTitle.trim(),
        description: editingDescription.trim() || undefined,
        notes: editingNotes.trim() || undefined,
      });
      await loadItem();
      setIsEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Changes saved');
    } catch (error) {
      console.error('Failed to save edits:', error);
      Alert.alert('Error', 'Failed to save changes');
    } finally {
      setSaving(false);
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
        // parseLocalDate avoids the UTC off-by-one of `new Date('YYYY-MM-DD')`.
        setScheduleDate(parseLocalDate(item.scheduled_date));
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

    // In-flight guard: a fast double-tap must not create two calendar events.
    if (savingScheduleRef.current) return;
    savingScheduleRef.current = true;

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
    } finally {
      savingScheduleRef.current = false;
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
        <ActivityIndicator size="large" color={BRAND[600]} />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={INK[300]} />
        <Text style={styles.errorText}>Item not found</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[styles.container, animatedStyle]}>
        {/* Header with Back Button - Outside gesture detector to ensure it works */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
          <View style={styles.backButtonWrap}>
            <PressableScale
              haptic="light"
              style={styles.backButton}
              onPress={handleBack}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <Ionicons name="arrow-back" size={24} color={INK[700]} />
            </PressableScale>
          </View>
          <Text style={styles.headerTitle}>Item Details</Text>
          {!isEditing ? (
            <PressableScale
              haptic="light"
              style={styles.editButton}
              onPress={handleStartEdit}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="create-outline" size={24} color={BRAND[600]} />
            </PressableScale>
          ) : (
            <View style={styles.editActions}>
              <PressableScale
                haptic="light"
                style={styles.editActionButton}
                onPress={handleCancelEdit}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.editActionText}>Cancel</Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                style={[styles.editActionButton, styles.saveButtonHeader]}
                onPress={handleSaveEdit}
                disabled={saving}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonTextHeader}>Save</Text>
                )}
              </PressableScale>
            </View>
          )}
        </View>

        {/* Gesture detector only wraps the scrollable content, not the header */}
        <GestureDetector gesture={panGesture}>
          <KeyboardAvoidingView 
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={insets.top + 60}
          >
            <ScrollView 
              style={styles.scrollView} 
              contentContainerStyle={styles.content}
              bounces={true}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
        {/* Image */}
        {item.imageUri && (
          <Image source={{ uri: item.imageUri }} style={styles.image} />
        )}

      {/* Item Header */}
      <View style={styles.itemHeader}>
        <LinearGradient
          colors={GRADIENTS.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.badge}
        >
          <Text style={styles.badgeText}>{item.classification}</Text>
        </LinearGradient>
        <Text style={styles.timestamp}>
          {format(new Date(item.created_at), 'MMM d, yyyy · h:mm a')}
        </Text>
      </View>

      {/* Title */}
      {isEditing ? (
        <View style={styles.editingSection}>
          <Text style={styles.editingLabel}>Title</Text>
          <TextInput
            style={styles.editingInput}
            value={editingTitle}
            onChangeText={setEditingTitle}
            placeholder="Item title"
            placeholderTextColor={INK[400]}
            multiline={false}
          />
        </View>
      ) : (
        <Text style={styles.title}>{item.title}</Text>
      )}

      {/* Description */}
      {isEditing ? (
        <View style={styles.editingSection}>
          <Text style={styles.editingLabel}>Description</Text>
          <TextInput
            style={[styles.editingInput, styles.editingTextArea]}
            value={editingDescription}
            onChangeText={setEditingDescription}
            placeholder="Add a description..."
            placeholderTextColor={INK[400]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>
      ) : (
        item.description && (
          <Text style={styles.description}>{item.description}</Text>
        )
      )}

      {/* Audio Player */}
      {item.audio_url && (
        <PressableScale haptic="light" style={styles.audioPlayer} onPress={toggleAudio}>
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={48}
            color={BRAND[600]}
          />
          <Text style={styles.audioText}>
            {isPlaying ? 'Pause narration' : 'Play narration'}
          </Text>
        </PressableScale>
      )}

      {/* Metadata */}
      <View style={styles.metadata}>
        {item.duration && (
          <View style={styles.metadataItem}>
            <Ionicons name="time-outline" size={20} color={INK[500]} />
            <Text style={styles.metadataText}>{item.duration} min</Text>
          </View>
        )}

        {item.url && (
          <PressableScale haptic="light" style={styles.metadataItem} onPress={openUrl}>
            <Ionicons name="link-outline" size={20} color={BRAND[600]} />
            <Text style={[styles.metadataText, styles.link]}>Open link</Text>
          </PressableScale>
        )}

        {item.place_name && (
          <View style={styles.metadataItem}>
            <Ionicons name="location-outline" size={20} color={INK[500]} />
            <Text style={styles.metadataText}>{item.place_name}</Text>
          </View>
        )}
      </View>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <View style={styles.tagsSection}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <View style={styles.tags}>
            {item.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Checklist Section */}
      {item.checklist && item.checklist.length > 0 && (
        <View style={styles.checklistSection}>
          <View style={styles.checklistHeader}>
            <Ionicons 
              name={item.classification === 'fitness' ? 'fitness-outline' : 
                    item.classification === 'food' ? 'restaurant-outline' :
                    item.classification === 'academia' ? 'school-outline' :
                    item.classification === 'career' ? 'briefcase-outline' : 'checkmark-circle-outline'}
              size={20}
              color={INK[500]}
            />
            <Text style={styles.sectionTitle}>
              {item.classification === 'fitness' ? 'Workout Steps' :
               item.classification === 'food' ? 'Ingredients' :
               item.classification === 'academia' ? 'Study Checklist' :
               item.classification === 'career' ? 'Preparation Checklist' : 'Checklist'}
            </Text>
            {item.checklist.filter(c => c.completed).length > 0 && (
              <Text style={styles.checklistProgress}>
                {item.checklist.filter(c => c.completed).length} / {item.checklist.length}
              </Text>
            )}
          </View>
          <View style={styles.checklistItems}>
            {item.checklist.map((checklistItem) => (
              <PressableScale
                key={checklistItem.id}
                style={styles.checklistItem}
                onPress={async () => {
                  if (!item) return;
                  const updatedChecklist = item.checklist!.map(c =>
                    c.id === checklistItem.id ? { ...c, completed: !c.completed } : c
                  );
                  await updateItem(id, { checklist: updatedChecklist });
                  await loadItem();
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[
                  styles.checklistCheckbox,
                  checklistItem.completed && styles.checklistCheckboxCompleted
                ]}>
                  {checklistItem.completed && (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </View>
                <Text style={[
                  styles.checklistText,
                  checklistItem.completed && styles.checklistTextCompleted
                ]}>
                  {checklistItem.text}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>
      )}

      {/* Notes Section */}
      <View style={styles.notesSection}>
        <View style={styles.notesHeader}>
          <Ionicons name="document-text-outline" size={20} color={INK[500]} />
          <Text style={styles.sectionTitle}>Personal Notes</Text>
        </View>
        {isEditing ? (
          <TextInput
            style={[styles.notesInput, styles.editingTextArea]}
            value={editingNotes}
            onChangeText={setEditingNotes}
            placeholder="Add your personal notes, thoughts, or comments here..."
            placeholderTextColor={INK[400]}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        ) : (
          <View style={styles.notesContent}>
            {item.notes ? (
              <Text style={styles.notesText}>{item.notes}</Text>
            ) : (
              <Text style={styles.notesPlaceholder}>
                Tap the edit button to add personal notes
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Scheduled Info */}
      {item.scheduled_date && (
        <View style={styles.scheduledSection}>
          <Ionicons name="calendar" size={24} color={BRAND[600]} />
          <View style={styles.scheduledInfo}>
            <Text style={styles.scheduledLabel}>Scheduled</Text>
            <Text style={styles.scheduledDate}>
              {format(parseLocalDate(item.scheduled_date), 'MMMM d, yyyy')}
              {item.scheduled_time && ` at ${item.scheduled_time}`}
            </Text>
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <View style={styles.actionWrap}>
          <PressableScale haptic="light" style={styles.actionButton} onPress={handleSchedulePress}>
            <Ionicons name="calendar-outline" size={24} color={BRAND[600]} />
            <Text style={[styles.actionText, styles.scheduleText]}>
              {item.scheduled_date ? 'Reschedule' : 'Schedule'}
            </Text>
          </PressableScale>
        </View>

        <View style={styles.actionWrap}>
          <PressableScale haptic="light" style={styles.actionButton} onPress={handleArchive}>
            <Ionicons name="archive-outline" size={24} color={INK[500]} />
            <Text style={styles.actionText}>Archive</Text>
          </PressableScale>
        </View>

        <View style={styles.actionWrap}>
          <PressableScale haptic="light" style={styles.actionButton} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={24} color="#ef4444" />
            <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
          </PressableScale>
        </View>
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
              <PressableScale
                haptic="light"
                onPress={() => setShowScheduleModal(false)}
                style={styles.modalCloseButton}
              >
                <Ionicons name="close" size={24} color={INK[700]} />
              </PressableScale>
            </View>

            <View style={styles.modalBody}>
              {/* Date Picker */}
              <PressableScale
                haptic="light"
                style={styles.pickerButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={24} color={BRAND[600]} />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Date</Text>
                  <Text style={styles.pickerValue}>
                    {format(scheduleDate, 'MMMM d, yyyy')}
                  </Text>
                </View>
              </PressableScale>

              {/* Time Picker */}
              <PressableScale
                haptic="light"
                style={styles.pickerButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Ionicons name="time-outline" size={24} color={BRAND[600]} />
                <View style={styles.pickerContent}>
                  <Text style={styles.pickerLabel}>Time</Text>
                  <Text style={styles.pickerValue}>
                    {format(scheduleTime, 'h:mm a')}
                  </Text>
                </View>
              </PressableScale>

              {/* Duration Picker */}
              <View style={styles.durationSection}>
                <Text style={styles.pickerLabel}>Duration</Text>
                <View style={styles.durationOptions}>
                  {durationOptions.map((duration) => (
                    <View key={duration} style={styles.durationWrap}>
                      <PressableScale
                        haptic="selection"
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
                      </PressableScale>
                    </View>
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
                  <View style={styles.modalButtonWrap}>
                    <PressableScale
                      haptic="light"
                      style={[styles.modalButton, styles.removeButton]}
                      onPress={handleRemoveSchedule}
                    >
                      <Text style={styles.removeButtonText}>Remove Schedule</Text>
                    </PressableScale>
                  </View>
                )}
                <View style={styles.modalButtonWrap}>
                  <PressableScale haptic="light" onPress={handleSaveSchedule}>
                    <LinearGradient
                      colors={GRADIENTS.brand}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.modalButton, styles.saveButton]}
                    >
                      <Text style={styles.saveButtonText}>Save</Text>
                    </LinearGradient>
                  </PressableScale>
                </View>
              </View>
            </View>
          </View>
        </View>
            </Modal>
          </KeyboardAvoidingView>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND[50],
  },
  pickerContainer: {
    marginVertical: 16,
    backgroundColor: '#ffffff',
    borderRadius: RADIUS.lg,
    padding: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  backButtonWrap: {
    zIndex: 1000,
    elevation: 1000, // Android
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: INK[900],
    textAlign: 'center',
    marginLeft: -32, // Center by offsetting back button
  },
  editButton: {
    padding: 8,
    marginRight: -8,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: -8,
  },
  editActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  saveButtonHeader: {
    backgroundColor: BRAND[600],
    paddingHorizontal: 16,
  },
  editActionText: {
    fontSize: 16,
    color: INK[500],
    fontWeight: '600',
  },
  saveButtonTextHeader: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
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
    backgroundColor: BRAND[50],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BRAND[50],
  },
  errorText: {
    fontSize: 18,
    color: INK[500],
    marginTop: 16,
  },
  image: {
    width: '100%',
    height: 300,
    backgroundColor: INK[100],
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timestamp: {
    fontSize: 12,
    color: INK[400],
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: INK[900],
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: INK[500],
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
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  audioText: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND[600],
    marginLeft: 12,
  },
  metadata: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
    gap: 12,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataText: {
    fontSize: 16,
    color: INK[600],
    marginLeft: 12,
  },
  link: {
    color: BRAND[600],
  },
  tagsSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: INK[900],
    marginBottom: 12,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: BRAND[600],
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
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
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  scheduledInfo: {
    marginLeft: 12,
    flex: 1,
  },
  scheduledLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: INK[400],
    textTransform: 'uppercase',
  },
  scheduledDate: {
    fontSize: 16,
    color: INK[800],
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    gap: 12,
  },
  actionWrap: {
    flex: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: INK[500],
    marginLeft: 8,
  },
  deleteText: {
    color: '#ef4444',
  },
  scheduleText: {
    color: BRAND[600],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: INK[900],
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
    backgroundColor: BRAND[50],
    padding: 16,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: HAIRLINE,
    marginBottom: 12,
  },
  pickerContent: {
    marginLeft: 12,
    flex: 1,
  },
  pickerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: INK[400],
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pickerValue: {
    fontSize: 16,
    fontWeight: '600',
    color: INK[800],
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalButtonWrap: {
    flex: 1,
  },
  modalButton: {
    padding: 16,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  saveButton: {
    overflow: 'hidden',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  removeButton: {
    backgroundColor: '#ef4444',
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
  durationWrap: {
    flex: 1,
  },
  durationOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: RADIUS.md,
    backgroundColor: BRAND[50],
    borderWidth: 1,
    borderColor: HAIRLINE,
    alignItems: 'center',
  },
  durationOptionActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
  },
  durationOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: INK[500],
  },
  durationOptionTextActive: {
    color: '#fff',
  },
  editingSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  editingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: INK[500],
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  editingInput: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 16,
    fontSize: 16,
    color: INK[900],
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  editingTextArea: {
    minHeight: 100,
    maxHeight: 200,
  },
  notesSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  notesInput: {
    backgroundColor: INK[50],
    borderRadius: RADIUS.sm,
    padding: 12,
    fontSize: 16,
    color: INK[900],
    borderWidth: 1,
    borderColor: HAIRLINE,
    minHeight: 120,
  },
  notesContent: {
    minHeight: 60,
  },
  notesText: {
    fontSize: 16,
    color: INK[800],
    lineHeight: 24,
  },
  notesPlaceholder: {
    fontSize: 14,
    color: INK[400],
    fontStyle: 'italic',
  },
  checklistSection: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  checklistProgress: {
    fontSize: 14,
    color: BRAND[600],
    fontWeight: '600',
    marginLeft: 'auto',
  },
  checklistItems: {
    gap: 8,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  checklistCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: INK[300],
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checklistCheckboxCompleted: {
    backgroundColor: BRAND[500],
    borderColor: BRAND[500],
  },
  checklistText: {
    flex: 1,
    fontSize: 16,
    color: INK[800],
    lineHeight: 22,
  },
  checklistTextCompleted: {
    textDecorationLine: 'line-through',
    color: INK[400],
  },
});

