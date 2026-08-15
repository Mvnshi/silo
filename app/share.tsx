/**
 * Share deep-link route (silo://share?type=&value=&category=).
 *
 * Used when something can open the app directly with a share payload (and by the
 * dev/test path). The native Share Extension itself hands off via the App Group
 * queue instead (see lib/shareImport.drainPendingShares) because iOS blocks
 * openURL from a share extension. Both paths run the same importSharedItem().
 *
 * This screen is the ONLY feedback a deep-link share gets, so it must actually
 * render its outcome: a success is held long enough to read before we hand the
 * user to the tabs, and a failure never navigates — it stays put and offers a
 * retry, because a silently-dropped share is indistinguishable from a save.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { importSharedItem } from '@/lib/shareImport';
import PressableScale from '@/components/ui/PressableScale';
import { DURATION, GRADIENTS, RADIUS, SHADOW, SPACE, SPRING, TEXT, TYPE } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { enterList, usePrefersReducedMotion } from '@/lib/motion';

/** How long the "Saved" state stays on screen before we leave. Long enough to read. */
const SAVED_HOLD_MS = 900;

type Status = 'saving' | 'saved' | 'failed';

function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default function ShareTarget() {
  const params = useLocalSearchParams();
  const c = useThemeColors();
  const reduced = usePrefersReducedMotion();
  const [status, setStatus] = useState<Status>('saving');
  const started = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Freeze the payload on first render — a retry must replay the original share,
  // not whatever the route params have become.
  const payload = useRef({
    type: asString(params.type),
    value: asString(params.value),
    category: asString(params.category),
  }).current;

  const runImport = useCallback(async () => {
    setStatus('saving');
    try {
      await importSharedItem(payload);
      setStatus('saved');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Navigate AFTER the confirmation has been on screen — the old code
      // replaced in a `finally`, in the same tick as setStatus, so neither the
      // success nor the failure state ever rendered.
      exitTimer.current = setTimeout(() => router.replace('/(tabs)'), SAVED_HOLD_MS);
    } catch (e) {
      console.error('Share import failed:', e);
      setStatus('failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [payload]);

  useEffect(() => {
    if (started.current) return; // process exactly once; retry is explicit
    started.current = true;
    void runImport();
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [runImport]);

  // The orb breathes while work is in flight and settles when it resolves.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (status === 'saving' && !reduced) {
      pulse.value = withRepeat(withTiming(1.12, { duration: DURATION.slow }), -1, true);
    } else {
      pulse.value = withSpring(1, SPRING.settle);
    }
  }, [status, reduced, pulse]);
  const orbStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const failed = status === 'failed';
  const icon = failed ? 'alert-circle' : status === 'saved' ? 'checkmark' : 'sparkles';

  return (
    <View style={[styles.container, { backgroundColor: c.page }]}>
      <Animated.View style={orbStyle}>
        <LinearGradient
          colors={failed ? [c.danger, c.danger] : [...GRADIENTS.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.orb}
        >
          {/* The orb is always a saturated fill, so its glyph stays white. */}
          <Ionicons name={icon} size={34} color={TEXT.inverse} />
        </LinearGradient>
      </Animated.View>

      <View style={styles.copy}>
        <Text style={[styles.title, { color: c.text }]}>
          {failed
            ? 'Couldn’t save that item.'
            : status === 'saved'
              ? 'Saved to Silo'
              : 'Saving to Silo…'}
        </Text>
        {failed ? (
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            It didn’t make it into your library — give it another go.
          </Text>
        ) : null}
      </View>

      {failed && (
        <Animated.View entering={enterList(0, reduced)} style={styles.actions}>
          <PressableScale
            haptic="light"
            onPress={() => void runImport()}
            accessibilityLabel="Try again"
          >
            <LinearGradient
              colors={[...GRADIENTS.brand]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>Try again</Text>
            </LinearGradient>
          </PressableScale>
          <PressableScale
            haptic="light"
            onPress={() => router.replace('/(tabs)')}
            style={styles.secondaryBtn}
            accessibilityLabel="Close"
          >
            <Text style={[styles.secondaryBtnText, { color: c.textBrand }]}>Close</Text>
          </PressableScale>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.lg,
    padding: SPACE.xl,
  },
  orb: {
    width: 84,
    height: 84,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.brandFloating,
  },
  copy: { alignItems: 'center', gap: SPACE.sm },
  title: { ...TYPE.title3, textAlign: 'center' },
  subtitle: { ...TYPE.callout, textAlign: 'center' },
  actions: { alignItems: 'center', gap: SPACE.xs, alignSelf: 'stretch' },
  primaryBtn: {
    borderRadius: RADIUS.pill,
    paddingVertical: 14,
    paddingHorizontal: SPACE.xxl,
    alignItems: 'center',
  },
  /* On the brand gradient — white in both appearances. */
  primaryBtnText: { ...TYPE.headline, color: TEXT.inverse },
  secondaryBtn: { padding: SPACE.md, alignItems: 'center' },
  secondaryBtnText: { ...TYPE.bodyStrong },
});
