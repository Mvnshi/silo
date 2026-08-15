/**
 * ItemCardPro — the saved-item row in the Stacks list feed.
 *
 * Gradient icon tile (or thumbnail), classification pill, title, description,
 * tags — with a staggered entrance, the shared press spring, and swipe-to-done.
 *
 * Two subtleties worth keeping:
 * - The entrance only plays on FIRST paint. FlatList remounts rows as they
 *   scroll into the window, so an unconditional `entering` makes every row past
 *   the tenth fade in *behind* a fast flick.
 * - The pan gesture and long-press are disabled in select mode; otherwise a
 *   slightly-horizontal drag while multi-selecting marks an item done and
 *   reloads the list under the user's finger.
 */
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Item } from '@/lib/types';
import { classConfig } from '@/lib/classification';
import { BRAND, RADIUS, SPRING } from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { enterList, usePrefersReducedMotion } from '@/lib/motion';

const SWIPE_THRESHOLD = 60;

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

function ItemCardPro({
  item,
  index = 0,
  onPress,
  onLongPress,
  onSwipeLeft,
  onSwipeRight,
  selectMode = false,
  selected = false,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));
  const cfg = classConfig(item.classification);
  const isDone =
    item.status === 'done' || item.bucketlist_completed === true || item.viewed === true;
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [];
  // Fall back to the gradient-icon tile if the thumbnail fails to load.
  const [imageFailed, setImageFailed] = useState(false);
  // Only rows painted in the initial window animate in; recycled rows appear
  // instantly so a fast scroll never outruns the entrance.
  const isFirstPaint = useRef(index < 10).current;

  // Swipe left / right past a threshold, then spring back (mirrors CompactCard).
  const panGesture = Gesture.Pan()
    .enabled(!selectMode)
    .activeOffsetX([-5, 5])
    .failOffsetY([-30, 30])
    .onStart(() => {
      translateX.value = 0;
      opacity.value = 1;
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
      opacity.value = Math.max(0.7, 1 - Math.abs(event.translationX) / SWIPE_THRESHOLD);
    })
    .onEnd((event) => {
      if (event.translationX < -SWIPE_THRESHOLD && onSwipeLeft) {
        runOnJS(onSwipeLeft)(item.id);
      } else if (event.translationX > SWIPE_THRESHOLD && onSwipeRight) {
        runOnJS(onSwipeRight)(item.id);
      }
      translateX.value = withSpring(0, SPRING.settle);
      opacity.value = withSpring(1, SPRING.settle);
    });

  // One node for VoiceOver: pill, title and description read as a single card
  // rather than four unrelated fragments.
  const a11yLabel = [cfg.label, item.title, item.description].filter(Boolean).join('. ');

  return (
    <Animated.View entering={isFirstPaint ? enterList(index, reduced) : undefined}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={aStyle}>
          <Pressable
            accessible
            accessibilityRole={selectMode ? 'checkbox' : 'button'}
            accessibilityLabel={a11yLabel}
            accessibilityHint={selectMode ? undefined : 'Opens this save'}
            accessibilityState={selectMode ? { checked: selected } : undefined}
            onPress={() => onPress(item.id)}
            onLongPress={() => {
              if (selectMode) return;
              onLongPress?.(item.id);
            }}
            onPressIn={() => {
              scale.value = withSpring(0.975, SPRING.press);
              Haptics.selectionAsync().catch(() => {});
            }}
            onPressOut={() => {
              scale.value = withSpring(1, SPRING.settle);
            }}
            className="mb-3 flex-row items-center rounded-xl p-2.5"
            style={{
              backgroundColor: c.card,
              shadowColor: cfg.from,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.16,
              shadowRadius: 16,
              // The classification-tinted shadow is what lifts this card off the
              // page — on a near-black ground it reads as nothing, so the card
              // holds its own edge with a hairline instead.
              ...(c.appearance === 'dark'
                ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }
                : null),
            }}
          >
              {/* Thumbnail or gradient icon tile */}
              <View className="h-[68px] w-[68px] overflow-hidden rounded-lg">
                {item.imageUri && !imageFailed ? (
                  <Image
                    source={{ uri: item.imageUri }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={180}
                    onError={() => setImageFailed(true)}
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
                    className="rounded-pill px-2.5 py-1"
                    style={{ backgroundColor: cfg.from + '1A' }}
                  >
                    {/* `deep`, not `from`: same-hue-on-its-own-tint is ~2:1. */}
                    <Text className="text-caption font-semibold" style={{ color: cfg.deep }}>
                      {cfg.label}
                    </Text>
                  </View>
                  {isDone && (
                    <Ionicons
                      name="checkmark-circle"
                      size={15}
                      color={c.success}
                      style={{ marginLeft: 6 }}
                    />
                  )}
                  <Text
                    className="ml-auto text-caption font-medium"
                    style={{ color: c.textTertiary }}
                  >
                    {timeAgo(item.created_at)}
                  </Text>
                </View>

                <Text
                  numberOfLines={2}
                  className="mt-1.5 text-callout font-bold leading-[19px]"
                  style={{ color: c.text }}
                >
                  {item.title}
                </Text>

                {!!item.description && (
                  <Text
                    numberOfLines={1}
                    className="mt-0.5 text-footnote"
                    style={{ color: c.textTertiary }}
                  >
                    {item.description}
                  </Text>
                )}

                {(tags.length > 0 || !!item.duration) && (
                  <View className="mt-2 flex-row items-center">
                    {tags.map((t) => (
                      <View
                        key={t}
                        className="mr-1.5 rounded-pill px-2 py-0.5"
                        style={{ backgroundColor: c.field }}
                      >
                        <Text
                          className="text-caption font-medium"
                          style={{ color: c.textSecondary }}
                        >
                          #{t}
                        </Text>
                      </View>
                    ))}
                    {!!item.duration && (
                      <View className="ml-auto flex-row items-center">
                        <Ionicons name="time-outline" size={13} color={c.decorative} />
                        <Text
                          className="ml-1 text-caption font-medium"
                          style={{ color: c.textTertiary }}
                        >
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
                    borderRadius: RADIUS.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    // BRAND[500] when picked in both appearances — it is a brand
                    // surface, and white-on-violet has to stay readable.
                    borderColor: selected ? BRAND[500] : c.decorative,
                    backgroundColor: selected ? BRAND[500] : 'transparent',
                  }}
                >
                  {selected && <Ionicons name="checkmark" size={15} color="#ffffff" />}
                </View>
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={c.decorative}
                  style={{ marginLeft: 4 }}
                />
              )}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// Memoized: this is a FlatList row in the Stacks list feed.
export default React.memo(ItemCardPro);
