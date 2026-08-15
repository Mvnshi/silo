/**
 * ScreenHeader — the one header treatment for every pushed screen.
 *
 * The root Stack runs with `headerShown: false` so screens control their own
 * chrome; without a shared component that turned into three different back
 * glyphs, alignments and backgrounds across settings / item / stack detail.
 * Use this instead of hand-rolling a bar.
 *
 * The title is optically centred (the left and right slots are equal-width),
 * so it stays centred whether or not a right-hand action is present.
 */
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from './PressableScale';
import { HIT_SLOP, MIN_TAP, SPACE, TYPE } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

interface Props {
  title?: string;
  /** Small line above the title (e.g. the item's classification). */
  eyebrow?: string;
  /** Rendered on the right; sized to match the back button so the title stays centred. */
  right?: React.ReactNode;
  /** Where to go if there is nothing to pop back to. */
  fallbackHref?: string;
  /** Hide the back affordance (root-of-modal screens). */
  hideBack?: boolean;
  /** Transparent bar for hero screens that scroll content underneath. */
  transparent?: boolean;
  style?: ViewStyle;
}

const SLOT_WIDTH = MIN_TAP;

export default function ScreenHeader({
  title,
  eyebrow,
  right,
  fallbackHref = '/(tabs)',
  hideBack = false,
  transparent = false,
  style,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useThemeColors();

  function handleBack() {
    // canGoBack is the common case; `replace` is only for a cold deep-link,
    // where there is genuinely no stack entry to pop.
    if (router.canGoBack()) router.back();
    else router.replace(fallbackHref as never);
  }

  return (
    <View
      style={[
        styles.bar,
        { paddingTop: insets.top + SPACE.md },
        transparent
          ? styles.transparent
          : [styles.solid, { backgroundColor: c.card, borderBottomColor: c.hairline }],
        style,
      ]}
    >
      <View style={styles.slot}>
        {!hideBack && (
          <PressableScale
            haptic="light"
            scaleTo={0.9}
            hitSlop={HIT_SLOP}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </PressableScale>
        )}
      </View>

      <View style={styles.titleWrap} pointerEvents="none">
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: c.textTertiary }]}>{eyebrow.toUpperCase()}</Text>
        ) : null}
        {title ? (
          <Text
            style={[styles.title, { color: c.text }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </Text>
        ) : null}
      </View>

      <View style={[styles.slot, styles.slotRight]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACE.base,
    paddingBottom: SPACE.md,
  },
  // Colours (background + border) are applied at the call site from the palette.
  solid: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
  slot: {
    width: SLOT_WIDTH,
    justifyContent: 'center',
  },
  slotRight: {
    alignItems: 'flex-end',
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  eyebrow: {
    ...TYPE.overline,
    marginBottom: 2,
  },
  title: {
    ...TYPE.headline,
  },
});
