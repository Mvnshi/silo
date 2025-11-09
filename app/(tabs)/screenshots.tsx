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

import React, { useState, useCallback } from 'react';
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
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { analyzeImage, generateAudio } from '@/lib/api';
import { addItem } from '@/lib/storage';
import { Item } from '@/lib/types';

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
   * Handle swipe right (import)
   */
  async function handleSwipeRight(screenshot: Screenshot) {
    try {
      setLoading(true);
      await importScreenshot(screenshot);
      moveToNext();
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      Alert.alert('Error', 'Failed to import screenshot');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle swipe left (skip)
   */
  function handleSwipeLeft() {
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

      // Generate audio if script is available
      if (analysis.script) {
        try {
          const audioResponse = await generateAudio(analysis.script, item.id);
          item.audio_url = audioResponse.audioUrl;
        } catch (error) {
          console.error('Failed to generate audio:', error);
          // Continue without audio
        }
      }

      // Save item
      await addItem(item);
    } catch (error) {
      console.error('Failed to import screenshot:', error);
      throw error;
    }
  }

  /**
   * Pan gesture handler
   */
  let panGesture: ReturnType<typeof Gesture.Pan> | null = null;
  try {
    panGesture = Gesture.Pan()
      .onUpdate((event) => {
        translateX.value = event.translationX;
        translateY.value = event.translationY;
        // More natural rotation like Tinder
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
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading screenshots...</Text>
        </View>
      ) : screenshots.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={64} color="#ccc" />
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
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
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
    borderRadius: 16,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
    position: 'absolute',
    top: 0,
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    backgroundColor: '#e0e0e0',
  },
  swipeOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
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
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    position: 'absolute',
    top: 0,
  },
  emptyCardText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginTop: 16,
  },
  emptyCardSubtext: {
    fontSize: 16,
    color: '#666',
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
    color: '#666',
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
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
});

