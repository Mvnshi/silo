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
import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { celebrationHaptic } from '@/lib/haptics';
import { classConfig } from '@/lib/classification';
import { updateItem } from '@/lib/storage';
import { buildReview } from '@/lib/resurface';
import { Item } from '@/lib/types';
import { DURATION, RADIUS, SHADOW, SPACE, TYPE, type ThemeColors } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
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
  const c = useThemeColors();
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);

  if (!item) return null;
  const cfg = classConfig(item.classification);
  const isDone = item.viewed === true || item.status === 'done';
  // The eyebrow sits on the bare sheet, not on the 10% tint the pills use, and
  // `deep` is tuned for that tint — on a near-black sheet it lands near 2:1.
  // The gradient's light end keeps the classification's identity and reads.
  const eyebrowColor = c.appearance === 'dark' ? cfg.to : cfg.deep;

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
        style={[styles.scrim, dyn.scrim]}
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
          style={[styles.sheet, dyn.sheet, { paddingBottom: insets.bottom + SPACE.base }]}
        >
          <View style={[styles.grabber, dyn.grabber]} />

          <View style={styles.header}>
            <Text style={[styles.eyebrow, { color: eyebrowColor }]}>{cfg.label.toUpperCase()}</Text>
            <Text style={[styles.title, dyn.title]} numberOfLines={2}>
              {item.title}
            </Text>
          </View>

          <Row
            icon={isDone ? 'arrow-undo' : 'checkmark-circle'}
            label={isDone ? 'Mark as not done' : 'I did this'}
            onPress={() =>
              // Through buildReview so a completion actually registers as a use
              // (times_done / last_done_at) — that is the north-star metric.
              mutate(
                isDone
                  ? { viewed: false, status: 'inbox', completed_at: undefined }
                  : buildReview(item, 'good'),
                !isDone
              )
            }
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

          <View style={[styles.divider, dyn.divider]} />

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
  const c = useThemeColors();
  const color = tone === 'danger' ? c.danger : c.text;
  return (
    <PressableScale
      haptic="light"
      scaleTo={0.985}
      style={styles.row}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={21} color={tone === 'danger' ? c.danger : c.textSecondary} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </PressableScale>
  );
}

/**
 * Colour-only companions to `styles`. Plain object, not StyleSheet.create — it
 * is rebuilt when the appearance flips and would otherwise leak stylesheet ids.
 */
function makeDynamicStyles(c: ThemeColors) {
  // SHADOW.floating is what separates the sheet from the scrim; over a dark
  // scrim there is nothing left for it to darken, so the sheet gets a lit edge.
  const sheetEdge: ViewStyle =
    c.appearance === 'dark'
      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }
      : {};
  return {
    scrim: { backgroundColor: c.scrim },
    sheet: { backgroundColor: c.card, ...sheetEdge },
    grabber: { backgroundColor: c.field },
    title: { color: c.text },
    divider: { backgroundColor: c.hairline },
  };
}

// Colour for every rule below that needs one lives in `makeDynamicStyles`.
const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
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
    marginVertical: SPACE.sm,
    marginHorizontal: SPACE.md,
  },
});
