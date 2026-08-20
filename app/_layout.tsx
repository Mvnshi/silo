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
import { AppState, LogBox } from 'react-native';
import { Stack, Redirect, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { syncNow } from '@/lib/sync';
import AssistantProvider from '@/components/AssistantProvider';

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
import { runMigrations, hasOnboarded, getItems, getSettings } from '@/lib/storage';
import { hydrateAllowance } from '@/lib/allowance';
import { drainPendingShares } from '@/lib/shareImport';
import * as Notifications from 'expo-notifications';
import { configureNotifications, routeForResponse, syncNotifications } from '@/lib/notifications';
import { ToastProvider } from '@/components/ui/Toast';
import TextPromptHost from '@/components/ui/TextPrompt';
import ThemeProvider from '@/components/ThemeProvider';
import AuthProvider from '@/components/AuthProvider';
import PremiumProvider from '@/components/PremiumProvider';
import { useThemeColors } from '@/lib/useTheme';

// Hold the native splash until we know whether to show onboarding or the tabs,
// so the user never sees a blank frame between the splash and a mounted screen.
// Best-effort: if the call loses the race with auto-hide, startup is unaffected.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Foreground presentation behaviour for local notifications. Module scope so it
// is installed exactly once, before any notification can arrive.
configureNotifications();

export default function RootLayout() {
  // null = still reading the flag (render a blank frame, not the wrong screen).
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const pathname = usePathname();
  const router = useRouter();

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
      // Before anything can make an AI call: the gate reads this count
      // synchronously, and an un-hydrated count reads as "spent nothing".
      await hydrateAllowance();
      await seedDevData();
      // Import anything the iOS Share Extension queued into the App Group.
      await drainPendingShares();
      // One sync per cold start, after the drain so fresh shares ride along.
      // Best-effort: unconfigured/offline must never affect startup.
      syncNow().catch(() => {});
      refreshNotifications();
    }

    /**
     * Rebuild the local-notification schedule from current state. Idempotent
     * (it cancels what it owns first), permission- and preference-gated
     * internally, and never throws — so it is safe on every foreground.
     */
    async function refreshNotifications() {
      try {
        const [items, settings] = await Promise.all([getItems(), getSettings()]);
        await syncNotifications(items, settings);
      } catch {
        // Notifications are a nicety; never let them affect startup.
      }
    }

    setupAudio();
    init();

    // Re-drain whenever the app returns to the foreground — the usual path after
    // tapping "Add to Silo" in another app and switching back.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      drainPendingShares()
        .catch(() => {})
        // Sync AFTER the drain resolves so a just-shared save pushes in the same pass.
        .then(() => syncNow().catch(() => {}))
        // Reminders follow the data, so rebuild them once the data has settled.
        .then(() => refreshNotifications());
    });
    return () => sub.remove();
  }, []);

  // Tapping a Silo notification should land where the action is — the Today
  // view for a check-in or the digest, "Your Silo" for the tidy-up nudge.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeForResponse(response);
      if (route) router.push(route as never);
    });
    return () => sub.remove();
  }, [router]);

  // Drop the splash only once we know which screen to mount, so the first
  // thing after the logo is a fully-rendered surface — never a blank frame.
  useEffect(() => {
    if (needsOnboarding !== null) SplashScreen.hideAsync().catch(() => {});
  }, [needsOnboarding]);

  // Keep the native splash up while the onboarding flag loads, so a returning
  // user never flashes onboarding (and a new user never flashes the tabs).
  if (needsOnboarding === null) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <PremiumProvider>
              <AppShell needsOnboarding={needsOnboarding} />
            </PremiumProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Split out so it renders INSIDE ThemeProvider and can read the resolved
 * palette — the status bar and the native stack background both have to follow
 * appearance or every push flashes white on a dark device.
 */
function AppShell({ needsOnboarding }: { needsOnboarding: boolean }) {
  const colors = useThemeColors();

  return (
    <>
      {/* Screen-level <StatusBar> instances override this (last mounted wins) —
          see reel.tsx, which needs light glyphs over its full-bleed media. */}
      <StatusBar style={colors.statusBar} />
      <ToastProvider>
        {/* Inside ToastProvider so the Undo that follows every assistant action
            has somewhere to appear, and BEFORE TextPromptHost so a text prompt
            still lands above the sheet. The assistant is an overlay rather than
            a route: it has to be reachable from every tab without navigating
            away from what you are looking at. */}
        <AssistantProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.page },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
            {/* A plain push, NOT presentation:'modal'. react-native-screens
                presents a modal as its own view controller, which renders ABOVE
                the root view where ToastProvider lives — so every toast raised
                from Settings (export result, sync failure) would have been
                invisible. Settings is reached from "Your Silo" via its gear, so a
                push is also the more consistent transition. */}
            <Stack.Screen name="settings" />
            {/* Modal: the paywall is a decision, not a destination — it must be
                dismissable without losing where you were. */}
            <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
            {/* Presented, not pushed: signing in is a detour from wherever you
                were, and the sheet makes "you can leave" obvious. */}
            <Stack.Screen
              name="sign-in"
              options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
            />
          </Stack>
        </AssistantProvider>
        {/* Backs promptForText() — replaces the iOS-only Alert.prompt. */}
        <TextPromptHost />
      </ToastProvider>
      {/* First launch only: route into onboarding (it replaces back to tabs). */}
      {needsOnboarding && <Redirect href="/onboarding" />}
    </>
  );
}

