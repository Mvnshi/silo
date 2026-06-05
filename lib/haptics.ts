/**
 * Shared haptic feedback helpers.
 *
 * Centralizes the "celebration" pattern that was duplicated across the capture
 * and swipe screens (Add, Streams, Screenshots, Silo, Calendar). Haptics are
 * best-effort — failures (unsupported device/simulator) are swallowed.
 */
import * as Haptics from 'expo-haptics';

/** Escalating success buzz for a completed action (import, schedule, mark-done). */
export async function celebrationHaptic(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics unavailable (e.g. simulator) — ignore.
  }
}
