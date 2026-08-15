/**
 * OptionCard — a tappable capture/action row with a gradient icon tile.
 * Reusable across Add, settings, etc. NativeWind + Reanimated.
 *
 * Press feel comes from PressableScale so these match every other touchable in
 * the app (the local spring this used to hand-roll omitted `stiffness`, which
 * made the capture-home cards visibly lag the rest of the UI).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import PressableScale from './PressableScale';
import { RADIUS, SPRING } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

interface OptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  colors: readonly [string, string];
  title: string;
  subtitle: string;
  onPress: () => void;
  index?: number;
}

export default function OptionCard({
  icon,
  colors,
  title,
  subtitle,
  onPress,
  index = 0,
}: OptionCardProps) {
  const c = useThemeColors();
  const isDark = c.appearance === 'dark';

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 70)
        .springify()
        .damping(SPRING.enter.damping)}
    >
      <PressableScale
        haptic="light"
        onPress={onPress}
        accessibilityLabel={`${title}. ${subtitle}`}
        className="mb-3 flex-row items-center rounded-xl p-3.5"
        style={[
          {
            backgroundColor: c.card,
            shadowColor: colors[0],
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.18,
            shadowRadius: 14,
          },
          // The tinted glow is what lifts this row off the page on light; on the
          // dark page it disappears entirely, so a hairline does the separating.
          isDark && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline },
        ]}
      >
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 52,
            height: 52,
            borderRadius: RADIUS.md,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={26} color="#ffffff" />
        </LinearGradient>
        <View className="ml-3.5 flex-1">
          <Text className="text-body font-bold" style={{ color: c.text }}>
            {title}
          </Text>
          <Text className="mt-0.5 text-footnote" style={{ color: c.textTertiary }}>
            {subtitle}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.decorative} />
      </PressableScale>
    </Animated.View>
  );
}
