/**
 * SiloMascot — the assistant's face.
 *
 * Every part is a rounded `View`. No SVG, no image, no Lottie, no new
 * dependency: the shapes are boxes with border radii, and the life comes from
 * Reanimated transforms. That means it scales to any size without assets and
 * every piece animates independently — an eye can blink without the body
 * moving.
 *
 * TWO TRANSFORM LAYERS, and they have to stay separate:
 *
 *   Tilt   carries the MOOD — the lean, the cower, the cocked head.
 *   Body   carries the MOTION — breathing, and the one-shot reactions.
 *
 * They cannot be the same view. Breathing runs forever and writes `transform`,
 * and a running animation beats a static transform on the same node, so a mood
 * lean declared alongside it is silently swallowed. Two nodes, two jobs.
 *
 * WHAT MAKES IT READ AS ALIVE (all four matter, none is decoration):
 *  - Squash and stretch. Nothing holds its volume — it crouches before a hop,
 *    stretches thin at the peak, and pancakes on landing.
 *  - Follow-through. The lower slabs lag behind the head and overshoot coming
 *    back, so the stack has weight and isn't one welded lump.
 *  - Brows. Invisible at rest. Inner ends UP is an apology, inner ends DOWN is
 *    a threat — getting that backwards is how a mascot ends up looking furious
 *    about your error message.
 *  - Offset timers. The two eyes never blink in perfect sync. Perfect sync is
 *    what makes a thing look like a machine.
 *
 * Sizes below ~22pt turn the face to mush — use an Ionicon there instead.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { BRAND, INK } from '@/lib/theme';

export type MascotMood = 'idle' | 'curious' | 'pleased' | 'waiting' | 'sorry' | 'alert';
export type MascotReaction = 'hop' | 'poke' | 'shake';

/**
 * The drawing, in design units. Everything scales off `W`, so `size` is the
 * mascot's width in points and every other number follows from it.
 */
const W = 132;
const D = {
  head: { w: 132, h: 60, rTop: 32, rBot: 15 },
  mid: { w: 126, h: 20, r: 11, gap: 2 },
  base: { w: 130, h: 22, rTop: 11, rBot: 20, gap: 2 },
  eye: { w: 16, h: 32, r: 8, top: 19, inset: 31 },
  gleam: { d: 6, top: 25, inset: 37 },
  brow: { w: 22, h: 6, r: 4, top: 9, inset: 28 },
};
const H = D.head.h + D.mid.gap + D.mid.h + D.base.gap + D.base.h;

interface MoodSpec {
  tilt: { rot: number; sx: number; sy: number };
  eye: { h: number; w: number; top: number; insetL: number; insetR: number; rTop: number; rBot: number };
  gleam: { op: number; top: number; insetL: number; insetR: number };
  brow: { op: number; top: number; rotL: number; rotR: number; tyL: number; tyR: number };
  /** Pleased holds its squeezed arcs — blinking on top of them reads as a glitch. */
  blinks: boolean;
}

const BASE_EYE = { h: D.eye.h, w: D.eye.w, top: D.eye.top, insetL: D.eye.inset, insetR: D.eye.inset, rTop: D.eye.r, rBot: D.eye.r };
const BASE_GLEAM = { op: 1, top: D.gleam.top, insetL: D.gleam.inset, insetR: D.gleam.inset };
const BASE_BROW = { op: 0, top: D.brow.top, rotL: 0, rotR: 0, tyL: 0, tyR: 0 };

const MOODS: Record<MascotMood, MoodSpec> = {
  idle: {
    tilt: { rot: 0, sx: 1, sy: 1 },
    eye: BASE_EYE,
    gleam: BASE_GLEAM,
    brow: BASE_BROW,
    blinks: true,
  },
  // Head cocks, gaze goes up and off to one side — working on it.
  curious: {
    tilt: { rot: -7, sx: 1, sy: 1 },
    eye: { ...BASE_EYE, h: 28, top: 13, insetL: 38, insetR: 24 },
    gleam: { op: 1, top: 18, insetL: 44, insetR: 30 },
    brow: { op: 1, top: D.brow.top, rotL: -11, rotR: -4, tyL: -4, tyR: 2 },
    blinks: true,
  },
  // Eyes squeeze into arcs. A nod, not a party.
  pleased: {
    tilt: { rot: 0, sx: 1, sy: 1 },
    eye: { ...BASE_EYE, h: 13, top: 24, rTop: 13, rBot: 4 },
    gleam: { ...BASE_GLEAM, op: 0 },
    brow: { op: 1, top: 6, rotL: -9, rotR: 9, tyL: 0, tyR: 0 },
    blinks: false,
  },
  // Lids low, brows sagging, sunk a little.
  waiting: {
    tilt: { rot: 0, sx: 1.02, sy: 0.97 },
    eye: { ...BASE_EYE, h: 19, top: 26 },
    gleam: BASE_GLEAM,
    brow: { op: 1, top: 14, rotL: -7, rotR: 7, tyL: 0, tyR: 0 },
    blinks: true,
  },
  // Inner brow ends up, leaning back, gone small.
  sorry: {
    tilt: { rot: 4, sx: 0.97, sy: 0.97 },
    eye: { ...BASE_EYE, h: 24, top: 23 },
    gleam: BASE_GLEAM,
    brow: { op: 1, top: 11, rotL: -15, rotR: 15, tyL: -2, tyR: -2 },
    blinks: true,
  },
  // Eyes wide, brows up, caught something.
  alert: {
    tilt: { rot: 0, sx: 1, sy: 1 },
    eye: { ...BASE_EYE, h: 36, w: 18, top: 15 },
    gleam: BASE_GLEAM,
    brow: { op: 1, top: 3, rotL: 0, rotR: 0, tyL: -3, tyR: -3 },
    blinks: true,
  },
};

const MOOD_T: WithTimingConfig = { duration: 260, easing: Easing.out(Easing.cubic) };
const step = (ms: number): WithTimingConfig => ({ duration: ms, easing: Easing.inOut(Easing.quad) });

interface Props {
  /** Width in points. Height follows the drawing's proportion (~0.80 × size). */
  size?: number;
  mood?: MascotMood;
  /** `inverse` is white-bodied, for the brand-tinted FAB where violet vanishes. */
  tone?: 'brand' | 'inverse';
  /** Fires a one-shot reaction each time this value changes to something new. */
  reaction?: MascotReaction;
  /** Breathing and blinking. Turn off for a static thumbnail. */
  alive?: boolean;
  style?: ViewStyle;
}

export default function SiloMascot({
  size = 44,
  mood = 'idle',
  tone = 'brand',
  reaction,
  alive = true,
  style,
}: Props) {
  const k = size / W;
  const spec = MOODS[mood];
  const inverse = tone === 'inverse';

  // Mood — the static pose, animated between states.
  const tiltRot = useSharedValue(spec.tilt.rot);
  const tiltSx = useSharedValue(spec.tilt.sx);
  const tiltSy = useSharedValue(spec.tilt.sy);
  const eyeH = useSharedValue(spec.eye.h);
  const eyeW = useSharedValue(spec.eye.w);
  const eyeTop = useSharedValue(spec.eye.top);
  const eyeInsetL = useSharedValue(spec.eye.insetL);
  const eyeInsetR = useSharedValue(spec.eye.insetR);
  const gleamOp = useSharedValue(spec.gleam.op);
  const gleamTop = useSharedValue(spec.gleam.top);
  const gleamInsetL = useSharedValue(spec.gleam.insetL);
  const gleamInsetR = useSharedValue(spec.gleam.insetR);
  const browOp = useSharedValue(spec.brow.op);
  const browTop = useSharedValue(spec.brow.top);
  const browRotL = useSharedValue(spec.brow.rotL);
  const browRotR = useSharedValue(spec.brow.rotR);
  const browTyL = useSharedValue(spec.brow.tyL);
  const browTyR = useSharedValue(spec.brow.tyR);

  // Motion — breathing, blinking, and the reactions, all independent of mood.
  const breath = useSharedValue(0);
  const blink = useSharedValue(1);
  const rSx = useSharedValue(1);
  const rSy = useSharedValue(1);
  const rTy = useSharedValue(0);
  const rTx = useSharedValue(0);
  const rRot = useSharedValue(0);
  const lagMid = useSharedValue(1);
  const lagBase = useSharedValue(1);

  useEffect(() => {
    const m = MOODS[mood];
    tiltRot.value = withTiming(m.tilt.rot, MOOD_T);
    tiltSx.value = withTiming(m.tilt.sx, MOOD_T);
    tiltSy.value = withTiming(m.tilt.sy, MOOD_T);
    eyeH.value = withTiming(m.eye.h, MOOD_T);
    eyeW.value = withTiming(m.eye.w, MOOD_T);
    eyeTop.value = withTiming(m.eye.top, MOOD_T);
    eyeInsetL.value = withTiming(m.eye.insetL, MOOD_T);
    eyeInsetR.value = withTiming(m.eye.insetR, MOOD_T);
    gleamOp.value = withTiming(m.gleam.op, MOOD_T);
    gleamTop.value = withTiming(m.gleam.top, MOOD_T);
    gleamInsetL.value = withTiming(m.gleam.insetL, MOOD_T);
    gleamInsetR.value = withTiming(m.gleam.insetR, MOOD_T);
    browOp.value = withTiming(m.brow.op, MOOD_T);
    browTop.value = withTiming(m.brow.top, MOOD_T);
    browRotL.value = withTiming(m.brow.rotL, MOOD_T);
    browRotR.value = withTiming(m.brow.rotR, MOOD_T);
    browTyL.value = withTiming(m.brow.tyL, MOOD_T);
    browTyR.value = withTiming(m.brow.tyR, MOOD_T);
    if (!m.blinks) blink.value = withTiming(1, { duration: 120 });
  }, [
    mood, tiltRot, tiltSx, tiltSy, eyeH, eyeW, eyeTop, eyeInsetL, eyeInsetR,
    gleamOp, gleamTop, gleamInsetL, gleamInsetR, browOp, browTop, browRotL,
    browRotR, browTyL, browTyR, blink,
  ]);

  // Breathing. Composed with the reaction values rather than fighting them for
  // the same shared value, so a hop never leaves the mascot holding its breath.
  useEffect(() => {
    if (!alive) {
      cancelAnimation(breath);
      breath.value = 0;
      return;
    }
    breath.value = withRepeat(
      withTiming(1, { duration: 1950, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(breath);
  }, [alive, breath]);

  // Blinking on a randomised interval — a fixed one reads as a metronome.
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!alive || !spec.blinks) {
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
      return;
    }
    const schedule = () => {
      blinkTimer.current = setTimeout(() => {
        blink.value = withSequence(
          withTiming(0.06, { duration: 90 }),
          withTiming(1, { duration: 120 })
        );
        schedule();
      }, 2800 + Math.random() * 2400);
    };
    schedule();
    return () => {
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
    };
  }, [alive, spec.blinks, blink]);

  // One-shot reactions. The keyframes are the squash-and-stretch: crouch,
  // stretch, pancake, settle.
  useEffect(() => {
    if (!reaction) return;
    if (reaction === 'hop') {
      rSx.value = withSequence(
        withTiming(1.1, step(120)), withTiming(0.9, step(180)), withTiming(0.94, step(200)),
        withTiming(1.14, step(180)), withTiming(0.96, step(140)), withTiming(1.03, step(100)),
        withTiming(1, step(80))
      );
      rSy.value = withSequence(
        withTiming(0.86, step(120)), withTiming(1.16, step(180)), withTiming(1.08, step(200)),
        withTiming(0.84, step(180)), withTiming(1.05, step(140)), withTiming(0.98, step(100)),
        withTiming(1, step(80))
      );
      rTy.value = withSequence(
        withTiming(0, step(120)), withTiming(-42, step(180)), withTiming(-50, step(200)),
        withTiming(0, step(180)), withTiming(-6, step(140)), withTiming(0, step(100)),
        withTiming(0, step(80))
      );
      // The slabs arrive late and overshoot — the bit that sells the weight.
      lagMid.value = withSequence(withTiming(0.93, step(300)), withTiming(1.1, step(340)), withTiming(1, step(260)));
      lagBase.value = withSequence(withTiming(0.93, step(360)), withTiming(1.1, step(340)), withTiming(1, step(200)));
    } else if (reaction === 'poke') {
      rSx.value = withSequence(
        withTiming(1.18, step(115)), withTiming(0.92, step(158)), withTiming(1.07, step(144)),
        withTiming(0.98, step(130)), withTiming(1, step(173))
      );
      rSy.value = withSequence(
        withTiming(0.8, step(115)), withTiming(1.1, step(158)), withTiming(0.95, step(144)),
        withTiming(1.02, step(130)), withTiming(1, step(173))
      );
      lagMid.value = withSequence(withTiming(1.12, step(130)), withTiming(0.95, step(190)), withTiming(1, step(240)));
      lagBase.value = withSequence(withTiming(1.12, step(180)), withTiming(0.95, step(190)), withTiming(1, step(190)));
    } else {
      rTx.value = withSequence(
        withTiming(-7, step(120)), withTiming(6, step(150)), withTiming(-4, step(150)),
        withTiming(2, step(108)), withTiming(0, step(72))
      );
      rRot.value = withSequence(
        withTiming(-3, step(120)), withTiming(2.5, step(150)), withTiming(-1.5, step(150)),
        withTiming(0.6, step(108)), withTiming(0, step(72))
      );
    }
  }, [reaction, rSx, rSy, rTy, rTx, rRot, lagMid, lagBase]);

  const tiltStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${tiltRot.value}deg` },
      { scaleX: tiltSx.value },
      { scaleY: tiltSy.value },
    ],
  }));

  const bodyStyle = useAnimatedStyle(() => {
    const bSx = interpolate(breath.value, [0, 1], [1, 0.992]);
    const bSy = interpolate(breath.value, [0, 1], [1, 1.02]);
    const bTy = interpolate(breath.value, [0, 1], [0, -2 * k]);
    return {
      transform: [
        { translateX: rTx.value * k },
        { translateY: bTy + rTy.value * k },
        { rotate: `${rRot.value}deg` },
        { scaleX: bSx * rSx.value },
        { scaleY: bSy * rSy.value },
      ],
    };
  });

  const midStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: lagMid.value }] }));
  const baseStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: lagBase.value }] }));

  const eyeLStyle = useAnimatedStyle(() => ({
    top: eyeTop.value * k,
    width: eyeW.value * k,
    height: eyeH.value * k,
    left: eyeInsetL.value * k,
    transform: [{ scaleY: blink.value }],
  }));
  const eyeRStyle = useAnimatedStyle(() => ({
    top: eyeTop.value * k,
    width: eyeW.value * k,
    height: eyeH.value * k,
    right: eyeInsetR.value * k,
    transform: [{ scaleY: blink.value }],
  }));

  const gleamLStyle = useAnimatedStyle(() => ({
    opacity: gleamOp.value, top: gleamTop.value * k, left: gleamInsetL.value * k,
  }));
  const gleamRStyle = useAnimatedStyle(() => ({
    opacity: gleamOp.value, top: gleamTop.value * k, right: gleamInsetR.value * k,
  }));
  const browLStyle = useAnimatedStyle(() => ({
    opacity: browOp.value, top: browTop.value * k,
    transform: [{ translateY: browTyL.value * k }, { rotate: `${browRotL.value}deg` }],
  }));
  const browRStyle = useAnimatedStyle(() => ({
    opacity: browOp.value, top: browTop.value * k,
    transform: [{ translateY: browTyR.value * k }, { rotate: `${browRotR.value}deg` }],
  }));

  const bodyC = inverse ? '#ffffff' : BRAND[600];
  const midC = inverse ? 'rgba(255,255,255,0.8)' : '#7449e0';
  const baseC = inverse ? 'rgba(255,255,255,0.6)' : '#6a3dd2';
  const inkC = inverse ? '#2a1a4a' : INK[900];

  // The eye's radius differs top vs bottom only for `pleased`, and swapping it
  // mid-transition looks worse than snapping it, so it is not animated.
  const eyeRadius = {
    borderTopLeftRadius: spec.eye.rTop * k,
    borderTopRightRadius: spec.eye.rTop * k,
    borderBottomLeftRadius: spec.eye.rBot * k,
    borderBottomRightRadius: spec.eye.rBot * k,
  };

  return (
    <View style={[{ width: size, height: H * k }, style]} pointerEvents="none">
      <Animated.View style={[styles.layer, { transformOrigin: 'bottom center' }, tiltStyle]}>
        <Animated.View style={[styles.layer, { transformOrigin: 'bottom center' }, bodyStyle]}>
          {/* head */}
          <View
            style={{
              width: D.head.w * k,
              height: D.head.h * k,
              backgroundColor: bodyC,
              borderTopLeftRadius: D.head.rTop * k,
              borderTopRightRadius: D.head.rTop * k,
              borderBottomLeftRadius: D.head.rBot * k,
              borderBottomRightRadius: D.head.rBot * k,
            }}
          >
            <Animated.View
              style={[
                styles.abs,
                { width: D.brow.w * k, height: D.brow.h * k, borderRadius: D.brow.r * k, backgroundColor: inkC, left: D.brow.inset * k },
                browLStyle,
              ]}
            />
            <Animated.View
              style={[
                styles.abs,
                { width: D.brow.w * k, height: D.brow.h * k, borderRadius: D.brow.r * k, backgroundColor: inkC, right: D.brow.inset * k },
                browRStyle,
              ]}
            />
            <Animated.View style={[styles.abs, { backgroundColor: inkC }, eyeRadius, eyeLStyle]} />
            <Animated.View style={[styles.abs, { backgroundColor: inkC }, eyeRadius, eyeRStyle]} />
            <Animated.View
              style={[
                styles.abs,
                { width: D.gleam.d * k, height: D.gleam.d * k, borderRadius: D.gleam.d * k, backgroundColor: 'rgba(255,255,255,0.92)' },
                gleamLStyle,
              ]}
            />
            <Animated.View
              style={[
                styles.abs,
                { width: D.gleam.d * k, height: D.gleam.d * k, borderRadius: D.gleam.d * k, backgroundColor: 'rgba(255,255,255,0.92)' },
                gleamRStyle,
              ]}
            />
          </View>

          <Animated.View
            style={[
              {
                width: D.mid.w * k,
                height: D.mid.h * k,
                marginTop: D.mid.gap * k,
                borderRadius: D.mid.r * k,
                backgroundColor: midC,
              },
              midStyle,
            ]}
          />
          <Animated.View
            style={[
              {
                width: D.base.w * k,
                height: D.base.h * k,
                marginTop: D.base.gap * k,
                borderTopLeftRadius: D.base.rTop * k,
                borderTopRightRadius: D.base.rTop * k,
                borderBottomLeftRadius: D.base.rBot * k,
                borderBottomRightRadius: D.base.rBot * k,
                backgroundColor: baseC,
              },
              baseStyle,
            ]}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { alignItems: 'center' },
  abs: { position: 'absolute' },
});
