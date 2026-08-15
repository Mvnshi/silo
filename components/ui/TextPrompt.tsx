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
    // SHADOW.floating carries the lift on light. On the dark page a shadow is
    // invisible, so the card leans on a hairline to read as a raised sheet.
    card:
      c.appearance === 'dark'
        ? {
            backgroundColor: c.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.hairline,
          }
        : { backgroundColor: c.card },
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

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => finish(null)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View
          entering={FadeIn.duration(DURATION.fast)}
          exiting={FadeOut.duration(DURATION.instant)}
          style={[styles.scrim, dyn.scrim]}
        >
          {/* Tapping the scrim cancels — a dialog whose only exit is a small
              button reads as a trap. */}
          <PressableScale
            haptic="none"
            scaleTo={1}
            containerStyle={StyleSheet.absoluteFill}
            onPress={() => finish(null)}
            accessibilityLabel="Cancel"
          >
            <View style={StyleSheet.absoluteFill} />
          </PressableScale>

          <Animated.View entering={enterHero(0, reduced)} style={[styles.card, dyn.card]}>
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
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Appearance-independent only — colours live in `makeDynamicStyles`. */
const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: RADIUS.xl,
    padding: SPACE.xl,
    ...SHADOW.floating,
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
