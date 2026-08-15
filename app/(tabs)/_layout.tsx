/**
 * Tabs Layout Component
 *
 * Native iOS-style tab navigation with 5 main screens using NativeTabs:
 * - Streams (reel): TikTok-style content feed
 * - Stacks (index): Organized collections
 * - Add: Add new content
 * - Silo (calendar): Today / calendar / map / bucket list
 * - Screenshots: Review recent screenshots
 *
 * Features:
 * - Native iOS liquid glass tab bar, tinted to the Silo violet (never the
 *   stock #007AFF — the window tint is what UIKit falls back to otherwise).
 * - Paired SF Symbols so UIKit plays its symbol transition on selection.
 * - Selection haptic on every tab change (skipped on cold start).
 * - Tab bar minimizes on scroll-down (iOS 26+), giving the feed screens
 *   the full canvas.
 *
 * Dependencies:
 * - expo-router: File-based routing with native tabs
 * - react-native-screens: 4.6.0+ required
 */

import { NativeTabs, Label, Icon } from 'expo-router/unstable-native-tabs';
import { useEffect, useRef } from 'react';
import { useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/lib/useTheme';

export default function TabsLayout() {
  const colors = useThemeColors();
  // segments[0] is the "(tabs)" group; segments[1] is the active tab route
  // ("reel" / "index" / "add" / …). usePathname() strips group segments, which
  // is why the old pathname regex could never match.
  const segments = useSegments();
  const activeTab = segments[1];
  const isFirstRun = useRef(true);

  useEffect(() => {
    // Don't buzz on cold start — only on an actual user-driven tab change.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    Haptics.selectionAsync().catch(() => {});
  }, [activeTab]);

  return (
    <NativeTabs
      // Explicit colours (not the window tint, which is stock #007AFF) AND
      // driven by our resolved palette, so a user who forces light or dark
      // independently of the OS still gets a tab bar that matches the app.
      tintColor={colors.brand}
      iconColor={{ default: colors.decorative, selected: colors.brand }}
      labelStyle={{
        default: { color: colors.textTertiary, fontSize: 10, fontWeight: '500' },
        selected: { color: colors.brand, fontSize: 10, fontWeight: '700' },
      }}
      blurEffect={colors.appearance === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterial'}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="reel">
        <Label>Streams</Label>
        <Icon sf={{ default: 'play', selected: 'play.fill' }} drawable="ic_menu_slideshow" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="index">
        <Label>Stacks</Label>
        <Icon sf={{ default: 'folder', selected: 'folder.fill' }} drawable="ic_menu_sort_by_size" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="add">
        <Label>Add</Label>
        <Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} drawable="ic_input_add" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="calendar">
        <Label>Silo</Label>
        <Icon sf={{ default: 'brain', selected: 'brain.fill' }} drawable="ic_menu_my_calendar" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="screenshots">
        <Label>Screenshots</Label>
        <Icon sf={{ default: 'photo', selected: 'photo.fill' }} drawable="ic_menu_gallery" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
