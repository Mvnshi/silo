/**
 * Stack Detail Screen
 *
 * Displays all items within a specific stack (collection). Users can
 * view, organize, and manage items in the stack.
 *
 * Features:
 * - List of all items in the stack (rendered with ItemCardPro, so a save looks
 *   identical here and in the Stacks feed)
 * - Stack metadata (name, description, colour) in the shared ScreenHeader
 * - Rename or delete the stack
 * - Swipe an item to mark it done / not done
 *
 * MATERIAL: this screen has exactly one piece of chrome of its own — the two
 * header actions — and they deliberately stay opaque. See `headerButton` in the
 * stylesheet. Everything else here is content (the meta line and the item
 * list); the bar behind it all is already Liquid Glass, inside <ScreenHeader />.
 *
 * Dependencies:
 * - expo-router: Navigation
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import ItemCardPro from '@/components/ItemCardPro';
import PressableScale from '@/components/ui/PressableScale';
import ScreenHeader from '@/components/ui/ScreenHeader';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import {
  RADIUS,
  SHADOW,
  SPACE,
  TYPE,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { Stack, Item } from '@/lib/types';
import { getStackById, getItems, updateStack, deleteStack, updateItem } from '@/lib/storage';
import { celebrationHaptic } from '@/lib/haptics';

export default function StackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const c = useThemeColors();
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
      toast.show({ tone: 'danger', message: "We couldn't open that stack." });
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
    router.push(`/item/${itemId}`);
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
      toast.show({ tone: 'danger', message: "Couldn't mark that done." });
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
      toast.show({ tone: 'danger', message: "Couldn't undo that." });
    }
  }

  /**
   * Rename the stack. Alert.prompt is iOS-only, which matches the app's target.
   */
  function handleEditStack() {
    if (!stack) return;

    Alert.prompt(
      'Rename stack',
      'What should this collection be called?',
      async (name) => {
        if (!name || !name.trim()) return;

        try {
          await updateStack(id, { name: name.trim() });
          setStack({ ...stack, name: name.trim() });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (error) {
          console.error('Failed to update stack:', error);
          toast.show({ tone: 'danger', message: "Couldn't rename that stack." });
        }
      },
      'plain-text',
      stack.name
    );
  }

  /**
   * Delete the stack. Still a confirm rather than an undoable toast: this
   * unfiles every item in one move, and the screen it happens on disappears.
   */
  function handleDeleteStack() {
    Alert.alert('Delete this stack?', 'Your saves stay put — only the stack goes.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteStack(id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            if (router.canGoBack()) router.back();
            else router.replace('/(tabs)' as never);
          } catch (error) {
            console.error('Failed to delete stack:', error);
            toast.show({ tone: 'danger', message: "Couldn't delete that stack." });
          }
        },
      },
    ]);
  }

  if (loading) {
    // Card-shaped placeholders in the list's own rhythm, so nothing shifts
    // when the items land.
    return (
      <View style={[styles.container, { backgroundColor: c.page }]}>
        <ScreenHeader />
        <View style={styles.listContent} accessible accessibilityLabel="Loading stack">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={92} radius={RADIUS.xl} style={styles.skeletonRow} />
          ))}
        </View>
      </View>
    );
  }

  if (!stack) {
    return (
      <View style={[styles.container, { backgroundColor: c.page }]}>
        <ScreenHeader />
        <EmptyState
          icon="alert-circle-outline"
          title="We couldn't find that stack"
          subtitle="It may have been deleted on another device."
          cta={{ label: 'Back to your stacks', onPress: () => router.replace('/(tabs)' as never) }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.page }]}>
      <ScreenHeader
        title={stack.name}
        right={
          // Overhangs the header's 44pt right slot; a long stack name truncates
          // before it reaches these.
          <View style={styles.headerActions}>
            <PressableScale
              haptic="light"
              style={[styles.headerButton, { backgroundColor: c.card, borderColor: c.hairline }]}
              onPress={handleEditStack}
              accessibilityLabel="Rename this stack"
            >
              <Ionicons name="pencil" size={17} color={c.brand} />
            </PressableScale>

            <PressableScale
              haptic="light"
              style={[styles.headerButton, { backgroundColor: c.card, borderColor: c.hairline }]}
              onPress={handleDeleteStack}
              accessibilityLabel="Delete this stack"
            >
              <Ionicons name="trash" size={17} color={c.danger} />
            </PressableScale>
          </View>
        }
      />

      {/* Stack meta — the name itself lives in the header, so this is just the
          things the header can't carry. */}
      <View style={styles.meta}>
        <View style={styles.countRow}>
          <View style={[styles.stackDot, { backgroundColor: stack.color }]} />
          <Text style={[styles.itemCount, { color: c.textTertiary }]}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Text>
        </View>
        {stack.description ? (
          <Text style={[styles.stackDescription, { color: c.textSecondary }]}>
            {stack.description}
          </Text>
        ) : null}
      </View>

      {/* Items List */}
      <FlatList
        data={items}
        renderItem={({ item, index }) => (
          <ItemCardPro
            item={item}
            index={index}
            onPress={handleItemPress}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
          />
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.listContentEmpty,
          { paddingBottom: insets.bottom + 120 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        ListEmptyComponent={
          <EmptyState
            icon="folder-open-outline"
            title="This stack is empty"
            subtitle="Anything you save into it will show up here."
            cta={{ label: 'Save something', onPress: () => router.push('/(tabs)/add' as never) }}
          />
        }
      />
    </View>
  );
}

/**
 * Appearance-independent only — the page, card, border and text colours are
 * applied at the call sites from `useThemeColors()`.
 */
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    // Explicit width so the two buttons keep their size instead of being
    // squeezed into the header's fixed-width slot.
    width: 78,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  // Opaque on purpose, and it must stay that way: these sit ON the header bar,
  // which <ScreenHeader /> already renders as Liquid Glass. A second material
  // stacked on the first doesn't read as two surfaces — it reads as mud, both
  // of them sampling the same pixels twice. The card fill plus the hairline is
  // what separates the button from the bar underneath it.
  headerButton: {
    width: 35,
    height: 35,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW.hairline,
  },
  meta: {
    paddingHorizontal: SPACE.base,
    paddingTop: SPACE.md,
    gap: SPACE.xs,
  },
  stackDescription: {
    ...TYPE.footnote,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackDot: {
    width: 8,
    height: 8,
    borderRadius: RADIUS.pill,
    marginRight: SPACE.sm - 2,
  },
  itemCount: {
    ...TYPE.caption,
  },
  listContent: {
    padding: SPACE.base,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  skeletonRow: {
    marginBottom: SPACE.md,
  },
});
