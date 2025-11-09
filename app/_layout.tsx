/**
 * Root Layout Component
 * 
 * This is the root layout for the entire app. It sets up:
 * - Font loading
 * - Navigation container
 * - Global error handling
 * - Initial data seeding
 * 
 * Dependencies:
 * - expo-router: File-based routing
 * - expo-av: Audio setup
 */

import { useEffect } from 'react';
import { Slot } from 'expo-router';
import { Audio } from 'expo-av';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { seedData, shouldSeedData } from '@/lib/seed';

export default function RootLayout() {
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

    // Check if we need to seed initial data
    async function checkAndSeedData() {
      try {
        const needsSeeding = await shouldSeedData();
        console.log('🔍 Checking if seed data needed...', needsSeeding);
        if (needsSeeding) {
          console.log('🌱 First launch detected, seeding data...');
          await seedData();
        } else {
          console.log('✅ Seed data already exists, skipping...');
        }
      } catch (error) {
        console.error('❌ Failed to check/seed data:', error);
      }
    }

    setupAudio();
    checkAndSeedData();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" translucent={false} />
      <Slot />
    </SafeAreaProvider>
  );
}

