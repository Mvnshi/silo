/**
 * Review surfaces for the resurfacing loop (lib/resurface.ts), shown at the top
 * of the Today view.
 *
 * - EventReviewCard: the after-event report. Two light taps —
 *     "How did it go?"  [Did it] [Skipped]
 *     Did it → "Again sometime?"  [♥ Yes] [No, done]
 *     Skipped → "What now?"  [Reschedule] [Not now] [Retire]
 *   Every branch past the first shows a back chevron: a mistap must never cost
 *   the user their item. "Not now" records the honest 'skipped' verdict, which
 *   stops the nagging without scheduling or archiving anything.
 * - StaleCard: the "you haven't opened this in a while" nudge — [Keep] [Archive].
 *
 * Pure presentation: every outcome is handed up to the parent, which owns
 * persistence + sync. Both cards exit with a fade and animate their layout, so
 * answering one doesn't make the list below it jump.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { Item } from '@/lib/types';
import { ReviewOutcome, scheduledEnd } from '@/lib/resurface';
import { classConfig } from '@/lib/classification';
import {
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  TYPE,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { exitFade, LAYOUT, usePrefersReducedMotion } from '@/lib/motion';

/**
 * "Yesterday, 7:00 PM" — the elapsed slot, phrased the way a person would.
 * Falls back to the neutral prompt if the item somehow has no schedule.
 */
function whenLabel(item: Item): string {
  const end = scheduledEnd(item);
  if (!end) return 'How did it go?';

  const time = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.getTime() - endOfDay(end)) / (24 * 60 * 60 * 1000));

  if (days <= 0) return `Earlier today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${end.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  return `${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

function endOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/* ---------- after-event report ---------- */

interface EventReviewProps {
  item: Item;
  onOutcome: (item: Item, outcome: ReviewOutcome) => void;
  onReschedule: (item: Item) => void;
}

export function EventReviewCard({ item, onOutcome, onReschedule }: EventReviewProps) {
  const [step, setStep] = useState<'ask' | 'did' | 'skip'>('ask');
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  const cfg = classConfig(item.classification);

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}
      layout={LAYOUT}
      exiting={exitFade(reduced)}
    >
      <View style={styles.headRow}>
        {step === 'ask' ? (
          <LinearGradient
            colors={[cfg.from, cfg.to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.icon}
          >
            <Ionicons name={cfg.icon} size={16} color="#fff" />
          </LinearGradient>
        ) : (
          <PressableScale
            haptic="selection"
            onPress={() => setStep('ask')}
            style={[styles.backBtn, { backgroundColor: c.hairline }]}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={18} color={c.textSecondary} />
          </PressableScale>
        )}
        <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.prompt, { color: c.textSecondary }]}>
            {/* The 'ask' step sits directly under a "How did it go?" section
                header, so repeating it here says nothing. Show WHEN it was on
                the calendar instead — that is the context the user needs to
                remember whether they did it. */}
            {step === 'ask'
              ? whenLabel(item)
              : step === 'did'
                ? 'Do it again sometime?'
                : 'What do you want to do with it?'}
          </Text>
        </View>
      </View>

      {step === 'ask' && (
        <View style={styles.actions}>
          <Pill label="Did it" icon="checkmark" filled onPress={() => setStep('did')} />
          <Pill label="Skipped" icon="close" onPress={() => setStep('skip')} />
        </View>
      )}

      {step === 'did' && (
        <View style={styles.actions}>
          <Pill label="Yes" icon="heart" filled onPress={() => onOutcome(item, 'loved')} />
          <Pill label="No, done" icon="checkmark-done" onPress={() => onOutcome(item, 'good')} />
        </View>
      )}

      {step === 'skip' && (
        <View style={styles.actions}>
          <Pill
            label="Reschedule"
            icon="calendar"
            filled
            compact
            onPress={() => onReschedule(item)}
          />
          <Pill label="Not now" icon="time" compact onPress={() => onOutcome(item, 'skipped')} />
          <Pill label="Retire" icon="archive" danger compact onPress={() => onOutcome(item, 'retire')} />
        </View>
      )}
    </Animated.View>
  );
}

/* ---------- staleness nudge ---------- */

interface StaleProps {
  item: Item;
  ageLabel: string; // e.g. "saved 3mo ago"
  onKeep: (id: string) => void;
  onArchive: (id: string) => void;
}

export function StaleCard({ item, ageLabel, onKeep, onArchive }: StaleProps) {
  const cfg = classConfig(item.classification);
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  return (
    <Animated.View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}
      layout={LAYOUT}
      exiting={exitFade(reduced)}
    >
      <View style={styles.headRow}>
        <LinearGradient
          colors={[cfg.from, cfg.to]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.icon}
        >
          <Ionicons name={cfg.icon} size={16} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.prompt, { color: c.textSecondary }]}>
            {ageLabel} · still want it?
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pill label="Keep" icon="bookmark" filled onPress={() => onKeep(item.id)} />
        <Pill label="Archive" icon="archive" danger onPress={() => onArchive(item.id)} />
      </View>
    </Animated.View>
  );
}

/* ---------- shared pill button ---------- */

function Pill({
  label,
  icon,
  filled,
  danger,
  compact,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  filled?: boolean;
  danger?: boolean;
  /** Three-up row: drop a type step so "Reschedule" doesn't wrap on a 4"-wide phone. */
  compact?: boolean;
  onPress: () => void;
}) {
  const c = useThemeColors();

  if (filled) {
    // Brand surface: the violet gradient and its white label are the same in
    // both appearances (they are the brand, not the page).
    return (
      <PressableScale haptic="light" onPress={onPress} containerStyle={styles.pillWrap}>
        <LinearGradient
          colors={[...GRADIENTS.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pillFilled}
        >
          <Ionicons name={icon} size={15} color="#fff" />
          <Text style={[styles.pillFilledText, compact && styles.pillTextCompact]} numberOfLines={1}>
            {label}
          </Text>
        </LinearGradient>
      </PressableScale>
    );
  }
  return (
    <PressableScale
      haptic="light"
      onPress={onPress}
      containerStyle={styles.pillWrap}
      style={[
        styles.pill,
        // `raised` rather than `card`: on dark the pill sits ON the card, and
        // an identical fill would leave only the hairline to read it by.
        { backgroundColor: danger ? c.dangerSoft : c.raised, borderColor: c.hairline },
      ]}
    >
      <Ionicons name={icon} size={15} color={danger ? c.danger : c.text} />
      <Text
        style={[
          styles.pillText,
          { color: danger ? c.danger : c.text },
          compact && styles.pillTextCompact,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * Appearance-independent only — every colour is applied at the call site from
 * `useThemeColors()`. The card keeps its 1pt border in both appearances: on
 * dark it is the ONLY thing separating the card from the page, since
 * `SHADOW.card` is invisible there.
 */
const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    ...SHADOW.card,
  },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...TYPE.callout, fontWeight: '700' },
  prompt: { ...TYPE.footnote, marginTop: SPACE.xxs },
  actions: { flexDirection: 'row', gap: SPACE.sm, marginTop: SPACE.md },
  pillWrap: { flex: 1 },
  pillFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.pill,
  },
  pillFilledText: { ...TYPE.subhead, fontWeight: '700', color: '#fff' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  pillText: { ...TYPE.subhead },
  pillTextCompact: { ...TYPE.footnote, fontWeight: '700' },
});
