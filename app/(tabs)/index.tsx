/**
 * Stacks Screen (Index)
 * 
 * Main screen showing all stacks (collections) and their items.
 * Users can browse stacks, view items within each stack, and manage
 * their content organization.
 * 
 * Features:
 * - List of all stacks with item counts
 * - Create new stacks
 * - View items within each stack
 * - Search across all items
 * 
 * Dependencies:
 * - React Native FlatList
 * - ItemCard component
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ItemCard from '@/components/ItemCard';
import { Item, Stack } from '@/lib/types';
import { getItems, getStacks, addStack } from '@/lib/storage';

export default function StacksScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  /**
   * Load stacks and items from storage
   */
  async function loadData() {
    try {
      const [allItems, allStacks] = await Promise.all([
        getItems(),
        getStacks(),
      ]);
      
      setItems(allItems.filter(item => !item.archived));
      setStacks(allStacks);
    } catch (error) {
      console.error('Failed to load data:', error);
      Alert.alert('Error', 'Failed to load data');
    }
  }

  // Load data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  /**
   * Filter items based on selected stack and search query
   */
  const filteredItems = items.filter(item => {
    // Filter by stack
    if (selectedStackId && item.stack_id !== selectedStackId) {
      return false;
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    return true;
  });

  /**
   * Handle item press
   */
  function handleItemPress(itemId: string) {
    router.push(`/item/${itemId}`);
  }

  /**
   * Handle stack press
   */
  function handleStackPress(stackId: string) {
    router.push(`/silo/${stackId}`);
  }

  /**
   * Create a new stack
   */
  async function handleCreateStack() {
    Alert.prompt(
      'New Stack',
      'Enter a name for your new stack',
      async (name) => {
        if (!name || !name.trim()) return;

        try {
          const newStack: Stack = {
            id: `stack_${Date.now()}`,
            name: name.trim(),
            color: '#667eea',
            item_count: 0,
            created_at: new Date().toISOString(),
          };

          await addStack(newStack);
          await loadData();
        } catch (error) {
          console.error('Failed to create stack:', error);
          Alert.alert('Error', 'Failed to create stack');
        }
      }
    );
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#999" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search items..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {/* Stacks Horizontal Scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stacksContainer}
      >
        <TouchableOpacity
          style={[
            styles.stackChip,
            !selectedStackId && styles.stackChipActive,
          ]}
          onPress={() => setSelectedStackId(null)}
        >
          <Ionicons name="apps" size={16} color={!selectedStackId ? '#fff' : '#333'} />
          <Text
            style={[
              styles.stackChipText,
              !selectedStackId && styles.stackChipTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>

        {stacks.map(stack => (
          <TouchableOpacity
            key={stack.id}
            style={[
              styles.stackChip,
              selectedStackId === stack.id && styles.stackChipActive,
            ]}
            onPress={() => setSelectedStackId(stack.id)}
          >
            <View
              style={[styles.stackDot, { backgroundColor: stack.color }]}
            />
            <Text
              style={[
                styles.stackChipText,
                selectedStackId === stack.id && styles.stackChipTextActive,
              ]}
            >
              {stack.name}
            </Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={styles.createStackButton}
          onPress={handleCreateStack}
        >
          <Ionicons name="add-circle-outline" size={20} color="#007AFF" />
        </TouchableOpacity>
      </ScrollView>

      {/* Items List */}
      <FlatList
        data={filteredItems}
        renderItem={({ item }) => (
          <ItemCard item={item} onPress={handleItemPress} />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No items found</Text>
            <Text style={styles.emptySubtext}>
              Add content to get started
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    marginLeft: 8,
  },
  stacksContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  stackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  stackChipActive: {
    backgroundColor: '#007AFF',
  },
  stackChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginLeft: 6,
  },
  stackChipTextActive: {
    color: '#fff',
  },
  stackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  createStackButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
  },
});

