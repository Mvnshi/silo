/**
 * Review surfaces for the resurfacing loop (lib/resurface.ts), shown at the top
 * of the Today view.
 *
 * - EventReviewCard: the after-event report. Two light taps —
 *     "How did it go?"  [Did it] [Skipped]
 *     Did it → "Again sometime?"  [♥ Yes] [No, done]
 *     Skipped → "Reschedule or retire?"  [Reschedule] [Retire]
 * - StaleCard: the "you haven't opened this in a while" nudge — [Keep] [Archive].
 *
 * Pure presentation: every outcome is handed up to the parent, which owns
 * persistence + sync.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from '@/components/ui/PressableScale';
import { Item } from '@/lib/types';
import { ReviewOutcome } from '@/lib/resurface';
import { classConfig } from '@/lib/classification';
import { BRAND, INK, HAIRLINE, RADIUS, GRADIENTS } from '@/lib/theme';

/* ---------- after-event report ---------- */

interface EventReviewProps {
  item: Item;
  onOutcome: (item: Item, outcome: ReviewOutcome) => void;
  onReschedule: (item: Item) => void;
}

export function EventReviewCard({ item, onOutcome, onReschedule }: EventReviewProps) {
  const [step, setStep] = useState<'ask' | 'did' | 'skip'>('ask');
  const cfg = classConfig(item.classification);

  return (
    <View style={styles.card}>
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
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.prompt}>
            {step === 'ask'
              ? 'How did it go?'
              : step === 'did'
                ? 'Do it again sometime?'
                : 'Reschedule or retire it?'}
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
          <Pill label="Reschedule" icon="calendar" filled onPress={() => onReschedule(item)} />
          <Pill label="Retire" icon="archive" danger onPress={() => onOutcome(item, 'retire')} />
        </View>
      )}
    </View>
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
  return (
    <View style={styles.card}>
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
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.prompt}>{ageLabel} · still want it?</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pill label="Keep" icon="bookmark" filled onPress={() => onKeep(item.id)} />
        <Pill label="Archive" icon="archive" danger onPress={() => onArchive(item.id)} />
      </View>
    </View>
  );
}

/* ---------- shared pill button ---------- */

function Pill({
  label,
  icon,
  filled,
  danger,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  filled?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  if (filled) {
    return (
      <PressableScale haptic="light" onPress={onPress} style={styles.pillWrap}>
        <LinearGradient
          colors={[...GRADIENTS.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.pillFilled}
        >
          <Ionicons name={icon} size={15} color="#fff" />
          <Text style={styles.pillFilledText}>{label}</Text>
        </LinearGradient>
      </PressableScale>
    );
  }
  return (
    <PressableScale
      haptic="light"
      onPress={onPress}
      style={[styles.pill, danger && styles.pillDanger]}
    >
      <Ionicons name={icon} size={15} color={danger ? '#ef4444' : INK[600]} />
      <Text style={[styles.pillText, danger && styles.pillDangerText]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 14,
    marginBottom: 10,
    shadowColor: BRAND[600],
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '700', color: INK[900], letterSpacing: -0.2 },
  prompt: { fontSize: 13, color: INK[500], marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pillWrap: { flex: 1 },
  pillFilled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.pill,
  },
  pillFilledText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  pillText: { color: INK[700], fontWeight: '600', fontSize: 14 },
  pillDanger: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  pillDangerText: { color: '#ef4444' },
});
