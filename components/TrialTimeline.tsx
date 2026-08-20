/**
 * The trial, drawn as three dated beats.
 *
 * ## Why show this at all
 *
 * "7-day free trial" tells a user nothing about the shape of the commitment,
 * and the gap between what they think they agreed to and what happens on day
 * seven is where refund requests, chargebacks and one-star "they charged me
 * without warning" reviews come from. Spelling the timeline out costs a few
 * conversions from people who would have churned angrily anyway, and buys back
 * far more in retained subscribers and a review page that isn't on fire.
 *
 * It is also more disclosure than Guideline 3.1.2 asks for, which is a good
 * place to be when a reviewer opens the purchase screen.
 *
 * ## The middle beat is a promise, so it has to be true
 *
 * "We'll remind you" is only honest if a reminder is actually scheduled — that
 * is `scheduleTrialReminder` in `lib/notifications.ts`, fired at purchase. If
 * notification permission was refused, the caller passes `reminder={false}` and
 * the row is dropped rather than left as a claim we cannot keep.
 *
 * Rendered on the paywall's brand gradient, so the palette here is deliberately
 * fixed white-on-violet rather than themed — the ground it sits on is the same
 * in light and dark.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RADIUS, SPACE, TYPE } from '@/lib/theme';

const DOT = 22;

interface Beat {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  body: string;
  /** The final beat draws no connector below it and gets a solid dot. */
  last?: boolean;
}

function dayLabel(offset: number): string {
  if (offset === 0) return 'Today';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

export default function TrialTimeline({
  days,
  reminderDaysBefore,
  priceLabel,
  period,
  reminder = true,
}: {
  /** Real trial length, read from the store product where possible. */
  days: number;
  /** How many days before the charge the reminder fires. */
  reminderDaysBefore: number;
  /** The store's own formatted price — never a constructed one. */
  priceLabel: string;
  period: 'year' | 'month';
  /** False when no reminder could be scheduled, so we don't promise one. */
  reminder?: boolean;
}) {
  const remindOn = Math.max(1, days - reminderDaysBefore);

  const beats: Beat[] = [
    {
      icon: 'lock-open',
      label: dayLabel(0),
      body: 'Everything unlocks. The whole AI layer, no limits.',
    },
    ...(reminder
      ? [
          {
            icon: 'notifications-outline' as const,
            label: dayLabel(remindOn),
            body: `We’ll remind you your trial is ending — with what you actually got done this week.`,
          },
        ]
      : []),
    {
      icon: 'card-outline',
      label: dayLabel(days),
      body: `Your subscription starts at ${priceLabel}/${period}. Cancel any time before then and you pay nothing.`,
      last: true,
    },
  ];

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={styles.heading}>How the free trial works</Text>
      {beats.map((beat, i) => (
        <View key={beat.label + beat.icon} style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, beat.last && styles.dotSolid]}>
              <Ionicons
                name={beat.icon}
                size={12}
                color={beat.last ? '#6d28d9' : 'rgba(255,255,255,0.95)'}
              />
            </View>
            {i < beats.length - 1 && <View style={styles.connector} />}
          </View>
          <View style={styles.copy}>
            <Text style={styles.label}>{beat.label}</Text>
            <Text style={styles.body}>{beat.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SPACE.xl },
  heading: {
    ...TYPE.caption,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACE.md,
  },
  row: { flexDirection: 'row' },
  // The rail is a fixed-width column so the connector stays plumb even when the
  // copy beside it wraps to four lines at the accessibility text sizes.
  rail: { width: DOT, alignItems: 'center' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotSolid: { backgroundColor: '#fff', borderColor: '#fff' },
  connector: {
    flex: 1,
    width: 2,
    minHeight: SPACE.base,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginVertical: SPACE.xxs,
  },
  copy: { flex: 1, paddingLeft: SPACE.md, paddingBottom: SPACE.base },
  label: { ...TYPE.subhead, color: '#fff' },
  body: { ...TYPE.footnote, color: 'rgba(255,255,255,0.78)', marginTop: SPACE.xxs },
});
