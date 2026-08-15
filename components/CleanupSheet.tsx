/**
 * CleanupSheet — the anti-hoarding pass.
 *
 * A save-everything app becomes a graveyard unless something makes letting go
 * as easy as saving. This walks the stale pile one card at a time: **Keep**
 * resets the seen-clock (it survives another cycle), **Let go** archives it.
 *
 * Deliberately one-at-a-time rather than a multi-select list: a checkbox list of
 * 200 forgotten saves is a chore nobody starts, whereas a short "keep or let go"
 * run is finishable in a minute and ends on a win.
 *
 * Nothing here is destructive — "let go" archives, so everything is recoverable.
 */
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import PressableScale from '@/components/ui/PressableScale';
import { useToast } from '@/components/ui/Toast';
import { classConfig } from '@/lib/classification';
import { celebrationHaptic } from '@/lib/haptics';
import { touchSeen, updateItem } from '@/lib/storage';
import { Item } from '@/lib/types';
import {
  BRAND,
  DURATION,
  GRADIENTS,
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
  visible: boolean;
  candidates: Item[];
  onClose: () => void;
  /** Called once at the end so the caller reloads with every decision applied. */
  onChanged: () => void | Promise<void>;
}

/** How many cards one run offers before declaring victory. */
const RUN_LENGTH = 10;

export default function CleanupSheet({ visible, candidates, onClose, onChanged }: Props) {
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [kept, setKept] = useState(0);
  const [released, setReleased] = useState(0);

  // A fresh run every time the sheet opens — reopening should not resume
  // halfway through a pile the user has already re-triaged.
  useEffect(() => {
    if (visible) {
      setIndex(0);
      setKept(0);
      setReleased(0);
    }
  }, [visible]);

  const run = candidates.slice(0, RUN_LENGTH);
  const item = run[index];
  const done = !item;

  async function decide(keep: boolean) {
    if (!item) return;
    const current = item;
    setIndex((i) => i + 1);
    if (keep) {
      setKept((n) => n + 1);
      // touchSeen is local + unsynced: it resets the staleness clock without
      // creating per-open sync churn.
      await touchSeen(current.id).catch(() => {});
    } else {
      setReleased((n) => n + 1);
      await updateItem(current.id, { archived: true, status: 'archived' }).catch(() => {});
    }
  }

  async function finish() {
    await onChanged();
    if (released > 0) {
      toast.show({
        message: `Archived ${released} ${released === 1 ? 'save' : 'saves'}`,
        tone: 'success',
      });
    }
    onClose();
  }

  useEffect(() => {
    if (visible && done && (kept > 0 || released > 0)) {
      celebrationHaptic().catch(() => {});
    }
    // Only fire on the transition into the summary.
  }, [visible, done, kept, released]);

  if (!visible) return null;

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
          onPress={done ? finish : onClose}
          accessibilityLabel="Close tidy up"
        >
          <View style={StyleSheet.absoluteFill} />
        </PressableScale>

        <Animated.View
          entering={enterFromBottom(0, reduced)}
          exiting={exitToBottom(reduced)}
          style={[styles.sheet, { paddingBottom: insets.bottom + SPACE.lg }]}
        >
          <View style={styles.grabber} />

          {done ? (
            <View style={styles.summary}>
              <LinearGradient
                colors={[...GRADIENTS.brand]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.summaryOrb}
              >
                <Ionicons name="checkmark" size={38} color="#fff" />
              </LinearGradient>
              <Text style={styles.summaryTitle}>
                {kept + released === 0 ? 'Nothing to tidy' : 'Nice — that’s tidier'}
              </Text>
              <Text style={styles.summarySub}>
                {kept + released === 0
                  ? 'Your saves are all still fresh.'
                  : `You kept ${kept} and let go of ${released}.` +
                    (candidates.length > RUN_LENGTH
                      ? ` ${candidates.length - RUN_LENGTH} more waiting whenever you want.`
                      : '')}
              </Text>
              <PressableScale
                haptic="medium"
                onPress={finish}
                style={styles.doneBtn}
                accessibilityLabel="Done"
              >
                <Text style={styles.doneBtnText}>Done</Text>
              </PressableScale>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Still want this?</Text>
                <Text style={styles.headerCount}>
                  {index + 1} of {run.length}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${(index / run.length) * 100}%` }]}
                />
              </View>

              <ItemPreview item={item} />

              <View style={styles.actions}>
                <PressableScale
                  haptic="light"
                  containerStyle={styles.actionSlot}
                  style={[styles.actionBtn, styles.letGoBtn]}
                  onPress={() => decide(false)}
                  accessibilityLabel="Let this go"
                >
                  <Ionicons name="archive-outline" size={19} color={STATUS.danger} />
                  <Text style={[styles.actionText, { color: STATUS.danger }]}>Let go</Text>
                </PressableScale>
                <PressableScale
                  haptic="medium"
                  containerStyle={styles.actionSlot}
                  style={[styles.actionBtn, styles.keepBtn]}
                  onPress={() => decide(true)}
                  accessibilityLabel="Keep this"
                >
                  <Ionicons name="bookmark" size={19} color="#fff" />
                  <Text style={[styles.actionText, { color: '#fff' }]}>Keep</Text>
                </PressableScale>
              </View>
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function ItemPreview({ item }: { item: Item }) {
  const cfg = classConfig(item.classification);
  const saved = new Date(item.created_at);
  const monthsAgo = Math.max(
    0,
    Math.round((Date.now() - saved.getTime()) / (30 * 24 * 60 * 60 * 1000))
  );

  return (
    <View style={styles.preview}>
      <View style={styles.previewThumb}>
        {item.imageUri ? (
          <Image
            source={{ uri: item.imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <LinearGradient
            colors={[cfg.from, cfg.to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.previewGlyph}>
              <Ionicons name={cfg.icon} size={30} color="#fff" />
            </View>
          </LinearGradient>
        )}
      </View>
      <View style={styles.previewBody}>
        <Text style={[styles.previewEyebrow, { color: cfg.deep }]}>{cfg.label.toUpperCase()}</Text>
        <Text style={styles.previewTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.previewMeta}>
          Saved {monthsAgo === 0 ? 'recently' : `${monthsAgo}mo ago`} · never opened since
        </Text>
      </View>
    </View>
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
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
    ...SHADOW.floating,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: INK[200],
    marginBottom: SPACE.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  headerTitle: {
    ...TYPE.title2,
    color: TEXT.primary,
  },
  headerCount: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
  },
  progressTrack: {
    height: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: INK[100],
    marginTop: SPACE.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },

  preview: {
    flexDirection: 'row',
    gap: SPACE.base,
    marginTop: SPACE.lg,
    padding: SPACE.md,
    borderRadius: RADIUS.xl,
    backgroundColor: SURFACE.sunken,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  previewThumb: {
    width: 76,
    height: 76,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: INK[100],
  },
  previewGlyph: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBody: {
    flex: 1,
    justifyContent: 'center',
  },
  previewEyebrow: {
    ...TYPE.overline,
  },
  previewTitle: {
    ...TYPE.bodyStrong,
    color: TEXT.primary,
    marginTop: 2,
  },
  previewMeta: {
    ...TYPE.footnote,
    color: TEXT.tertiary,
    marginTop: SPACE.xs,
  },

  actions: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginTop: SPACE.lg,
  },
  actionSlot: { flex: 1 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.sm,
    paddingVertical: 15,
    borderRadius: RADIUS.pill,
  },
  letGoBtn: {
    backgroundColor: STATUS.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  keepBtn: {
    backgroundColor: BRAND[600],
  },
  actionText: {
    ...TYPE.bodyStrong,
  },

  summary: {
    alignItems: 'center',
    paddingVertical: SPACE.lg,
  },
  summaryOrb: {
    width: 82,
    height: 82,
    borderRadius: RADIUS.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.brandCard,
  },
  summaryTitle: {
    ...TYPE.title2,
    color: TEXT.primary,
    marginTop: SPACE.base,
  },
  summarySub: {
    ...TYPE.subhead,
    fontWeight: '400',
    color: TEXT.secondary,
    textAlign: 'center',
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.base,
  },
  doneBtn: {
    marginTop: SPACE.lg,
    paddingHorizontal: SPACE.xxl,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
  },
  doneBtnText: {
    ...TYPE.bodyStrong,
    color: '#fff',
  },
});
