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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import ItemCard from '@/components/ItemCard';
import PressableScale from '@/components/ui/PressableScale';
import { BRAND, INK, HAIRLINE } from '@/lib/theme';
import { Stack, Item } from '@/lib/types';
import { getStackById, getItems, updateStack, deleteStack, updateItem } from '@/lib/storage';
import { celebrationHaptic } from '@/lib/haptics';

export default function StackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/item/${itemId}?from=stacks`);
  }

  /**
   * Handle swipe left - mark as done
   */
  async function handleSwipeLeft(itemId: string) {
    try {
      const item = items.find(i => i.id === itemId);
      if (!item || item.viewed) return; // Already done
      
      await updateItem(itemId, { viewed: true });
      await loadData();
      // Celebration haptic for completion
      celebrationHaptic();
    } catch (error) {
      console.error('Failed to mark item as done:', error);
      Alert.alert('Error', 'Failed to mark item as done');
    }
  }

  /**
   * Handle swipe right - unmark as done
   */
  async function handleSwipeRight(itemId: string) {
    try {
      const item = items.find(i => i.id === itemId);
      if (!item || !item.viewed) return; // Not done
      
      await updateItem(itemId, { viewed: false });
      await loadData();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.error('Failed to unmark item as done:', error);
      Alert.alert('Error', 'Failed to unmark item as done');
    }
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
        <ActivityIndicator size="large" color={BRAND[600]} />
      </View>
    );
  }

  if (!stack) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={INK[300]} />
        <Text style={styles.errorText}>Stack not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Stack Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerContent}>
          <Text style={styles.stackName}>{stack.name}</Text>
          {stack.description && (
            <Text style={styles.stackDescription}>{stack.description}</Text>
          )}
          <View style={styles.countRow}>
            <View style={[styles.stackDot, { backgroundColor: stack.color }]} />
            <Text style={styles.itemCount}>
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <PressableScale
            haptic="light"
            style={styles.headerButton}
            onPress={handleEditStack}
          >
            <Ionicons name="pencil" size={18} color={BRAND[600]} />
          </PressableScale>

          <PressableScale
            haptic="light"
            style={styles.headerButton}
            onPress={handleDeleteStack}
          >
            <Ionicons name="trash" size={18} color="#ef4444" />
          </PressableScale>
        </View>
      </View>

      {/* Items List */}
      <FlatList
        data={items}
        renderItem={({ item }) => (
          <ItemCard 
            item={item} 
            onPress={handleItemPress}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 }
        ]}
        contentInsetAdjustmentBehavior="automatic"
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={64} color={INK[300]} />
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
    backgroundColor: BRAND[50],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BRAND[50],
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BRAND[50],
  },
  errorText: {
    fontSize: 18,
    color: INK[500],
    marginTop: 16,
  },
  header: {
    padding: 20,
  },
  headerContent: {
    marginBottom: 16,
  },
  stackName: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: INK[900],
    marginBottom: 8,
  },
  stackDescription: {
    fontSize: 16,
    color: INK[500],
    marginBottom: 8,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  itemCount: {
    fontSize: 14,
    fontWeight: '600',
    color: INK[400],
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: HAIRLINE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
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
    color: INK[700],
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: INK[400],
    marginTop: 8,
    textAlign: 'center',
  },
});

