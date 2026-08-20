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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Linking,
  ActivityIndicator,
  Dimensions,
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
import { scheduleItemReview, unscheduleItem } from '@/lib/scheduler';
import { parseLocalDate } from '@/lib/datetime';
import { classConfig } from '@/lib/classification';
import { usePrefersReducedMotion } from '@/lib/motion';
import PressableScale from '@/components/ui/PressableScale';
import ScreenHeader from '@/components/ui/ScreenHeader';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import Glass, { GlassGroup } from '@/components/ui/Glass';
import { useToast } from '@/components/ui/Toast';
import {
  BRAND,
  GRADIENTS,
  HIT_SLOP,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  STATUS,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

/**
 * 16:9, not a square-ish 300.
 *
 * Two reasons. It matches the aspect of the media most saves actually are, and
 * — less obviously — it crops YouTube's letterbox. `hqdefault.jpg` (the only
 * thumbnail oEmbed hands back) is a 4:3 canvas with black bars baked in above
 * and below the frame. Rendered `cover` into a 4:3 box those bars survive as a
 * black band under the hero; rendered into 16:9 they are exactly what gets
 * cropped away.
 */
const HERO_HEIGHT = Math.round(Dimensions.get('window').width * (9 / 16));

/** Animating expo-image directly keeps its caching + contentFit on the hero. */
const AnimatedImage = Animated.createAnimatedComponent(Image);

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
  const c = useThemeColors();
  // Built once per appearance — this screen paints a lot of small coloured
  // chrome (cards, chips, picker rows) and rebuilding it per render would churn.
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);
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

  /**
   * Load item from storage
   */
  /**
   * Holds the Sound that was actually created, so unmount can unload it.
   *
   * The cleanup below can't close over the `sound` STATE: this effect is keyed
   * on [id], so it captures whatever `sound` was at mount — `null` on every
   * normal open. Navigating away mid-playback therefore unloaded nothing, and
   * the narration kept playing over whatever screen came next.
   */
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    loadItem();
    return () => {
      const s = soundRef.current;
      if (s) {
        s.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
    // loadItem is stable for a given id and intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        soundRef.current = newSound;
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
      // Clears the fields *and* deletes the native calendar entry — dropping
      // only the fields leaves the event (and its alarm) live on the device.
      await updateItem(id, await unscheduleItem(id));
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
      <View style={[styles.container, dyn.container]}>
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
      <View style={[styles.container, dyn.container]}>
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

  const header = (
    <ScreenHeader
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
              <Text style={[styles.editActionText, dyn.editActionText]}>Cancel</Text>
            </PressableScale>
            <PressableScale
              haptic="light"
              style={[styles.editActionButton, styles.saveButtonHeader]}
              onPress={handleSaveEdit}
              disabled={saving}
              accessibilityLabel="Save changes"
            >
              {saving ? (
                // On the BRAND[600] pill, which is identical in both
                // appearances — so the spinner stays white, not textInverse.
                <ActivityIndicator size="small" color="#fff" />
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
            <Ionicons name="create-outline" size={24} color={c.brand} />
          </PressableScale>
        )
      }
    />
  );

  return (
    <View style={[styles.container, dyn.container]}>
      {header}

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
              style={[styles.image, dyn.image, heroStyle]}
              contentFit="cover"
            />
          )}

          {/* Item Header */}
          <View style={styles.itemHeader}>
            {/* The pill is a 10% wash of the classification's own hue in both
                appearances, and `deep` is contrast-tuned for exactly that wash. */}
            <View style={[styles.badge, { backgroundColor: cfg.from + '1A' }]}>
              <Ionicons name={cfg.icon} size={12} color={cfg.deep} />
              <Text style={[styles.badgeText, { color: cfg.deep }]}>{cfg.label}</Text>
            </View>
            <Text style={[styles.timestamp, dyn.timestamp]}>
              {format(new Date(item.created_at), 'MMM d, yyyy · h:mm a')}
            </Text>
          </View>

          {/* Title */}
          {isEditing ? (
            <View style={styles.editingSection}>
              <Text style={[styles.editingLabel, dyn.editingLabel]}>Title</Text>
              <TextInput
                style={[styles.editingInput, dyn.editingInput]}
                value={editingTitle}
                onChangeText={setEditingTitle}
                placeholder="Item title"
                placeholderTextColor={c.textPlaceholder}
                multiline={false}
              />
            </View>
          ) : (
            <Text style={[styles.title, dyn.title]}>{item.title}</Text>
          )}

          {/* Description */}
          {isEditing ? (
            <View style={styles.editingSection}>
              <Text style={[styles.editingLabel, dyn.editingLabel]}>Description</Text>
              <TextInput
                style={[styles.editingInput, dyn.editingInput, styles.editingTextArea]}
                value={editingDescription}
                onChangeText={setEditingDescription}
                placeholder="Add a description..."
                placeholderTextColor={c.textPlaceholder}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          ) : (
            item.description && (
              <Text style={[styles.description, dyn.description]}>{item.description}</Text>
            )
          )}

          {/* Audio Player — a control, so it takes the material and the
              specular press that goes with it. */}
          {item.audio_url && (
            <PressableScale
              haptic="light"
              containerStyle={styles.cardLift}
              onPress={toggleAudio}
              accessibilityLabel={isPlaying ? 'Pause narration' : 'Play narration'}
            >
              <Glass
                interactive
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.cardTint}
                style={[styles.audioPlayer, dyn.cardEdge]}
              >
                <Ionicons
                  name={isPlaying ? 'pause-circle' : 'play-circle'}
                  size={48}
                  color={c.brand}
                />
                <Text style={[styles.audioText, dyn.audioText]}>
                  {isPlaying ? 'Pause narration' : 'Play narration'}
                </Text>
              </Glass>
            </PressableScale>
          )}

          {/* Metadata — short labelled lines, never a block of prose, so the
              material costs it nothing. The link row inside stays a plain row:
              a second material stacked on this one reads as mud. */}
          <View style={styles.cardLift}>
            <Glass
              variant="regular"
              radius={RADIUS.lg}
              bordered={false}
              tintColor={dyn.cardTint}
              style={[styles.metadata, dyn.cardEdge]}
            >
              {item.duration && (
                <View style={styles.metadataItem}>
                  <Ionicons name="time-outline" size={20} color={c.decorative} />
                  <Text style={[styles.metadataText, dyn.metadataText]}>{item.duration} min</Text>
                </View>
              )}

              {item.url && (
                <PressableScale
                  haptic="light"
                  style={styles.metadataItem}
                  onPress={openUrl}
                  accessibilityLabel="Open link in browser"
                >
                  <Ionicons name="link-outline" size={20} color={c.brand} />
                  <Text style={[styles.metadataText, styles.link, dyn.link]}>Open link</Text>
                </PressableScale>
              )}

              {item.place_name && (
                <View style={styles.metadataItem}>
                  <Ionicons name="location-outline" size={20} color={c.decorative} />
                  <Text style={[styles.metadataText, dyn.metadataText]}>{item.place_name}</Text>
                </View>
              )}
            </Glass>
          </View>

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <View style={styles.tagsSection}>
              <Text style={[styles.sectionTitle, dyn.sectionTitle]}>Tags</Text>
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
            <View style={[styles.checklistSection, dyn.card]}>
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
                  color={c.decorative}
                />
                <Text style={[styles.sectionTitle, dyn.sectionTitle]}>
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
                {/* `entry`, not `c` — `c` is the palette in this scope now, and a
                    ChecklistItem also has a `.text`, so the shadow would hide a
                    real mistake rather than error. */}
                {item.checklist.filter(entry => entry.completed).length > 0 && (
                  <Text style={[styles.checklistProgress, dyn.checklistProgress]}>
                    {item.checklist.filter(entry => entry.completed).length} / {item.checklist.length}
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
                      const updatedChecklist = item.checklist!.map(entry =>
                        entry.id === checklistItem.id
                          ? { ...entry, completed: !entry.completed }
                          : entry
                      );
                      await updateItem(id, { checklist: updatedChecklist });
                      await loadItem();
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                  >
                    <View
                      style={[
                        styles.checklistCheckbox,
                        dyn.checklistCheckbox,
                        checklistItem.completed && styles.checklistCheckboxCompleted,
                      ]}
                    >
                      {checklistItem.completed && (
                        // Sits on the BRAND[500] fill, which is identical in
                        // both appearances — so white, not textInverse.
                        <Ionicons name="checkmark" size={16} color="#fff" />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.checklistText,
                        dyn.checklistText,
                        checklistItem.completed && [
                          styles.checklistTextCompleted,
                          dyn.checklistTextCompleted,
                        ],
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
          <View style={[styles.notesSection, dyn.card]}>
            <View style={styles.notesHeader}>
              <Ionicons name="document-text-outline" size={20} color={c.decorative} />
              <Text style={[styles.sectionTitle, dyn.sectionTitle]}>Personal Notes</Text>
            </View>
            {isEditing ? (
              <TextInput
                style={[styles.notesInput, dyn.notesInput, styles.editingTextArea]}
                value={editingNotes}
                onChangeText={setEditingNotes}
                placeholder="Add your personal notes, thoughts, or comments here..."
                placeholderTextColor={c.textPlaceholder}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
            ) : (
              <View style={styles.notesContent}>
                {item.notes ? (
                  <Text style={[styles.notesText, dyn.notesText]}>{item.notes}</Text>
                ) : (
                  <Text style={[styles.notesPlaceholder, dyn.notesPlaceholder]}>
                    Tap the edit button to add personal notes
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Scheduled Info — a two-line status readout, so it takes the
              material like the metadata card above it. */}
          {item.scheduled_date && (
            <View style={styles.cardLift}>
              <Glass
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.cardTint}
                style={[styles.scheduledSection, dyn.cardEdge]}
              >
                <Ionicons name="calendar" size={24} color={c.brand} />
                <View style={styles.scheduledInfo}>
                  <Text style={[styles.scheduledLabel, dyn.scheduledLabel]}>Scheduled</Text>
                  <Text style={[styles.scheduledDate, dyn.scheduledDate]}>
                    {format(parseLocalDate(item.scheduled_date), 'MMMM d, yyyy')}
                    {item.scheduled_time && ` at ${item.scheduled_time}`}
                  </Text>
                </View>
              </Glass>
            </View>
          )}

          {/* Actions — one lensed cluster of three controls, not three
              unrelated blurs. Each is `interactive`, so the material responds
              to the touch the way Apple's own controls do. */}
          <GlassGroup spacing={SPACE.md} style={styles.actions}>
            <PressableScale
              haptic="light"
              containerStyle={styles.actionWrap}
              onPress={handleSchedulePress}
              accessibilityLabel={item.scheduled_date ? 'Reschedule this save' : 'Schedule this save'}
            >
              <Glass
                interactive
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.cardTint}
                style={[styles.actionButton, dyn.cardEdge]}
              >
                <Ionicons name="calendar-outline" size={24} color={c.brand} />
                <Text style={[styles.actionText, dyn.scheduleText]}>
                  {item.scheduled_date ? 'Reschedule' : 'Schedule'}
                </Text>
              </Glass>
            </PressableScale>

            <PressableScale
              haptic="light"
              containerStyle={styles.actionWrap}
              onPress={handleArchive}
              accessibilityLabel="Archive this save"
            >
              <Glass
                interactive
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.cardTint}
                style={[styles.actionButton, dyn.cardEdge]}
              >
                <Ionicons name="archive-outline" size={24} color={c.textSecondary} />
                <Text style={[styles.actionText, dyn.actionText]}>Archive</Text>
              </Glass>
            </PressableScale>

            <PressableScale
              haptic="light"
              containerStyle={styles.actionWrap}
              onPress={handleDelete}
              accessibilityLabel="Delete this save"
            >
              {/* The danger tint keeps Delete legible as the destructive one
                  now that it has no fill of its own to carry that. */}
              <Glass
                interactive
                variant="regular"
                radius={RADIUS.lg}
                bordered={false}
                tintColor={dyn.dangerTint}
                style={[styles.actionButton, dyn.cardEdge]}
              >
                <Ionicons name="trash-outline" size={24} color={c.danger} />
                <Text style={[styles.actionText, dyn.deleteText]}>Delete</Text>
              </Glass>
            </PressableScale>
          </GlassGroup>
        </Animated.ScrollView>

        {/* Schedule Modal */}
        <Modal
          visible={showScheduleModal}
          /*
           * Kept native, and kept on `slide`. The presentation this animates is
           * cover-vertical — a TRANSFORM, never an alpha — so the glass sheet
           * below rides it intact, and it is the only path that keeps the
           * dismissal animated: RN's Modal holds its children mounted through a
           * native dismissal, but under `animationType="none"` it tears the host
           * view down at once and a Reanimated `exiting` never gets to play.
           */
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowScheduleModal(false)}
        >
          <View style={[styles.modalOverlay, dyn.scrim]}>
            {/* Glass can't cast a shadow from inside its own clipped bounds, so
                the lift that separates the sheet from the scrim lives out here,
                on a wrapper that matches its box exactly. */}
            <View style={styles.sheetLift}>
              <Glass
                variant="regular"
                radius={RADIUS.xl}
                // The rim is drawn per-edge below — only the top edge is on screen.
                bordered={false}
                tintColor={dyn.sheetTint}
                style={[
                  styles.modalContent,
                  dyn.sheetEdge,
                  { paddingBottom: insets.bottom + SPACE.xxl },
                ]}
              >
                <View style={[styles.modalHeader, dyn.modalHeader]}>
                  <Text style={[styles.modalTitle, dyn.modalTitle]}>Schedule Item</Text>
                  <PressableScale
                    haptic="light"
                    onPress={() => setShowScheduleModal(false)}
                    style={styles.modalCloseButton}
                    accessibilityLabel="Close scheduler"
                  >
                    <Ionicons name="close" size={24} color={c.textSecondary} />
                  </PressableScale>
                </View>

                <View style={styles.modalBody}>
                  {/* Date Picker */}
                  <PressableScale
                    haptic="light"
                    style={[styles.pickerButton, dyn.pickerButton]}
                    onPress={() => setShowDatePicker(true)}
                    accessibilityLabel={`Date, ${format(scheduleDate, 'MMMM d, yyyy')}`}
                  >
                    <Ionicons name="calendar-outline" size={24} color={c.brand} />
                    <View style={styles.pickerContent}>
                      <Text style={[styles.pickerLabel, dyn.pickerLabel]}>Date</Text>
                      <Text style={[styles.pickerValue, dyn.pickerValue]}>
                        {format(scheduleDate, 'MMMM d, yyyy')}
                      </Text>
                    </View>
                  </PressableScale>

                  {/* Time Picker */}
                  <PressableScale
                    haptic="light"
                    style={[styles.pickerButton, dyn.pickerButton]}
                    onPress={() => setShowTimePicker(true)}
                    accessibilityLabel={`Time, ${format(scheduleTime, 'h:mm a')}`}
                  >
                    <Ionicons name="time-outline" size={24} color={c.brand} />
                    <View style={styles.pickerContent}>
                      <Text style={[styles.pickerLabel, dyn.pickerLabel]}>Time</Text>
                      <Text style={[styles.pickerValue, dyn.pickerValue]}>
                        {format(scheduleTime, 'h:mm a')}
                      </Text>
                    </View>
                  </PressableScale>

                  {/* Duration Picker */}
                  <View style={styles.durationSection}>
                    <Text style={[styles.pickerLabel, dyn.pickerLabel]}>Duration</Text>
                    <View style={styles.durationOptions}>
                      {durationOptions.map((duration) => (
                        <PressableScale
                          key={duration}
                          haptic="selection"
                          containerStyle={styles.durationWrap}
                          selected={scheduleDuration === duration}
                          accessibilityLabel={`${duration} minutes`}
                          // `durationOptionActive` last: the brand fill must win
                          // over the dynamic field/hairline pair beneath it.
                          style={[
                            styles.durationOption,
                            dyn.durationOption,
                            scheduleDuration === duration && styles.durationOptionActive,
                          ]}
                          onPress={() => setScheduleDuration(duration)}
                        >
                          <Text
                            style={[
                              styles.durationOptionText,
                              dyn.durationOptionText,
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
                    <View style={[styles.pickerContainer, dyn.pickerContainer]}>
                      {/* Both picker props follow the appearance: pinned to light,
                          the spinner paints black digits on the dark sheet. */}
                      <DateTimePicker
                        value={scheduleDate}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        themeVariant={c.appearance}
                        onChange={(event, selectedDate) => {
                          setShowDatePicker(Platform.OS === 'android');
                          if (selectedDate) {
                            setScheduleDate(selectedDate);
                          }
                        }}
                        minimumDate={new Date()}
                        textColor={Platform.OS === 'ios' ? c.text : undefined}
                      />
                    </View>
                  )}

                  {/* Time Picker Component */}
                  {showTimePicker && (
                    <View style={[styles.pickerContainer, dyn.pickerContainer]}>
                      <DateTimePicker
                        value={scheduleTime}
                        mode="time"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        themeVariant={c.appearance}
                        onChange={(event, selectedTime) => {
                          setShowTimePicker(Platform.OS === 'android');
                          if (selectedTime) {
                            setScheduleTime(selectedTime);
                          }
                        }}
                        textColor={Platform.OS === 'ios' ? c.text : undefined}
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
              </Glass>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>

    </View>
  );
}

/**
 * Colour-only companions to `styles`. A plain object, NOT StyleSheet.create —
 * this is rebuilt whenever the appearance flips, and registering fresh
 * stylesheet ids on every flip would just leak them.
 */
function makeDynamicStyles(c: ThemeColors) {
  return {
    container: { backgroundColor: c.page },
    editActionText: { color: c.textSecondary },
    // The ground the hero paints onto while the image decodes. Left near-white
    // it flashes a lit panel over the dark page on every open.
    image: { backgroundColor: c.field },
    timestamp: { color: c.textTertiary },
    title: { color: c.text },
    description: { color: c.textSecondary },
    /**
     * Shared dress for the raised cards that stay OPAQUE (checklist, notes).
     * Each already carries a 1px border in the static sheet, so recolouring it
     * to `hairline` is what gives them a visible edge on dark, where SHADOW.card
     * separates nothing — card and page are both near-black.
     */
    card: { backgroundColor: c.card, borderColor: c.hairline },
    /**
     * The same dress MINUS the fill, for the surfaces that are glass (audio,
     * metadata, scheduled, the three action buttons): a background colour on a
     * glass view paints over the material. Only the edge is left to draw, and it
     * stays the palette's hairline rather than the material's fainter own rim.
     */
    cardEdge: { borderColor: c.hairline },
    /**
     * Tints those glass surfaces. Glass borrows its colour from what is behind
     * it, and on light that is a pale violet page — labels on bare material
     * drift under AA. `2e` ≈ 18% of the palette's own card colour: enough to
     * hold text, far too little to read as a fill.
     */
    cardTint: `${c.card}2e`,
    /**
     * Delete's wash. `1f` ≈ 12% of the palette's own danger red — the button
     * reads as the destructive one without becoming a danger FILL (which is a
     * different, louder promise, and would strand its red label).
     * The rim stays `cardEdge` like its two neighbours: they lens as one row.
     */
    dangerTint: `${c.danger}1f`,
    audioText: { color: c.brand },
    metadataText: { color: c.textSecondary },
    link: { color: c.textBrand },
    sectionTitle: { color: c.text },
    scheduledLabel: { color: c.textTertiary },
    scheduledDate: { color: c.text },
    actionText: { color: c.textSecondary },
    deleteText: { color: c.danger },
    scheduleText: { color: c.textBrand },
    scrim: { backgroundColor: c.scrim },
    /**
     * No fill: the glass IS the sheet. What is left to draw is the rim on the
     * one edge you can see — the top — which is what separates the sheet from
     * the scrim behind it, in both appearances now rather than on dark only.
     */
    sheetEdge: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
    /** Holds the sheet's own labels over whatever the scrim is dimming. */
    sheetTint: `${c.card}2e`,
    modalHeader: { borderBottomColor: c.hairline },
    modalTitle: { color: c.text },
    pickerContainer: { backgroundColor: c.card, borderColor: c.hairline },
    pickerButton: { backgroundColor: c.field, borderColor: c.hairline },
    pickerLabel: { color: c.textTertiary },
    pickerValue: { color: c.text },
    durationOption: { backgroundColor: c.field, borderColor: c.hairline },
    durationOptionText: { color: c.textSecondary },
    editingLabel: { color: c.textTertiary },
    editingInput: { backgroundColor: c.card, borderColor: c.hairline, color: c.text },
    notesInput: { backgroundColor: c.sunken, borderColor: c.hairline, color: c.text },
    notesText: { color: c.text },
    notesPlaceholder: { color: c.textTertiary },
    checklistProgress: { color: c.textBrand },
    checklistCheckbox: {
      backgroundColor: c.card,
      // The resting ring is decoration, not text. INK[300] is tuned against
      // white; on the dark card it reads as a lit halo, so dark takes the
      // palette's decorative step instead.
      borderColor: c.appearance === 'dark' ? c.decorative : INK[300],
    },
    checklistText: { color: c.text },
    checklistTextCompleted: { color: c.textTertiary },
  };
}

// Colour for every rule below that needs one lives in `makeDynamicStyles`.
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  pickerContainer: {
    marginVertical: SPACE.base,
    borderRadius: RADIUS.lg,
    padding: SPACE.sm,
    borderWidth: 1,
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
  // A brand surface: identical in both appearances, so its label stays white
  // rather than following textInverse (which is near-black on dark).
  saveButtonHeader: {
    backgroundColor: BRAND[600],
    paddingHorizontal: SPACE.base,
  },
  editActionText: {
    ...TYPE.bodyStrong,
  },
  saveButtonTextHeader: {
    ...TYPE.bodyStrong,
    color: '#fff',
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
  },
  title: {
    ...TYPE.title1,
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.md,
  },
  description: {
    ...TYPE.body,
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.base,
  },
  /**
   * The outer box of every GLASS card on this screen (audio, metadata,
   * scheduled). It carries the margins and the lift, because a glass surface
   * clips to its own rounded bounds — a shadow set on it never escapes them.
   * The corner is repeated here so the shadow is cast in the sheet's own shape.
   */
  cardLift: {
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    borderRadius: RADIUS.lg,
    ...SHADOW.card,
  },
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  audioText: {
    ...TYPE.bodyStrong,
    marginLeft: SPACE.md,
  },
  metadata: {
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACE.md,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataText: {
    ...TYPE.body,
    marginLeft: SPACE.md,
  },
  link: {
    fontWeight: '600',
  },
  tagsSection: {
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.base,
  },
  sectionTitle: {
    ...TYPE.headline,
    marginBottom: SPACE.md,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // Brand chip — same violet in both appearances, so its label stays white.
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
    color: '#fff',
  },
  scheduledSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  scheduledInfo: {
    marginLeft: SPACE.md,
    flex: 1,
  },
  scheduledLabel: {
    ...TYPE.overline,
  },
  scheduledDate: {
    ...TYPE.body,
    marginTop: SPACE.xxs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: SPACE.base,
    gap: SPACE.md,
  },
  // The lift lives out here for the same reason as `cardLift`: the button
  // itself is glass, and clips any shadow of its own away.
  actionWrap: {
    flex: 1,
    borderRadius: RADIUS.lg,
    ...SHADOW.card,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  actionText: {
    ...TYPE.subhead,
    marginLeft: SPACE.sm,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // The sheet's lift, on the wrapper that also owns its (transform-only)
  // entrance — glass cannot cast a shadow from inside its own clipped bounds.
  sheetLift: {
    ...SHADOW.floating,
  },
  modalContent: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    // Flush with the bottom of the screen, so the corners the `radius` prop
    // rounds by default get squared off again.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACE.base,
    borderBottomWidth: 1,
  },
  modalTitle: {
    ...TYPE.title3,
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
    padding: SPACE.base,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACE.md,
  },
  pickerContent: {
    marginLeft: SPACE.md,
    flex: 1,
  },
  pickerLabel: {
    ...TYPE.overline,
    marginBottom: SPACE.xs,
  },
  pickerValue: {
    ...TYPE.bodyStrong,
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
  // On GRADIENTS.brand, which is identical in both appearances.
  saveButtonText: {
    ...TYPE.bodyStrong,
    fontWeight: '700',
    color: '#fff',
  },
  // A solid destructive fill, not destructive text: it keeps the deep red in
  // both appearances so its white label stays above 4.5:1. `c.danger` on dark
  // is the *lightened* red meant for text on a card, and would fail here.
  removeButton: {
    backgroundColor: STATUS.danger,
  },
  removeButtonText: {
    ...TYPE.bodyStrong,
    color: '#fff',
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
    borderWidth: 1,
    alignItems: 'center',
  },
  // Brand fill in both appearances, so the selected label stays white.
  durationOptionActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
  },
  durationOptionText: {
    ...TYPE.subhead,
  },
  durationOptionTextActive: {
    color: '#fff',
  },
  editingSection: {
    paddingHorizontal: SPACE.base,
    marginBottom: SPACE.base,
  },
  editingLabel: {
    ...TYPE.overline,
    marginBottom: SPACE.sm,
  },
  editingInput: {
    borderRadius: RADIUS.md,
    padding: SPACE.base,
    ...TYPE.body,
    borderWidth: 1,
  },
  editingTextArea: {
    minHeight: 100,
    maxHeight: 200,
  },
  notesSection: {
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    ...SHADOW.card,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACE.md,
    gap: SPACE.sm,
  },
  notesInput: {
    borderRadius: RADIUS.sm,
    padding: SPACE.md,
    ...TYPE.body,
    borderWidth: 1,
    minHeight: 120,
  },
  notesContent: {
    minHeight: 60,
  },
  notesText: {
    ...TYPE.body,
  },
  notesPlaceholder: {
    ...TYPE.footnote,
    fontStyle: 'italic',
  },
  checklistSection: {
    marginHorizontal: SPACE.base,
    marginBottom: SPACE.base,
    padding: SPACE.base,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Brand fill in both appearances, so its checkmark stays white.
  checklistCheckboxCompleted: {
    backgroundColor: BRAND[500],
    borderColor: BRAND[500],
  },
  checklistText: {
    flex: 1,
    ...TYPE.body,
  },
  checklistTextCompleted: {
    textDecorationLine: 'line-through',
  },
});
