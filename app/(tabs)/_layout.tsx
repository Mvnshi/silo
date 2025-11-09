/**
 * Tabs Layout Component
 * 
 * Native iOS-style tab navigation with 5 main screens using NativeTabs:
 * - Reel: TikTok-style content feed
 * - Stacks: Organized collections
 * - Add: Add new content
 * - Calendar: Scheduled items
 * - Screenshots: Review recent screenshots
 * 
 * Features:
 * - Native iOS liquid glass effect (iOS 16+)
 * - Automatic dark mode support
 * - Scroll-to-top on tab press
 * - Pop-to-root navigation
 * 
 * Dependencies:
 * - expo-router: File-based routing with native tabs
 * - react-native-screens: 4.6.0+ required
 */

import { NativeTabs, Label, Icon } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import * as Haptics from 'expo-haptics';

export default function TabsLayout() {
  const pathname = usePathname();
  
  // Haptic feedback on tab switch
  useEffect(() => {
    // Only trigger on tab routes, not nested routes
    if (pathname && pathname.match(/^\/(tabs)\/(reel|index|add|calendar|screenshots)$/)) {
      Haptics.selectionAsync();
    }
  }, [pathname]);

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="reel">
        <Label>Streams</Label>
        <Icon
          sf="play.fill"
          drawable="ic_menu_slideshow"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="index">
        <Label>Stacks</Label>
        <Icon
          sf="folder.fill"
          drawable="ic_menu_sort_by_size"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="add">
        <Label>Add</Label>
        <Icon
          sf="plus.circle.fill"
          drawable="ic_input_add"
        />
      </NativeTabs.Trigger>

            <NativeTabs.Trigger name="calendar">
              <Label>Silo</Label>
              <Icon
                sf="brain"
                drawable="ic_menu_my_calendar"
              />
            </NativeTabs.Trigger>

      <NativeTabs.Trigger name="screenshots">
        <Label>Screenshots</Label>
        <Icon
          sf="photo.fill"
          drawable="ic_menu_gallery"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

