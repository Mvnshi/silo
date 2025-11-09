/**
 * StreamCard Component
 * 
 * A TikTok-style full-screen card for displaying content items in the reel feed.
 * Features audio playback, interactive controls, and swipe gestures.
 * 
 * Props:
 * - item: Content item to display
 * - onArchive: Callback when item is archived
 * - onSchedule: Callback when item is scheduled
 * - onAddToStack: Callback when item is added to a stack
 * 
 * Dependencies:
 * - expo-av: Audio playback
 * - expo-linear-gradient: Background gradients
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/lib/types';

const { width, height } = Dimensions.get('window');

interface StreamCardProps {
  item: Item;
  onArchive: (itemId: string) => void;
  onSchedule: (itemId: string) => void;
  onAddToStack: (itemId: string) => void;
}

export default function StreamCard({ 
  item, 
  onArchive, 
  onSchedule, 
  onAddToStack 
}: StreamCardProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  /**
   * Load and play audio when component mounts
   */
  useEffect(() => {
    if (item.audio_url) {
      loadAudio();
    }

    return () => {
      // Cleanup audio on unmount
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [item.audio_url]);

  /**
   * Load audio from Vultr CDN URL
   */
  async function loadAudio() {
    try {
      if (!item.audio_url) return;

      const { sound: audioSound } = await Audio.Sound.createAsync(
        { uri: item.audio_url },
        { shouldPlay: false }
      );
      
      setSound(audioSound);
    } catch (error) {
      console.error('Failed to load audio:', error);
    }
  }

  /**
   * Toggle audio playback
   */
  async function togglePlayback() {
    if (!sound) return;

    try {
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
    } catch (error) {
      console.error('Failed to toggle playback:', error);
    }
  }

  /**
   * Get icon for classification type
   */
  function getClassificationIcon(): keyof typeof Ionicons.glyphMap {
    switch (item.classification) {
      case 'article': return 'newspaper-outline';
      case 'video': return 'play-circle-outline';
      case 'recipe': return 'restaurant-outline';
      case 'product': return 'cart-outline';
      case 'event': return 'calendar-outline';
      case 'place': return 'location-outline';
      case 'idea': return 'bulb-outline';
      default: return 'document-outline';
    }
  }

  /**
   * Get background color for classification type
   */
  function getClassificationColor(): string[] {
    switch (item.classification) {
      case 'article': return ['#667eea', '#764ba2'];
      case 'video': return ['#f093fb', '#f5576c'];
      case 'recipe': return ['#4facfe', '#00f2fe'];
      case 'product': return ['#43e97b', '#38f9d7'];
      case 'event': return ['#fa709a', '#fee140'];
      case 'place': return ['#30cfd0', '#330867'];
      case 'idea': return ['#a8edea', '#fed6e3'];
      default: return ['#667eea', '#764ba2'];
    }
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={getClassificationColor()}
        style={styles.gradient}
      >
        <ScrollView 
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Classification Badge */}
          <View style={styles.badge}>
            <Ionicons 
              name={getClassificationIcon()} 
              size={20} 
              color="#fff" 
            />
            <Text style={styles.badgeText}>
              {item.classification.toUpperCase()}
            </Text>
          </View>

          {/* Title */}
          <Text style={styles.title}>{item.title}</Text>

          {/* Description */}
          {item.description && (
            <Text style={styles.description}>{item.description}</Text>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {item.tags.map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Place Info */}
          {item.place_name && (
            <View style={styles.placeInfo}>
              <Ionicons name="location" size={16} color="#fff" />
              <Text style={styles.placeText}>{item.place_name}</Text>
            </View>
          )}

          {/* Duration */}
          {item.duration && (
            <View style={styles.durationInfo}>
              <Ionicons name="time-outline" size={16} color="#fff" />
              <Text style={styles.durationText}>{item.duration} min</Text>
            </View>
          )}
        </ScrollView>

        {/* Action Buttons */}
        <View style={styles.actions}>
          {/* Audio Playback */}
          {item.audio_url && (
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={togglePlayback}
            >
              <Ionicons 
                name={isPlaying ? 'pause-circle' : 'play-circle'} 
                size={48} 
                color="#fff" 
              />
            </TouchableOpacity>
          )}

          {/* Schedule */}
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => onSchedule(item.id)}
          >
            <Ionicons name="calendar" size={32} color="#fff" />
            <Text style={styles.actionLabel}>Schedule</Text>
          </TouchableOpacity>

          {/* Add to Stack */}
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => onAddToStack(item.id)}
          >
            <Ionicons name="folder" size={32} color="#fff" />
            <Text style={styles.actionLabel}>Stack</Text>
          </TouchableOpacity>

          {/* Archive */}
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => onArchive(item.id)}
          >
            <Ionicons name="archive" size={32} color="#fff" />
            <Text style={styles.actionLabel}>Archive</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: width,
    height: height,
  },
  gradient: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingBottom: 120,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 20,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  description: {
    fontSize: 18,
    color: '#fff',
    lineHeight: 28,
    marginBottom: 20,
    opacity: 0.95,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  tag: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  placeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  placeText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 8,
  },
  durationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 8,
  },
  actions: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    marginBottom: 24,
  },
  actionLabel: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
});

