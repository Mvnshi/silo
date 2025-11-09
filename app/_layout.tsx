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
import { Stack } from 'expo-router';
import { Audio } from 'expo-av';
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
        if (needsSeeding) {
          console.log('First launch detected, seeding data...');
          await seedData();
        }
      } catch (error) {
        console.error('Failed to check/seed data:', error);
      }
    }

    setupAudio();
    checkAndSeedData();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'default',
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen 
        name="item/[id]" 
        options={{
          presentation: 'modal' as any,
          headerShown: true,
          headerTitle: 'Item Details',
        }}
      />
      <Stack.Screen 
        name="silo/[id]" 
        options={{
          headerShown: true,
          headerTitle: 'Stack',
        }}
      />
    </Stack>
  );
}

