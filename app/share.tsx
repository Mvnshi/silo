/**
 * Share deep-link route (silo://share?type=&value=&category=).
 *
 * Used when something can open the app directly with a share payload (and by the
 * dev/test path). The native Share Extension itself hands off via the App Group
 * queue instead (see lib/shareImport.drainPendingShares) because iOS blocks
 * openURL from a share extension. Both paths run the same importSharedItem().
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { importSharedItem } from '@/lib/shareImport';

function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default function ShareTarget() {
  const params = useLocalSearchParams();
  const [status, setStatus] = useState('Saving to Silo…');
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return; // process exactly once
    handled.current = true;
    (async () => {
      try {
        await importSharedItem({
          type: asString(params.type),
          value: asString(params.value),
          category: asString(params.category),
        });
        setStatus('Saved to Silo!');
      } catch (e) {
        console.error('Share import failed:', e);
        setStatus('Couldn’t save that item.');
      } finally {
        router.replace('/(tabs)');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#6366f1" />
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#F5F3FF',
  },
  text: { fontSize: 16, color: '#444', fontWeight: '600' },
});
