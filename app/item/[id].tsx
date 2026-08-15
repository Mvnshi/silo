/**
 * Item Detail Screen
 *
 * Full view of a single saved item: hero image with rubber-band parallax,
 * metadata, inline editing, checklist, personal notes, and the
 * schedule / archive / delete action row.
 *
 * Navigation: the root Stack owns the push transition AND the interactive
 * edge-swipe back gesture. This screen must not re-implement either — its only
 * back affordance is the shared <ScreenHeader />, which every state (loading /
 * not found / loaded) renders so the screen is never a dead end.
 *
 * Confirmation model: a completed action is confirmed by the re-rendered state
 * plus a haptic, never by an "OK" alert. Delete applies immediately and is
 * undoable from a toast; Archive still asks, because it is a filing decision
 * the user may not be picturing correctly.
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
  Alert,
  Linking,
  ActivityIndicator,
  Modal,
  Platform,
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
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { Item, ItemType } from '@/lib/types';
import {
  addItem,
  clearTombstones,
  deleteItem,
  getItemById,
  touchSeen,
  updateItem,
} from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';
import { parseLocalDate } from '@/lib/datetime';
import { classConfig } from '@/lib/classification';
import { usePrefersReducedMotion } from '@/lib/motion';
import PressableScale from '@/components/ui/PressableScale';
import ScreenHeader from '@/components/ui/ScreenHeader';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import {
  BRAND,
  GRADIENTS,
  HAIRLINE,
  HIT_SLOP,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  STATUS,
  SURFACE,
  TEXT,
  TYPE,
} from '@/lib/theme';

const HERO_HEIGHT = 300;

/** Animating expo-image directly keeps its caching + contentFit on the hero. */
const AnimatedImage = Animated.createAnimatedComponent(Image);

/**
 * The header sits on top of the hero, so its ink glyphs need guaranteed
 * contrast over an arbitrary photo. A soft white wash does that without the
 * "always solid bar" look; the real bar background fades in over it on scroll.
 * (Not in GRADIENTS — every shared scrim there is dark, for white glyphs.)
 */
const HEADER_SCRIM = ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0)'] as const;

/** What the user saved, in their words — the header title. */
const TYPE_LABEL: Record<ItemType, string> = {
  link: 'Saved link',
  screenshot: 'Screenshot',
  note: 'Note',
};

export default function ItemDetailScreen() {
  const { id, schedule } = useLocalSearchParams<{ id: string; schedule?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
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

  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [scheduleTime, setScheduleTime] = useState(new Date());
  const [scheduleDuration, setScheduleDuration] = useState(15);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const durationOptions = [15, 30, 45, 60];
  // Guards against a fast double-tap on "Save" (schedule) creating duplicate events.
  const savingScheduleRef = useRef(false);

  // Hero parallax + header fade both read the same scroll offset.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  /**
   * Rubber-band hero: pulling down grows the image into the gap it leaves
   * instead of exposing the page background. Scrolling up is clamped so the
   * image just travels away normally.
   */
  const heroStyle = useAnimatedStyle(() => {
    const translateY = reduced
      ? 0
      : interpolate(scrollY.value, [-HERO_HEIGHT, 0], [-HERO_HEIGHT / 2, 0], 'clamp');
    const scale = reduced
      ? 1
      : interpolate(scrollY.value, [-HERO_HEIGHT, 0], [1.6, 1], 'clamp');
    return { transform: [{ translateY }, { scale }] };
  }, [reduced]);

  // Bar background appears as the title scrolls under it. Forced on while
  // editing, where legible Cancel/Save matters more than the hero.
  const headerBgStyle = useAnimatedStyle(
    () => ({
      opacity: isEditing ? 1 : interpolate(scrollY.value, [180, 240], [0, 1], 'clamp'),
    }),
    [isEditing]
  );

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

      // Record the open so the staleness nudge (lib/resurface) knows this card
      // was just on screen. Ambient + local — never blocks the load.
      if (loadedItem) touchSeen(id).catch(() => {});

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
      toast.show({ tone: 'danger', message: "We couldn't open that save." });
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
      toast.show({ tone: 'danger', message: 'Give it a title first.' });
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
      // The fields collapsing back to read mode IS the confirmation.
      setIsEditing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to save edits:', error);
      toast.show({ tone: 'danger', message: "Couldn't save your changes." });
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
      toast.show({ tone: 'danger', message: "That narration wouldn't play." });
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
   * Archive item. Still a confirm: archiving is a filing decision, and "where
   * did it go?" is a worse outcome than one extra tap.
   */
  async function handleArchive() {
    Alert.alert('Tuck this away?', 'You can find it again in Archive.', [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Archive',
        onPress: async () => {
          try {
            await updateItem(id, { archived: true });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            handleBack();
          } catch (error) {
            console.error('Failed to archive item:', error);
            toast.show({ tone: 'danger', message: "Couldn't archive that." });
          }
        },
      },
    ]);
  }

  /**
   * Delete item — applied immediately, undoable from the toast. Undo also drops
   * the tombstone storage wrote, so the delete is never replayed to other
   * devices on the next sync.
   */
  async function handleDelete() {
    if (!item) return;
    const snapshot = item;

    try {
      await deleteItem(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toast.show({
        tone: 'danger',
        message: `Deleted "${snapshot.title}"`,
        action: {
          label: 'Undo',
          onPress: async () => {
            await clearTombstones([snapshot.id]);
            await addItem(snapshot);
          },
        },
      });
      handleBack();
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.show({ tone: 'danger', message: "Couldn't delete that." });
    }
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Worth a toast: the calendar write happens off-screen, so the in-app
        // "Scheduled" card alone doesn't tell you the event actually landed.
        toast.show({ tone: 'success', message: 'Added to your calendar.' });
      } else {
        toast.show({
          tone: 'danger',
          message: "Couldn't reach your calendar. Check calendar access in Settings.",
        });
      }
    } catch (error) {
      console.error('Failed to schedule item:', error);
      toast.show({ tone: 'danger', message: "Couldn't schedule that." });
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
      // The "Scheduled" card disappearing is the confirmation.
      setShowScheduleModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Failed to remove schedule:', error);
      toast.show({ tone: 'danger', message: "Couldn't remove that schedule." });
    }
  }

  /**
   * Handle back navigation. `replace` is only the cold-deep-link fallback —
   * popping the stack is what preserves the list's scroll and filter state.
   */
  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  }

  if (loading) {
    // Content-shaped placeholder in the real layout, so nothing jumps when the
    // item lands: hero, title, two description lines, the 3-up action row.
    return (
      <View style={styles.container}>
        <ScreenHeader />
        <View accessibilityLabel="Loading item" accessible>
          <Skeleton width="100%" height={HERO_HEIGHT} radius={0} />
          <View style={styles.skeletonBody}>
            <Skeleton width="70%" height={24} />
            <Skeleton width="100%" height={16} />
            <Skeleton width="85%" height={16} />
            <View style={styles.skeletonRow}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.skeletonCell}>
                  <Skeleton width="100%" height={56} radius={RADIUS.lg} />
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.container}>
        <ScreenHeader />
        <EmptyState
          icon="alert-circle-outline"
          title="We couldn't find that save"
          subtitle="It may have been deleted on another device."
          cta={{ label: 'Back to your stacks', onPress: () => router.replace('/(tabs)' as never) }}
        />
      </View>
    );
  }

  const cfg = classConfig(item.classification);
  const hasHero = !!item.imageUri;

  const header = (
    <ScreenHeader
      transparent={hasHero}
      // While editing the slot holds Cancel + Save, which overhang the centred
      // title — so the title steps aside rather than sitting underneath.
      eyebrow={isEditing ? undefined : cfg.label}
      title={isEditing ? undefined : TYPE_LABEL[item.type]}
      right={
        isEditing ? (
          <View style={styles.editActions}>
            <PressableScale
              haptic="light"
              style={styles.editActionButton}
              onPress={handleCancelEdit}
              accessibilityLabel="Discard changes"
            >
              <Text style={styles.editActionText}>Cancel</Text>
            </PressableScale>
            <PressableScale
              haptic="light"
              style={[styles.editActionButton, styles.saveButtonHeader]}
              onPress={handleSaveEdit}
              disabled={saving}
              accessibilityLabel="Save changes"
            >
              {saving ? (
                <ActivityIndicator size="small" color={TEXT.inverse} />
              ) : (
                <Text style={styles.saveButtonTextHeader}>Save</Text>
              )}
            </PressableScale>
          </View>
        ) : (
          <PressableScale
            haptic="light"
            onPress={handleStartEdit}
            hitSlop={HIT_SLOP}
            accessibilityLabel="Edit this save"
          >
            <Ionicons name="create-outline" size={24} color={BRAND[600]} />
          </PressableScale>
        )
      }
    />
  );

  return (
    <View style={styles.container}>
      {!hasHero && header}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 60}
      >
        <Animated.ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: insets.bottom + SPACE.xxl }}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          bounces
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          {item.imageUri && (
            <AnimatedImage
              source={{ uri: item.imageUri }}
              style={[styles.image, heroStyle]}
              contentFit="cover"
            />
          )}

          {/* Item Header */}
          <View style={styles.itemHeader}>
            <View style={[styles.badge, { backgroundColor: cfg.from + '1A' }]}>
              <Ionicons name={cfg.icon} size={12} color={cfg.deep} />
              <Text style={[styles.badgeText, { color: cfg.deep }]}>{cfg.label}</Text>
            </View>
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
                placeholderTextColor={TEXT.placeholder}
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
                placeholderTextColor={TEXT.placeholder}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          ) : (
            item.description && <Text style={styles.description}>{item.description}</Text>
          )}

          {/* Audio Player */}
          {item.audio_url && (
            <PressableScale
              haptic="light"
              style={styles.audioPlayer}
              onPress={toggleAudio}
              accessibilityLabel={isPlaying ? 'Pause narration' : 'Play narration'}
            >
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
                <Ionicons name="time-outline" size={20} color={TEXT.decorative} />
                <Text style={styles.metadataText}>{item.duration} min</Text>
              </View>
            )}

            {item.url && (
              <PressableScale
                haptic="light"
                style={styles.metadataItem}
                onPress={openUrl}
                accessibilityLabel="Open link in browser"
              >
                <Ionicons name="link-outline" size={20} color={BRAND[600]} />
                <Text style={[styles.metadataText, styles.link]}>Open link</Text>
              </PressableScale>
            )}

            {item.place_name && (
              <View style={styles.metadataItem}>
                <Ionicons name="location-outline" size={20} color={TEXT.decorative} />
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
                  name={
                    item.classification === 'fitness'
                      ? 'fitness-outline'
                      : item.classification === 'food'
                        ? 'restaurant-outline'
                        : item.classification === 'academia'
                          ? 'school-outline'
                          : item.classification === 'career'
                            ? 'briefcase-outline'
                            : 'checkmark-circle-outline'
                  }
                  size={20}
                  color={TEXT.decorative}
                />
                <Text style={styles.sectionTitle}>
                  {item.classification === 'fitness'
                    ? 'Workout Steps'
                    : item.classification === 'food'
                      ? 'Ingredients'
                      : item.classification === 'academia'
                        ? 'Study Checklist'
                        : item.classification === 'career'
                          ? 'Preparation Checklist'
                          : 'Checklist'}
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
                    scaleTo={0.985}
                    style={styles.checklistItem}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: checklistItem.completed }}
                    accessibilityLabel={checklistItem.text}
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
                    <View
                      style={[
                        styles.checklistCheckbox,
                        checklistItem.completed && styles.checklistCheckboxCompleted,
                      ]}
                    >
                      {checklistItem.completed && (
                        <Ionicons name="checkmark" size={16} color={TEXT.inverse} />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.checklistText,
                        checklistItem.completed && styles.checklistTextCompleted,
                      ]}
                    >
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
              <Ionicons name="document-text-outline" size={20} color={TEXT.decorative} />
              <Text style={styles.sectionTitle}>Personal Notes</Text>
            </View>
            {isEditing ? (
              <TextInput
                style={[styles.notesInput, styles.editingTextArea]}
                value={editingNotes}
                onChangeText={setEditingNotes}
                placeholder="Add your personal notes, thoughts, or comments here..."
                placeholderTextColor={TEXT.placeholder}
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
            <PressableScale
              haptic="light"
              containerStyle={styles.actionWrap}
              style={styles.actionButton}
              onPress={handleSchedulePress}
              accessibilityLabel={item.scheduled_date ? 'Reschedule this save' : 'Schedule this save'}
            >
              <Ionicons name="calendar-outline" size={24} color={BRAND[600]} />
              <Text style={[styles.actionText, styles.scheduleText]}>
                {item.scheduled_date ? 'Reschedule' : 'Schedule'}
              </Text>
            </PressableScale>

            <PressableScale
              haptic="light"
              containerStyle={styles.actionWrap}
              style={styles.actionButton}
              onPress={handleArchive}
              accessibilityLabel="Archive this save"
            >
              <Ionicons name="archive-outline" size={24} color={TEXT.secondary} />
              <Text style={styles.actionText}>Archive</Text>
            </PressableScale>

            <PressableScale
              haptic="light"
              containerStyle={styles.actionWrap}
              style={styles.actionButton}
              onPress={handleDelete}
              accessibilityLabel="Delete this save"
            >
              <Ionicons name="trash-outline" size={24} color={STATUS.danger} />
              <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
            </PressableScale>
          </View>
        </Animated.ScrollView>

        {/* Schedule Modal */}
        <Modal
          visible={showScheduleModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowScheduleModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: insets.bottom + SPACE.xxl }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Schedule Item</Text>
                <PressableScale
                  haptic="light"
                  onPress={() => setShowScheduleModal(false)}
                  style={styles.modalCloseButton}
                  accessibilityLabel="Close scheduler"
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
                  accessibilityLabel={`Date, ${format(scheduleDate, 'MMMM d, yyyy')}`}
                >
                  <Ionicons name="calendar-outline" size={24} color={BRAND[600]} />
                  <View style={styles.pickerContent}>
                    <Text style={styles.pickerLabel}>Date</Text>
                    <Text style={styles.pickerValue}>{format(scheduleDate, 'MMMM d, yyyy')}</Text>
                  </View>
                </PressableScale>

                {/* Time Picker */}
                <PressableScale
                  haptic="light"
                  style={styles.pickerButton}
                  onPress={() => setShowTimePicker(true)}
                  accessibilityLabel={`Time, ${format(scheduleTime, 'h:mm a')}`}
                >
                  <Ionicons name="time-outline" size={24} color={BRAND[600]} />
                  <View style={styles.pickerContent}>
                    <Text style={styles.pickerLabel}>Time</Text>
                    <Text style={styles.pickerValue}>{format(scheduleTime, 'h:mm a')}</Text>
                  </View>
                </PressableScale>

                {/* Duration Picker */}
                <View style={styles.durationSection}>
                  <Text style={styles.pickerLabel}>Duration</Text>
                  <View style={styles.durationOptions}>
                    {durationOptions.map((duration) => (
                      <PressableScale
                        key={duration}
                        haptic="selection"
                        containerStyle={styles.durationWrap}
                        selected={scheduleDuration === duration}
                        accessibilityLabel={`${duration} minutes`}
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
                      textColor={Platform.OS === 'ios' ? INK[900] : undefined}
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
                      textColor={Platform.OS === 'ios' ? INK[900] : undefined}
                    />
                  </View>
                )}

                {/* Action Buttons */}
                <View style={styles.modalActions}>
                  {item.scheduled_date && (
                    <PressableScale
                      haptic="light"
                      containerStyle={styles.modalButtonWrap}
                      style={[styles.modalButton, styles.removeButton]}
                      onPress={handleRemoveSchedule}
                      accessibilityLabel="Remove schedule"
                    >
                      <Text style={styles.removeButtonText}>Remove Schedule</Text>
                    </PressableScale>
                  )}
                  <PressableScale
                    haptic="light"
                    containerStyle={styles.modalButtonWrap}
                    onPress={handleSaveSchedule}
                    accessibilityLabel="Save schedule"
                  >
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
        </Modal>
      </KeyboardAvoidingView>

      {hasHero && (
        <View style={styles.headerFloat} pointerEvents="box-none">
          <LinearGradient
            colors={HEADER_SCRIM}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.headerFloatBg, headerBgStyle]}
            pointerEvents="none"
          />
          {header}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: BRAND[50],
  },
  headerFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  headerFloatBg: {
    backgroundColor: SURFACE.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  pickerContainer: {
    marginVertical: SPACE.base,
    backgroundColor: SURFACE.card,
    borderRadius: RADIUS.lg,
    padding: SPACE.sm,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.hairline,
  },
  // Overhangs the header's 44pt right slot on purpose — the title is hidden
  // while editing, so there is nothing underneath to collide with.
  editActions: {
    width: 160,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  editActionButton: {
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs + 2,
    borderRadius: RADIUS.pill,
  },
  saveButtonHeader: {
    backgroundColor: BRAND[600],
    paddingHorizontal: SPACE.base,
  },
  editActionText: {
    ...TYPE.bodyStrong,
    color: TEXT.secondary,
  },
  saveButtonTextHeader: {
    ...TYPE.bodyStrong,
    color: TEXT.inverse,
  },
  skeletonBody: {
    padding: SPACE.base,
    gap: SPACE.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginTop: SPACE.sm,
  },
  skeletonCell: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: HERO_HEIGHT,
    backgroundColor: INK[100],
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACE.base,
    paddingBottom: SPACE.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs + 2,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs + 2,
    borderRadius: RADIUS.pill,
  },
  badgeText: {
    ...TYPE.overline,
  },
  timestamp: {
    ...TYPE.caption,
    fontWeight: '500',
    color: TEXT.tertiary,
  },
  title: {
    ...TYPE.title1,
    color: TEXT.primary,
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.md,
  },
  description: {
    ...TYPE.body,
    color: TEXT.secondary,
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.base,
  },
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE.card,
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  audioText: {
    ...TYPE.bodyStrong,
    color: BRAND[600],
    marginLeft: SPACE.md,
  },
  metadata: {
    backgroundColor: SURFACE.card,
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
    gap: SPACE.md,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataText: {
    ...TYPE.body,
    color: TEXT.secondary,
    marginLeft: SPACE.md,
  },
  link: {
    color: TEXT.brand,
    fontWeight: '600',
  },
  tagsSection: {
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.base,
  },
  sectionTitle: {
    ...TYPE.headline,
    color: TEXT.primary,
    marginBottom: SPACE.md,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: BRAND[600],
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.xs + 2,
    borderRadius: RADIUS.pill,
    marginRight: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  tagText: {
    ...TYPE.subhead,
    color: TEXT.inverse,
  },
  scheduledSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE.card,
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  scheduledInfo: {
    marginLeft: SPACE.md,
    flex: 1,
  },
  scheduledLabel: {
    ...TYPE.overline,
    color: TEXT.tertiary,
  },
  scheduledDate: {
    ...TYPE.body,
    color: TEXT.primary,
    marginTop: SPACE.xxs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: SPACE.base,
    gap: SPACE.md,
  },
  actionWrap: {
    flex: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE.card,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  actionText: {
    ...TYPE.subhead,
    color: TEXT.secondary,
    marginLeft: SPACE.sm,
  },
  deleteText: {
    color: STATUS.danger,
  },
  scheduleText: {
    color: TEXT.brand,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: SURFACE.scrim,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: SURFACE.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
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
    ...TYPE.title3,
    color: TEXT.primary,
  },
  modalCloseButton: {
    padding: SPACE.xs,
  },
  modalBody: {
    padding: SPACE.base,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND[50],
    padding: SPACE.base,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: HAIRLINE,
    marginBottom: SPACE.md,
  },
  pickerContent: {
    marginLeft: SPACE.md,
    flex: 1,
  },
  pickerLabel: {
    ...TYPE.overline,
    color: TEXT.tertiary,
    marginBottom: SPACE.xs,
  },
  pickerValue: {
    ...TYPE.bodyStrong,
    color: TEXT.primary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginTop: SPACE.sm,
  },
  modalButtonWrap: {
    flex: 1,
  },
  modalButton: {
    padding: SPACE.base,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  saveButton: {
    overflow: 'hidden',
  },
  saveButtonText: {
    ...TYPE.bodyStrong,
    fontWeight: '700',
    color: TEXT.inverse,
  },
  removeButton: {
    backgroundColor: STATUS.danger,
  },
  removeButtonText: {
    ...TYPE.bodyStrong,
    color: TEXT.inverse,
  },
  durationSection: {
    marginTop: SPACE.sm,
    marginBottom: SPACE.md,
  },
  durationOptions: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.sm,
  },
  durationWrap: {
    flex: 1,
  },
  durationOption: {
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.base,
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
    ...TYPE.subhead,
    color: TEXT.secondary,
  },
  durationOptionTextActive: {
    color: TEXT.inverse,
  },
  editingSection: {
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.base,
  },
  editingLabel: {
    ...TYPE.overline,
    color: TEXT.tertiary,
    marginBottom: SPACE.sm,
  },
  editingInput: {
    backgroundColor: SURFACE.card,
    borderRadius: RADIUS.md,
    padding: SPACE.base,
    ...TYPE.body,
    color: TEXT.primary,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  editingTextArea: {
    minHeight: 100,
    maxHeight: 200,
  },
  notesSection: {
    backgroundColor: SURFACE.card,
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACE.md,
    gap: SPACE.sm,
  },
  notesInput: {
    backgroundColor: SURFACE.sunken,
    borderRadius: RADIUS.sm,
    padding: SPACE.md,
    ...TYPE.body,
    color: TEXT.primary,
    borderWidth: 1,
    borderColor: HAIRLINE,
    minHeight: 120,
  },
  notesContent: {
    minHeight: 60,
  },
  notesText: {
    ...TYPE.body,
    color: TEXT.primary,
  },
  notesPlaceholder: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
    fontStyle: 'italic',
  },
  checklistSection: {
    backgroundColor: SURFACE.card,
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  checklistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACE.md,
    gap: SPACE.sm,
  },
  checklistProgress: {
    ...TYPE.subhead,
    color: TEXT.brand,
    marginLeft: 'auto',
  },
  checklistItems: {
    gap: SPACE.sm,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACE.sm,
    gap: SPACE.md,
  },
  checklistCheckbox: {
    width: 24,
    height: 24,
    borderRadius: RADIUS.xs,
    borderWidth: 2,
    borderColor: INK[300],
    backgroundColor: SURFACE.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checklistCheckboxCompleted: {
    backgroundColor: BRAND[500],
    borderColor: BRAND[500],
  },
  checklistText: {
    flex: 1,
    ...TYPE.body,
    color: TEXT.primary,
  },
  checklistTextCompleted: {
    textDecorationLine: 'line-through',
    color: TEXT.tertiary,
  },
});
