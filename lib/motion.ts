/**
 * Motion presets — one animation vocabulary for the whole app.
 *
 * Screens should import from here rather than hand-rolling `FadeIn.delay(...)`
 * chains, so entrances, exits, and layout moves feel like one product.
 *
 * Reduce Motion: `usePrefersReducedMotion()` returns the OS setting; the
 * `enter*` helpers already collapse to a plain fade when it is on, so callers
 * usually don't need to branch.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  FadeIn,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  ZoomIn,
} from 'react-native-reanimated';
import { LIQUID_GLASS } from './glass';
import { DURATION, SPRING, STAGGER } from './theme';

/**
 * True when the user has "Reduce Motion" enabled. Animations should degrade to
 * a cross-fade rather than disappear entirely (an instant swap reads as a bug).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Per-item entrance delay for a staggered list. Capped at `STAGGER.max` items so
 * a 500-row list doesn't take 20s to finish appearing — everything past the cap
 * shares the last delay and lands together.
 */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER.max) * STAGGER.step;
}

/**
 * Standard list/card entrance: rise + fade, staggered by index.
 * Pass `reduced` from `usePrefersReducedMotion()` to honour the OS setting.
 */
export function enterList(index: number, reduced = false) {
  const delay = staggerDelay(index);
  if (reduced) return FadeIn.duration(DURATION.fast).delay(delay);
  return FadeIn.duration(DURATION.base).delay(delay).springify().damping(SPRING.enter.damping);
}

/**
 * Entrance for a hero/primary element that should arrive with a little pop.
 * Glass-safe under Reduce Motion — see `glassSafeNote`.
 */
export function enterHero(delay = 0, reduced = false) {
  if (reduced) return LIQUID_GLASS ? undefined : FadeIn.duration(DURATION.fast).delay(delay);
  return ZoomIn.duration(DURATION.base).delay(delay).springify().damping(SPRING.enter.damping);
}

/**
 * Entrance for chrome that slides up from the bottom (bars, sheets, toasts).
 *
 * Returns `undefined` under Reduce Motion when Liquid Glass is active — see
 * `glassSafeNote` below. `undefined` is a valid `entering` value and means "no
 * animation", which is what Reduce Motion asks for anyway.
 */
export function enterFromBottom(delay = 0, reduced = false) {
  if (reduced) return LIQUID_GLASS ? undefined : FadeIn.duration(DURATION.fast).delay(delay);
  return SlideInDown.duration(DURATION.base).delay(delay).springify().damping(SPRING.snappy.damping);
}

/** Matching exit for `enterFromBottom`. */
export function exitToBottom(reduced = false) {
  if (reduced) return LIQUID_GLASS ? undefined : FadeOut.duration(DURATION.instant);
  return SlideOutDown.duration(DURATION.fast);
}

/*
 * glassSafeNote
 * -------------
 * Every preset here degrades to a cross-fade under Reduce Motion. That is right
 * for an ordinary view and WRONG for a Liquid Glass one: an opacity animation on
 * a glass surface — or on any ancestor of one — makes the material stop
 * rendering rather than fade, so the sheet arrives as an empty hole.
 *
 * The presets used by glass surfaces (`enterFromBottom` / `exitToBottom` /
 * `enterHero`) therefore return `undefined` instead of a fade when the real
 * effect is active. Handling it here rather than at each call site means a new
 * glass sheet can't forget the guard — which is exactly how this class of bug
 * comes back.
 *
 * `enterList` and `exitFade` are deliberately NOT guarded: they are for list
 * rows and other content, which are never glass.
 */

/** Plain cross-fade exit — the default for anything leaving a list. */
export function exitFade(reduced = false) {
  return FadeOut.duration(reduced ? DURATION.instant : DURATION.fast);
}

/**
 * Layout transition for lists whose rows reorder/resize (filter changes, a row
 * being removed). Attach as `layout={LAYOUT}` on the animated row.
 */
export const LAYOUT = LinearTransition.duration(DURATION.base).springify().damping(SPRING.settle.damping);
