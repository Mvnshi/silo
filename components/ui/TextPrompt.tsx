/**
 * TextPromptHost — the UI behind `promptForText()` (see lib/prompt.ts).
 *
 * Mount once at the root. It replaces `Alert.prompt`, which is iOS-only and
 * therefore silently did nothing on Android at every call site that used it.
 *
 * The dialog follows the app appearance; only the confirm button is fixed,
 * because it is a brand surface rather than a page one.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Glass, { LIQUID_GLASS } from './Glass';
import PressableScale from './PressableScale';
import { registerTextPrompt, TextPromptOptions } from '@/lib/prompt';
import { BRAND, DURATION, RADIUS, SHADOW, SPACE, TYPE } from '@/lib/theme';
import type { ThemeColors } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { enterHero, usePrefersReducedMotion } from '@/lib/motion';

/**
 * Every colour in the dialog, built once per palette change. Plain object, not
 * StyleSheet.create — that would allocate a new sheet on every render.
 */
function makeDynamicStyles(c: ThemeColors) {
  return {
    scrim: { backgroundColor: c.scrim },
    // The card has no fill of its own any more — it is glass, and `Glass` draws
    // the rim that used to be the dark-only hairline. What it still needs is a
    // whisper of colour: glass borrows from whatever is behind it, and on light
    // that is a pale violet page, where body text on bare material drifts under
    // AA. `2e` ≈ 18% of the palette's own card colour — enough to hold text, far
    // too little to read as a fill. (Both palettes state `card` as a 6-digit
    // hex, so an alpha suffix is all this needs.)
    cardTint: `${c.card}2e`,
    title: { color: c.text },
    message: { color: c.textSecondary },
    input: { color: c.text, backgroundColor: c.field, borderColor: c.hairline },
    cancelBtn: { backgroundColor: c.field },
    cancelText: { color: c.textSecondary },
  };
}

export default function TextPromptHost() {
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);
  const [options, setOptions] = useState<TextPromptOptions | null>(null);
  const [value, setValue] = useState('');
  const resolverRef = useRef<((v: string | null) => void) | null>(null);

  const open = useCallback((opts: TextPromptOptions) => {
    setOptions(opts);
    setValue(opts.defaultValue ?? '');
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    registerTextPrompt(open);
    return () => registerTextPrompt(null);
  }, [open]);

  const finish = useCallback((result: string | null) => {
    Keyboard.dismiss();
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
    setValue('');
  }, []);

  if (!options) return null;

  // Reduce Motion collapses `enterHero` to a cross-fade — and a fade above a
  // glass surface makes the material stop rendering rather than fade it in. So
  // under the real effect the card arrives without an entrance of its own; the
  // scrim behind it still cross-fades, so it is not a hard cut.
  const cardEnter = LIQUID_GLASS && reduced ? undefined : enterHero(0, reduced);

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => finish(null)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.root}>
          {/* The scrim fades as a SIBLING of the card, never as its parent: any
              opacity animation above a glass surface deletes it instead of
              fading it. Tapping it cancels — a dialog whose only exit is a small
              button reads as a trap. */}
          <Animated.View
            entering={FadeIn.duration(DURATION.fast)}
            exiting={FadeOut.duration(DURATION.instant)}
            style={[StyleSheet.absoluteFill, dyn.scrim]}
          >
            <PressableScale
              haptic="none"
              scaleTo={1}
              containerStyle={StyleSheet.absoluteFill}
              onPress={() => finish(null)}
              accessibilityLabel="Cancel"
            >
              <View style={StyleSheet.absoluteFill} />
            </PressableScale>
          </Animated.View>

          {/* Glass can't cast a shadow from inside its own clipped bounds, so the
              lift lives on this wrapper — which is also the only thing that
              animates (transform only). */}
          <Animated.View entering={cardEnter} style={styles.cardLift}>
            <Glass
              variant="regular"
              radius={RADIUS.xl}
              tintColor={dyn.cardTint}
              style={styles.card}
            >
              <Text style={[styles.title, dyn.title]} accessibilityRole="header">
                {options.title}
              </Text>
              {!!options.message && (
                <Text style={[styles.message, dyn.message]}>{options.message}</Text>
              )}

              <TextInput
                style={[styles.input, dyn.input]}
                value={value}
                onChangeText={setValue}
                placeholder={options.placeholder}
                placeholderTextColor={c.textPlaceholder}
                maxLength={options.maxLength ?? 60}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={() => finish(value)}
                accessibilityLabel={options.title}
              />

              <View style={styles.actions}>
                <PressableScale
                  haptic="light"
                  scaleTo={0.96}
                  containerStyle={styles.actionSlot}
                  style={[styles.cancelBtn, dyn.cancelBtn]}
                  onPress={() => finish(null)}
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.cancelText, dyn.cancelText]}>Cancel</Text>
                </PressableScale>
                <PressableScale
                  haptic="medium"
                  scaleTo={0.96}
                  containerStyle={styles.actionSlot}
                  style={[styles.confirmBtn, !value.trim() && styles.confirmDisabled]}
                  disabled={!value.trim()}
                  onPress={() => finish(value)}
                  accessibilityLabel={options.confirmLabel ?? 'Save'}
                >
                  <Text style={styles.confirmText}>{options.confirmLabel ?? 'Save'}</Text>
                </PressableScale>
              </View>
            </Glass>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Appearance-independent only — colours live in `makeDynamicStyles`. */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xl,
  },
  // Width + lift sit on the wrapper; the glass fills it and rounds itself.
  cardLift: {
    width: '100%',
    maxWidth: 380,
    ...SHADOW.floating,
  },
  card: {
    padding: SPACE.xl,
  },
  title: {
    ...TYPE.title3,
  },
  message: {
    ...TYPE.subhead,
    fontWeight: '400',
    marginTop: SPACE.xs,
  },
  input: {
    ...TYPE.body,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    marginTop: SPACE.base,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACE.md,
    marginTop: SPACE.lg,
  },
  actionSlot: {
    flex: 1,
  },
  cancelBtn: {
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  cancelText: {
    ...TYPE.bodyStrong,
  },
  // Confirm is a brand surface: violet fill + white label in both appearances.
  confirmBtn: {
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
    alignItems: 'center',
  },
  confirmDisabled: {
    opacity: 0.45,
  },
  confirmText: {
    ...TYPE.bodyStrong,
    color: '#fff',
  },
});
