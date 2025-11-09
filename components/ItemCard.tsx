/**
 * ItemCard Component
 * 
 * A compact card component for displaying content items in list views
 * (Stacks screen, Calendar screen, Search results).
 * 
 * Props:
 * - item: Content item to display
 * - onPress: Callback when card is tapped
 * - showStack: Whether to show stack name badge
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
import { Item } from '@/lib/types';
import { format } from 'date-fns';

interface ItemCardProps {
  item: Item;
  onPress: (itemId: string) => void;
  showStack?: boolean;
}

export default function ItemCard({ item, onPress, showStack = false }: ItemCardProps) {
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
      default: return 'document';
    }
  }

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
      default: return '#667eea';
    }
  }

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
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(item.id)}
      activeOpacity={0.7}
    >
      {/* Left Color Bar */}
      <View 
        style={[
          styles.colorBar, 
          { backgroundColor: getClassificationColor() }
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
                { backgroundColor: getClassificationColor() }
              ]}
            >
              <Ionicons 
                name={getClassificationIcon()} 
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
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>

        {/* Description */}
        {item.description && (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        {/* Footer Row */}
        <View style={styles.footer}>
          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <View style={styles.tags}>
              {item.tags.slice(0, 3).map((tag, index) => (
                <Text key={index} style={styles.tag}>
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
              <Ionicons name="volume-medium" size={16} color="#999" />
            )}
            {item.scheduled_date && (
              <Ionicons 
                name="calendar-outline" 
                size={16} 
                color="#007AFF" 
                style={{ marginLeft: 8 }}
              />
            )}
            {item.viewed && (
              <Ionicons 
                name="checkmark-circle" 
                size={16} 
                color="#4cd964" 
                style={{ marginLeft: 8 }}
              />
            )}
            {item.duration && (
              <View style={styles.duration}>
                <Ionicons name="time-outline" size={14} color="#999" />
                <Text style={styles.durationText}>{item.duration}m</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

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
    color: '#666',
    textTransform: 'capitalize',
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
    lineHeight: 22,
  },
  description: {
    fontSize: 14,
    color: '#666',
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
    color: '#007AFF',
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
    color: '#999',
    marginLeft: 2,
  },
});

