/**
 * Toast — the app's single transient-feedback surface (and the home of Undo).
 *
 * Mount `<ToastProvider>` once at the root; call `useToast().show(...)` from
 * anywhere. Destructive actions should ALWAYS route through here with an
 * `action: { label: 'Undo', onPress }` instead of a blocking confirm dialog —
 * an undoable action that happens instantly beats a modal that asks twice.
 *
 * The toast floats above the tab bar, auto-dismisses after `DURATION.toast`,
 * and pauses nothing — tapping Undo dismisses it immediately.
 *
 * APPEARANCE: this is deliberately a dark glass surface in BOTH appearances —
 * it floats over arbitrary content, and a surface that restyled itself per
 * appearance would read as part of the page instead of above it. So its own
 * colours stay literal rather than coming from the palette.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Glass, { LIQUID_GLASS } from './Glass';
import PressableScale from './PressableScale';
import { BRAND, DURATION, HIT_SLOP, RADIUS, SHADOW, SPACE, STATUS, TYPE } from '@/lib/theme';
import { useIsDark } from '@/lib/useTheme';
import { enterFromBottom, exitToBottom, usePrefersReducedMotion } from '@/lib/motion';

export type ToastTone = 'neutral' | 'success' | 'danger';

export interface ToastOptions {
  message: string;
  /** Optional trailing action — this is how Undo is surfaced. */
  action?: { label: string; onPress: () => void | Promise<void> };
  tone?: ToastTone;
  /** Override the auto-dismiss delay (ms). */
  duration?: number;
}

interface ToastContextValue {
  show: (options: ToastOptions) => void;
  hide: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Access the toast controller. Safe to call outside a provider (no-ops), so a
 * component can be unit-rendered without wiring the whole app shell.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_TOAST;
}

const NOOP_TOAST: ToastContextValue = { show: () => {}, hide: () => {} };

const TONE_ICON: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  neutral: 'information-circle',
  success: 'checkmark-circle',
  danger: 'alert-circle',
};

const TONE_COLOR: Record<ToastTone, string> = {
  neutral: BRAND[400],
  success: STATUS.success,
  danger: STATUS.danger,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const isDark = useIsDark();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const show = useCallback(
    (options: ToastOptions) => {
      clearTimer();
      setToast(options);
      timerRef.current = setTimeout(() => setToast(null), options.duration ?? DURATION.toast);
    },
    [clearTimer]
  );

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  const tone = toast?.tone ?? 'neutral';

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          // Tab bar (~52) + its bottom inset, then a gap — so the toast never
          // sits under the floating tab bar on any device.
          style={[styles.wrap, { bottom: insets.bottom + 78 }]}
          entering={enterFromBottom(0, reduced)}
          exiting={exitToBottom(reduced)}
          pointerEvents="box-none"
          accessibilityLiveRegion="polite"
        >
          {/* tint is pinned dark: the toast's ground is the toast, not the page. */}
          <Glass
            tint="dark"
            intensity={60}
            radius={RADIUS.lg}
            style={[
              // The slate wash is how the blur FALLBACK reads as a floating
              // surface rather than a smudge. Liquid Glass's dark material
              // already does that on its own, and a 55%-opaque fill laid over it
              // would smother the effect — so the wash stays fallback-only.
              !LIQUID_GLASS && styles.cardWash,
              isDark && styles.cardOnDark,
            ]}
          >
            <View style={styles.row}>
              <Ionicons name={TONE_ICON[tone]} size={19} color={TONE_COLOR[tone]} />
              <Text style={styles.message} numberOfLines={2}>
                {toast.message}
              </Text>
              {toast.action && (
                <PressableScale
                  haptic="light"
                  hitSlop={HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={toast.action.label}
                  onPress={() => {
                    hide();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                    void toast.action?.onPress();
                  }}
                >
                  <Text style={styles.action}>{toast.action.label}</Text>
                </PressableScale>
              )}
            </View>
          </Glass>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: SPACE.base,
    right: SPACE.base,
    ...SHADOW.floating,
  },
  cardWash: {
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  // On a light page the dark card plus SHADOW.floating separate on their own.
  // On the dark page neither does: the shadow vanishes and Glass's default
  // 14%-white edge is too faint against near-black, so brighten just the rim.
  cardOnDark: {
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingVertical: 13,
    paddingHorizontal: SPACE.base,
  },
  message: {
    ...TYPE.callout,
    color: '#fff',
    flex: 1,
  },
  action: {
    ...TYPE.subhead,
    fontWeight: '800',
    color: BRAND[300],
  },
});
