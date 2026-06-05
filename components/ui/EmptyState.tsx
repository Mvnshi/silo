/**
 * EmptyState — a friendly, animated empty/zero-data state.
 * Reused across feeds, search, calendar, etc. NativeWind + Reanimated.
 */
import React from 'react';
import { Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  colors?: readonly [string, string];
  /** Use light text on a dark background (e.g. the Streams feed). */
  dark?: boolean;
  cta?: { label: string; onPress: () => void };
}

export default function EmptyState({
  icon,
  title,
  subtitle,
  colors = ['#8b5cf6', '#6366f1'],
  dark = false,
  cta,
}: EmptyStateProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(350)}
      className="flex-1 items-center justify-center px-10 py-16"
    >
      <Animated.View entering={FadeInDown.springify().damping(15)}>
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 92,
            height: 92,
            borderRadius: 30,
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
        className={`mt-7 text-center text-[21px] font-bold ${dark ? 'text-white' : 'text-ink-900'}`}
      >
        {title}
      </Text>
      {!!subtitle && (
        <Text
          className={`mt-2 text-center text-[14px] leading-[20px] ${
            dark ? 'text-white/70' : 'text-ink-400'
          }`}
        >
          {subtitle}
        </Text>
      )}

      {cta && (
        <Pressable onPress={cta.onPress} className="mt-7 overflow-hidden rounded-full">
          <LinearGradient
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ paddingHorizontal: 26, paddingVertical: 13 }}
          >
            <Text className="text-[15px] font-bold text-white">{cta.label}</Text>
          </LinearGradient>
        </Pressable>
      )}
    </Animated.View>
  );
}
