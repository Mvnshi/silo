/**
 * Stack Detail Screen
 * 
 * Displays all items within a specific stack (collection). Users can
 * view, organize, and manage items in the stack.
 * 
 * Features:
 * - List of all items in the stack
 * - Stack metadata (name, description, color)
 * - Edit stack details
 * - Remove items from stack
 * - Delete stack
 * 
 * Dependencies:
 * - expo-router: Navigation
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ItemCard from '@/components/ItemCard';
import { Stack, Item } from '@/lib/types';
import { getStackById, getItems, updateStack, deleteStack } from '@/lib/storage';

export default function StackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [stack, setStack] = useState<Stack | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load stack and its items
   */
  async function loadData() {
    try {
      setLoading(true);
      const [loadedStack, allItems] = await Promise.all([
        getStackById(id),
        getItems(),
      ]);

      setStack(loadedStack);

      // Filter items that belong to this stack
      const stackItems = allItems.filter(
        item => item.stack_id === id && !item.archived
      );
      setItems(stackItems);

      // Update item count if it changed
      if (loadedStack && loadedStack.item_count !== stackItems.length) {
        await updateStack(id, { item_count: stackItems.length });
        setStack({ ...loadedStack, item_count: stackItems.length });
      }
    } catch (error) {
      console.error('Failed to load stack:', error);
      Alert.alert('Error', 'Failed to load stack');
    } finally {
      setLoading(false);
    }
  }

  // Load data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [id])
  );

  /**
   * Handle item press
   */
  function handleItemPress(itemId: string) {
    router.push(`/item/${itemId}`);
  }

  /**
   * Edit stack details
   */
  function handleEditStack() {
    if (!stack) return;

    Alert.prompt(
      'Edit Stack',
      'Enter a new name for this stack',
      async (name) => {
        if (!name || !name.trim()) return;

        try {
          await updateStack(id, { name: name.trim() });
          setStack({ ...stack, name: name.trim() });
        } catch (error) {
          console.error('Failed to update stack:', error);
          Alert.alert('Error', 'Failed to update stack');
        }
      },
      'plain-text',
      stack.name
    );
  }

  /**
   * Delete stack
   */
  function handleDeleteStack() {
    Alert.alert(
      'Delete Stack',
      'Delete this stack? Items will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStack(id);
              router.back();
            } catch (error) {
              console.error('Failed to delete stack:', error);
              Alert.alert('Error', 'Failed to delete stack');
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

  if (!stack) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#ccc" />
        <Text style={styles.errorText}>Stack not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Stack Header */}
      <View style={[styles.header, { backgroundColor: stack.color }]}>
        <View style={styles.headerContent}>
          <Text style={styles.stackName}>{stack.name}</Text>
          {stack.description && (
            <Text style={styles.stackDescription}>{stack.description}</Text>
          )}
          <Text style={styles.itemCount}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleEditStack}
          >
            <Ionicons name="pencil" size={20} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleDeleteStack}
          >
            <Ionicons name="trash" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Items List */}
      <FlatList
        data={items}
        renderItem={({ item }) => (
          <ItemCard item={item} onPress={handleItemPress} />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>No items in this stack</Text>
            <Text style={styles.emptySubtext}>
              Add items from the feed or add screen
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
  header: {
    padding: 20,
    paddingTop: 32,
  },
  headerContent: {
    marginBottom: 16,
  },
  stackName: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  stackDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  itemCount: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
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
    textAlign: 'center',
  },
});

