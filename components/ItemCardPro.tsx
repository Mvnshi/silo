/**
 * ItemCardPro — design proof-of-concept (NativeWind + Reanimated).
 *
 * Drop-in replacement for ItemCard in the Stacks list feed: same props.
 * Shows the target aesthetic — gradient icon tiles, soft brand-tinted shadows,
 * a category pill, clean type scale, staggered entrance + press-spring.
 */
import React from 'react';
import { Text, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Item } from '@/lib/types';
import { classConfig } from '@/lib/classification';

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d`;
  const w = d / 7;
  if (w < 5) return `${Math.floor(w)}w`;
  return `${Math.floor(d / 30)}mo`;
}

interface Props {
  item: Item;
  index?: number;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
  onSwipeLeft?: (id: string) => void;
  onSwipeRight?: (id: string) => void;
  selectMode?: boolean;
  selected?: boolean;
}

export default function ItemCardPro({
  item,
  index = 0,
  onPress,
  onLongPress,
  selectMode = false,
  selected = false,
}: Props) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const cfg = classConfig(item.classification);
  const isDone =
    item.status === 'done' || item.bucketlist_completed === true || item.viewed === true;
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [];

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 10) * 55)
        .springify()
        .damping(18)}
    >
      <Animated.View style={aStyle}>
        <Pressable
        onPress={() => onPress(item.id)}
        onLongPress={() => onLongPress?.(item.id)}
        onPressIn={() => {
          scale.value = withSpring(0.975, { damping: 18 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 14 });
        }}
        className="mb-3 flex-row items-center rounded-[26px] bg-white p-2.5"
        style={{
          shadowColor: cfg.from,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.16,
          shadowRadius: 16,
        }}
      >
        {/* Thumbnail or gradient icon tile */}
        <View className="h-[68px] w-[68px] overflow-hidden rounded-[20px]">
          {item.imageUri ? (
            <Image
              source={{ uri: item.imageUri }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <LinearGradient
              colors={[cfg.from, cfg.to]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name={cfg.icon} size={27} color="#ffffff" />
            </LinearGradient>
          )}
        </View>

        {/* Content */}
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <View
              className="rounded-full px-2.5 py-1"
              style={{ backgroundColor: cfg.from + '1A' }}
            >
              <Text className="text-[11px] font-semibold" style={{ color: cfg.from }}>
                {cfg.label}
              </Text>
            </View>
            {isDone && (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color="#22c55e"
                style={{ marginLeft: 6 }}
              />
            )}
            <Text className="ml-auto text-[11px] font-medium text-ink-400">
              {timeAgo(item.created_at)}
            </Text>
          </View>

          <Text
            numberOfLines={2}
            className="mt-1.5 text-[15px] font-bold leading-[19px] text-ink-900"
          >
            {item.title}
          </Text>

          {!!item.description && (
            <Text numberOfLines={1} className="mt-0.5 text-[13px] leading-[16px] text-ink-400">
              {item.description}
            </Text>
          )}

          {(tags.length > 0 || !!item.duration) && (
            <View className="mt-2 flex-row items-center">
              {tags.map((t, i) => (
                <View key={i} className="mr-1.5 rounded-full bg-ink-100 px-2 py-0.5">
                  <Text className="text-[11px] font-medium text-ink-500">#{t}</Text>
                </View>
              ))}
              {!!item.duration && (
                <View className="ml-auto flex-row items-center">
                  <Ionicons name="time-outline" size={13} color="#94a3b8" />
                  <Text className="ml-1 text-[11px] font-medium text-ink-400">
                    {item.duration}m
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {selectMode ? (
          <View
            style={{
              marginLeft: 6,
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: selected ? '#8b5cf6' : '#cbd5e1',
              backgroundColor: selected ? '#8b5cf6' : 'transparent',
            }}
          >
            {selected && <Ionicons name="checkmark" size={15} color="#ffffff" />}
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={16} color="#cbd5e1" style={{ marginLeft: 4 }} />
        )}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
