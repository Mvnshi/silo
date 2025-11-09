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

import React, { useState, useCallback, useEffect } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import ItemCard from '@/components/ItemCard';
import { Item, Stack } from '@/lib/types';
import { getItems, getStacks, addStack, updateItem, deleteItem } from '@/lib/storage';
import { aiSearch } from '@/lib/api';
import { scheduleItemReview } from '@/lib/scheduler';

export default function StacksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState<Set<string>>(new Set());

  /**
   * Load stacks and items from storage
   */
  async function loadData() {
    try {
      const [allItems, allStacks] = await Promise.all([
        getItems(),
        getStacks(),
      ]);
      
      console.log(`📊 Loaded ${allItems.length} items and ${allStacks.length} stacks`);
      if (allStacks.length > 0) {
        console.log('📦 Stacks:', allStacks.map(s => s.name).join(', '));
      }
      
      setItems(allItems.filter(item => !item.archived));
      setStacks(allStacks);
      
      // Check if we have the expected stacks (Fitness, Food, Tech, Places)
      const expectedStackIds = ['stack_fitness', 'stack_food', 'stack_tech', 'stack_places'];
      const existingStackIds = new Set(allStacks.map(s => s.id));
      const missingStacks = expectedStackIds.filter(id => !existingStackIds.has(id));
      
      if (missingStacks.length > 0) {
        console.log(`⚠️ Missing expected stacks: ${missingStacks.join(', ')}, attempting to seed...`);
        const { seedData } = await import('@/lib/seed');
        await seedData();
        // Reload after seeding
        const [newItems, newStacks] = await Promise.all([
          getItems(),
          getStacks(),
        ]);
        setItems(newItems.filter(item => !item.archived));
        setStacks(newStacks);
        console.log(`✅ After seeding: ${newStacks.length} stacks and ${newItems.length} items`);
        console.log('📦 Stacks now:', newStacks.map(s => s.name).join(', '));
      }
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
   * Perform AI-powered search when query changes
   */
  useEffect(() => {
    if (searchQuery.trim() && searchQuery.length > 2) {
      setIsAiSearching(true);
      const timeoutId = setTimeout(async () => {
        try {
          const searchableItems = items.map((item, index) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            tags: item.tags,
            classification: item.classification,
          }));
          const resultIndices = await aiSearch(searchQuery, searchableItems);
          // aiSearch returns indices, convert to item IDs
          const resultIds = resultIndices
            .map(idx => {
              const index = parseInt(idx);
              return items[index]?.id;
            })
            .filter(Boolean) as string[];
          setAiSearchResults(new Set(resultIds));
        } catch (error) {
          console.error('AI search failed:', error);
          // Fallback to keyword search
          const keywordResults = items
            .filter(item => {
              const q = searchQuery.toLowerCase();
              return (
                item.title.toLowerCase().includes(q) ||
                item.description?.toLowerCase().includes(q) ||
                item.tags.some(tag => tag.toLowerCase().includes(q))
              );
            })
            .map(item => item.id);
          setAiSearchResults(new Set(keywordResults));
        } finally {
          setIsAiSearching(false);
        }
      }, 300); // Debounce 300ms

      return () => clearTimeout(timeoutId);
    } else {
      setAiSearchResults(new Set());
      setIsAiSearching(false);
    }
  }, [searchQuery, items]);

  /**
   * Filter items based on selected stack and search query
   */
  const filteredItems = items.filter(item => {
    // Filter by stack
    if (selectedStackId && item.stack_id !== selectedStackId) {
      return false;
    }
    
    // Filter by search query (AI-powered or keyword)
    if (searchQuery) {
      if (aiSearchResults.size > 0) {
        return aiSearchResults.has(item.id);
      }
      // Fallback keyword search
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
    router.push(`/item/${itemId}?from=stacks`);
  }

  /**
   * Handle long press on item card - show quick actions
   */
  function handleItemLongPress(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const actions = [
      {
        text: item.archived ? 'Unarchive' : 'Archive',
        onPress: async () => {
          try {
            await updateItem(itemId, { archived: !item.archived });
            await loadData();
          } catch (error) {
            console.error('Failed to update item:', error);
            Alert.alert('Error', 'Failed to update item');
          }
        },
      },
      {
        text: item.viewed ? 'Mark Unviewed' : 'Mark Viewed',
        onPress: async () => {
          try {
            await updateItem(itemId, { viewed: !item.viewed });
            await loadData();
          } catch (error) {
            console.error('Failed to update item:', error);
            Alert.alert('Error', 'Failed to update item');
          }
        },
      },
      {
        text: item.scheduled_date ? 'Unschedule' : 'Schedule',
        onPress: async () => {
          if (item.scheduled_date) {
            // Unschedule
            try {
              await updateItem(itemId, { scheduled_date: undefined, scheduled_time: undefined });
              await loadData();
            } catch (error) {
              console.error('Failed to unschedule item:', error);
              Alert.alert('Error', 'Failed to unschedule item');
            }
          } else {
            // Schedule - show date/time picker
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);

            Alert.alert(
              'Schedule Item',
              'Choose when to review this item',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Tomorrow 9 AM',
                  onPress: async () => {
                    try {
                      const dateStr = format(tomorrow, 'yyyy-MM-dd');
                      const timeStr = format(tomorrow, 'HH:mm');
                      await updateItem(itemId, {
                        scheduled_date: dateStr,
                        scheduled_time: timeStr,
                      });
                      await scheduleItemReview(item, dateStr, timeStr, item.duration || 15);
                      await loadData();
                    } catch (error) {
                      console.error('Failed to schedule item:', error);
                      Alert.alert('Error', 'Failed to schedule item');
                    }
                  },
                },
                {
                  text: 'Pick Date & Time',
                  onPress: () => {
                    router.push(`/item/${itemId}?schedule=true`);
                  },
                },
              ]
            );
          }
        },
      },
      {
        text: 'Delete',
        style: 'destructive' as const,
        onPress: () => {
          Alert.alert(
            'Delete Item',
            `Delete "${item.title}"? This cannot be undone.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteItem(itemId);
                    await loadData();
                  } catch (error) {
                    console.error('Failed to delete item:', error);
                    Alert.alert('Error', 'Failed to delete item');
                  }
                },
              },
            ]
          );
        },
      },
      { text: 'Cancel', style: 'cancel' as const },
    ];

    Alert.alert(item.title, 'Quick Actions', actions);
  }

  /**
   * Handle stack press
   */
  function handleStackPress(stackId: string) {
    router.push(`/silo/${stackId}`);
  }

  /**
   * Handle long press on stack (rename/delete)
   */
  function handleStackLongPress(stackId: string) {
    const stack = stacks.find(s => s.id === stackId);
    if (!stack) return;

    Alert.alert(
      stack.name,
      'What would you like to do?',
      [
        {
          text: 'Rename',
          onPress: () => {
            Alert.prompt(
              'Rename Stack',
              'Enter a new name',
              async (name) => {
                if (!name || !name.trim()) return;
                try {
                  const { updateStack } = await import('@/lib/storage');
                  await updateStack(stackId, { name: name.trim() });
                  await loadData();
                } catch (error) {
                  console.error('Failed to rename stack:', error);
                  Alert.alert('Error', 'Failed to rename stack');
                }
              },
              'plain-text',
              stack.name
            );
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Stack',
              `Delete "${stack.name}"? Items will not be deleted.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const { deleteStack } = await import('@/lib/storage');
                      await deleteStack(stackId);
                      await loadData();
                    } catch (error) {
                      console.error('Failed to delete stack:', error);
                      Alert.alert('Error', 'Failed to delete stack');
                    }
                  },
                },
              ]
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
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

  /**
   * Force seed data (dev helper)
   */
  async function handleForceSeed() {
    try {
      const { seedData } = await import('@/lib/seed');
      await seedData();
      await loadData();
      Alert.alert('Success', 'Seed data loaded!');
    } catch (error) {
      console.error('Failed to force seed:', error);
      Alert.alert('Error', 'Failed to load seed data');
    }
  }

  return (
    <View style={styles.container}>
      {/* Sticky Search and Stacks Bar */}
      <View style={[styles.stickyHeader, { paddingTop: insets.top + 8 }]}>
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
          {isAiSearching && (
            <Ionicons name="sparkles" size={20} color="#007AFF" />
          )}
          {searchQuery.length > 0 && !isAiSearching && (
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
              onLongPress={() => handleStackLongPress(stack.id)}
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
          
          {/* Dev: Force seed button (only show if no stacks) */}
          {stacks.length === 0 && (
            <TouchableOpacity
              style={[styles.createStackButton, { marginLeft: 8 }]}
              onPress={handleForceSeed}
            >
              <Ionicons name="refresh" size={20} color="#4CAF50" />
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      <FlatList
        data={filteredItems}
        renderItem={({ item }) => (
          <ItemCard 
            item={item} 
            onPress={handleItemPress}
            onLongPress={handleItemLongPress}
          />
        )}
        keyExtractor={item => item.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: 120, // Space for sticky header
          paddingBottom: insets.bottom + 120,
        }}
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
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerSpacer: {
    height: 120, // Space for sticky header
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 12,
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
    minWidth: 60,
  },
  stackChipActive: {
    backgroundColor: '#007AFF',
  },
  stackChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginLeft: 6,
    flexShrink: 0,
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

