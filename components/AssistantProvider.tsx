/**
 * AssistantProvider — the assistant's home.
 *
 * It used to be mounted in exactly one place, `app/(tabs)/add.tsx`, with
 * `onClose={() => {}}` — buried in the Add tab, with a close button that did
 * nothing. That was defensible when it could only answer questions about the
 * library. It is not defensible now that it can schedule, complete, archive and
 * set reminders: "archive everything stale" is not an Add-tab thought.
 *
 * So the sheet is mounted ONCE at the root, as a sibling of the navigator (the
 * same arrangement as `TextPromptHost`), and every screen reaches it through
 * `useAssistant()`. That buys three things:
 *
 *  - **A real dismiss.** Close state lives here, so the close button, the
 *    backdrop and a programmatic `close()` all go through one path.
 *  - **One instance.** A per-screen sheet would have meant per-screen
 *    conversation history, and an action proposed on one tab evaporating when
 *    you switched to another.
 *  - **Toasts work.** It sits inside `ToastProvider`, so the Undo that follows
 *    every applied action actually has somewhere to appear.
 *
 * The FAB lives here rather than inside `ChatBot` because deciding *where* the
 * assistant should be offered is a routing question, and the sheet should not
 * know about routes. See `HIDDEN_ON`.
 *
 * VISION.md is explicit that Silo is not a chat-first product — the feed, the
 * calendar and the nudge are. Hence a floating entry point rather than a sixth
 * tab: reachable everywhere, primary nowhere.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChatBot from '@/components/ChatBot';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import { BRAND, SHADOW, SPACE, TEXT } from '@/lib/theme';

interface AssistantContextValue {
  isOpen: boolean;
  /** Open the sheet, optionally with the composer pre-filled. */
  open: (prefill?: string) => void;
  close: () => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
});

/** Safe outside the provider (no-ops), so a screen can be rendered in isolation. */
export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}

/** FAB diameter. Also its corner radius — glass rounds to a number, not `pill`. */
const FAB_SIZE = 60;

/**
 * The FAB is glass, but it is still the brand control: violet dense enough to
 * hold a white glyph, thin enough that the material behind it keeps lensing.
 * Pinned to BRAND[600] in both appearances — the palette's `brand` lightens two
 * steps on dark, and white on that pale violet drops under 3:1.
 */
const FAB_TINT = `${BRAND[600]}bf`;

/**
 * Routes with no FAB.
 *
 * `/onboarding`, `/sign-in` and `/paywall` are single-decision surfaces — a
 * floating second option undermines each of them. `/reel` is full-bleed media
 * where the FAB would sit on top of the video. `/share` is a transient
 * deep-link target that unmounts itself.
 *
 * The assistant is still reachable on all of them via `open()`; this only
 * governs the ambient entry point.
 */
const HIDDEN_ON = ['/onboarding', '/sign-in', '/paywall', '/reel', '/share'];

export default function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const open = useCallback((text?: string) => {
    setPrefill(text);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Clear so re-opening from a plain tap doesn't resurrect the last prefill.
    setPrefill(undefined);
  }, []);

  const value = useMemo<AssistantContextValue>(
    () => ({ isOpen, open, close }),
    [isOpen, open, close]
  );

  const showFab = !isOpen && !HIDDEN_ON.some((route) => pathname.startsWith(route));

  return (
    <AssistantContext.Provider value={value}>
      {children}

      {/* box-none so the (mostly empty) overlay never eats a tap meant for the
          screen underneath. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {showFab && (
          <PressableScale
            haptic="medium"
            accessibilityLabel="Open assistant"
            // Sits above the floating tab bar on every device.
            containerStyle={[styles.fabContainer, { bottom: insets.bottom + 66 }]}
            // Glass clips to its own bounds, so the brand lift that separates the
            // FAB from the page has to live outside it.
            style={styles.fabLift}
            onPress={() => open()}
          >
            {/* A control, so the material takes the press (Apple's specular
                response) — and a brand tint so it still reads as THE button
                rather than a blurred hole. The glyph stays white on it. */}
            <Glass interactive radius={FAB_SIZE / 2} tintColor={FAB_TINT} style={styles.fab}>
              <Ionicons name="sparkles" size={26} color={TEXT.inverse} />
            </Glass>
          </PressableScale>
        )}

        <ChatBot visible={isOpen} prefill={prefill} onClose={close} />
      </View>
    </AssistantContext.Provider>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    right: SPACE.lg,
  },
  // The brand lift, on the wrapper — the glass itself clips to its own bounds,
  // so a shadow set on it would never escape them.
  fabLift: {
    borderRadius: FAB_SIZE / 2,
    ...SHADOW.brandFloating,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
