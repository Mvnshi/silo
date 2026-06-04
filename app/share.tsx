/**
 * Share-target deep-link handler (silo://share?type=&value=&category=).
 *
 * The native iOS Share Extension (targets/share) hands off the shared URL/text/
 * image here. This screen runs the SAME pipeline as the in-app capture flow —
 * extractLink() for URLs, analyzeImage() for images — builds an Item via
 * createItem(), saves it to the shared AsyncStorage store, and returns to
 * Stacks. Never loses a save: a failed extraction still stores the raw link.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { extractLink, analyzeImage } from '@/lib/api';
import { createItem } from '@/lib/items';
import { addItem } from '@/lib/storage';
import { detectPlatform } from '@/lib/embed';
import { imageUriToBase64 } from '@/lib/screenshots';
import { Classification } from '@/lib/types';

const CLASSIFICATIONS: Classification[] = [
  'article', 'video', 'recipe', 'product', 'event', 'place',
  'idea', 'fitness', 'food', 'career', 'academia', 'other',
];

function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

export default function ShareTarget() {
  const params = useLocalSearchParams();
  const [status, setStatus] = useState('Saving to Silo…');
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return; // guard against double-processing on re-render
    handled.current = true;

    (async () => {
      const type = asString(params.type) || 'url';
      const value = asString(params.value);
      const catParam = asString(params.category);
      const preset =
        catParam && catParam !== 'auto' && (CLASSIFICATIONS as string[]).includes(catParam)
          ? (catParam as Classification)
          : undefined;

      try {
        if (!value) throw new Error('empty share payload');

        if (type === 'image') {
          const base64 = await imageUriToBase64(value);
          const analysis = await analyzeImage(base64, 'image/jpeg');
          await addItem(
            createItem({
              type: 'screenshot',
              classification: preset || analysis.classification,
              title: analysis.title || 'Shared image',
              description: analysis.description,
              imageUri: value,
              tags: analysis.tags || [],
            })
          );
        } else if (type === 'text' && !/^https?:\/\//i.test(value)) {
          // Plain text (not a URL) → a note.
          await addItem(
            createItem({
              type: 'note',
              classification: preset || 'idea',
              title: value.slice(0, 60) || 'Shared note',
              description: value,
              notes: value,
              tags: [],
            })
          );
        } else {
          // URL (or shared text containing a URL) → the universal extractor.
          try {
            const r = await extractLink(value);
            await addItem(
              createItem({
                type: 'link',
                classification: preset || r.classification,
                title: r.title || value,
                description: r.description || r.caption,
                url: r.sourceUrl || value,
                imageUri: r.thumbnailUrl,
                author: r.author,
                platform: r.platform,
                tags: r.tags || [],
              })
            );
          } catch {
            // Backend unreachable / not configured → still save the raw link.
            await addItem(
              createItem({
                type: 'link',
                classification: preset || 'other',
                title: value,
                url: value,
                platform: detectPlatform(value),
                tags: [],
              })
            );
          }
        }
        setStatus('Saved to Silo!');
      } catch (e) {
        console.error('Share import failed:', e);
        setStatus('Couldn’t save that item.');
      } finally {
        router.replace('/(tabs)');
      }
    })();
    // Process exactly once on mount.
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
  text: {
    fontSize: 16,
    color: '#444',
    fontWeight: '600',
  },
});
