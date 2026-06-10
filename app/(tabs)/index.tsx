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
 * - ItemCardPro / CompactCard components
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
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import CompactCard from '@/components/CompactCard';
import ItemCardPro from '@/components/ItemCardPro';
import EmptyState from '@/components/ui/EmptyState';
import GlassCard from '@/components/ui/GlassCard';
import PressableScale from '@/components/ui/PressableScale';
import { BRAND, INK, HAIRLINE, RADIUS } from '@/lib/theme';
import { Item, Stack } from '@/lib/types';
import { getItems, getStacks, addStack, updateItem, deleteItem, updateStack, deleteStack } from '@/lib/storage';
import { aiSearch } from '@/lib/api';
import { scheduleItemReview } from '@/lib/scheduler';
import { celebrationHaptic } from '@/lib/haptics';

type ViewMode = 'list' | 'grid';

/**
 * Stacks screen: browse/search all saved items and filter by stack (collection).
 */
export default function StacksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [headerHeight, setHeaderHeight] = useState(170);

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
      // Haptic feedback when tab is focused
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
  function toggleSelect(itemId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    Haptics.selectionAsync();
  }

  function exitSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.alert(
      `Delete ${ids.length} item${ids.length > 1 ? 's' : ''}?`,
      'This permanently removes them from this device and can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const id of ids) {
              try { await deleteItem(id); } catch (e) { console.warn('delete failed', e); }
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            exitSelect();
            await loadData();
          },
        },
      ]
    );
  }

  async function bulkMarkDone() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    for (const id of ids) {
      try { await updateItem(id, { viewed: true }); } catch (e) { console.warn('mark done failed', e); }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    exitSelect();
    await loadData();
  }

  function handleItemPress(itemId: string) {
    if (selectMode) {
      toggleSelect(itemId);
      return;
    }
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
   * Handle long press on item card - show quick actions
   */
  function handleItemLongPress(itemId: string) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const actions = [
      {
        text: item.bucketlist ? 'Remove from Bucket List' : 'Add to Bucket List',
        onPress: async () => {
          try {
            await updateItem(itemId, { bucketlist: !item.bucketlist });
            await loadData();
            Haptics.notificationAsync(
              item.bucketlist 
                ? Haptics.NotificationFeedbackType.Warning 
                : Haptics.NotificationFeedbackType.Success
            );
          } catch (error) {
            console.error('Failed to update bucket list:', error);
            Alert.alert('Error', 'Failed to update bucket list');
          }
        },
      },
      {
        text: item.viewed ? 'Mark as Not Done' : 'Mark as Done',
        onPress: async () => {
          try {
            const wasViewed = item.viewed;
            await updateItem(itemId, { viewed: !item.viewed });
            await loadData();
            if (!wasViewed) {
              celebrationHaptic();
            } else {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          } catch (error) {
            console.error('Failed to update item:', error);
            Alert.alert('Error', 'Failed to update item');
          }
        },
      },
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
            color: BRAND[500],
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
      {/* Gradient Background */}
        <LinearGradient
          colors={['#E8D4F5', '#F5E7FF', '#FFF0FF']}
          style={StyleSheet.absoluteFill}
        />
        {/* Sticky Search and Stacks Bar */}
        <View
          style={[styles.stickyHeader, { paddingTop: insets.top + 8 }]}
          onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}
        >
        {/* Title + profile/settings entry */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 10 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: '#0f172a', letterSpacing: -0.5 }}>Stacks</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => (selectMode ? exitSelect() : setSelectMode(true))} activeOpacity={0.7} hitSlop={8}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#7c3aed' }}>{selectMode ? 'Cancel' : 'Select'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/settings')} activeOpacity={0.8} accessibilityLabel="Profile and settings">
              <LinearGradient colors={['#8b5cf6', '#6366f1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person" size={19} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={INK[400]} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search items..."
            placeholderTextColor={INK[400]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {isAiSearching && (
            <Ionicons name="sparkles" size={20} color={BRAND[600]} />
          )}
          {searchQuery.length > 0 && !isAiSearching && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={INK[400]} />
            </TouchableOpacity>
          )}
          {/* View Mode Toggle */}
          <TouchableOpacity
            style={styles.viewModeButton}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode(viewMode === 'list' ? 'grid' : 'list');
            }}
          >
            <Ionicons
              name={viewMode === 'list' ? 'grid' : 'list'}
              size={20}
              color={BRAND[600]}
            />
          </TouchableOpacity>
        </View>

        {/* Stacks Horizontal Scroll */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stacksContainer}
        >
          <PressableScale
            haptic="selection"
            style={[
              styles.stackChip,
              !selectedStackId && styles.stackChipActive,
            ]}
            onPress={() => setSelectedStackId(null)}
          >
            <Ionicons name="apps" size={16} color={!selectedStackId ? '#fff' : INK[700]} />
            <Text
              style={[
                styles.stackChipText,
                !selectedStackId && styles.stackChipTextActive,
              ]}
            >
              All
            </Text>
          </PressableScale>

          {stacks.map(stack => (
            <PressableScale
              key={stack.id}
              haptic="selection"
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
            </PressableScale>
          ))}

          <PressableScale
            haptic="light"
            style={styles.createStackButton}
            onPress={handleCreateStack}
          >
            <Ionicons name="add" size={16} color={BRAND[600]} />
            <Text style={styles.createStackText}>New stack</Text>
          </PressableScale>
        </ScrollView>
      </View>

      {viewMode === 'list' ? (
        <FlatList
          key="list-view"
          data={filteredItems}
          renderItem={({ item, index }) => (
            <ItemCardPro
              item={item}
              index={index}
              onPress={handleItemPress}
              onLongPress={handleItemLongPress}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
              selectMode={selectMode}
              selected={selectedIds.has(item.id)}
            />
          )}
          keyExtractor={item => item.id}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{
            paddingTop: headerHeight + 12, // measured sticky-header clearance
            paddingBottom: insets.bottom + 120,
            paddingHorizontal: 16,
          }}
          ListEmptyComponent={
            <EmptyState
              icon="sparkles"
              title="Nothing here yet"
              subtitle="Save a link, screenshot, or note — Silo classifies and organizes it for you."
            />
          }
        />
      ) : (
        <FlatList
          key="grid-view"
          data={filteredItems}
          renderItem={({ item }) => (
            <CompactCard 
              item={item} 
              onPress={handleItemPress}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
            />
          )}
          keyExtractor={item => item.id}
          numColumns={2}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{
            paddingTop: headerHeight + 12, // measured sticky-header clearance
            paddingBottom: insets.bottom + 120,
            paddingHorizontal: 8,
          }}
          ListEmptyComponent={
            <EmptyState
              icon="sparkles"
              title="Nothing here yet"
              subtitle="Save a link, screenshot, or note — Silo classifies and organizes it for you."
            />
          }
        />
      )}

      {selectMode && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 90, shadowColor: BRAND[600], shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 20 }}>
          <GlassCard tint="light" intensity={55} radius={RADIUS.xl}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 18 }}>
              <Text style={{ color: INK[900], fontWeight: '700', fontSize: 14, flex: 1 }}>
                {selectedIds.size} selected
              </Text>
              <PressableScale haptic="light" onPress={bulkMarkDone} disabled={selectedIds.size === 0} style={{ opacity: selectedIds.size === 0 ? 0.4 : 1, marginRight: 20, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="checkmark-done" size={18} color={BRAND[600]} />
                <Text style={{ color: BRAND[600], fontWeight: '700', fontSize: 13, marginLeft: 5 }}>Done</Text>
              </PressableScale>
              <PressableScale haptic="light" onPress={bulkDelete} disabled={selectedIds.size === 0} style={{ opacity: selectedIds.size === 0 ? 0.4 : 1, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="trash" size={18} color="#ef4444" />
                <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 13, marginLeft: 5 }}>Delete</Text>
              </PressableScale>
            </View>
          </GlassCard>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: '#E8D4F5',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: INK[900],
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
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: HAIRLINE,
    marginRight: 8,
    minWidth: 60,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  stackChipActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
    shadowColor: BRAND[600],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  stackChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: INK[700],
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND[100],
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BRAND[200],
    marginRight: 8,
  },
  createStackText: {
    fontSize: 14,
    fontWeight: '700',
    color: BRAND[600],
    marginLeft: 4,
  },
  viewModeButton: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
    marginLeft: 8,
  },
});

