/**
 * ItemCard Component
 *
 * A compact list-row card for content items (Calendar screen, Search results).
 * Swipe left to mark done, swipe right to unmark; tap to open, long-press for
 * actions. Done state (strikethrough + checkmark) is derived from the item.
 *
 * Props:
 * - item: Content item to display
 * - onPress: Callback when card is tapped
 * - onLongPress: Callback on long press
 * - onSwipeLeft / onSwipeRight: Callbacks past the swipe threshold
 *
 * Dependencies:
 * - React Native core components
 * - @expo/vector-icons
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Item } from '@/lib/types';
import { classConfig } from '@/lib/classification';
import { BRAND, INK } from '@/lib/theme';
import { format } from 'date-fns';

const SWIPE_THRESHOLD = 80;

interface ItemCardProps {
  item: Item;
  onPress: (itemId: string) => void;
  onLongPress?: (itemId: string) => void;
  onSwipeLeft?: (itemId: string) => void;
  onSwipeRight?: (itemId: string) => void;
}

function ItemCard({ item, onPress, onLongPress, onSwipeLeft, onSwipeRight }: ItemCardProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  // Single source of truth for the "done" visual (strikethrough + checkmark).
  const isDone = item.status === 'done' || item.bucketlist_completed === true || item.viewed === true;

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
      // Slight fade as we swipe
      if (event.translationX < 0) {
        // Swiping left
        opacity.value = Math.max(0.7, 1 + event.translationX / SWIPE_THRESHOLD);
      } else {
        // Swiping right
        opacity.value = Math.max(0.7, 1 - event.translationX / SWIPE_THRESHOLD);
      }
    })
    .onEnd((event) => {
      if (event.translationX < -SWIPE_THRESHOLD) {
        // Swipe left was far enough, mark as done and spring back
        if (onSwipeLeft) {
          runOnJS(onSwipeLeft)(item.id);
        }
        // Spring back to original position
        translateX.value = withSpring(0, {
          damping: 20,
          stiffness: 90,
        });
        opacity.value = withSpring(1);
      } else if (event.translationX > SWIPE_THRESHOLD) {
        // Swipe right was far enough, unmark as done and spring back
        if (onSwipeRight) {
          runOnJS(onSwipeRight)(item.id);
        }
        // Spring back to original position
        translateX.value = withSpring(0, {
          damping: 20,
          stiffness: 90,
        });
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
  // Per-classification visuals (icon + accent color) from the shared palette.
  const cfg = classConfig(item.classification);

  /**
   * Format timestamp for display
   */
  function formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return format(date, 'MMM d');
    } catch {
      return '';
    }
  }

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={styles.container}
          onPress={() => onPress(item.id)}
          onLongPress={() => onLongPress?.(item.id)}
          activeOpacity={0.7}
        >
      {/* Left Color Bar */}
      <View
        style={[
          styles.colorBar,
          { backgroundColor: cfg.from }
        ]}
      />

      {/* Content */}
      <View style={styles.content}>
        {/* Header Row */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: cfg.from }
              ]}
            >
              <Ionicons
                name={cfg.icon}
                size={16}
                color="#fff"
              />
            </View>
            <Text style={styles.classification}>
              {item.classification}
            </Text>
          </View>
          
          <Text style={styles.timestamp}>
            {formatTimestamp(item.created_at)}
          </Text>
        </View>

        {/* Title */}
        <Text style={[styles.title, isDone && styles.titleCompleted]} numberOfLines={2}>
          {item.title}
        </Text>

        {/* Description */}
        {item.description && (
          <Text style={[styles.description, isDone && styles.descriptionCompleted]} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        {/* Footer Row */}
        <View style={styles.footer}>
          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <View style={styles.tags}>
              {item.tags.slice(0, 3).map((tag) => (
                <Text key={tag} style={styles.tag}>
                  #{tag}
                </Text>
              ))}
              {item.tags.length > 3 && (
                <Text style={styles.tag}>
                  +{item.tags.length - 3}
                </Text>
              )}
            </View>
          )}

          {/* Indicators */}
          <View style={styles.indicators}>
            {item.audio_url && (
              <Ionicons name="volume-medium" size={16} color={INK[400]} />
            )}
            {item.scheduled_date && (
              <Ionicons
                name="calendar-outline"
                size={16}
                color={BRAND[600]}
                style={{ marginLeft: 8 }}
              />
            )}
            {isDone && (
              <Ionicons
                name="checkmark-circle"
                size={16}
                color="#4cd964"
                style={{ marginLeft: 8 }}
              />
            )}
            {item.bucketlist && (
              <Ionicons 
                name="list" 
                size={16} 
                color="#FF6B6B" 
                style={{ marginLeft: 8 }}
              />
            )}
            {item.duration && (
              <View style={styles.duration}>
                <Ionicons name="time-outline" size={14} color={INK[400]} />
                <Text style={styles.durationText}>{item.duration}m</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
      </Animated.View>
    </GestureDetector>
  );
}

// Memoized: this is a FlatList row in list views.
export default React.memo(ItemCard);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  colorBar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  classification: {
    fontSize: 12,
    fontWeight: '600',
    color: INK[500],
    textTransform: 'capitalize',
  },
  timestamp: {
    fontSize: 12,
    color: INK[400],
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: INK[900],
    marginBottom: 4,
    lineHeight: 22,
  },
  description: {
    fontSize: 14,
    color: INK[500],
    lineHeight: 20,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tags: {
    flexDirection: 'row',
    flex: 1,
  },
  tag: {
    fontSize: 12,
    color: BRAND[600],
    marginRight: 8,
  },
  indicators: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  duration: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  durationText: {
    fontSize: 12,
    color: INK[400],
    marginLeft: 2,
  },
  titleCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  descriptionCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
});

