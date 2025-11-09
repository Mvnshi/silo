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
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import StreamCard from '@/components/StreamCard';
import { Item } from '@/lib/types';
import { getItems, updateItem } from '@/lib/storage';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function ReelScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Load items from storage
   */
  async function loadItems() {
    try {
      const allItems = await getItems();
      // Filter out archived and viewed items for the feed
      const feedItems = allItems.filter(item => !item.archived && !item.viewed);
      setItems(feedItems);
    } catch (error) {
      console.error('Failed to load items:', error);
      Alert.alert('Error', 'Failed to load content');
    }
  }

  // Load items when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [])
  );

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
   * Schedule an item
   */
  function handleSchedule(itemId: string) {
    // TODO: Implement schedule modal
    Alert.alert('Schedule', 'Scheduling feature coming soon!');
  }

  /**
   * Add item to a stack
   */
  function handleAddToStack(itemId: string) {
    // TODO: Implement stack picker modal
    Alert.alert('Add to Stack', 'Stack selection coming soon!');
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        renderItem={({ item }) => (
          <StreamCard
            item={item}
            onArchive={handleArchive}
            onSchedule={handleSchedule}
            onAddToStack={handleAddToStack}
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

