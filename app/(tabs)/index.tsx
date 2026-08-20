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
  type ViewStyle,
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
import Glass, { LIQUID_GLASS } from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import Skeleton from '@/components/ui/Skeleton';
import ItemActionSheet from '@/components/ItemActionSheet';
import { useToast } from '@/components/ui/Toast';
import {
  BRAND,
  GRADIENTS,
  HIT_SLOP,
  MAX_DISPLAY_SCALE,
  RADIUS,
  SHADOW,
  SPACE,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
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
  clearTombstones,
} from '@/lib/storage';
import { useDataVersion } from '@/lib/dataVersion';
import { aiSearch } from '@/lib/api';
import { promptForText } from '@/lib/prompt';
import { buildReview } from '@/lib/resurface';
import { unscheduleItem } from '@/lib/scheduler';

type ViewMode = 'list' | 'grid';

/**
 * Stacks screen: browse/search all saved items and filter by stack (collection).
 */
export default function StacksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  const dataVersion = useDataVersion();
  // Built once per appearance — this screen paints a lot of small coloured
  // chrome (chips, field, skeletons) and rebuilding it per render would churn.
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);

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
  // `dataVersion` is here so the assistant's actions land: it is an overlay, not
  // a route, so archiving from it never blurs this tab and the focus effect
  // would otherwise not re-run. See lib/dataVersion.ts.
  useFocusEffect(
    useCallback(() => {
      loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadData, dataVersion])
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
          // Drop the tombstones first: a surviving one is newer than the
          // restored item, so the next sync would push the delete right back.
          await clearTombstones(removed.map((i) => i.id));
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
        ids.map(async (id) => {
          const item = itemsRef.current.find((i) => i.id === id);
          if (!item) return;
          try {
            await updateItem(id, buildReview(item, 'good'));
          } catch (e) {
            console.warn('mark done failed', e);
            return;
          }
          // buildReview clears the slot; the native event has to go with it.
          await unscheduleItem(id).catch((e) => console.error('calendar cleanup failed', e));
        })
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

  /**
   * Swipe left — mark as done. Routed through `buildReview` rather than a bare
   * `viewed: true` so it counts as a real completion: it bumps times_done and
   * last_done_at, which is what the resurfacing metric and the repeatables lane
   * are built on. A "done" that doesn't move the north-star number is a lie.
   */
  const handleSwipeLeft = useCallback(
    async (itemId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item || item.viewed) return;
      try {
        await updateItem(itemId, buildReview(item, 'good'));
        // buildReview clears the slot; without this the native event outlives it.
        // Best-effort — a calendar that won't cooperate must not eat the completion.
        await unscheduleItem(itemId).catch((err) => console.error('calendar cleanup failed', err));
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
            await clearTombstones([item.id]);
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
    // Skeleton's default block is near-white — on a dark card it reads as a row
    // of lit panels rather than absent content, so darken block and sweep.
    const tone =
      c.appearance === 'dark'
        ? { color: c.field, sweepColor: 'rgba(255,255,255,0.06)' }
        : {};
    if (viewMode === 'grid') {
      return (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={styles.skeletonGridCell}>
              <Skeleton height={168} radius={RADIUS.xl} {...tone} />
            </View>
          ))}
        </View>
      );
    }
    return (
      <View>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.skeletonRow, dyn.skeletonRow]}>
            <Skeleton width={68} height={68} radius={RADIUS.lg} {...tone} />
            <View style={styles.skeletonRowBody}>
              <Skeleton width="40%" height={14} {...tone} />
              <Skeleton width="85%" height={16} style={{ marginTop: SPACE.sm }} {...tone} />
              <Skeleton width="60%" height={12} style={{ marginTop: SPACE.xs }} {...tone} />
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
      tintColor={c.brand}
      // The header is absolutely positioned, so the spinner needs to clear it.
      progressViewOffset={headerHeight}
    />
  );

  return (
    <View style={styles.container}>
      <LinearGradient colors={[...c.pageGradient]} style={StyleSheet.absoluteFill} />

      {/* Sticky search + stacks bar.
          Two layers on purpose: the outer view carries the brand glow, the
          inner one clips (rounded bottom corners + the glass material), and a
          layer that masks its own bounds can't cast a shadow out of them. */}
      <View
        style={styles.stickyShadow}
        onLayout={(e) => {
          // Guarded: an unconditional setState here re-renders every row on
          // every layout pass, which is what makes the memoized cards expensive.
          const next = e.nativeEvent.layout.height;
          setHeaderHeight((h) => (Math.abs(h - next) > 1 ? next : h));
        }}
      >
        <View style={[styles.stickyHeader, dyn.stickyHeader, { paddingTop: insets.top + SPACE.sm }]}>
          {/* Real material first, violet wash ON TOP of it: the header gradient
              is opaque, so behind the glass it would just be a solid bar with
              nothing to refract. At low alpha over the glass the brand identity
              survives and the material still reads. */}
          <Glass variant="regular" bordered={false} radius={0} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[...c.headerGradient]}
            style={[StyleSheet.absoluteFill, styles.headerWash]}
          />

          {/* Title + select + settings */}
          <View style={styles.titleRow}>
            <Text
              style={[styles.screenTitle, dyn.screenTitle]}
              accessibilityRole="header"
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_DISPLAY_SCALE}
            >
              Stacks
            </Text>
            <View style={styles.titleActions}>
              <PressableScale
                haptic="medium"
                scaleTo={0.92}
                onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
                accessibilityLabel={selectMode ? 'Cancel selection' : 'Select items'}
              >
                <Text style={[styles.selectAction, dyn.selectAction]}>
                  {selectMode ? 'Cancel' : 'Select'}
                </Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                scaleTo={0.92}
                onPress={() => router.push('/stats')}
                accessibilityLabel="Your Silo — stats and settings"
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
          <View style={[styles.searchContainer, dyn.searchContainer]}>
            <Ionicons name="search" size={20} color={c.decorative} />
            <TextInput
              style={[styles.searchInput, dyn.searchInput]}
              placeholder="Search your saves"
              placeholderTextColor={c.textPlaceholder}
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
                <Ionicons name="close-circle" size={20} color={c.decorative} />
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
              <Ionicons name={viewMode === 'list' ? 'grid' : 'list'} size={20} color={c.brand} />
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
              // `stackChipActive` last: the brand fill must win over the dynamic
              // card/hairline pair that dresses the resting chip.
              style={[styles.stackChip, dyn.stackChip, !selectedStackId && styles.stackChipActive]}
              onPress={() => setSelectedStackId(null)}
              accessibilityLabel="All stacks"
            >
              <Ionicons name="apps" size={16} color={!selectedStackId ? '#fff' : c.textSecondary} />
              <Text
                style={[
                  styles.stackChipText,
                  dyn.stackChipText,
                  !selectedStackId && styles.stackChipTextActive,
                ]}
              >
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
                  style={[styles.stackChip, dyn.stackChip, active && styles.stackChipActive]}
                  onPress={() => setSelectedStackId(stack.id)}
                  onLongPress={() => handleStackLongPress(stack.id)}
                  accessibilityLabel={stack.name}
                >
                  <View style={[styles.stackDot, { backgroundColor: stack.color }]} />
                  <Text
                    style={[
                      styles.stackChipText,
                      dyn.stackChipText,
                      active && styles.stackChipTextActive,
                    ]}
                  >
                    {stack.name}
                  </Text>
                </PressableScale>
              );
            })}

            <PressableScale
              haptic="light"
              style={[styles.createStackButton, dyn.createStackButton]}
              onPress={handleCreateStack}
              accessibilityLabel="Create a new stack"
            >
              <Ionicons name="add" size={16} color={c.brand} />
              <Text style={[styles.createStackText, dyn.createStackText]}>New stack</Text>
            </PressableScale>
          </ScrollView>
        </View>
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
          // Both presets are transform-based (SlideIn/OutDown) — deliberately,
          // because opacity anywhere above a glass surface stops the effect
          // rendering. Their Reduce Motion fallback IS a cross-fade, so under
          // real Liquid Glass we take an instant swap over a bar that never
          // paints; the blur fallback fades fine and keeps it.
          entering={reduced && LIQUID_GLASS ? undefined : enterFromBottom(0, reduced)}
          exiting={reduced && LIQUID_GLASS ? undefined : exitToBottom(reduced)}
        >
          <Glass variant="regular" intensity={55} radius={RADIUS.xl}>
            <View style={styles.bulkBarRow}>
              <Text style={[styles.bulkCount, dyn.bulkCount]}>
                {bulkBusy ? 'Working…' : `${selectedIds.size} selected`}
              </Text>
              <PressableScale
                haptic="light"
                onPress={bulkMarkDone}
                disabled={selectedIds.size === 0 || bulkBusy}
                style={[styles.bulkAction, { opacity: selectedIds.size === 0 || bulkBusy ? 0.4 : 1 }]}
                accessibilityLabel="Mark selected items done"
              >
                <Ionicons name="checkmark-done" size={18} color={c.brand} />
                <Text style={[styles.bulkActionText, { color: c.brand }]}>Done</Text>
              </PressableScale>
              <PressableScale
                haptic="light"
                onPress={bulkDelete}
                disabled={selectedIds.size === 0 || bulkBusy}
                style={[styles.bulkAction, { opacity: selectedIds.size === 0 || bulkBusy ? 0.4 : 1 }]}
                accessibilityLabel="Delete selected items"
              >
                <Ionicons name="trash" size={18} color={c.danger} />
                <Text style={[styles.bulkActionText, { color: c.danger }]}>Delete</Text>
              </PressableScale>
            </View>
          </Glass>
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
  const c = useThemeColors();
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
      <Ionicons name="sparkles" size={18} color={c.brand} />
    </Animated.View>
  );
}

/**
 * Colour-only companions to `styles`. A plain object, NOT StyleSheet.create —
 * this is rebuilt whenever the appearance flips, and registering fresh
 * stylesheet ids on every flip would just leak them.
 */
function makeDynamicStyles(c: ThemeColors) {
  // On dark the brand-tinted shadows these surfaces lean on are all but
  // invisible against a near-black page, so they get a hairline edge instead.
  const darkEdge: ViewStyle =
    c.appearance === 'dark'
      ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }
      : {};
  return {
    stickyHeader:
      c.appearance === 'dark'
        ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairline }
        : null,
    screenTitle: { color: c.text },
    selectAction: { color: c.brand },
    searchContainer: { backgroundColor: c.card, borderColor: c.hairline },
    searchInput: { color: c.text },
    stackChip: { backgroundColor: c.card, borderColor: c.hairline },
    stackChipText: { color: c.textSecondary },
    createStackButton: { backgroundColor: c.brandSoft, borderColor: c.brandBorder },
    createStackText: { color: c.brand },
    skeletonRow: { backgroundColor: c.card, ...darkEdge },
    bulkCount: { color: c.text },
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Placement + the brand glow live out here, above the clip: `overflow:
  // hidden` masks the layer to its bounds, and a masked layer has no shadow.
  stickyShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    ...SHADOW.brandCard,
  },
  stickyHeader: {
    paddingHorizontal: SPACE.base,
    paddingBottom: 14,
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
    overflow: 'hidden',
  },
  // The violet wash, thinned so the glass under it still refracts the page.
  // Static opacity on a SIBLING of the glass — never on the glass or above it.
  headerWash: {
    opacity: 0.45,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.xs,
    paddingBottom: 10,
  },
  // Colour for every rule below that names one lives in `makeDynamicStyles`.
  screenTitle: {
    ...TYPE.title1,
    // At the accessibility text sizes this row's title would otherwise grow
    // until it pushed Select and the profile button off the right edge — the
    // controls didn't wrap, they became unreachable. The title yields; the
    // controls never do.
    flexShrink: 1,
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexShrink: 0,
  },
  selectAction: {
    ...TYPE.callout,
    fontWeight: '700',
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
    marginBottom: SPACE.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    ...SHADOW.card,
  },
  searchInput: {
    flex: 1,
    ...TYPE.body,
    marginLeft: SPACE.sm,
  },
  stacksContainer: {
    paddingBottom: SPACE.md,
  },
  stackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    marginRight: SPACE.sm,
    minWidth: 60,
    ...SHADOW.hairline,
  },
  // Stays BRAND[600] in both appearances: it is a brand surface, and the
  // lighter dark-mode brand would drop white-on-violet under 3:1.
  stackChipActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
    ...SHADOW.brandCard,
  },
  stackChipText: {
    ...TYPE.subhead,
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
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    marginRight: SPACE.sm,
  },
  createStackText: {
    ...TYPE.subhead,
    fontWeight: '700',
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
