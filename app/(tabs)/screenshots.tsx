/**
 * Screenshots Screen
 *
 * Card-deck review of recent device screenshots. The top card is pan-driven
 * (swipe right = import + AI-analyze; swipe left = skip) and the next two sit
 * behind it as a peek stack that grows as the top card leaves. A Skip / Save
 * button row mirrors the gesture so the screen is usable with VoiceOver and
 * Switch Control. A filter strip scopes by recency or hides imports.
 *
 * Every triage shows an Undo snackbar with a visibly draining expiry bar; once
 * the Worker returns a time suggestion the same snackbar grows a "Schedule"
 * action. Nothing about triage is allowed to open a modal — a blocking alert
 * lands on top of the *next* card and stops rapid review dead.
 *
 * Permission is read before it is requested, so a first run shows a priming
 * card and a hard denial shows a Settings route — never "No screenshots found".
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
  Dimensions,
  ScrollView,
  ActivityIndicator,
  Linking,
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
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import {
  queryRecentScreenshots,
  requestMediaLibraryPermissions,
  imageUriToBase64,
  getMimeTypeFromFilename,
  Screenshot,
  MediaPermissionStatus,
} from '@/lib/screenshots';
import { analyzeImage, suggestScheduleTime } from '@/lib/api';
import { addItem, getItems, deleteItem } from '@/lib/storage';
import { createItem } from '@/lib/items';
import { scheduleItemReview } from '@/lib/scheduler';
import { celebrationHaptic } from '@/lib/haptics';
import type { Item, ScheduleSuggestionResponse } from '@/lib/types';
import {
  BRAND,
  DURATION,
  GRADIENTS,
  HAIRLINE,
  HAIRLINE_DARK,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  STATUS,
  SURFACE,
  TEXT,
  TYPE,
} from '@/lib/theme';
import {
  enterFromBottom,
  enterList,
  exitToBottom,
  usePrefersReducedMotion,
} from '@/lib/motion';
import Skeleton from '@/components/ui/Skeleton';
import PressableScale from '@/components/ui/PressableScale';
import GlassCard from '@/components/ui/GlassCard';
import EmptyState from '@/components/ui/EmptyState';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const CARD_WIDTH = SCREEN_WIDTH - 20;
/** Fallback deck height until the deck reports its real one via onLayout. */
const DECK_HEIGHT_GUESS = Math.round(SCREEN_HEIGHT * 0.5);
/**
 * Horizontal velocity (px/s) that commits a swipe regardless of distance.
 * Rapid triage is a flick, not a drag — without this the natural gesture
 * snaps back and the deck feels stuck.
 */
const FLING = 800;
/** Degrees the card is tilted to by the time it leaves the screen. */
const EXIT_TILT = 22;
/** Diameter of the Skip / Save circles, and the room reserved for that row. */
const ACTION_SIZE = 56;
/** Clearance for the native (liquid-glass) tab bar, above the home indicator. */
const TAB_BAR_INSET = 76;

type FilterKey = 'all' | 'today' | 'week' | 'unprocessed';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'unprocessed', label: 'Unprocessed' },
];

interface LastAction {
  kind: 'imported' | 'skipped' | 'failed';
  itemId?: string;
  item?: Item;
  /** Whether the deck advanced — Undo only steps back when it did. */
  advanced: boolean;
  /** Arrives asynchronously from the Worker; unlocks the Schedule action. */
  suggestion?: ScheduleSuggestionResponse;
  /** Terminal state after the user taps Schedule. */
  scheduleResult?: 'ok' | 'error';
}

function snackbarLabel(a: LastAction): string {
  if (a.scheduleResult === 'ok') return 'Added to calendar';
  if (a.scheduleResult === 'error') return "Couldn't add to calendar";
  if (a.kind === 'failed') return "Couldn't import";
  return a.kind === 'imported' ? 'Imported' : 'Skipped';
}

function snackbarIcon(a: LastAction): keyof typeof Ionicons.glyphMap {
  if (a.scheduleResult === 'ok') return 'calendar';
  if (a.scheduleResult === 'error' || a.kind === 'failed') return 'alert-circle';
  return a.kind === 'imported' ? 'checkmark-circle' : 'close-circle';
}

export default function ScreenshotsScreen() {
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [permission, setPermission] = useState<MediaPermissionStatus | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  /** Initial library fetch only — never the per-card import (that's `analyzing`). */
  const [loading, setLoading] = useState(true);
  /** A card's AI round-trip is in flight; triage is paused until it lands. */
  const [analyzing, setAnalyzing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  /** URIs already imported into Silo — drives the Unprocessed filter. */
  const [importedUris, setImportedUris] = useState<Set<string>>(new Set());
  /** How many items were imported today — used by the "all caught up" hero. */
  const [importsToday, setImportsToday] = useState(0);
  /** Most recent action, for the Undo snackbar. */
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [deckHeight, setDeckHeight] = useState(DECK_HEIGHT_GUESS);
  /** Held in a ref so the timeout can clear it independently of React state. */
  const snackbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation values for the top card.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);
  const lastHapticTime = useSharedValue(0);
  /** 1 → 0 over the undo window; drives the snackbar's expiry bar. */
  const expiry = useSharedValue(0);
  const importingRef = useRef(false);

  const resetAnimation = useCallback(() => {
    translateX.value = 0;
    translateY.value = 0;
    rotate.value = 0;
    opacity.value = 1;
  }, [translateX, translateY, rotate, opacity]);

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

  /**
   * Load recent screenshots from the device. Reports permission status rather
   * than throwing, so there is nothing here to catch.
   */
  const loadScreenshots = useCallback(async () => {
    setLoading(true);
    const { status, assets } = await queryRecentScreenshots(30);
    setPermission(status);
    setScreenshots(assets);
    setCurrentIndex(0);
    setLoading(false);
  }, []);

  /** Priming CTA — the OS dialog only ever appears after the user asks for it. */
  const requestAccess = useCallback(async () => {
    const status = await requestMediaLibraryPermissions();
    setPermission(status);
    if (status === 'granted' || status === 'limited') await loadScreenshots();
  }, [loadScreenshots]);

  useFocusEffect(
    useCallback(() => {
      loadScreenshots();
      refreshImportedFromStorage();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [loadScreenshots, refreshImportedFromStorage])
  );

  // Reset the visible-deck index whenever the filter changes — the new list is
  // a different slice of screenshots, so currentIndex isn't comparable.
  useEffect(() => {
    setCurrentIndex(0);
    resetAnimation();
  }, [activeFilter, resetAnimation]);

  useEffect(() => () => {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
  }, []);

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

  // Park the card transform whenever a *different* screenshot reaches the top —
  // whether the index advanced, the list shrank under it (Unprocessed), or Undo
  // stepped back. Keying on the card rather than writing the transform inline
  // is what stops the exit spring being cancelled a frame after it starts.
  const topShotId = visibleScreenshots[currentIndex]?.id;
  useEffect(() => {
    resetAnimation();
  }, [topShotId, resetAnimation]);

  // ---- Snackbar -----------------------------------------------------------
  function showSnackbar(action: LastAction) {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    setLastAction(action);
    // Restart the drain from full so the undo window is legible, not guessed.
    expiry.value = 1;
    expiry.value = withTiming(0, { duration: DURATION.toast, easing: Easing.linear });
    snackbarTimerRef.current = setTimeout(() => setLastAction(null), DURATION.toast);
  }

  function dismissSnackbar() {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    snackbarTimerRef.current = null;
    expiry.value = 0;
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
    // Only step back if the deck actually moved. Under the Unprocessed filter
    // an import removes its own card instead of advancing the index.
    if (lastAction.advanced) setCurrentIndex((i) => Math.max(0, i - 1));
    resetAnimation();
    await refreshImportedFromStorage();
    dismissSnackbar();
  }

  /** Snackbar action: accept the Worker's suggested slot. No modal, no alert. */
  async function scheduleFromSnackbar() {
    const action = lastAction;
    if (!action?.item || !action.suggestion) return;
    try {
      await scheduleItemReview(
        action.item,
        action.suggestion.date,
        action.suggestion.time,
        action.item.duration || 15
      );
      celebrationHaptic();
      showSnackbar({ ...action, scheduleResult: 'ok' });
    } catch (error) {
      console.error('Failed to schedule event:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showSnackbar({ ...action, scheduleResult: 'error' });
    }
  }

  // ---- Triage -------------------------------------------------------------
  function moveToNext() {
    setCurrentIndex((i) => (i < visibleScreenshots.length ? i + 1 : i));
  }

  async function handleSwipeRight(screenshot: Screenshot) {
    if (importingRef.current) {
      resetAnimation();
      return;
    }
    importingRef.current = true;
    setAnalyzing(true);
    try {
      const item = await importScreenshot(screenshot);
      // Under Unprocessed the imported card drops out of the list at a position
      // <= currentIndex, so advancing as well would silently skip the next one.
      // Either way a new screenshot reaches the top and the reset effect fires.
      const removedFromDeck = activeFilter === 'unprocessed';
      if (!removedFromDeck) moveToNext();
      celebrationHaptic();
      showSnackbar({ kind: 'imported', itemId: item.id, item, advanced: !removedFromDeck });
      await refreshImportedFromStorage();

      // Soft schedule suggestion. Best-effort — it arrives as an extra action on
      // the snackbar that's already up, never as a dialog over the next card.
      try {
        const suggestion = await suggestScheduleTime({
          title: item.title,
          classification: item.classification || 'other',
          description: item.description,
          duration: item.duration,
        });
        setLastAction((prev) =>
          prev && prev.itemId === item.id ? { ...prev, suggestion } : prev
        );
      } catch {
        // schedule suggestion is optional (needs the Worker key)
      }
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      resetAnimation();
      showSnackbar({ kind: 'failed', advanced: false });
    } finally {
      setAnalyzing(false);
      importingRef.current = false;
    }
  }

  function handleSwipeLeft() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    moveToNext();
    showSnackbar({ kind: 'skipped', advanced: true });
  }

  /**
   * Button-driven triage. Runs the same exit as the gesture (minus throw
   * velocity) so the deck behaves identically for pointer, VoiceOver and
   * Switch Control users.
   */
  function triage(direction: 'left' | 'right') {
    const shot = visibleScreenshots[currentIndex];
    // A non-zero transform means this card is already flying out — a second tap
    // would restart the spring and commit the same screenshot twice.
    if (!shot || analyzing || Math.abs(translateX.value) > 1) return;
    const dir = direction === 'right' ? 1 : -1;
    const onDone = direction === 'right' ? () => handleSwipeRight(shot) : handleSwipeLeft;
    translateX.value = withSpring(dir * SCREEN_WIDTH * 1.5, SPRING.settle, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    rotate.value = withSpring(dir * EXIT_TILT, SPRING.settle);
    opacity.value = withTiming(0, { duration: DURATION.base, easing: Easing.out(Easing.quad) });
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
      .enabled(!analyzing)
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
          Extrapolation.CLAMP
        );
      })
      .onEnd((event) => {
        const tx = event.translationX;
        const vx = event.velocityX;
        // A flick commits even when it never travelled far — but only in the
        // direction the card is already leaning, so a snap-back flick can't
        // import the screenshot the user was rejecting.
        const flung = Math.abs(vx) > FLING;
        const right = tx > SWIPE_THRESHOLD || (flung && vx > 0 && tx > 0);
        const left = tx < -SWIPE_THRESHOLD || (flung && vx < 0 && tx < 0);

        if (right || left) {
          const dir = right ? 1 : -1;
          const top = visibleScreenshots[currentIndex];
          // The index moves from the completion callback, not now: writing it
          // immediately would reset the transform ~a frame into the exit.
          translateX.value = withSpring(
            dir * SCREEN_WIDTH * 1.5,
            { ...SPRING.settle, velocity: vx },
            (finished) => {
              if (!finished) return;
              if (right) {
                if (top) runOnJS(handleSwipeRight)(top);
              } else {
                runOnJS(handleSwipeLeft)();
              }
            }
          );
          // Carry Y and rotation through the exit — freezing them at release
          // makes the card look like it detached from the throw.
          translateY.value = withSpring(translateY.value + event.velocityY * 0.12, {
            ...SPRING.settle,
            velocity: event.velocityY,
          });
          rotate.value = withSpring(dir * EXIT_TILT, { ...SPRING.settle, velocity: vx / 60 });
          // Timing, not spring: a spring to 0 opacity undershoots past 0 and
          // the card flickers back into view on the way out.
          opacity.value = withTiming(0, {
            duration: DURATION.base,
            easing: Easing.out(Easing.quad),
          });
        } else {
          translateX.value = withSpring(0, SPRING.snappy);
          translateY.value = withSpring(0, SPRING.snappy);
          rotate.value = withSpring(0, SPRING.snappy);
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
    const o = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_THRESHOLD],
      [0, 0.5],
      Extrapolation.CLAMP
    );
    const isRight = translateX.value > 0;
    return {
      opacity: o,
      backgroundColor: isRight ? 'rgba(22, 163, 74, 0.6)' : 'rgba(220, 38, 38, 0.6)',
    };
  });
  const importIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const skipIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  // The peek stack is driven by the drag, not by index, so the card underneath
  // rises into place as the top one leaves instead of popping in one frame.
  const peek1Style = useAnimatedStyle(() => {
    const p = Math.abs(translateX.value);
    return {
      transform: [
        { scale: interpolate(p, [0, SWIPE_THRESHOLD], [0.95, 1], Extrapolation.CLAMP) },
        { translateY: interpolate(p, [0, SWIPE_THRESHOLD], [14, 0], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(p, [0, SWIPE_THRESHOLD], [0.85, 1], Extrapolation.CLAMP),
    };
  });
  const peek2Style = useAnimatedStyle(() => {
    const p = Math.abs(translateX.value);
    return {
      transform: [
        { scale: interpolate(p, [0, SWIPE_THRESHOLD], [0.9, 0.95], Extrapolation.CLAMP) },
        { translateY: interpolate(p, [0, SWIPE_THRESHOLD], [28, 14], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(p, [0, SWIPE_THRESHOLD], [0.7, 0.85], Extrapolation.CLAMP),
    };
  });
  const expiryStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: expiry.value }] }));

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
          <Ionicons name="checkmark" size={72} color={TEXT.inverse} />
        </LinearGradient>
        <Text accessibilityRole="header" style={styles.caughtUpTitle}>
          All caught up
        </Text>
        <Text style={styles.caughtUpSub}>
          {importsToday > 0 ? `${importsToday} imported today` : 'No imports today yet'}
        </Text>
        <PressableScale
          haptic="light"
          onPress={loadScreenshots}
          accessibilityLabel="Reload screenshots"
          style={styles.reloadBtn}
          containerStyle={{ marginTop: SPACE.xl }}
        >
          <LinearGradient
            colors={[...GRADIENTS.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.reloadFill}
          >
            <Ionicons name="refresh" size={18} color={TEXT.inverse} />
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
    return (
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, styles.peekCard, depth === 1 ? peek1Style : peek2Style]}
      >
        <Image source={{ uri: shot.uri }} style={styles.cardImage} />
      </Animated.View>
    );
  }

  /** The top, gesture-enabled card. */
  function renderTopCard() {
    const shot = visibleScreenshots[currentIndex];
    if (!shot) return null;
    const content = (
      <Animated.View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Screenshot ${currentIndex + 1} of ${visibleScreenshots.length}`}
        style={[styles.card, cardStyle]}
      >
        <Image source={{ uri: shot.uri }} style={styles.cardImage} />
        <Animated.View pointerEvents="none" style={[styles.swipeOverlay, overlayStyle]}>
          <Animated.View
            style={[styles.swipeIndicator, importIndicatorStyle, styles.importIndicator]}
          >
            <Ionicons name="checkmark-circle" size={80} color={TEXT.inverse} />
            <Text style={styles.swipeText}>SAVE</Text>
          </Animated.View>
          <Animated.View
            style={[styles.swipeIndicator, skipIndicatorStyle, styles.skipIndicator]}
          >
            <Ionicons name="close-circle" size={80} color={TEXT.inverse} />
            <Text style={styles.swipeText}>SKIP</Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
    if (!panGesture) return content;
    return <GestureDetector gesture={panGesture}>{content}</GestureDetector>;
  }

  /**
   * Skip / Save row. The pan gesture is unreachable for VoiceOver and Switch
   * Control, so these buttons — not the swipe — are the accessible path.
   */
  function renderActions() {
    return (
      <View style={styles.actionRow}>
        <PressableScale
          haptic="medium"
          disabled={analyzing}
          onPress={() => triage('left')}
          accessibilityRole="button"
          accessibilityLabel="Skip this screenshot"
          accessibilityHint="Moves to the next screenshot without importing"
          style={[styles.actionCircle, styles.skipCircle, analyzing && styles.actionDisabled]}
        >
          <Ionicons name="close" size={28} color={STATUS.danger} />
        </PressableScale>
        <PressableScale
          haptic="medium"
          disabled={analyzing}
          onPress={() => triage('right')}
          accessibilityRole="button"
          accessibilityLabel="Save this screenshot to Silo"
          accessibilityHint="Imports the screenshot and analyzes it"
          style={[styles.saveCircleShadow, analyzing && styles.actionDisabled]}
        >
          <LinearGradient
            colors={[...GRADIENTS.brand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.actionCircle}
          >
            <Ionicons name="checkmark" size={30} color={TEXT.inverse} />
          </LinearGradient>
        </PressableScale>
      </View>
    );
  }

  /** Skeleton stack — mirrors the peek-card layout while loading. */
  function renderSkeletonDeck() {
    return (
      <View pointerEvents="none" style={styles.skeletonStack}>
        <Skeleton
          width={CARD_WIDTH * 0.9}
          height={deckHeight}
          radius={RADIUS.xl}
          style={[styles.skeletonCard, { transform: [{ translateY: 28 }], opacity: 0.7 }]}
        />
        <Skeleton
          width={CARD_WIDTH * 0.95}
          height={deckHeight}
          radius={RADIUS.xl}
          style={[styles.skeletonCard, { transform: [{ translateY: 14 }], opacity: 0.85 }]}
        />
        <Skeleton
          width={CARD_WIDTH}
          height={deckHeight}
          radius={RADIUS.xl}
          style={styles.skeletonCard}
        />
      </View>
    );
  }

  // ---- Top-level render ---------------------------------------------------
  const deckEmpty =
    visibleScreenshots.length === 0 || currentIndex >= visibleScreenshots.length;
  const canRead = permission === 'granted' || permission === 'limited';
  // Skeletons stand in for content we expect to arrive. A refocus with access
  // denied re-enters `loading`, and flashing a fake deck before the Settings
  // prompt would be a lie — so the permission states win over the placeholder.
  const showSkeleton =
    loading && screenshots.length === 0 && (permission === null || canRead);

  function renderDeck() {
    if (showSkeleton) return renderSkeletonDeck();
    if (permission === 'denied') {
      return (
        <EmptyState
          icon="lock-closed"
          title="Photo access is off"
          subtitle="Silo can't see your screenshots until you allow photo access in Settings."
          cta={{ label: 'Open Settings', onPress: () => Linking.openSettings() }}
        />
      );
    }
    if (permission === 'undetermined') {
      return (
        <EmptyState
          icon="images"
          title="Let Silo find your screenshots"
          subtitle="Silo reads screenshots only, and nothing leaves your phone until you save a card."
          cta={{ label: 'Allow photo access', onPress: requestAccess }}
        />
      );
    }
    if (screenshots.length === 0) {
      return permission === 'limited' ? (
        <EmptyState
          icon="images"
          title="No screenshots in your selection"
          subtitle="Silo can only see the photos you picked. Add your screenshots to keep triaging."
          cta={{ label: 'Manage access', onPress: () => Linking.openSettings() }}
          secondary={{ label: 'Reload', onPress: loadScreenshots }}
        />
      ) : (
        <EmptyState
          icon="images"
          title="No screenshots yet"
          subtitle="Screenshot anything worth keeping and it'll be waiting here."
          cta={{ label: 'Reload', onPress: loadScreenshots }}
        />
      );
    }
    if (deckEmpty) return renderCaughtUp();
    return (
      <>
        {/* Peek cards render BEHIND the top card (deeper depth first). */}
        {renderPeekCard(2)}
        {renderPeekCard(1)}
        {renderTopCard()}
        {analyzing && (
          <Animated.View
            entering={enterFromBottom(0, reduced)}
            exiting={exitToBottom(reduced)}
            style={styles.analyzingPill}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator size="small" color={BRAND[600]} />
            <Text style={styles.analyzingText}>Analyzing…</Text>
          </Animated.View>
        )}
      </>
    );
  }

  const showActions = canRead && !deckEmpty && !showSkeleton;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...GRADIENTS.page]} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <Animated.View
        entering={enterList(0, reduced).delay(60)}
        style={[styles.header, { paddingTop: insets.top + SPACE.md }]}
      >
        <Text accessibilityRole="header" style={styles.headerTitle}>
          {!deckEmpty
            ? `${Math.min(currentIndex + 1, visibleScreenshots.length)} / ${visibleScreenshots.length}`
            : 'Screenshots'}
        </Text>
        <Text style={styles.headerSubtitle}>Swipe or use the buttons below</Text>
      </Animated.View>

      {/* Filter chips */}
      <Animated.View entering={enterList(0, reduced).delay(140)} style={styles.filterScroller}>
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
                selected={active}
                accessibilityLabel={`${f.label} screenshots`}
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
      </Animated.View>

      {/* Deck */}
      <Animated.View
        entering={enterList(0, reduced).delay(220)}
        style={[styles.deckArea, { paddingBottom: insets.bottom + TAB_BAR_INSET }]}
      >
        <View
          style={styles.deck}
          onLayout={(e) => setDeckHeight(Math.round(e.nativeEvent.layout.height))}
        >
          {renderDeck()}
        </View>
        {showActions && renderActions()}
      </Animated.View>

      {/* Undo snackbar */}
      {lastAction && (
        <Animated.View
          pointerEvents="box-none"
          entering={enterFromBottom(0, reduced)}
          exiting={exitToBottom(reduced)}
          // Rides above the Skip / Save row so Undo never covers the buttons.
          style={[
            styles.snackbarWrap,
            { bottom: insets.bottom + TAB_BAR_INSET + ACTION_SIZE + SPACE.lg },
          ]}
        >
          <GlassCard tint="dark" intensity={60} radius={RADIUS.lg}>
            <View style={styles.snackbarInner}>
              <Ionicons name={snackbarIcon(lastAction)} size={18} color={TEXT.inverse} />
              <Text style={styles.snackbarText}>{snackbarLabel(lastAction)}</Text>
              <View style={styles.snackbarActions}>
                {!!lastAction.suggestion && !lastAction.scheduleResult && (
                  <PressableScale
                    haptic="light"
                    onPress={scheduleFromSnackbar}
                    accessibilityLabel={`Schedule for ${lastAction.suggestion.date} at ${lastAction.suggestion.time}`}
                  >
                    <Text style={styles.snackbarAction}>Schedule</Text>
                  </PressableScale>
                )}
                {lastAction.kind !== 'failed' && !lastAction.scheduleResult && (
                  <PressableScale
                    haptic="light"
                    onPress={undoLast}
                    accessibilityLabel="Undo last action"
                  >
                    <Text style={styles.snackbarAction}>Undo</Text>
                  </PressableScale>
                )}
              </View>
            </View>
            {/* The undo window drains visibly instead of expiring by surprise. */}
            <View style={styles.snackbarExpiryTrack}>
              <Animated.View style={[styles.snackbarExpiryFill, expiryStyle]} />
            </View>
          </GlassCard>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Solid base color matches the page gradient's bottom stop. NativeTabs keeps
  // adjacent tabs mounted; without this the previous tab's content shows
  // through any gap in our own layout (especially while system dialogs are up).
  container: { flex: 1, backgroundColor: '#FAF5FF' },
  header: { backgroundColor: 'transparent', padding: SPACE.base, alignItems: 'center' },
  headerTitle: { ...TYPE.title2, color: TEXT.primary },
  headerSubtitle: { ...TYPE.subhead, fontWeight: '500', color: TEXT.tertiary, marginTop: SPACE.xs },
  // flexGrow: 0 is load-bearing: a horizontal ScrollView in a column flex
  // layout otherwise claims ALL remaining vertical space, shoving the card
  // deck off the bottom of the screen.
  filterScroller: { flexGrow: 0, flexShrink: 0 },
  filterStrip: {
    paddingHorizontal: SPACE.base,
    paddingBottom: SPACE.sm,
    gap: SPACE.sm,
  },
  chip: {
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: SURFACE.card,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  chipActive: { backgroundColor: BRAND[600], borderColor: BRAND[600] },
  chipText: { ...TYPE.footnote, fontWeight: '600', color: TEXT.secondary },
  chipTextActive: { color: TEXT.inverse },
  deckArea: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 10,
    // Opaque: the deck's cards are position:absolute, so this flex region is
    // otherwise empty. Under expo-router's native tabs on iOS 26 an empty,
    // transparent region lets the adjacent (Stacks) tab composite through.
    backgroundColor: '#FAF5FF',
  },
  /** Sized by flex so the action row below always fits, on any device. */
  deck: { width: CARD_WIDTH, flex: 1 },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: RADIUS.xl,
    backgroundColor: SURFACE.card,
    // No `overflow: hidden` here — it would mask the shadow away. The children
    // carry the same radius instead.
    ...SHADOW.brandFloating,
  },
  peekCard: SHADOW.brandCard,
  // Absolute children honour the parent's alignItems, so the three placeholder
  // cards overlay each other centred instead of stacking down the page.
  skeletonStack: { ...StyleSheet.absoluteFillObject, alignItems: 'center' },
  skeletonCard: { position: 'absolute', top: 0 },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: RADIUS.xl,
    backgroundColor: INK[100],
  },
  swipeOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeIndicator: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  importIndicator: {
    top: 60,
    left: SPACE.lg,
    borderWidth: 4,
    borderColor: TEXT.inverse,
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
    transform: [{ rotate: '-15deg' }],
  },
  skipIndicator: {
    top: 60,
    right: SPACE.lg,
    borderWidth: 4,
    borderColor: TEXT.inverse,
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
    transform: [{ rotate: '15deg' }],
  },
  swipeText: {
    ...TYPE.title1,
    fontWeight: '900',
    color: TEXT.inverse,
    marginTop: SPACE.xs,
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  analyzingPill: {
    position: 'absolute',
    bottom: SPACE.base,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: SURFACE.card,
    ...SHADOW.card,
  },
  analyzingText: { ...TYPE.footnote, color: TEXT.secondary },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xxl,
    marginTop: SPACE.base,
  },
  actionCircle: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipCircle: {
    backgroundColor: SURFACE.card,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  // Opaque + rounded so iOS can derive the shadow path from the bounds rather
  // than rasterising the gradient's alpha every frame.
  saveCircleShadow: {
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
    ...SHADOW.brandCard,
  },
  actionDisabled: { opacity: 0.4 },
  caughtUpWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xxl,
  },
  caughtUpOrb: {
    width: 160,
    height: 160,
    borderRadius: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    ...SHADOW.brandFloating,
  },
  caughtUpTitle: { ...TYPE.title1, color: TEXT.primary },
  caughtUpSub: { ...TYPE.callout, color: TEXT.tertiary, marginTop: SPACE.sm },
  reloadBtn: { borderRadius: RADIUS.pill, overflow: 'hidden' },
  reloadFill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  reloadText: { ...TYPE.callout, fontWeight: '700', color: TEXT.inverse },
  snackbarWrap: {
    position: 'absolute',
    left: SPACE.base,
    right: SPACE.base,
    alignItems: 'center',
  },
  snackbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: 18,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.sm,
  },
  snackbarText: { ...TYPE.subhead, color: TEXT.inverse, flexShrink: 1 },
  snackbarActions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.base },
  snackbarAction: { ...TYPE.subhead, fontWeight: '800', color: BRAND[300] },
  snackbarExpiryTrack: {
    height: 2,
    marginHorizontal: 18,
    marginBottom: SPACE.md,
    borderRadius: RADIUS.pill,
    backgroundColor: HAIRLINE_DARK,
    overflow: 'hidden',
  },
  snackbarExpiryFill: {
    width: '100%',
    height: 2,
    backgroundColor: BRAND[300],
    transformOrigin: 'left',
  },
});
