/**
 * Whether the device can draw Apple's real Liquid Glass.
 *
 * This lives in `lib/` rather than in the `Glass` component so that
 * `lib/motion.ts` can consult it without a component importing a component —
 * the motion presets have to know, because a fade above a glass surface is not
 * a fade (see below).
 *
 * Resolved once at module load: the answer can't change without a relaunch, and
 * re-querying per render would cost a native call on every frame of a sheet
 * animation.
 *
 * The check is a RUNTIME one, not an iOS-version comparison — some iOS 26 betas
 * ship without the API, and calling into it there crashes.
 */
import { Platform } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';

export const LIQUID_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();
