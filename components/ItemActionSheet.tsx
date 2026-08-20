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
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import { celebrationHaptic } from '@/lib/haptics';
import { classConfig } from '@/lib/classification';
import { updateItem } from '@/lib/storage';
import { unscheduleItem } from '@/lib/scheduler';
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
      // A patch that clears the slot (buildReview on a completion) has to take
      // the native calendar event with it, or the event outlives its schedule
      // and keeps firing. Best-effort: it must not eat the mutation.
      if ('scheduled_date' in patch && patch.scheduled_date === undefined) {
        await unscheduleItem(item.id).catch((err) => console.error('calendar cleanup failed', err));
      }
      if (celebrate) await celebrationHaptic();
      await onChanged();
    } catch (error) {
      console.error('Quick action failed:', error);
    }
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* The scrim fades as a SIBLING of the sheet, never as its parent: any
            opacity animation above a glass surface deletes it instead of fading
            it. It still covers the full screen, so tapping anywhere closes. */}
        <Animated.View
          entering={FadeIn.duration(DURATION.fast)}
          exiting={FadeOut.duration(DURATION.instant)}
          style={[StyleSheet.absoluteFill, dyn.scrim]}
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
        </Animated.View>

        {/* Glass can't cast a shadow from inside its own clipped bounds, so the
            lift that separated the opaque sheet lives on this wrapper — which is
            also the only thing that animates (transform only). */}
        <Animated.View entering={enterFromBottom(0, reduced)} exiting={exitToBottom(reduced)} style={styles.sheetLift}>
          <Glass
            variant="regular"
            radius={RADIUS.xxl}
            // The rim is drawn per-edge below — only the top edge is on screen.
            bordered={false}
            tintColor={dyn.sheetTint}
            style={[styles.sheet, dyn.sheet, { paddingBottom: insets.bottom + SPACE.base }]}
          >
            <View style={[styles.grabber, dyn.grabber]} />

            <View style={styles.header}>
              <Text style={[styles.eyebrow, { color: eyebrowColor }]}>
                {cfg.label.toUpperCase()}
              </Text>
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
          </Glass>
        </Animated.View>
      </View>
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
  return {
    scrim: { backgroundColor: c.scrim },
    // No fill: the glass IS the surface. What is left to draw is the rim on the
    // one edge you can see — the top — which is what separates the sheet from
    // whatever it is floating over, in both appearances.
    sheet: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },
    // Glass borrows its colour from what is behind it, and on light that is a
    // pale violet page — body text on bare material drifts under AA. `2e` ≈ 18%
    // of the palette's own card colour: enough to hold text, far too little to
    // read as a fill. (Both palettes state `card` as a 6-digit hex, so the alpha
    // suffix is all this needs.)
    sheetTint: `${c.card}2e`,
    grabber: { backgroundColor: c.field },
    title: { color: c.text },
    divider: { backgroundColor: c.hairline },
  };
}

// Colour for every rule below that needs one lives in `makeDynamicStyles`.
const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetLift: {
    ...SHADOW.floating,
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    // Flush with the bottom of the screen, so the corners the `radius` prop
    // rounds by default get squared off again.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: SPACE.sm,
    paddingTop: SPACE.md,
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
