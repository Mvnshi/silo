/**
 * Screenshots Screen
 *
 * Card-deck review of recent device screenshots. The top card is pan-driven
 * (swipe right = import + AI-analyze; swipe left = skip); the next two are
 * rendered behind it as a peek stack. A filter strip lets the user scope by
 * recency or hide ones they've already imported. Every swipe shows a 5-second
 * "Undo" snackbar — on import-undo we delete the just-created item.
 *
 * Dependencies:
 * - expo-media-library: Photo library access (via lib/screenshots)
 * - react-native-gesture-handler / reanimated: Swipe gesture + animation
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import {
  getRecentScreenshots,
  imageUriToBase64,
  getMimeTypeFromFilename,
  Screenshot,
} from '@/lib/screenshots';
import { analyzeImage, suggestScheduleTime } from '@/lib/api';
import { addItem, getItems, deleteItem } from '@/lib/storage';
import { createItem } from '@/lib/items';
import { scheduleItemReview } from '@/lib/scheduler';
import { celebrationHaptic } from '@/lib/haptics';
import { BRAND, INK, HAIRLINE, RADIUS, GRADIENTS } from '@/lib/theme';
import Skeleton from '@/components/ui/Skeleton';
import PressableScale from '@/components/ui/PressableScale';
import GlassCard from '@/components/ui/GlassCard';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const CARD_WIDTH = SCREEN_WIDTH - 20;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.7;
const SNACKBAR_MS = 5000;

type FilterKey = 'all' | 'today' | 'week' | 'unprocessed';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'unprocessed', label: 'Unprocessed' },
];

interface LastAction {
  kind: 'imported' | 'skipped';
  itemId?: string;
}

export default function ScreenshotsScreen() {
  const insets = useSafeAreaInsets();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  /** URIs already imported into Silo — drives the Unprocessed filter. */
  const [importedUris, setImportedUris] = useState<Set<string>>(new Set());
  /** How many items were imported today — used by the "all caught up" hero. */
  const [importsToday, setImportsToday] = useState(0);
  /** Most recent action, for the Undo snackbar. */
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  /** Held in a ref so the timeout can clear it independently of React state. */
  const snackbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation values for the top card.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);
  const lastHapticTime = useSharedValue(0);
  const importingRef = useRef(false);

  /**
   * Refresh the imported-URIs set and today's import count from storage.
   * Cheap (one AsyncStorage read) — call after every import / undo.
   */
  const refreshImportedFromStorage = useCallback(async () => {
    try {
      const items = await getItems();
      const uris = new Set<string>();
      const todayStr = new Date().toISOString().slice(0, 10);
      let todayCount = 0;
      for (const i of items) {
        if (i.imageUri) uris.add(i.imageUri);
        if (i.type === 'screenshot' && i.created_at.slice(0, 10) === todayStr) {
          todayCount++;
        }
      }
      setImportedUris(uris);
      setImportsToday(todayCount);
    } catch (err) {
      console.warn('refresh imported state failed:', err);
    }
  }, []);

  /** Load recent screenshots from device. */
  async function loadScreenshots() {
    try {
      setLoading(true);
      const recentScreenshots = await getRecentScreenshots(30);
      setScreenshots(recentScreenshots);
      setCurrentIndex(0);
      resetAnimation();
    } catch (error) {
      console.error('Failed to load screenshots:', error);
      Alert.alert('Error', 'Failed to load screenshots. Please check permissions.');
    } finally {
      setLoading(false);
    }
  }

  function resetAnimation() {
    translateX.value = 0;
    translateY.value = 0;
    rotate.value = 0;
    opacity.value = 1;
  }

  useFocusEffect(
    useCallback(() => {
      loadScreenshots();
      refreshImportedFromStorage();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [refreshImportedFromStorage])
  );

  // Reset the visible-deck index whenever the filter changes — the new list is
  // a different slice of screenshots, so currentIndex isn't comparable.
  useEffect(() => {
    setCurrentIndex(0);
    resetAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  // ---- Filter logic -------------------------------------------------------
  const visibleScreenshots = useMemo(() => {
    if (activeFilter === 'all') return screenshots;
    if (activeFilter === 'unprocessed') {
      return screenshots.filter((s) => !importedUris.has(s.uri));
    }
    const nowSec = Date.now() / 1000;
    const windowSec = activeFilter === 'today' ? 24 * 60 * 60 : 7 * 24 * 60 * 60;
    const startOfWindow =
      activeFilter === 'today'
        ? Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000)
        : nowSec - windowSec;
    return screenshots.filter((s) => s.creationTime >= startOfWindow);
  }, [screenshots, activeFilter, importedUris]);

  // ---- Snackbar -----------------------------------------------------------
  function showSnackbar(action: LastAction) {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    setLastAction(action);
    snackbarTimerRef.current = setTimeout(() => setLastAction(null), SNACKBAR_MS);
  }

  function dismissSnackbar() {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    snackbarTimerRef.current = null;
    setLastAction(null);
  }

  async function undoLast() {
    if (!lastAction) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (lastAction.kind === 'imported' && lastAction.itemId) {
      try {
        await deleteItem(lastAction.itemId);
      } catch (err) {
        console.warn('undo: failed to delete item:', err);
      }
    }
    // Step back to the same card. Cap at 0.
    setCurrentIndex((i) => Math.max(0, i - 1));
    resetAnimation();
    await refreshImportedFromStorage();
    dismissSnackbar();
  }

  // ---- Swipe handlers -----------------------------------------------------
  function moveToNext() {
    if (currentIndex < visibleScreenshots.length) {
      setCurrentIndex(currentIndex + 1);
      resetAnimation();
    }
  }

  async function handleSwipeRight(screenshot: Screenshot) {
    if (importingRef.current) return;
    importingRef.current = true;
    try {
      setLoading(true);
      const item = await importScreenshot(screenshot);
      moveToNext();
      celebrationHaptic();
      showSnackbar({ kind: 'imported', itemId: item.id });
      await refreshImportedFromStorage();

      // Soft schedule suggestion. Best-effort — never blocks the flow.
      try {
        const suggestion = await suggestScheduleTime({
          title: item.title,
          classification: item.classification || 'other',
          description: item.description,
          duration: item.duration,
        });
        Alert.alert(
          'Schedule this item?',
          `${suggestion.reason}\n\nDate: ${suggestion.date}\nTime: ${suggestion.time}`,
          [
            { text: 'No thanks', style: 'cancel' },
            {
              text: 'Add to Calendar',
              onPress: async () => {
                try {
                  await scheduleItemReview(item, suggestion.date, suggestion.time, item.duration || 15);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Success', 'Event added to calendar');
                } catch (error) {
                  console.error('Failed to schedule event:', error);
                  Alert.alert('Error', 'Failed to add event to calendar');
                }
              },
            },
          ]
        );
      } catch {
        // schedule suggestion is optional (needs the Worker key)
      }
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to import screenshot');
    } finally {
      setLoading(false);
      importingRef.current = false;
    }
  }

  function handleSwipeLeft() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    moveToNext();
    showSnackbar({ kind: 'skipped' });
  }

  async function importScreenshot(screenshot: Screenshot) {
    // Best-effort AI analysis — without the backend we still save the image.
    let analysis: Awaited<ReturnType<typeof analyzeImage>> | null = null;
    try {
      const base64 = await imageUriToBase64(screenshot.uri);
      const mimeType = getMimeTypeFromFilename(screenshot.filename);
      analysis = await analyzeImage(base64, mimeType);
    } catch (error) {
      console.warn('Screenshot AI analysis unavailable; importing without it:', error);
    }
    const item = createItem({
      type: 'screenshot',
      classification: analysis?.classification ?? 'idea',
      title: analysis?.title || 'Screenshot',
      description: analysis?.description,
      imageUri: screenshot.uri,
      script: analysis?.script,
      tags: analysis?.tags || [],
      duration: analysis?.duration,
      place_name: analysis?.place_name,
      place_address: analysis?.place_address,
    });
    await addItem(item);
    return item;
  }

  /** Progressive haptic that intensifies with drag distance ("stretch" feel). */
  function triggerProgressiveHaptic(dragDistance: number, lastTime: number) {
    const absDistance = Math.abs(dragDistance);
    if (absDistance < 15) return;
    const maxDistance = SCREEN_WIDTH * 0.4;
    const normalizedDistance = Math.min(absDistance / maxDistance, 1);
    const interval = 120 - normalizedDistance * 90;
    let hapticStyle: Haptics.ImpactFeedbackStyle;
    if (normalizedDistance < 0.33) hapticStyle = Haptics.ImpactFeedbackStyle.Light;
    else if (normalizedDistance < 0.66) hapticStyle = Haptics.ImpactFeedbackStyle.Medium;
    else hapticStyle = Haptics.ImpactFeedbackStyle.Heavy;
    const now = Date.now();
    if (now - lastTime >= interval) {
      Haptics.impactAsync(hapticStyle);
      lastHapticTime.value = now;
    }
  }

  // ---- Gesture ------------------------------------------------------------
  let panGesture: ReturnType<typeof Gesture.Pan> | null = null;
  try {
    panGesture = Gesture.Pan()
      .onStart(() => {
        lastHapticTime.value = 0;
      })
      .onUpdate((event) => {
        translateX.value = event.translationX;
        translateY.value = event.translationY;
        runOnJS(triggerProgressiveHaptic)(event.translationX, lastHapticTime.value);
        rotate.value = interpolate(
          event.translationX,
          [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
          [-20, 0, 20],
          Extrapolate.CLAMP
        );
      })
      .onEnd((event) => {
        const shouldSwipeRight = event.translationX > SWIPE_THRESHOLD;
        const shouldSwipeLeft = event.translationX < -SWIPE_THRESHOLD;

        if (shouldSwipeRight) {
          translateX.value = withSpring(SCREEN_WIDTH * 1.5, { damping: 15, stiffness: 150 });
          opacity.value = withSpring(0, { damping: 15, stiffness: 150 });
          const top = visibleScreenshots[currentIndex];
          if (top) runOnJS(handleSwipeRight)(top);
        } else if (shouldSwipeLeft) {
          translateX.value = withSpring(-SCREEN_WIDTH * 1.5, { damping: 15, stiffness: 150 });
          opacity.value = withSpring(0, { damping: 15, stiffness: 150 });
          runOnJS(handleSwipeLeft)();
        } else {
          translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
          translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
          rotate.value = withSpring(0, { damping: 20, stiffness: 300 });
        }
      });
  } catch (error) {
    console.warn('Gesture handler not available:', error);
    panGesture = null;
  }

  // ---- Animated styles ----------------------------------------------------
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));
  const overlayStyle = useAnimatedStyle(() => {
    const o = interpolate(Math.abs(translateX.value), [0, SWIPE_THRESHOLD], [0, 0.5], Extrapolate.CLAMP);
    const isRight = translateX.value > 0;
    return {
      opacity: o,
      backgroundColor: isRight ? 'rgba(76, 175, 80, 0.6)' : 'rgba(244, 67, 54, 0.6)',
    };
  });
  const importIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolate.CLAMP),
  }));
  const skipIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolate.CLAMP),
  }));

  // ---- Renderers ----------------------------------------------------------

  /** "All caught up" celebration shown when the visible deck empties. */
  function renderCaughtUp() {
    return (
      <View style={styles.caughtUpWrap}>
        <LinearGradient
          colors={[...GRADIENTS.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.caughtUpOrb}
        >
          <Ionicons name="checkmark" size={72} color="#fff" />
        </LinearGradient>
        <Text style={styles.caughtUpTitle}>All caught up</Text>
        <Text style={styles.caughtUpSub}>
          {importsToday > 0
            ? `${importsToday} imported today`
            : 'No imports today yet'}
        </Text>
        <PressableScale
          haptic="light"
          onPress={loadScreenshots}
          style={{ marginTop: 24 }}
        >
          <LinearGradient
            colors={[...GRADIENTS.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.reloadBtn}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.reloadText}>Reload</Text>
          </LinearGradient>
        </PressableScale>
      </View>
    );
  }

  /** A peek card behind the top card. Index 1 or 2. Not gesture-enabled. */
  function renderPeekCard(depth: 1 | 2) {
    const shot = visibleScreenshots[currentIndex + depth];
    if (!shot) return null;
    const isMid = depth === 1;
    return (
      <View
        pointerEvents="none"
        style={[
          styles.card,
          styles.peekCard,
          {
            transform: [{ scale: isMid ? 0.95 : 0.9 }, { translateY: isMid ? 14 : 28 }],
            opacity: isMid ? 0.85 : 0.7,
          },
        ]}
      >
        <Image source={{ uri: shot.uri }} style={styles.cardImage} />
      </View>
    );
  }

  /** The top, gesture-enabled card. */
  function renderTopCard() {
    const shot = visibleScreenshots[currentIndex];
    if (!shot) return null;
    const content = (
      <Animated.View style={[styles.card, cardStyle]}>
        <Image source={{ uri: shot.uri }} style={styles.cardImage} />
        <Animated.View style={[styles.swipeOverlay, overlayStyle]}>
          <Animated.View style={[styles.swipeIndicator, importIndicatorStyle, styles.importIndicator]}>
            <Ionicons name="checkmark-circle" size={80} color="#fff" />
            <Text style={styles.swipeText}>SAVE</Text>
          </Animated.View>
          <Animated.View style={[styles.swipeIndicator, skipIndicatorStyle, styles.skipIndicator]}>
            <Ionicons name="close-circle" size={80} color="#fff" />
            <Text style={styles.swipeText}>SKIP</Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
    if (!panGesture) return content;
    return <GestureDetector gesture={panGesture}>{content}</GestureDetector>;
  }

  // ---- Top-level render ---------------------------------------------------
  const deckEmpty =
    visibleScreenshots.length === 0 || currentIndex >= visibleScreenshots.length;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...GRADIENTS.page]} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>
          {!deckEmpty
            ? `${Math.min(currentIndex + 1, visibleScreenshots.length)} / ${visibleScreenshots.length}`
            : 'Screenshots'}
        </Text>
        <Text style={styles.headerSubtitle}>Swipe right to import</Text>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterStrip}
      >
        {FILTERS.map((f) => {
          const active = activeFilter === f.key;
          return (
            <PressableScale
              key={f.key}
              haptic="selection"
              onPress={() => setActiveFilter(f.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Deck */}
      {loading && currentIndex === 0 ? (
        <View style={[styles.cardContainer, { paddingBottom: insets.bottom + 100 }]}>
          {/* Skeleton stack — mirrors the peek-card layout while loading. */}
          <Skeleton
            width={CARD_WIDTH * 0.9}
            height={CARD_HEIGHT}
            radius={24}
            style={[styles.peekCard, { transform: [{ translateY: 28 }], opacity: 0.7 }]}
          />
          <Skeleton
            width={CARD_WIDTH * 0.95}
            height={CARD_HEIGHT}
            radius={24}
            style={[styles.peekCard, { transform: [{ translateY: 14 }], opacity: 0.85 }]}
          />
          <Skeleton width={CARD_WIDTH} height={CARD_HEIGHT} radius={24} />
        </View>
      ) : screenshots.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={64} color={BRAND[300]} />
          <Text style={styles.emptyText}>No screenshots found</Text>
          <Text style={styles.emptySubtext}>
            Take screenshots to import them here
          </Text>
        </View>
      ) : deckEmpty ? (
        <View style={[styles.cardContainer, { paddingBottom: insets.bottom + 100 }]}>
          {renderCaughtUp()}
        </View>
      ) : (
        <View style={[styles.cardContainer, { paddingBottom: insets.bottom + 100 }]}>
          {/* Peek cards render BEHIND the top card (deeper depth first). */}
          {renderPeekCard(2)}
          {renderPeekCard(1)}
          {renderTopCard()}
        </View>
      )}

      {/* Undo snackbar */}
      {lastAction && (
        <View pointerEvents="box-none" style={[styles.snackbarWrap, { bottom: insets.bottom + 90 }]}>
          <GlassCard tint="dark" intensity={60} radius={RADIUS.pill}>
            <View style={styles.snackbarInner}>
              <Ionicons
                name={lastAction.kind === 'imported' ? 'checkmark-circle' : 'close-circle'}
                size={18}
                color="#fff"
              />
              <Text style={styles.snackbarText}>
                {lastAction.kind === 'imported' ? 'Imported' : 'Skipped'}
              </Text>
              <PressableScale haptic="light" onPress={undoLast}>
                <Text style={styles.snackbarUndo}>Undo</Text>
              </PressableScale>
            </View>
          </GlassCard>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Solid base color matches the page gradient's bottom stop. NativeTabs keeps
  // adjacent tabs mounted; without this the previous tab's content shows
  // through any gap in our own layout (especially while system dialogs are up).
  container: { flex: 1, backgroundColor: '#FAF5FF' },
  header: { backgroundColor: 'transparent', padding: 16, alignItems: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: INK[900] },
  headerSubtitle: { fontSize: 14, color: INK[500], marginTop: 4 },
  filterStrip: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  chipActive: { backgroundColor: BRAND[600], borderColor: BRAND[600] },
  chipText: { fontSize: 13, fontWeight: '600', color: INK[700] },
  chipTextActive: { color: '#fff' },
  cardContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 24,
    backgroundColor: '#fff',
    shadowColor: BRAND[400],
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  peekCard: {
    shadowOpacity: 0.15,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: INK[100],
  },
  swipeOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeIndicator: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  importIndicator: {
    top: 60,
    left: 20,
    borderWidth: 4,
    borderColor: '#fff',
    borderRadius: 12,
    padding: 8,
    transform: [{ rotate: '-15deg' }],
  },
  skipIndicator: {
    top: 60,
    right: 20,
    borderWidth: 4,
    borderColor: '#fff',
    borderRadius: 12,
    padding: 8,
    transform: [{ rotate: '15deg' }],
  },
  swipeText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    marginTop: 4,
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  caughtUpWrap: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    position: 'absolute',
    top: 0,
  },
  caughtUpOrb: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BRAND[500],
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 32,
    marginBottom: 28,
  },
  caughtUpTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: INK[900] },
  caughtUpSub: { fontSize: 15, color: INK[500], marginTop: 8 },
  reloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 999,
  },
  reloadText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: { fontSize: 20, fontWeight: '600', color: INK[900], marginTop: 16 },
  emptySubtext: { fontSize: 14, color: INK[500], marginTop: 8, textAlign: 'center' },
  snackbarWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  snackbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  snackbarText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  snackbarUndo: { color: BRAND[300], fontWeight: '800', fontSize: 14, marginLeft: 6 },
});
