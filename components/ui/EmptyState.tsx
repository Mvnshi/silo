/**
 * EmptyState — the app's single zero-data / error / no-results surface.
 *
 * Every list, feed and pane should route its empty AND failure states through
 * this component so "nothing here" always looks and sounds the same. The copy
 * is the caller's job: an empty library, an empty search, and a failed load are
 * three different messages and must never share one string.
 */
import React from 'react';
import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import PressableScale from './PressableScale';
import { DURATION, GRADIENTS, RADIUS, SPRING } from '@/lib/theme';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  colors?: readonly [string, string];
  /** Use light text on a dark background (e.g. the Streams feed). */
  dark?: boolean;
  cta?: { label: string; onPress: () => void };
  /** Secondary, lower-emphasis action rendered as plain text under the CTA. */
  secondary?: { label: string; onPress: () => void };
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  colors = GRADIENTS.brand,
  dark = false,
  cta,
  secondary,
}: EmptyStateProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(DURATION.slow)}
      className="flex-1 items-center justify-center px-10 py-16"
    >
      <Animated.View entering={FadeInDown.springify().damping(SPRING.enter.damping)}>
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 92,
            height: 92,
            borderRadius: RADIUS.xxl,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: colors[0],
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.32,
            shadowRadius: 22,
          }}
        >
          <Ionicons name={icon} size={42} color="#ffffff" />
        </LinearGradient>
      </Animated.View>

      <Text
        accessibilityRole="header"
        className={`mt-7 text-center text-title3 font-bold ${dark ? 'text-white' : 'text-ink-900'}`}
      >
        {title}
      </Text>
      {!!subtitle && (
        <Text
          className={`mt-2 text-center text-subhead font-normal ${
            dark ? 'text-white/70' : 'text-ink-500'
          }`}
        >
          {subtitle}
        </Text>
      )}

      {cta && (
        <PressableScale
          haptic="light"
          onPress={cta.onPress}
          accessibilityLabel={cta.label}
          className="mt-7 overflow-hidden rounded-pill"
        >
          <LinearGradient
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ paddingHorizontal: 26, paddingVertical: 13 }}
          >
            <Text className="text-callout font-bold text-white">{cta.label}</Text>
          </LinearGradient>
        </PressableScale>
      )}

      {secondary && (
        <PressableScale
          haptic="light"
          scaleTo={0.94}
          onPress={secondary.onPress}
          accessibilityLabel={secondary.label}
          className="mt-4"
        >
          <Text
            className={`text-subhead font-bold ${dark ? 'text-white/80' : 'text-brand-600'}`}
          >
            {secondary.label}
          </Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}
