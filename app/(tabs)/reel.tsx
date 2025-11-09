/**
 * Reel Screen (Streams Feed)
 * 
 * TikTok-style vertical swipeable feed for browsing content.
 * Users can swipe through items, play audio narrations, and take actions
 * (schedule, add to stack, archive).
 * 
 * Features:
 * - Full-screen vertical scrolling
 * - Audio playback for each item
 * - Quick actions (schedule, stack, archive)
 * - Filters by classification
 * 
 * Dependencies:
 * - React Native FlatList with pagination
 * - StreamCard component
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Alert,
  RefreshControl,
  Dimensions,
  TouchableOpacity,
  Text,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import StreamCard from '@/components/StreamCard';
import { Item, Classification } from '@/lib/types';
import { getItems, updateItem } from '@/lib/storage';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ReelScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Classification | 'all'>('all');

  /**
   * Load items from storage
   */
  async function loadItems() {
    try {
      const allItems = await getItems();
      // Show all non-archived, unviewed items (completed items don't show in stream)
      // Prioritize videos and unviewed items
      const feedItems = allItems
        .filter(item => !item.archived && !item.viewed)
        .sort((a, b) => {
          // Prioritize videos
          if (a.classification === 'video' && b.classification !== 'video') return -1;
          if (b.classification === 'video' && a.classification !== 'video') return 1;
          // Then by creation date (newest first)
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      setItems(feedItems);
      applyCategoryFilter(feedItems, selectedCategory);
    } catch (error) {
      console.error('Failed to load items:', error);
      Alert.alert('Error', 'Failed to load content');
    }
  }

  /**
   * Apply category filter
   */
  function applyCategoryFilter(allItems: Item[], category: Classification | 'all') {
    if (category === 'all') {
      setFilteredItems(allItems);
    } else {
      setFilteredItems(allItems.filter(item => item.classification === category));
    }
  }

  /**
   * Handle category selection
   */
  function handleCategorySelect(category: Classification | 'all') {
    setSelectedCategory(category);
    applyCategoryFilter(items, category);
  }

  // Load items when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [])
  );

  // Update filtered items when category changes
  useEffect(() => {
    applyCategoryFilter(items, selectedCategory);
  }, [selectedCategory, items]);

  /**
   * Handle pull to refresh
   */
  async function handleRefresh() {
    setRefreshing(true);
    await loadItems();
    setRefreshing(false);
  }

  /**
   * Archive an item
   */
  async function handleArchive(itemId: string) {
    try {
      await updateItem(itemId, { archived: true, viewed: true });
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
    } catch (error) {
      console.error('Failed to archive item:', error);
      Alert.alert('Error', 'Failed to archive item');
    }
  }

  /**
   * Schedule an item - navigate to item detail with schedule modal
   */
  function handleSchedule(itemId: string) {
    router.push(`/item/${itemId}?schedule=true`);
  }

  /**
   * Mark item as completed/viewed - removes from stream
   */
  async function handleComplete(itemId: string) {
    try {
      await updateItem(itemId, { viewed: true });
      // Remove from current feed
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
      setFilteredItems(prevItems => prevItems.filter(item => item.id !== itemId));
    } catch (error) {
      console.error('Failed to mark item as completed:', error);
      Alert.alert('Error', 'Failed to mark item as completed');
    }
  }

  const categories: Array<{ label: string; value: Classification | 'all'; icon: keyof typeof Ionicons.glyphMap }> = [
    { label: 'All', value: 'all', icon: 'apps' },
    { label: 'Videos', value: 'video', icon: 'play-circle' },
    { label: 'Fitness', value: 'fitness', icon: 'fitness' },
    { label: 'Food', value: 'food', icon: 'restaurant' },
    { label: 'Career', value: 'career', icon: 'briefcase' },
    { label: 'Academia', value: 'academia', icon: 'school' },
    { label: 'Articles', value: 'article', icon: 'newspaper' },
  ];

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredItems}
        renderItem={({ item }) => (
          <StreamCard
            item={item}
            onArchive={handleArchive}
            onSchedule={handleSchedule}
            onComplete={handleComplete}
          />
        )}
        keyExtractor={item => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(data, index) => ({
          length: SCREEN_HEIGHT,
          offset: SCREEN_HEIGHT * index,
          index,
        })}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="videocam-outline" size={64} color="#666" />
            <Text style={styles.emptyText}>No content found</Text>
            <Text style={styles.emptySubtext}>
              Try selecting a different category
            </Text>
          </View>
        }
      />
      
      {/* Floating Category Filter Bar */}
      <View style={[styles.floatingCategories, { paddingTop: insets.top + 8 }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat.value}
              style={[
                styles.categoryChip,
                selectedCategory === cat.value && styles.categoryChipActive,
              ]}
              onPress={() => handleCategorySelect(cat.value)}
            >
              <Ionicons 
                name={cat.icon} 
                size={16} 
                color={selectedCategory === cat.value ? '#fff' : '#999'} 
              />
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === cat.value && styles.categoryChipTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  listContent: {
    backgroundColor: 'transparent',
  },
  floatingCategories: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'transparent',
  },
  categoryScroll: {
    paddingHorizontal: 0,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: '#007AFF',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
});

