/**
 * Stacks Screen (Index)
 *
 * The library: every saved item, filterable by stack (collection) and
 * searchable. List or grid, with multi-select bulk actions.
 *
 * Things worth knowing before you edit:
 * - Search is LOCAL-FIRST. Keyword matching runs on every keystroke with no
 *   network; the AI pass only refines the result set, is debounced, and is
 *   guarded by a generation counter so a slow response can never paint under a
 *   newer query.
 * - The empty state is a function of *why* the list is empty (loading / load
 *   failed / no matches / empty stack / first run). One generic "Nothing here
 *   yet" told a user with 400 saves that their library was gone.
 * - Destructive actions are optimistic + undoable via the Toast, never a
 *   blocking confirm.
 *
 * Dependencies:
 * - React Native FlatList
 * - ItemCardPro / CompactCard components
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  RefreshControl,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import CompactCard from '@/components/CompactCard';
import ItemCardPro from '@/components/ItemCardPro';
import EmptyState from '@/components/ui/EmptyState';
import GlassCard from '@/components/ui/GlassCard';
import PressableScale from '@/components/ui/PressableScale';
import Skeleton from '@/components/ui/Skeleton';
import ItemActionSheet from '@/components/ItemActionSheet';
import { useToast } from '@/components/ui/Toast';
import {
  BRAND,
  GRADIENTS,
  HAIRLINE,
  HIT_SLOP,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  STATUS,
  TEXT,
  TYPE,
} from '@/lib/theme';
import { enterFromBottom, exitToBottom, usePrefersReducedMotion } from '@/lib/motion';
import { Item, Stack } from '@/lib/types';
import {
  getItems,
  getStacks,
  addStack,
  updateItem,
  deleteItem,
  addItem,
  updateStack,
  deleteStack,
} from '@/lib/storage';
import { aiSearch } from '@/lib/api';
import { promptForText } from '@/lib/prompt';

type ViewMode = 'list' | 'grid';

/**
 * Stacks screen: browse/search all saved items and filter by stack (collection).
 */
export default function StacksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const [items, setItems] = useState<Item[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [searchDegraded, setSearchDegraded] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(170);
  const [actionItem, setActionItem] = useState<Item | null>(null);

  // The AI search reads the latest items without re-running on every list
  // mutation — otherwise marking one card done costs a Worker round-trip.
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  // Generation counter: a slow response for an older query must never paint.
  const searchGeneration = useRef(0);

  /**
   * Load stacks and items from storage
   */
  const loadData = useCallback(async () => {
    try {
      const [allItems, allStacks] = await Promise.all([getItems(), getStacks()]);
      setItems(allItems.filter((item) => !item.archived));
      setStacks(allStacks);
      setLoadError(false);
    } catch (error) {
      console.error('Failed to load data:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load data when screen comes into focus. No haptic here — the tab bar owns
  // the tab-change buzz, and this also fires on every return from /item/[id].
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  /**
   * AI-refined search. Keyword matching below is instant and always applies;
   * this only narrows the set once the network answers.
   */
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length <= 2) {
      searchGeneration.current++;
      setAiSearchResults(new Set());
      setIsAiSearching(false);
      setSearchDegraded(false);
      return;
    }

    setIsAiSearching(true);
    const timeoutId = setTimeout(async () => {
      const myGeneration = ++searchGeneration.current;
      const snapshot = itemsRef.current;
      try {
        const resultIndices = await aiSearch(
          q,
          snapshot.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            tags: item.tags,
            classification: item.classification,
          }))
        );
        if (myGeneration !== searchGeneration.current) return; // stale
        const resultIds = resultIndices
          .map((idx) => snapshot[parseInt(idx, 10)]?.id)
          .filter(Boolean) as string[];
        setAiSearchResults(new Set(resultIds));
        setSearchDegraded(false);
      } catch (error) {
        console.error('AI search failed:', error);
        if (myGeneration !== searchGeneration.current) return; // stale
        // Fall through to the keyword filter below and say so, rather than
        // silently pretending the smart search ran.
        setAiSearchResults(new Set());
        setSearchDegraded(true);
      } finally {
        if (myGeneration === searchGeneration.current) setIsAiSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
    // Deliberately NOT keyed on `items` — see itemsRef.
  }, [searchQuery]);

  /**
   * Filter items based on selected stack and search query
   */
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedStackId && item.stack_id !== selectedStackId) return false;
      if (!query) return true;
      if (aiSearchResults.size > 0) return aiSearchResults.has(item.id);
      return (
        item.title.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [items, selectedStackId, searchQuery, aiSearchResults]);

  /* ---------------------------------------------------------------- select */

  const toggleSelect = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  /**
   * Bulk delete — optimistic, with a real undo. `deleteItem` writes a tombstone
   * for sync, so restoring re-adds the item rather than resurrecting the row.
   */
  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const removed = items.filter((i) => ids.includes(i.id));

    setBulkBusy(true);
    setItems((prev) => prev.filter((i) => !ids.includes(i.id)));
    exitSelect();
    try {
      await Promise.all(ids.map((id) => deleteItem(id).catch((e) => console.warn('delete failed', e))));
    } finally {
      setBulkBusy(false);
    }

    toast.show({
      message: `Deleted ${removed.length} ${removed.length === 1 ? 'item' : 'items'}`,
      tone: 'danger',
      action: {
        label: 'Undo',
        onPress: async () => {
          await Promise.all(removed.map((i) => addItem(i).catch(() => {})));
          await loadData();
        },
      },
    });
  }, [selectedIds, items, exitSelect, toast, loadData]);

  const bulkMarkDone = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) => updateItem(id, { viewed: true }).catch((e) => console.warn('mark done failed', e)))
      );
    } finally {
      setBulkBusy(false);
    }
    exitSelect();
    await loadData();
    toast.show({ message: `Marked ${ids.length} done`, tone: 'success' });
  }, [selectedIds, exitSelect, loadData, toast]);

  /* ----------------------------------------------------------------- items */

  const handleItemPress = useCallback(
    (itemId: string) => {
      if (selectMode) {
        toggleSelect(itemId);
        return;
      }
      router.push(`/item/${itemId}`);
    },
    [selectMode, toggleSelect, router]
  );

  /** Swipe left — mark as done. */
  const handleSwipeLeft = useCallback(
    async (itemId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item || item.viewed) return;
      try {
        await updateItem(itemId, { viewed: true });
        await loadData();
        toast.show({
          message: 'Marked done',
          tone: 'success',
          action: {
            label: 'Undo',
            onPress: async () => {
              await updateItem(itemId, { viewed: false });
              await loadData();
            },
          },
        });
      } catch (error) {
        console.error('Failed to mark item as done:', error);
        toast.show({ message: "That didn't save. Try again?", tone: 'danger' });
      }
    },
    [loadData, toast]
  );

  /** Swipe right — unmark as done. */
  const handleSwipeRight = useCallback(
    async (itemId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item || !item.viewed) return;
      try {
        await updateItem(itemId, { viewed: false });
        await loadData();
      } catch (error) {
        console.error('Failed to unmark item as done:', error);
      }
    },
    [loadData]
  );

  /** Long press opens the quick-action sheet. */
  const handleItemLongPress = useCallback((itemId: string) => {
    const item = itemsRef.current.find((i) => i.id === itemId);
    if (item) setActionItem(item);
  }, []);

  /** Single-item delete from the action sheet — optimistic + undoable. */
  const handleDeleteItem = useCallback(
    async (item: Item) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      await deleteItem(item.id).catch((e) => console.warn('delete failed', e));
      toast.show({
        message: `Deleted “${item.title}”`,
        tone: 'danger',
        action: {
          label: 'Undo',
          onPress: async () => {
            await addItem(item).catch(() => {});
            await loadData();
          },
        },
      });
    },
    [toast, loadData]
  );

  /* ---------------------------------------------------------------- stacks */

  const handleStackLongPress = useCallback(
    (stackId: string) => {
      const stack = stacks.find((s) => s.id === stackId);
      if (!stack) return;

      Alert.alert(stack.name, undefined, [
        {
          text: 'Rename',
          onPress: async () => {
            const name = await promptForText({
              title: 'Rename stack',
              message: 'What should this stack be called?',
              defaultValue: stack.name,
              confirmLabel: 'Rename',
            });
            if (!name) return;
            try {
              await updateStack(stackId, { name });
              await loadData();
            } catch (error) {
              console.error('Failed to rename stack:', error);
              toast.show({ message: "Couldn't rename that stack", tone: 'danger' });
            }
          },
        },
        {
          text: 'Delete stack',
          style: 'destructive',
          onPress: async () => {
            // Items survive a stack delete, so this is safely undoable.
            try {
              await deleteStack(stackId);
              if (selectedStackId === stackId) setSelectedStackId(null);
              await loadData();
              toast.show({
                message: `Deleted “${stack.name}”. Its items are still saved.`,
                action: {
                  label: 'Undo',
                  onPress: async () => {
                    await addStack(stack).catch(() => {});
                    await loadData();
                  },
                },
              });
            } catch (error) {
              console.error('Failed to delete stack:', error);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [stacks, loadData, toast, selectedStackId]
  );

  const handleCreateStack = useCallback(async () => {
    const name = await promptForText({
      title: 'New stack',
      message: 'Name it something you’d actually search for.',
      placeholder: 'Weekend plans',
      confirmLabel: 'Create',
    });
    if (!name) return;
    try {
      const newStack: Stack = {
        id: `stack_${Date.now()}`,
        name,
        color: BRAND[500],
        item_count: 0,
        created_at: new Date().toISOString(),
      };
      await addStack(newStack);
      await loadData();
      setSelectedStackId(newStack.id);
    } catch (error) {
      console.error('Failed to create stack:', error);
      toast.show({ message: "Couldn't create that stack", tone: 'danger' });
    }
  }, [loadData, toast]);

  /* ------------------------------------------------------------- rendering */

  const activeStack = stacks.find((s) => s.id === selectedStackId);

  /** Empty state as a function of WHY the list is empty. */
  function renderEmpty() {
    if (loading) return null;
    if (loadError) {
      return (
        <EmptyState
          icon="cloud-offline"
          title="Couldn’t open your library"
          subtitle="Your saves are still on this device — this was a read error."
          cta={{ label: 'Try again', onPress: loadData }}
        />
      );
    }
    if (searchQuery.trim()) {
      return (
        <EmptyState
          icon="search"
          title={`No matches for “${searchQuery.trim()}”`}
          subtitle={
            searchDegraded
              ? 'Smart search is offline, so this was a keyword match only.'
              : 'Try a different word, or search by tag.'
          }
          cta={{ label: 'Clear search', onPress: () => setSearchQuery('') }}
        />
      );
    }
    if (activeStack) {
      return (
        <EmptyState
          icon="folder-open"
          title={`${activeStack.name} is empty`}
          subtitle="Save something into this stack and it’ll show up here."
          cta={{ label: 'Show everything', onPress: () => setSelectedStackId(null) }}
        />
      );
    }
    return (
      <EmptyState
        icon="sparkles"
        title="Nothing here yet"
        subtitle="Save a link, screenshot, or note — Silo classifies and organizes it for you."
        cta={{ label: 'Save your first thing', onPress: () => router.push('/(tabs)/add') }}
      />
    );
  }

  /** Content-shaped placeholders so the first frame never lies about being empty. */
  function renderSkeletons() {
    if (viewMode === 'grid') {
      return (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.skeletonGridCell}>
              <Skeleton height={168} radius={RADIUS.xl} />
            </View>
          ))}
        </View>
      );
    }
    return (
      <View>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width={68} height={68} radius={RADIUS.lg} />
            <View style={styles.skeletonRowBody}>
              <Skeleton width="40%" height={14} />
              <Skeleton width="85%" height={16} style={{ marginTop: SPACE.sm }} />
              <Skeleton width="60%" height={12} style={{ marginTop: SPACE.xs }} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  const listPadding = {
    paddingTop: headerHeight + SPACE.md,
    paddingBottom: insets.bottom + 120,
  };

  const renderListItem = useCallback(
    ({ item, index }: { item: Item; index: number }) => (
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
    ),
    [handleItemPress, handleItemLongPress, handleSwipeLeft, handleSwipeRight, selectMode, selectedIds]
  );

  const renderGridItem = useCallback(
    ({ item, index }: { item: Item; index: number }) => (
      <CompactCard
        item={item}
        index={index}
        onPress={handleItemPress}
        onSwipeLeft={handleSwipeLeft}
        onSwipeRight={handleSwipeRight}
        selectMode={selectMode}
        selected={selectedIds.has(item.id)}
      />
    ),
    [handleItemPress, handleSwipeLeft, handleSwipeRight, selectMode, selectedIds]
  );

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={BRAND[600]}
      // The header is absolutely positioned, so the spinner needs to clear it.
      progressViewOffset={headerHeight}
    />
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...GRADIENTS.page]} style={StyleSheet.absoluteFill} />

      {/* Sticky search + stacks bar */}
      <View
        style={[styles.stickyHeader, { paddingTop: insets.top + SPACE.sm }]}
        onLayout={(e) => {
          // Guarded: an unconditional setState here re-renders every row on
          // every layout pass, which is what makes the memoized cards expensive.
          const next = e.nativeEvent.layout.height;
          setHeaderHeight((h) => (Math.abs(h - next) > 1 ? next : h));
        }}
      >
        <LinearGradient colors={[...GRADIENTS.header]} style={StyleSheet.absoluteFill} />

        {/* Title + select + settings */}
        <View style={styles.titleRow}>
          <Text style={styles.screenTitle} accessibilityRole="header">
            Stacks
          </Text>
          <View style={styles.titleActions}>
            <PressableScale
              haptic="medium"
              scaleTo={0.92}
              onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
              accessibilityLabel={selectMode ? 'Cancel selection' : 'Select items'}
            >
              <Text style={styles.selectAction}>{selectMode ? 'Cancel' : 'Select'}</Text>
            </PressableScale>
            <PressableScale
              haptic="light"
              scaleTo={0.92}
              onPress={() => router.push('/settings')}
              accessibilityLabel="Profile and settings"
            >
              <LinearGradient
                colors={[...GRADIENTS.brand]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatar}
              >
                <Ionicons name="person" size={19} color="#fff" />
              </LinearGradient>
            </PressableScale>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={INK[400]} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search your saves"
            placeholderTextColor={TEXT.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="never"
            accessibilityLabel="Search your saves"
          />
          {isAiSearching && <ThinkingSparkle reduced={reduced} />}
          {searchQuery.length > 0 && (
            <PressableScale
              haptic="light"
              scaleTo={0.9}
              hitSlop={HIT_SLOP}
              onPress={() => setSearchQuery('')}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={INK[400]} />
            </PressableScale>
          )}
          <PressableScale
            haptic="selection"
            scaleTo={0.9}
            hitSlop={HIT_SLOP}
            style={styles.viewModeButton}
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            accessibilityLabel={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            <Ionicons name={viewMode === 'list' ? 'grid' : 'list'} size={20} color={BRAND[600]} />
          </PressableScale>
        </View>

        {/* Stack filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stacksContainer}
          keyboardShouldPersistTaps="handled"
        >
          <PressableScale
            haptic="selection"
            selected={!selectedStackId}
            style={[styles.stackChip, !selectedStackId && styles.stackChipActive]}
            onPress={() => setSelectedStackId(null)}
            accessibilityLabel="All stacks"
          >
            <Ionicons name="apps" size={16} color={!selectedStackId ? '#fff' : INK[700]} />
            <Text style={[styles.stackChipText, !selectedStackId && styles.stackChipTextActive]}>
              All
            </Text>
          </PressableScale>

          {stacks.map((stack) => {
            const active = selectedStackId === stack.id;
            return (
              <PressableScale
                key={stack.id}
                haptic="selection"
                selected={active}
                style={[styles.stackChip, active && styles.stackChipActive]}
                onPress={() => setSelectedStackId(stack.id)}
                onLongPress={() => handleStackLongPress(stack.id)}
                accessibilityLabel={stack.name}
              >
                <View style={[styles.stackDot, { backgroundColor: stack.color }]} />
                <Text style={[styles.stackChipText, active && styles.stackChipTextActive]}>
                  {stack.name}
                </Text>
              </PressableScale>
            );
          })}

          <PressableScale
            haptic="light"
            style={styles.createStackButton}
            onPress={handleCreateStack}
            accessibilityLabel="Create a new stack"
          >
            <Ionicons name="add" size={16} color={BRAND[600]} />
            <Text style={styles.createStackText}>New stack</Text>
          </PressableScale>
        </ScrollView>
      </View>

      {loading ? (
        <ScrollView
          contentContainerStyle={[listPadding, { paddingHorizontal: SPACE.base }]}
          scrollEnabled={false}
        >
          {renderSkeletons()}
        </ScrollView>
      ) : viewMode === 'list' ? (
        <FlatList
          key="list-view"
          data={filteredItems}
          renderItem={renderListItem}
          keyExtractor={(item) => item.id}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[listPadding, styles.listContent]}
          ListEmptyComponent={renderEmpty()}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={9}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews
          // No getItemLayout: rows are variable height (a description adds a
          // line, tags add a row), so a fixed estimate would desync scrolling.
        />
      ) : (
        <FlatList
          key="grid-view"
          data={filteredItems}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[listPadding, styles.gridContent]}
          ListEmptyComponent={renderEmpty()}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews
        />
      )}

      {selectMode && (
        <Animated.View
          style={[styles.bulkBar, { bottom: insets.bottom + 90 }]}
          entering={enterFromBottom(0, reduced)}
          exiting={exitToBottom(reduced)}
        >
          <GlassCard tint="light" intensity={55} radius={RADIUS.xl}>
            <View style={styles.bulkBarRow}>
              <Text style={styles.bulkCount}>
                {bulkBusy ? 'Working…' : `${selectedIds.size} selected`}
              </Text>
              <PressableScale
                haptic="light"
                onPress={bulkMarkDone}
                disabled={selectedIds.size === 0 || bulkBusy}
                style={[styles.bulkAction, { opacity: selectedIds.size === 0 || bulkBusy ? 0.4 : 1 }]}
                accessibilityLabel="Mark selected items done"
              >
                <Ionicons name="checkmark-done" size={18} color={BRAND[600]} />
                <Text style={[styles.bulkActionText, { color: BRAND[600] }]}>Done</Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                onPress={bulkDelete}
                disabled={selectedIds.size === 0 || bulkBusy}
                style={[styles.bulkAction, { opacity: selectedIds.size === 0 || bulkBusy ? 0.4 : 1 }]}
                accessibilityLabel="Delete selected items"
              >
                <Ionicons name="trash" size={18} color={STATUS.danger} />
                <Text style={[styles.bulkActionText, { color: STATUS.danger }]}>Delete</Text>
              </PressableScale>
            </View>
          </GlassCard>
        </Animated.View>
      )}

      <ItemActionSheet
        item={actionItem}
        onClose={() => setActionItem(null)}
        onChanged={loadData}
        onDelete={handleDeleteItem}
      />
    </View>
  );
}

/**
 * The search sparkle, breathing while the AI pass is in flight — a motionless
 * icon here is indistinguishable from decoration.
 */
function ThinkingSparkle({ reduced }: { reduced: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulse, reduced]);
  const aStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.55,
    transform: [{ scale: 0.9 + pulse.value * 0.18 }],
  }));
  return (
    <Animated.View style={[aStyle, { marginRight: SPACE.sm }]}>
      <Ionicons name="sparkles" size={18} color={BRAND[600]} />
    </Animated.View>
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
    paddingHorizontal: SPACE.base,
    paddingBottom: 14,
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
    overflow: 'hidden',
    ...SHADOW.brandCard,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.xs,
    paddingBottom: 10,
  },
  screenTitle: {
    ...TYPE.title1,
    color: TEXT.primary,
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  selectAction: {
    ...TYPE.callout,
    fontWeight: '700',
    color: BRAND[600],
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: SPACE.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: HAIRLINE,
    ...SHADOW.card,
  },
  searchInput: {
    flex: 1,
    ...TYPE.body,
    color: TEXT.primary,
    marginLeft: SPACE.sm,
  },
  stacksContainer: {
    paddingBottom: SPACE.md,
  },
  stackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: HAIRLINE,
    marginRight: SPACE.sm,
    minWidth: 60,
    ...SHADOW.hairline,
  },
  stackChipActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
    ...SHADOW.brandCard,
  },
  stackChipText: {
    ...TYPE.subhead,
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
    borderRadius: RADIUS.pill,
  },
  createStackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND[100],
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BRAND[200],
    marginRight: SPACE.sm,
  },
  createStackText: {
    ...TYPE.subhead,
    fontWeight: '700',
    color: BRAND[600],
    marginLeft: SPACE.xs,
  },
  viewModeButton: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACE.xs,
    marginLeft: SPACE.xs,
  },
  // flexGrow is required or EmptyState (flex-1, centered) collapses to a short
  // block pinned under the header with a void beneath it.
  listContent: {
    flexGrow: 1,
    paddingHorizontal: SPACE.base,
  },
  gridContent: {
    flexGrow: 1,
    paddingHorizontal: SPACE.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    padding: 10,
    marginBottom: SPACE.md,
    ...SHADOW.hairline,
  },
  skeletonRowBody: {
    flex: 1,
    marginLeft: SPACE.md,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  skeletonGridCell: {
    width: '50%',
    padding: 6,
  },
  bulkBar: {
    position: 'absolute',
    left: SPACE.base,
    right: SPACE.base,
    ...SHADOW.brandFloating,
  },
  bulkBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  bulkCount: {
    ...TYPE.subhead,
    fontWeight: '700',
    color: TEXT.primary,
    flex: 1,
  },
  bulkAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: SPACE.lg,
  },
  bulkActionText: {
    ...TYPE.footnote,
    fontWeight: '700',
    marginLeft: 5,
  },
});
