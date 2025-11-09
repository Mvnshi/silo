/**
 * Screenshots Screen
 * 
 * Displays recent screenshots from the device's photo library for quick
 * import and analysis. Users can select screenshots to analyze with AI
 * and add to their Silo.
 * 
 * Features:
 * - Grid view of recent screenshots
 * - Select multiple screenshots
 * - Batch import and AI analysis
 * - Delete screenshots after import
 * 
 * Dependencies:
 * - expo-media-library: Photo library access
 * - expo-image-picker: Image selection
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
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
import { analyzeImage, generateAudio, suggestScheduleTime, generateEmbedding } from '@/lib/api';
import { addItem, getUserId } from '@/lib/storage';
import { Item } from '@/lib/types';
import { scheduleItemReview } from '@/lib/scheduler';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;
const CARD_WIDTH = SCREEN_WIDTH - 20;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.75;

export default function ScreenshotsScreen() {
  const insets = useSafeAreaInsets();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  
  // Animation values for current card
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);
  
  // Haptic feedback - use shared values to avoid worklet warnings
  const hapticIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastHapticTime = useSharedValue(0);

  /**
   * Load recent screenshots from device
   */
  async function loadScreenshots() {
    try {
      setLoading(true);
      const recentScreenshots = await getRecentScreenshots(30);
      setScreenshots(recentScreenshots);
      setCurrentIndex(0);
      // Reset animation values
      translateX.value = 0;
      translateY.value = 0;
      rotate.value = 0;
      opacity.value = 1;
    } catch (error) {
      console.error('Failed to load screenshots:', error);
      Alert.alert('Error', 'Failed to load screenshots. Please check permissions.');
    } finally {
      setLoading(false);
    }
  }

  // Load screenshots when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadScreenshots();
      // Haptic feedback when tab is focused
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, [])
  );

  /**
   * Move to next card
   */
  function moveToNext() {
    if (currentIndex < screenshots.length - 1) {
      setCurrentIndex(currentIndex + 1);
      // Reset animation values
      translateX.value = 0;
      translateY.value = 0;
      rotate.value = 0;
      opacity.value = 1;
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
   * Handle swipe right (import)
   */
  async function handleSwipeRight(screenshot: Screenshot) {
    try {
      setLoading(true);
      const item = await importScreenshot(screenshot);
      moveToNext();
      // Celebration haptic for successful import
      celebrationHaptic();
      
      // Suggest calendar event
      try {
        const suggestion = await suggestScheduleTime({
          title: item.title,
          classification: item.classification || 'other',
          description: item.description,
          duration: item.duration,
        });
        
        // Show alert with suggestion
        Alert.alert(
          'Schedule this item?',
          `${suggestion.reason}\n\nDate: ${suggestion.date}\nTime: ${suggestion.time}`,
          [
            {
              text: 'No thanks',
              style: 'cancel',
            },
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
      } catch (error) {
        console.warn('Failed to suggest schedule:', error);
        // Don't show error - schedule suggestion is optional
      }
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Failed to import screenshot');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle swipe left (skip)
   */
  function handleSwipeLeft() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    moveToNext();
  }

  /**
   * Import a single screenshot with AI analysis
   */
  async function importScreenshot(screenshot: Screenshot) {
    try {
      // Convert to base64
      const base64 = await imageUriToBase64(screenshot.uri);
      const mimeType = getMimeTypeFromFilename(screenshot.filename);

      // Analyze with backend API
      const analysis = await analyzeImage(base64, mimeType);

      // Create item
      const item: Item = {
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'screenshot',
        classification: analysis.classification,
        title: analysis.title,
        description: analysis.description,
        imageUri: screenshot.uri,
        script: analysis.script,
        tags: analysis.tags || [],
        duration: analysis.duration,
        place_name: analysis.place_name,
        place_address: analysis.place_address,
        created_at: new Date().toISOString(),
        viewed: false,
        archived: false,
      };

      // Generate audio if script is available (optional - fail gracefully)
      if (analysis.script) {
        try {
          const audioResponse = await generateAudio(analysis.script, item.id);
          item.audio_url = audioResponse.audioUrl;
        } catch (error) {
          console.warn('Audio generation failed (continuing without audio):', error instanceof Error ? error.message : error);
          // Continue without audio - this is optional functionality
        }
      }

      // Generate embedding for RAG (async, don't wait)
      try {
        const userId = await getUserId();
        generateEmbedding({
          userId,
          itemId: item.id,
          title: item.title,
          description: item.description,
          tags: item.tags,
        }).catch(error => {
          console.warn('Failed to generate embedding:', error);
          // Don't show error to user, embedding is optional
        });
      } catch (error) {
        console.warn('Failed to generate embedding:', error);
      }

      // Save item
      await addItem(item);

      // Suggest calendar event after import
      return item;
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      throw error;
    }
  }

  /**
   * Progressive haptic feedback - gets faster as card is dragged further
   * Creates a "stretching" vibration feeling that intensifies with distance
   */
  function triggerProgressiveHaptic(dragDistance: number, lastTime: number) {
    const absDistance = Math.abs(dragDistance);
    
    // Only trigger haptics if dragging significantly
    if (absDistance < 15) {
      return;
    }

    // Calculate haptic frequency based on distance
    // Closer to center = slower, further = faster
    // Max distance is about SCREEN_WIDTH/2, so we map that to intervals
    const maxDistance = SCREEN_WIDTH * 0.4;
    const normalizedDistance = Math.min(absDistance / maxDistance, 1);
    
    // Interval ranges from 120ms (slow) to 30ms (fast) as you drag further
    // This creates the "stretching" effect - faster vibration = more tension
    const interval = 120 - (normalizedDistance * 90);
    
    // Use different haptic intensities based on distance
    // Light for small drags, medium for medium, heavy for large
    let hapticStyle: Haptics.ImpactFeedbackStyle;
    if (normalizedDistance < 0.33) {
      hapticStyle = Haptics.ImpactFeedbackStyle.Light;
    } else if (normalizedDistance < 0.66) {
      hapticStyle = Haptics.ImpactFeedbackStyle.Medium;
    } else {
      hapticStyle = Haptics.ImpactFeedbackStyle.Heavy;
    }
    
    const now = Date.now();
    if (now - lastTime >= interval) {
      // Use impact haptic for the "stretching" feel - more tactile
      Haptics.impactAsync(hapticStyle);
      lastHapticTime.value = now;
    }
  }

  /**
   * Pan gesture handler
   */
  let panGesture: ReturnType<typeof Gesture.Pan> | null = null;
  try {
    panGesture = Gesture.Pan()
      .onStart(() => {
        // Clear any existing haptic interval
        if (hapticIntervalRef.current) {
          clearInterval(hapticIntervalRef.current);
          hapticIntervalRef.current = null;
        }
        lastHapticTime.value = 0;
      })
      .onUpdate((event) => {
        translateX.value = event.translationX;
        translateY.value = event.translationY;
        
        // Progressive haptic feedback - gets faster as you drag
        // Pass the shared value's current value to avoid worklet warnings
        runOnJS(triggerProgressiveHaptic)(event.translationX, lastHapticTime.value);
        
        // More natural rotation like Tinder
        rotate.value = interpolate(
          event.translationX,
          [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
          [-20, 0, 20],
          Extrapolate.CLAMP
        );
      })
      .onEnd((event) => {
        // Clear haptic interval when gesture ends
        if (hapticIntervalRef.current) {
          clearInterval(hapticIntervalRef.current);
          hapticIntervalRef.current = null;
        }
        const shouldSwipeRight = event.translationX > SWIPE_THRESHOLD;
        const shouldSwipeLeft = event.translationX < -SWIPE_THRESHOLD;

        if (shouldSwipeRight) {
          // Swipe right - import (more springy like Tinder)
          translateX.value = withSpring(SCREEN_WIDTH * 1.5, {
            damping: 15,
            stiffness: 150,
          });
          opacity.value = withSpring(0, {
            damping: 15,
            stiffness: 150,
          });
          if (screenshots[currentIndex]) {
            runOnJS(handleSwipeRight)(screenshots[currentIndex]);
          }
        } else if (shouldSwipeLeft) {
          // Swipe left - skip
          translateX.value = withSpring(-SCREEN_WIDTH * 1.5, {
            damping: 15,
            stiffness: 150,
          });
          opacity.value = withSpring(0, {
            damping: 15,
            stiffness: 150,
          });
          runOnJS(handleSwipeLeft)();
        } else {
          // Return to center (snappy spring)
          translateX.value = withSpring(0, {
            damping: 20,
            stiffness: 300,
          });
          translateY.value = withSpring(0, {
            damping: 20,
            stiffness: 300,
          });
          rotate.value = withSpring(0, {
            damping: 20,
            stiffness: 300,
          });
        }
      });
  } catch (error) {
    console.warn('Gesture handler not available:', error);
    panGesture = null;
  }

  /**
   * Animated style for card
   */
  const cardStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotate.value}deg` },
      ],
      opacity: opacity.value,
    };
  });

  /**
   * Animated style for overlay (green for right, red for left)
   * More subtle like Tinder
   */
  const overlayStyle = useAnimatedStyle(() => {
    const overlayOpacity = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_THRESHOLD],
      [0, 0.5],
      Extrapolate.CLAMP
    );
    
    const isRight = translateX.value > 0;
    
    return {
      opacity: overlayOpacity,
      backgroundColor: isRight ? 'rgba(76, 175, 80, 0.6)' : 'rgba(244, 67, 54, 0.6)',
    };
  });

  /**
   * Animated style for import indicator (only show when swiping right)
   */
  const importIndicatorStyle = useAnimatedStyle(() => {
    const indicatorOpacity = interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD],
      [0, 1],
      Extrapolate.CLAMP
    );
    
    return {
      opacity: indicatorOpacity,
    };
  });

  /**
   * Animated style for skip indicator (only show when swiping left)
   */
  const skipIndicatorStyle = useAnimatedStyle(() => {
    const indicatorOpacity = interpolate(
      -translateX.value,
      [0, SWIPE_THRESHOLD],
      [0, 1],
      Extrapolate.CLAMP
    );
    
    return {
      opacity: indicatorOpacity,
    };
  });

  /**
   * Render swipeable card
   */
  function renderCard() {
    if (currentIndex >= screenshots.length) {
      return (
        <View style={styles.emptyCard}>
          <Ionicons name="checkmark-circle" size={64} color="#4CAF50" />
          <Text style={styles.emptyCardText}>All done!</Text>
          <Text style={styles.emptyCardSubtext}>
            Swipe right on screenshots to import them
          </Text>
        </View>
      );
    }

    const screenshot = screenshots[currentIndex];

    const cardContent = (
      <Animated.View style={[styles.card, cardStyle]}>
        <Image source={{ uri: screenshot.uri }} style={styles.cardImage} />
        
        {/* Swipe overlay - Tinder style indicators */}
        <Animated.View style={[styles.swipeOverlay, overlayStyle]}>
          <Animated.View style={[styles.swipeIndicator, importIndicatorStyle, styles.importIndicator]}>
            <Ionicons name="checkmark-circle" size={80} color="#fff" />
            <Text style={styles.swipeText}>LIKE</Text>
          </Animated.View>
          <Animated.View style={[styles.swipeIndicator, skipIndicatorStyle, styles.skipIndicator]}>
            <Ionicons name="close-circle" size={80} color="#fff" />
            <Text style={styles.swipeText}>NOPE</Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );

    if (panGesture) {
      return (
        <GestureDetector gesture={panGesture}>
          {cardContent}
        </GestureDetector>
      );
    }

    return cardContent;
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Gradient Background */}
      <LinearGradient
        colors={['#E8B4E8', '#F5D7F5', '#FFF0F5']}
        style={StyleSheet.absoluteFill}
      />
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>
          {currentIndex < screenshots.length
            ? `${currentIndex + 1} / ${screenshots.length}`
            : 'Screenshots'}
        </Text>
        <Text style={styles.headerSubtitle}>Swipe right to import</Text>
      </View>

      {/* Swipeable Cards */}
      {loading && currentIndex === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#E8B4E8" />
          <Text style={styles.loadingText}>Loading screenshots...</Text>
        </View>
      ) : screenshots.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={64} color="#D4A5D4" />
          <Text style={styles.emptyText}>No screenshots found</Text>
          <Text style={styles.emptySubtext}>
            Take screenshots to import them here
          </Text>
        </View>
      ) : (
        <View style={[styles.cardContainer, { paddingBottom: insets.bottom + 100 }]}>
          {renderCard()}
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    backgroundColor: 'transparent',
    padding: 16,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#5A3A5A',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#8B6B8B',
    marginTop: 4,
  },
  cardContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 20,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 24,
    backgroundColor: '#fff',
    shadowColor: '#E8B4E8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: '#f0f0f0',
  },
  swipeOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeIndicator: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  emptyCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    position: 'absolute',
    top: 0,
    shadowColor: '#E8B4E8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  emptyCardText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#5A3A5A',
    marginTop: 16,
  },
  emptyCardSubtext: {
    fontSize: 16,
    color: '#8B6B8B',
    marginTop: 8,
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#8B6B8B',
    marginTop: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#5A3A5A',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8B6B8B',
    marginTop: 8,
    textAlign: 'center',
  },
});

