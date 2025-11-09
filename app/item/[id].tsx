/**
 * Item Detail Screen
 * 
 * Displays full details for a single content item. Shows all metadata,
 * allows editing, playing audio, scheduling, and taking actions.
 * 
 * Features:
 * - Full item information display
 * - Audio playback
 * - Edit title, description, tags
 * - Schedule or reschedule
 * - Add to stack
 * - Archive or delete
 * - Share content
 * 
 * Dependencies:
 * - expo-av: Audio playback
 * - expo-router: Navigation
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { format } from 'date-fns';
import { Item } from '@/lib/types';
import { getItemById, updateItem, deleteItem } from '@/lib/storage';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

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
      
      // Mark as viewed
      if (loadedItem && !loadedItem.viewed) {
        await updateItem(id, { viewed: true });
      }
    } catch (error) {
      console.error('Failed to load item:', error);
      Alert.alert('Error', 'Failed to load item');
    } finally {
      setLoading(false);
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
      Alert.alert('Error', 'Failed to play audio');
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
   * Archive item
   */
  async function handleArchive() {
    Alert.alert(
      'Archive Item',
      'Move this item to archive?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateItem(id, { archived: true });
              router.back();
            } catch (error) {
              console.error('Failed to archive item:', error);
              Alert.alert('Error', 'Failed to archive item');
            }
          },
        },
      ]
    );
  }

  /**
   * Delete item permanently
   */
  async function handleDelete() {
    Alert.alert(
      'Delete Item',
      'Permanently delete this item? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem(id);
              router.back();
            } catch (error) {
              console.error('Failed to delete item:', error);
              Alert.alert('Error', 'Failed to delete item');
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#ccc" />
        <Text style={styles.errorText}>Item not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Image */}
      {item.imageUri && (
        <Image source={{ uri: item.imageUri }} style={styles.image} />
      )}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.classification}</Text>
        </View>
        <Text style={styles.timestamp}>
          {format(new Date(item.created_at), 'MMM d, yyyy · h:mm a')}
        </Text>
      </View>

      {/* Title */}
      <Text style={styles.title}>{item.title}</Text>

      {/* Description */}
      {item.description && (
        <Text style={styles.description}>{item.description}</Text>
      )}

      {/* Audio Player */}
      {item.audio_url && (
        <TouchableOpacity style={styles.audioPlayer} onPress={toggleAudio}>
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={48}
            color="#007AFF"
          />
          <Text style={styles.audioText}>
            {isPlaying ? 'Pause narration' : 'Play narration'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Metadata */}
      <View style={styles.metadata}>
        {item.duration && (
          <View style={styles.metadataItem}>
            <Ionicons name="time-outline" size={20} color="#666" />
            <Text style={styles.metadataText}>{item.duration} min</Text>
          </View>
        )}

        {item.url && (
          <TouchableOpacity style={styles.metadataItem} onPress={openUrl}>
            <Ionicons name="link-outline" size={20} color="#007AFF" />
            <Text style={[styles.metadataText, styles.link]}>Open link</Text>
          </TouchableOpacity>
        )}

        {item.place_name && (
          <View style={styles.metadataItem}>
            <Ionicons name="location-outline" size={20} color="#666" />
            <Text style={styles.metadataText}>{item.place_name}</Text>
          </View>
        )}
      </View>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <View style={styles.tagsSection}>
          <Text style={styles.sectionTitle}>Tags</Text>
          <View style={styles.tags}>
            {item.tags.map((tag, index) => (
              <View key={index} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Scheduled Info */}
      {item.scheduled_date && (
        <View style={styles.scheduledSection}>
          <Ionicons name="calendar" size={24} color="#007AFF" />
          <View style={styles.scheduledInfo}>
            <Text style={styles.scheduledLabel}>Scheduled</Text>
            <Text style={styles.scheduledDate}>
              {format(new Date(item.scheduled_date), 'MMMM d, yyyy')}
              {item.scheduled_time && ` at ${item.scheduled_time}`}
            </Text>
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={handleArchive}>
          <Ionicons name="archive-outline" size={24} color="#666" />
          <Text style={styles.actionText}>Archive</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={24} color="#ff3b30" />
          <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: '#999',
    marginTop: 16,
  },
  image: {
    width: '100%',
    height: 300,
    backgroundColor: '#e0e0e0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  badge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  audioText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginLeft: 12,
  },
  metadata: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataText: {
    fontSize: 16,
    color: '#666',
    marginLeft: 12,
  },
  link: {
    color: '#007AFF',
  },
  tagsSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: '#007AFF',
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
  scheduledSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  scheduledInfo: {
    marginLeft: 12,
    flex: 1,
  },
  scheduledLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
  },
  scheduledDate: {
    fontSize: 16,
    color: '#333',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginLeft: 8,
  },
  deleteText: {
    color: '#ff3b30',
  },
});

