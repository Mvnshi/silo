/**
 * CompactCard — the saved-item tile in the Stacks grid view.
 *
 * Square visual (thumbnail or gradient tile) + classification pill + title,
 * with the same press spring, swipe gestures and select-mode affordance as the
 * list row, so switching views never changes what the app feels like.
 *
 * The entrance is a diagonal wipe (row-major with a per-column offset) because
 * a 2-up grid with a purely linear stagger reads as a stutter down the left
 * column rather than a sweep across the page.
 */
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Item } from '@/lib/types';
import { classConfig } from '@/lib/classification';
import { BRAND, DURATION, RADIUS, SPRING, STATUS } from '@/lib/theme';
import Glass from '@/components/ui/Glass';
import { useThemeColors } from '@/lib/useTheme';
import { usePrefersReducedMotion } from '@/lib/motion';

const SWIPE_THRESHOLD = 60;

interface CompactCardProps {
  item: Item;
  index?: number;
  onPress: (itemId: string) => void;
  onSwipeLeft?: (itemId: string) => void;
  onSwipeRight?: (itemId: string) => void;
  selectMode?: boolean;
  selected?: boolean;
}

function CompactCard({
  item,
  index = 0,
  onPress,
  onSwipeLeft,
  onSwipeRight,
  selectMode = false,
  selected = false,
}: CompactCardProps) {
  const reduced = usePrefersReducedMotion();
  const c = useThemeColors();
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const cfg = classConfig(item.classification);
  const isDone =
    item.status === 'done' || item.bucketlist_completed === true || item.viewed === true;
  const isPicked = selectMode && selected;
  // Fall back to the gradient-icon tile if the thumbnail fails to load.
  const [imageFailed, setImageFailed] = useState(false);
  const isFirstPaint = useRef(index < 12).current;

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

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
    // In select mode, unpicked tiles recede so the picked set reads at a glance.
    opacity:
      selectMode && !selected
        ? withTiming(0.55, { duration: DURATION.fast })
        : opacity.value,
  }));

  // Diagonal 2-up wipe, capped so a long grid doesn't crawl.
  const enterDelay = Math.min(Math.floor(index / 2), 6) * 60 + (index % 2) * 30;

  return (
    <Animated.View
      // maxWidth is required: with numColumns={2} and flex:1, an odd item count
      // leaves the last row with one child that stretches to full width.
      style={{ flex: 1, maxWidth: '50%' }}
      entering={
        isFirstPaint
          ? FadeInDown.delay(reduced ? 0 : enterDelay)
              .duration(DURATION.base)
              .springify()
              .damping(SPRING.enter.damping)
          : undefined
      }
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[animatedStyle, { flex: 1 }]}>
          <Pressable
            accessible
            accessibilityRole={selectMode ? 'checkbox' : 'button'}
            accessibilityLabel={[cfg.label, item.title].filter(Boolean).join('. ')}
            accessibilityState={selectMode ? { checked: selected } : undefined}
            onPress={() => onPress(item.id)}
            onPressIn={() => {
              scale.value = withSpring(0.97, SPRING.press);
              Haptics.selectionAsync().catch(() => {});
            }}
            onPressOut={() => {
              scale.value = withSpring(1, SPRING.settle);
            }}
            className="m-1.5 flex-1"
            style={{
              // Glass clips its own bounds, so the lift lives out here.
              shadowColor: cfg.from,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.16,
              shadowRadius: 14,
            }}
          >
            <Glass
              variant="regular"
              radius={RADIUS.xl}
              // A wash of the card colour, so the thumbnail below still reads as
              // the tile's own image rather than the page showing through it.
              tintColor={`${c.card}c0`}
              // Selection draws a 2px brand ring instead of the default rim.
              bordered={!isPicked}
              style={[
                styles.tile,
                isPicked ? { borderWidth: 2, borderColor: BRAND[500] } : null,
              ]}
            >
            <View className="aspect-square w-full overflow-hidden">
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
                  <Ionicons name={cfg.icon} size={40} color="#ffffff" />
                </LinearGradient>
              )}

              {/* Sits on the thumbnail, so the unpicked ring stays white in both
                  appearances — `decorative` would disappear into a dark photo. */}
              {selectMode ? (
                <View
                  className="absolute left-2 top-2"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: RADIUS.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: selected ? BRAND[500] : '#ffffff',
                    backgroundColor: selected ? BRAND[500] : 'rgba(15,23,42,0.28)',
                  }}
                >
                  {selected && <Ionicons name="checkmark" size={15} color="#ffffff" />}
                </View>
              ) : null}

              {/* Stays a white chip in both appearances: it floats over the
                  thumbnail, not the page, and white guarantees separation from
                  whatever image happens to be underneath. */}
              {isDone && (
                <View className="absolute right-2 top-2 rounded-pill bg-white/90 p-0.5">
                  <Ionicons name="checkmark-circle" size={20} color={STATUS.success} />
                </View>
              )}
            </View>

            <View className="p-2.5">
              <View
                className="self-start rounded-pill px-2 py-0.5"
                style={{ backgroundColor: cfg.from + '1A' }}
              >
                {/* `deep`, not `from`: same-hue-on-its-own-tint is ~2:1. */}
                <Text className="text-overline" style={{ color: cfg.deep }}>
                  {cfg.label}
                </Text>
              </View>
              <Text
                numberOfLines={2}
                className="mt-1.5 text-footnote font-bold leading-[17px]"
                style={{ color: c.text }}
              >
                {item.title}
              </Text>
            </View>
            </Glass>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Colour comes from the Glass tint; this is shape + clipping only.
  tile: {
    flex: 1,
    overflow: 'hidden',
  },
});

// Memoized: this is a FlatList row in the Stacks grid feed.
export default React.memo(CompactCard);
