/**
 * CompactCard Component
 * 
 * A compact card component for grid view in Stacks screen.
 * Shows preview image, title, and classification badge.
 * 
 * Props:
 * - item: Content item to display
 * - onPress: Callback when card is tapped
 * - onSwipeLeft: Callback when swiped left (mark as done)
 * - onSwipeRight: Callback when swiped right (unmark as done)
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Item } from '@/lib/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 60;

interface CompactCardProps {
  item: Item;
  onPress: (itemId: string) => void;
  onSwipeLeft?: (itemId: string) => void;
  onSwipeRight?: (itemId: string) => void;
}

export default function CompactCard({ item, onPress, onSwipeLeft, onSwipeRight }: CompactCardProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

  /**
   * Get background color for classification type
   */
  function getClassificationColor(): string {
    switch (item.classification) {
      case 'article': return '#667eea';
      case 'video': return '#f093fb';
      case 'recipe': return '#4facfe';
      case 'product': return '#43e97b';
      case 'event': return '#fa709a';
      case 'place': return '#30cfd0';
      case 'idea': return '#a8edea';
      case 'fitness': return '#FF6B6B';
      case 'food': return '#FFA07A';
      case 'career': return '#4ECDC4';
      case 'academia': return '#95E1D3';
      default: return '#667eea';
    }
  }

  /**
   * Get icon for classification type
   */
  function getClassificationIcon(): keyof typeof Ionicons.glyphMap {
    switch (item.classification) {
      case 'article': return 'newspaper';
      case 'video': return 'play-circle';
      case 'recipe': return 'restaurant';
      case 'product': return 'cart';
      case 'event': return 'calendar';
      case 'place': return 'location';
      case 'idea': return 'bulb';
      case 'fitness': return 'fitness';
      case 'food': return 'restaurant';
      case 'career': return 'briefcase';
      case 'academia': return 'school';
      default: return 'document';
    }
  }

  /**
   * Pan gesture for swipe left (mark as done) and swipe right (unmark as done)
   */
  const panGesture = Gesture.Pan()
    .activeOffsetX([-5, 5]) // Very small threshold to activate quickly
    .failOffsetY([-30, 30]) // More lenient vertical threshold
    .onStart(() => {
      // Reset values on start
      translateX.value = 0;
      opacity.value = 1;
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
      if (event.translationX < 0) {
        opacity.value = Math.max(0.7, 1 + event.translationX / SWIPE_THRESHOLD);
      } else {
        opacity.value = Math.max(0.7, 1 - event.translationX / SWIPE_THRESHOLD);
      }
    })
    .onEnd((event) => {
      if (event.translationX < -SWIPE_THRESHOLD) {
        // Swipe left was far enough, mark as done and spring back
        if (onSwipeLeft) {
          runOnJS(onSwipeLeft)(item.id);
        }
        translateX.value = withSpring(0, { damping: 20, stiffness: 90 });
        opacity.value = withSpring(1);
      } else if (event.translationX > SWIPE_THRESHOLD) {
        // Swipe right was far enough, unmark as done and spring back
        if (onSwipeRight) {
          runOnJS(onSwipeRight)(item.id);
        }
        translateX.value = withSpring(0, { damping: 20, stiffness: 90 });
        opacity.value = withSpring(1);
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[animatedStyle, { flex: 1 }]}>
          <TouchableOpacity
            style={styles.container}
            onPress={() => onPress(item.id)}
            activeOpacity={0.8}
          >
            {/* Preview Image or Placeholder */}
            <View style={[styles.imageContainer, { backgroundColor: getClassificationColor() }]}>
              {item.imageUri ? (
                <Image
                  source={{ uri: item.imageUri }}
                  style={styles.image}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.placeholder}>
                  <Ionicons 
                    name={getClassificationIcon()} 
                    size={32} 
                    color="#fff" 
                  />
                </View>
              )}
              
              {/* Done Badge */}
              {item.viewed && (
                <View style={styles.doneBadge}>
                  <Ionicons name="checkmark-circle" size={20} color="#4cd964" />
                </View>
              )}
            </View>

            {/* Title */}
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>

            {/* Classification Badge */}
            <View style={[styles.badge, { backgroundColor: getClassificationColor() }]}>
              <Text style={styles.badgeText}>
                {item.classification}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    margin: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.8,
  },
  doneBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    padding: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    padding: 8,
    paddingBottom: 4,
    lineHeight: 18,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
    marginBottom: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'capitalize',
  },
});

