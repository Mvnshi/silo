/**
 * Root Layout Component
 *
 * Root layout for the entire app. On mount it:
 * - configures audio mode (expo-av) for background/silent-mode playback
 * - runs storage migrations, then (dev only) seeds example data
 * - drains pending iOS Share-Extension imports (on boot + every foreground)
 *
 * Wraps the navigator in a single app-wide GestureHandlerRootView so individual
 * screens don't each need their own.
 *
 * Dependencies:
 * - expo-router: File-based routing
 * - expo-av: Audio setup
 * - react-native-gesture-handler: Root gesture context
 */

import '../global.css';
import { useEffect, useState } from 'react';
import { AppState, View, LogBox } from 'react-native';
import { Stack, Redirect, usePathname } from 'expo-router';

// Known, tracked noise only — never blanket-ignore:
// - expo-av deprecation: migration to expo-audio/expo-video is in TODO.md.
// - ExpoBlurView view-config/view-manager notices: benign Fabric-interop noise
//   (BlurView renders; it degrades gracefully on binaries built without the
//   pod). Goes away when expo-blur ships Fabric-native.
LogBox.ignoreLogs([
  /Expo AV has been deprecated/,
  /Unable to get the view config/,
  /native view manager.*ExpoBlurView/,
]);
import { Audio } from 'expo-av';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { seedData, shouldSeedData } from '@/lib/seed';
import { runMigrations, hasOnboarded } from '@/lib/storage';
import { drainPendingShares } from '@/lib/shareImport';

export default function RootLayout() {
  // null = still reading the flag (render a blank frame, not the wrong screen).
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    hasOnboarded().then((done) => setNeedsOnboarding(!done));
  }, []);

  // Once we've ARRIVED at onboarding, unmount the <Redirect> below. Without
  // this, the still-mounted Redirect would bounce the user straight back to
  // /onboarding when "Get Started" replaces to the tabs.
  useEffect(() => {
    if (needsOnboarding && pathname === '/onboarding') setNeedsOnboarding(false);
  }, [pathname, needsOnboarding]);

  useEffect(() => {
    // Configure audio mode for background playback
    async function setupAudio() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });
      } catch (error) {
        console.error('Failed to setup audio:', error);
      }
    }

    // Seed example content ONLY in development builds. Production must never
    // ship demo data (App Store + "no fakes" requirement); real first-run
    // onboarding is handled separately (Phase 4). `__DEV__` is false in EAS
    // release/preview builds, so users always start with a clean slate.
    async function seedDevData() {
      if (!__DEV__) return;
      try {
        if (await shouldSeedData()) {
          await seedData();
        }
      } catch (error) {
        console.error('Dev seed failed (non-fatal):', error);
      }
    }

    // Run storage migrations FIRST so every screen reads the unified schema,
    // then (dev only) seed. Migration is idempotent and never blocks startup.
    async function init() {
      await runMigrations();
      await seedDevData();
      // Import anything the iOS Share Extension queued into the App Group.
      await drainPendingShares();
    }

    setupAudio();
    init();

    // Re-drain whenever the app returns to the foreground — the usual path after
    // tapping "Add to Silo" in another app and switching back.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') drainPendingShares().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // Hold one blank frame while the onboarding flag loads so a returning user
  // never flashes onboarding (and a new user never flashes the tabs).
  if (needsOnboarding === null) {
    return <View style={{ flex: 1, backgroundColor: '#F5F3FF' }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" translucent={false} />
        <Stack screenOptions={{ headerShown: false }} />
        {/* First launch only: route into onboarding (it replaces back to tabs). */}
        {needsOnboarding && <Redirect href="/onboarding" />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

