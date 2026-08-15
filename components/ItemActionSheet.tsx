/**
 * ItemActionSheet — the long-press quick actions for a saved item.
 *
 * Replaces a six-button `Alert.alert(item.title, 'Quick Actions', …)`. iOS
 * stacks any alert with more than two buttons vertically, so the app's most-used
 * shortcut surface was a centred modal with body text reading "Quick Actions",
 * no icons, Delete sitting next to Schedule, and a Schedule button that opened a
 * SECOND nested alert.
 *
 * Delete is handled by the caller (`onDelete`) so it can be optimistic and
 * undoable — this sheet just dismisses.
 */
import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { celebrationHaptic } from '@/lib/haptics';
import { classConfig } from '@/lib/classification';
import { updateItem } from '@/lib/storage';
import { Item } from '@/lib/types';
import {
  DURATION,
  HAIRLINE,
  INK,
  RADIUS,
  SHADOW,
  SPACE,
  STATUS,
  SURFACE,
  TEXT,
  TYPE,
} from '@/lib/theme';
import { enterFromBottom, exitToBottom, usePrefersReducedMotion } from '@/lib/motion';

interface Props {
  /** The item to act on; `null` keeps the sheet closed. */
  item: Item | null;
  onClose: () => void;
  /** Called after any mutation so the list can reload. */
  onChanged: () => void | Promise<void>;
  /** Delete is the caller's job — it owns the optimistic removal + undo. */
  onDelete: (item: Item) => void | Promise<void>;
}

export default function ItemActionSheet({ item, onClose, onChanged, onDelete }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();

  if (!item) return null;
  const cfg = classConfig(item.classification);
  const isDone = item.viewed === true || item.status === 'done';

  async function mutate(patch: Partial<Item>, celebrate = false) {
    if (!item) return;
    onClose();
    try {
      await updateItem(item.id, patch);
      if (celebrate) await celebrationHaptic();
      await onChanged();
    } catch (error) {
      console.error('Quick action failed:', error);
    }
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(DURATION.fast)}
        exiting={FadeOut.duration(DURATION.instant)}
        style={styles.scrim}
      >
        <PressableScale
          haptic="none"
          scaleTo={1}
          containerStyle={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close actions"
        >
          <View style={StyleSheet.absoluteFill} />
        </PressableScale>

        <Animated.View
          entering={enterFromBottom(0, reduced)}
          exiting={exitToBottom(reduced)}
          style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.base }]}
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={[styles.eyebrow, { color: cfg.deep }]}>{cfg.label.toUpperCase()}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
          </View>

          <Row
            icon={isDone ? 'arrow-undo' : 'checkmark-circle'}
            label={isDone ? 'Mark as not done' : 'Mark as done'}
            onPress={() => mutate({ viewed: !isDone }, !isDone)}
          />
          <Row
            icon={item.bucketlist ? 'bookmark' : 'bookmark-outline'}
            label={item.bucketlist ? 'Remove from bucket list' : 'Add to bucket list'}
            onPress={() => mutate({ bucketlist: !item.bucketlist })}
          />
          <Row
            icon="calendar-outline"
            label={item.scheduled_date ? 'Reschedule' : 'Schedule it'}
            onPress={() => {
              onClose();
              router.push(`/item/${item.id}?schedule=true`);
            }}
          />
          <Row
            icon="archive-outline"
            label={item.archived ? 'Unarchive' : 'Tuck away in Archive'}
            onPress={() => mutate({ archived: !item.archived })}
          />

          <View style={styles.divider} />

          <Row
            icon="trash-outline"
            label="Delete"
            tone="danger"
            onPress={() => {
              onClose();
              void onDelete(item);
            }}
          />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  const color = tone === 'danger' ? STATUS.danger : TEXT.primary;
  return (
    <PressableScale
      haptic="light"
      scaleTo={0.985}
      style={styles.row}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={21} color={tone === 'danger' ? STATUS.danger : INK[600]} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: SURFACE.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: SURFACE.card,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    paddingHorizontal: SPACE.sm,
    paddingTop: SPACE.md,
    ...SHADOW.floating,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: INK[200],
    marginBottom: SPACE.md,
  },
  header: {
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.md,
  },
  eyebrow: {
    ...TYPE.overline,
  },
  title: {
    ...TYPE.title3,
    color: TEXT.primary,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.md,
  },
  rowLabel: {
    ...TYPE.body,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
    marginVertical: SPACE.sm,
    marginHorizontal: SPACE.md,
  },
});
