/**
 * OptionCard — a tappable capture/action row with a gradient icon tile.
 * Reusable across Add, settings, etc. NativeWind + Reanimated.
 */
import React from 'react';
import { Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

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
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 70).springify().damping(16)}>
      <Animated.View style={aStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            scale.value = withSpring(0.97, { damping: 18 });
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 14 });
          }}
          className="mb-3 flex-row items-center rounded-[24px] bg-white/85 p-3.5"
          style={{
            shadowColor: colors[0],
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.18,
            shadowRadius: 14,
          }}
        >
          <LinearGradient
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 52,
              height: 52,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={26} color="#ffffff" />
          </LinearGradient>
          <View className="ml-3.5 flex-1">
            <Text className="text-[16px] font-bold text-ink-900">{title}</Text>
            <Text className="mt-0.5 text-[13px] text-ink-400">{subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
