/**
 * ActionCard — a thing the assistant wants to do, shown before it happens.
 *
 * This is the safety surface of the whole action layer. `lib/assistant.ts`
 * guarantees an action can only reference rows the device itself put on the
 * wire; this guarantees the user sees WHICH rows before any of them change.
 *
 * ## Why a card and not the app's usual optimistic-plus-Undo
 *
 * The convention in Silo is that a destructive action applies instantly and
 * offers Undo in the Toast, never a blocking confirm — and that is right when
 * the USER picked the target: they tapped a specific row, so the only question
 * left is whether they meant it. Here the MODEL picked the target. "Archive
 * everything I haven't touched since June" is an instruction whose result the
 * user cannot predict, and Undo after the fact is no substitute for seeing the
 * list first.
 *
 * So the rule is one step longer, and it is the same for every action:
 *
 *      propose (this card) → user taps → apply → Undo in the Toast
 *
 * The card is the confirm, but it is not a modal — it sits inline in the
 * conversation, the user can ignore it, and every row it names can be
 * un-ticked before they commit. Once run it becomes a quiet receipt rather than
 * a live button, so a second tap cannot archive the same six things twice.
 *
 * `schedule` says out loud that it writes to the real calendar, because that is
 * the one verb whose effect leaves Silo (`leavesTheApp`).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import {
  actionItemIds,
  actionVerb,
  describeAction,
  leavesTheApp,
  type AssistantAction,
} from '@/lib/assistant';
import PressableScale from '@/components/ui/PressableScale';
import { ShimmerSweep, ShimmerText } from '@/components/ui/Shimmer';
import { LAYOUT, usePrefersReducedMotion } from '@/lib/motion';
import { BRAND, MIN_TAP, RADIUS, SPACE, TEXT, TYPE, type ThemeColors } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import type { Item } from '@/lib/types';

/** Rows shown before the list collapses behind "and N more". */
const VISIBLE_ROWS = 4;

/** Where the card is in its life. `done` and `failed` are terminal-ish. */
export type CardState = 'idle' | 'running' | 'done' | 'failed';

const ICON: Record<AssistantAction['tool'], keyof typeof Ionicons.glyphMap> = {
  schedule: 'calendar',
  complete: 'checkmark-done',
  archive: 'archive',
  add: 'add-circle',
  set_trigger: 'notifications',
};

interface Props {
  action: AssistantAction;
  /** The grounding set, for titles. Ids not in here were already dropped. */
  items: ReadonlyMap<string, Item>;
  state: CardState;
  /** Why it failed, shown in place of the button. */
  error?: string;
  /** Runs the action against the (possibly trimmed) selection. */
  onRun: (itemIds: string[]) => void;
  /** Take the card off the conversation without running it. */
  onDismiss: () => void;
}

export default function ActionCard({ action, items, state, error, onRun, onDismiss }: Props) {
  const c = useThemeColors();
  const reduced = usePrefersReducedMotion();
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);

  const allIds = actionItemIds(action);
  /** Which rows are still in. Starts as everything the model proposed. */
  const [selected, setSelected] = useState<string[]>(allIds);
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  // Schedule is single-item by construction, and `add` names no rows at all —
  // in both cases a tick list would be a checkbox with nothing to choose.
  const trimmable = action.tool !== 'add' && action.tool !== 'schedule' && allIds.length > 1;
  const shown = expanded ? allIds : allIds.slice(0, VISIBLE_ROWS);
  const hidden = allIds.length - shown.length;

  const headline = describeAction(
    // Re-describe against the live selection so the headline tracks the ticks:
    // un-ticking two of six must not still read "Archive 6 items".
    selected.length === allIds.length ? action : withItems(action, selected),
    items
  );

  const running = state === 'running';
  const canRun = state === 'idle' && (action.tool === 'add' || selected.length > 0);

  return (
    <Animated.View style={[styles.card, dyn.card]} layout={reduced ? undefined : LAYOUT}>
      <ShimmerSweep radius={RADIUS.lg} active={running} />

      <View style={styles.header}>
        <View style={[styles.badge, dyn.badge]}>
          <Ionicons
            name={state === 'done' ? 'checkmark' : ICON[action.tool]}
            size={15}
            color={state === 'done' ? c.success : c.textBrand}
          />
        </View>
        <Text style={[styles.headline, dyn.headline]}>{headline}</Text>
      </View>

      {leavesTheApp(action) && state !== 'done' && (
        <Text style={[styles.caveat, dyn.caveat]}>
          This adds a real event to your calendar.
        </Text>
      )}

      {shown.length > 0 && state !== 'done' && (
        <View style={styles.rows}>
          {shown.map((id) => {
            const on = selected.includes(id);
            const title = items.get(id)?.title ?? 'Untitled';
            return (
              <PressableScale
                key={id}
                haptic={trimmable ? 'selection' : 'none'}
                disabled={!trimmable || state !== 'idle'}
                scaleTo={0.985}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={title}
                accessibilityHint={trimmable ? 'Double tap to leave this one out' : undefined}
                style={styles.row}
                onPress={() => toggle(id)}
              >
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={17}
                  color={on ? c.textBrand : c.decorative}
                />
                <Text
                  style={[styles.rowText, on ? dyn.rowText : dyn.rowTextOff]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
              </PressableScale>
            );
          })}

          {hidden > 0 && (
            <PressableScale
              haptic="selection"
              accessibilityLabel={`Show ${hidden} more`}
              style={styles.row}
              onPress={() => setExpanded(true)}
            >
              <Ionicons name="chevron-down" size={17} color={c.decorative} />
              <Text style={[styles.rowText, dyn.rowTextOff]}>and {hidden} more</Text>
            </PressableScale>
          )}
        </View>
      )}

      {state === 'failed' && !!error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={c.danger} />
          <Text style={[styles.errorText, dyn.errorText]}>{error}</Text>
        </View>
      )}

      <View style={styles.footer}>
        {running ? (
          <ShimmerText style={styles.working}>Working…</ShimmerText>
        ) : state === 'done' ? (
          <Text style={[styles.doneText, dyn.doneText]}>Done</Text>
        ) : (
          <>
            <PressableScale
              haptic="medium"
              disabled={!canRun}
              accessibilityLabel={actionVerb(action)}
              style={[styles.confirm, !canRun && dyn.confirmOff]}
              onPress={() => onRun(selected)}
            >
              <Text style={[styles.confirmText, !canRun && dyn.confirmTextOff]}>
                {state === 'failed' ? 'Try again' : actionVerb(action)}
              </Text>
            </PressableScale>
            <PressableScale
              haptic="light"
              accessibilityLabel="Dismiss this suggestion"
              style={styles.dismiss}
              onPress={onDismiss}
            >
              <Text style={[styles.dismissText, dyn.dismissText]}>Not now</Text>
            </PressableScale>
          </>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * The action narrowed to a subset of its rows — used both for the live headline
 * and for the run itself, so what the user reads and what executes are built
 * from the same value.
 */
export function withItems(action: AssistantAction, itemIds: string[]): AssistantAction {
  if (action.tool === 'add') return action;
  if (action.tool === 'schedule') return { ...action, itemIds: [itemIds[0] ?? action.itemIds[0]] };
  return { ...action, itemIds };
}

function makeDynamicStyles(c: ThemeColors) {
  return {
    card: { backgroundColor: c.card, borderColor: c.brandBorder },
    badge: { backgroundColor: c.brandSoft },
    headline: { color: c.text },
    caveat: { color: c.textTertiary },
    rowText: { color: c.textSecondary },
    rowTextOff: { color: c.decorative },
    errorText: { color: c.danger },
    confirmOff: { backgroundColor: c.field },
    confirmTextOff: { color: c.decorative },
    dismissText: { color: c.textTertiary },
    doneText: { color: c.success },
  };
}

const styles = StyleSheet.create({
  // Opaque, unlike the sheet it sits in: this card is content, and content on
  // glass is the contrast trap the design system warns about.
  //
  // `stretch` + maxWidth, NOT `flex-start`: shrink-to-fit made the card's width
  // a function of its own contents, so once the item rows were hidden on
  // completion the header's `flex: 1` headline resolved to zero and the card
  // collapsed into a narrow box reading only "Done". A proposal that changes
  // width as it runs also just looks unstable.
  card: {
    alignSelf: 'stretch',
    maxWidth: '92%',
    marginTop: SPACE.xs,
    padding: SPACE.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: SPACE.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    ...TYPE.subhead,
    flex: 1,
  },
  caveat: {
    ...TYPE.caption,
    fontWeight: '500',
  },
  rows: {
    gap: SPACE.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    paddingVertical: SPACE.xs,
  },
  rowText: {
    ...TYPE.footnote,
    flexShrink: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
  },
  errorText: {
    ...TYPE.caption,
    flexShrink: 1,
  },
  // Wraps, because at the accessibility text sizes the confirm label alone is
  // wider than the card and "Not now" was pushed off the right edge — an
  // unreachable way to decline something the assistant wants to do to your data.
  // Wrapping puts it on its own line instead of hiding it.
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginTop: SPACE.xxs,
  },
  /**
   * Brand fill pinned to BRAND[600] in BOTH appearances, not `c.brand`.
   *
   * The dark palette lightens brand two steps to BRAND[400] so it keeps its
   * chroma on near-black — and white on that pale violet measures 2.7:1, under
   * even the 3:1 large-text floor. This is the button that commits a change to
   * the user's data, so it is the last label in the app that should be hard to
   * read. Same reasoning as the assistant FAB, the send button and the user's
   * own chat bubble, all of which pin to 600.
   */
  confirm: {
    minHeight: MIN_TAP - SPACE.md,
    justifyContent: 'center',
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  confirmText: {
    ...TYPE.footnote,
    fontWeight: '700',
    color: TEXT.inverse,
  },
  dismiss: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm,
  },
  dismissText: {
    ...TYPE.footnote,
  },
  working: {
    ...TYPE.footnote,
    fontWeight: '600',
    paddingVertical: SPACE.sm,
  },
  doneText: {
    ...TYPE.footnote,
    fontWeight: '700',
    paddingVertical: SPACE.sm,
  },
});
