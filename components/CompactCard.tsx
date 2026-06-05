/**
 * CompactCard — premium grid-view card for the Stacks screen.
 * Square visual (image or gradient tile) + classification pill + title.
 * Preserves the swipe-left/right gesture. NativeWind + Reanimated.
 */
import React, { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Item } from '@/lib/types';
import { classConfig } from '@/lib/classification';

const SWIPE_THRESHOLD = 60;

interface CompactCardProps {
  item: Item;
  onPress: (itemId: string) => void;
  onSwipeLeft?: (itemId: string) => void;
  onSwipeRight?: (itemId: string) => void;
}

function CompactCard({
  item,
  onPress,
  onSwipeLeft,
  onSwipeRight,
}: CompactCardProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const cfg = classConfig(item.classification);
  const isDone =
    item.status === 'done' || item.bucketlist_completed === true || item.viewed === true;
  // Fall back to the gradient-icon tile if the thumbnail fails to load.
  const [imageFailed, setImageFailed] = useState(false);

  const panGesture = Gesture.Pan()
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
      translateX.value = withSpring(0, { damping: 20, stiffness: 90 });
      opacity.value = withSpring(1);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[animatedStyle, { flex: 1 }]}>
          <Pressable
            onPress={() => onPress(item.id)}
            onPressIn={() => {
              scale.value = withSpring(0.97, { damping: 18 });
            }}
            onPressOut={() => {
              scale.value = withSpring(1, { damping: 14 });
            }}
            className="m-1.5 flex-1 overflow-hidden rounded-[22px] bg-white"
            style={{
              shadowColor: cfg.from,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.16,
              shadowRadius: 14,
            }}
          >
            <View className="aspect-square w-full overflow-hidden">
              {item.imageUri && !imageFailed ? (
                <Image
                  source={{ uri: item.imageUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
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
              {isDone && (
                <View className="absolute right-2 top-2 rounded-full bg-white/90 p-0.5">
                  <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                </View>
              )}
            </View>

            <View className="p-2.5">
              <View
                className="self-start rounded-full px-2 py-0.5"
                style={{ backgroundColor: cfg.from + '1A' }}
              >
                <Text className="text-[10px] font-bold" style={{ color: cfg.from }}>
                  {cfg.label}
                </Text>
              </View>
              <Text
                numberOfLines={2}
                className="mt-1.5 text-[13px] font-bold leading-[17px] text-ink-900"
              >
                {item.title}
              </Text>
            </View>
          </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

// Memoized: this is a FlatList row in the Stacks grid feed.
export default React.memo(CompactCard);
