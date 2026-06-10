/**
 * StreamCard Component
 *
 * A TikTok-style full-screen card for displaying content items in the reel feed.
 * Renders inline social embeds (via lib/embed) or a gradient content card, with
 * audio playback and interactive Schedule / Done / Archive controls.
 *
 * Props:
 * - item: Content item to display
 * - onArchive: Callback when item is archived
 * - onSchedule: Callback when item is scheduled
 * - onComplete: Callback when item is marked done
 *
 * Dependencies:
 * - expo-av: Audio playback
 * - expo-linear-gradient: Background gradients
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import GlassCard from '@/components/ui/GlassCard';
import PressableScale from '@/components/ui/PressableScale';
import { GRADIENTS, RADIUS } from '@/lib/theme';
import { Item } from '@/lib/types';
import { getEmbed } from '@/lib/embed';
import { classConfig, classGradient } from '@/lib/classification';

const { width, height } = Dimensions.get('window');

/** Map a social platform to a brand glyph for the embed badge/fallback. */
function platformIcon(platform?: string): keyof typeof Ionicons.glyphMap {
  switch (platform) {
    case 'instagram':
      return 'logo-instagram';
    case 'youtube':
      return 'logo-youtube';
    case 'tiktok':
      return 'logo-tiktok';
    case 'twitter':
      return 'logo-twitter';
    case 'reddit':
      return 'logo-reddit';
    case 'facebook':
      return 'logo-facebook';
    case 'vimeo':
      return 'logo-vimeo';
    default:
      return 'globe-outline';
  }
}

interface StreamCardProps {
  item: Item;
  onArchive: (itemId: string) => void;
  onSchedule: (itemId: string) => void;
  onComplete: (itemId: string) => void;
}

function StreamCard({
  item,
  onArchive,
  onSchedule,
  onComplete
}: StreamCardProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [webViewError, setWebViewError] = useState(false);
  const [webViewLoading, setWebViewLoading] = useState(true);
  // Holds the actually-loaded Audio.Sound so cleanup can unload it without
  // closing over the (null-at-register-time) `sound` state.
  const soundRef = useRef<Audio.Sound | null>(null);

  // Inline embed for saved social links (token-free official platform embeds).
  const embed = getEmbed(item);

  /**
   * Load audio when component mounts; unload it on unmount.
   */
  useEffect(() => {
    if (item.audio_url) {
      loadAudio();
    }

    return () => {
      // Unload the sound we actually loaded (via the ref) and detach its
      // listener. unloadAsync clears the loaded sound, so no double-unload.
      const s = soundRef.current;
      if (s) {
        s.setOnPlaybackStatusUpdate(null);
        s.unloadAsync().catch(console.error);
        soundRef.current = null;
      }
    };
  }, [item.audio_url]);

  /**
   * Handle audio playback end
   */
  useEffect(() => {
    if (!sound) return;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded) {
        setIsPlaying(status.isPlaying);
        if (status.didJustFinish) {
          setIsPlaying(false);
        }
      }
    });
  }, [sound]);

  /**
   * Load audio from a remote URL (voice is roadmap-only/default-off)
   */
  async function loadAudio() {
    try {
      if (!item.audio_url) return;

      const { sound: audioSound } = await Audio.Sound.createAsync(
        { uri: item.audio_url },
        { shouldPlay: false }
      );

      soundRef.current = audioSound;
      setSound(audioSound);
    } catch (error) {
      console.error('Failed to load audio:', error);
    }
  }

  /**
   * Toggle audio playback
   */
  async function togglePlayback() {
    if (!sound) return;

    try {
      const status = await sound.getStatusAsync();
      
      if (status.isLoaded) {
        if (isPlaying) {
          await sound.pauseAsync();
          setIsPlaying(false);
        } else {
          await sound.playAsync();
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error('Failed to toggle playback:', error);
    }
  }

  // Inline embed for saved social links — render the platform's own player.
  if (embed.kind !== 'none') {
    const label = (item.platform || 'link').toUpperCase();
    const openSource = () => {
      const u = item.url || '';
      if (/^https?:\/\//i.test(u)) Linking.openURL(u).catch(() => {});
    };
    return (
      <View style={styles.container}>
        {webViewError ? (
          // Fallback UI if the embed can't load (private / region-locked / deleted).
          <View style={[styles.webview, styles.embedFallback]}>
            <Ionicons name={platformIcon(item.platform)} size={64} color="#fff" />
            <Text style={styles.embedFallbackTitle}>{item.title || 'Open this post'}</Text>
            <Text style={styles.embedFallbackSub}>Couldn’t load the embed here.</Text>
            <PressableScale haptic="light" onPress={openSource}>
              <LinearGradient
                colors={GRADIENTS.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.embedOpenBtn}
              >
                <Text style={styles.embedOpenBtnText}>Open link</Text>
              </LinearGradient>
            </PressableScale>
          </View>
        ) : (
          <WebView
            source={
              embed.kind === 'uri'
                ? { uri: embed.uri, headers: embed.headers }
                : { html: embed.html, baseUrl: embed.baseUrl }
            }
            style={styles.webview}
            // The embed is a fixed player, not a scrolling page. Internal
            // scrolling must stay OFF or the WebView swallows vertical pans
            // and the feed's swipe-to-next-card gesture stops working.
            scrollEnabled={false}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            allowsInlineMediaPlayback
            originWhitelist={['https://*', 'about:*', 'data:*']}
            onShouldStartLoadWithRequest={(req) => {
              const url = req.url;
              // Allow the embed's own initial load and any non-http(s) scheme
              // (about:/data:/blob:/intent: the player itself uses).
              if (!/^https?:\/\//i.test(url)) return true;
              if (embed.kind === 'uri' && url === embed.uri) return true;
              // A user tapped a link inside the embed -> open the real browser
              // instead of navigating this in-app WebView away from the player.
              Linking.openURL(url).catch(() => {});
              return false;
            }}
            onLoadStart={() => {
              setWebViewLoading(true);
              setWebViewError(false);
            }}
            onLoadEnd={() => setWebViewLoading(false)}
            onError={(syntheticEvent) => {
              console.error('Embed WebView error:', syntheticEvent.nativeEvent);
              setWebViewError(true);
              setWebViewLoading(false);
            }}
            renderError={() => (
              <View style={[styles.webview, styles.embedFallback]}>
                <Ionicons name={platformIcon(item.platform)} size={64} color="#fff" />
                <Text style={styles.embedFallbackSub}>Failed to load embed.</Text>
              </View>
            )}
          />
        )}

        {webViewLoading && !webViewError && (
          <View style={[styles.webview, styles.embedLoading]} pointerEvents="none">
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={2} />
            ) : null}
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.embedLoadingText}>Loading…</Text>
          </View>
        )}

        {/* Overlay with platform badge + title */}
        <View style={styles.reelOverlay} pointerEvents="box-none">
          <View style={styles.reelHeader}>
            <View style={styles.badge}>
              <Ionicons name={platformIcon(item.platform)} size={18} color="#fff" />
              <Text style={styles.badgeText}>{label}</Text>
            </View>
            {item.title ? (
              <Text style={styles.reelTitle} numberOfLines={3}>
                {item.title}
              </Text>
            ) : null}
            {item.author ? <Text style={styles.reelAuthor}>{item.author}</Text> : null}
          </View>
        </View>

        {/* Action Buttons — 54px circular dark-glass targets */}
        <View style={styles.actions}>
          <PressableScale haptic="light" style={styles.actionButton} onPress={() => onSchedule(item.id)}>
            <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
              <Ionicons name="calendar" size={24} color="#fff" />
            </GlassCard>
            <Text style={styles.actionLabel}>Schedule</Text>
          </PressableScale>
          <PressableScale haptic="light" style={styles.actionButton} onPress={() => onComplete(item.id)}>
            <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
            </GlassCard>
            <Text style={styles.actionLabel}>Done</Text>
          </PressableScale>
          <PressableScale haptic="light" style={styles.actionButton} onPress={() => onArchive(item.id)}>
            <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
              <Ionicons name="archive" size={24} color="#fff" />
            </GlassCard>
            <Text style={styles.actionLabel}>Archive</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // Regular content card
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[...classGradient(item.classification)]}
        style={styles.gradient}
      >
        <ScrollView 
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Title with Classification Badge */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.badge}>
              <Ionicons
                name={classConfig(item.classification).icon}
                size={14}
                color="#fff"
              />
              <Text style={styles.badgeText}>
                {(item.classification || 'other').toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Description */}
          {item.description && (
            <Text style={styles.description}>{item.description}</Text>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {item.tags.map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Place Info */}
          {item.place_name && (
            <View style={styles.placeInfo}>
              <Ionicons name="location" size={16} color="#fff" />
              <Text style={styles.placeText}>{item.place_name}</Text>
            </View>
          )}

          {/* Duration */}
          {item.duration && (
            <View style={styles.durationInfo}>
              <Ionicons name="time-outline" size={16} color="#fff" />
              <Text style={styles.durationText}>{item.duration} min</Text>
            </View>
          )}
        </ScrollView>

        {/* Action Buttons — 54px circular dark-glass targets */}
        <View style={styles.actions}>
          {/* Audio Playback / Read Button */}
          {item.audio_url ? (
            <PressableScale
              haptic="light"
              style={styles.actionButton}
              onPress={togglePlayback}
            >
              <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={24}
                  color="#fff"
                />
              </GlassCard>
              <Text style={styles.actionLabel}>
                {isPlaying ? 'Pause' : 'Read'}
              </Text>
            </PressableScale>
          ) : null}

          {/* Schedule */}
          <PressableScale
            haptic="light"
            style={styles.actionButton}
            onPress={() => onSchedule(item.id)}
          >
            <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
              <Ionicons name="calendar" size={24} color="#fff" />
            </GlassCard>
            <Text style={styles.actionLabel}>Schedule</Text>
          </PressableScale>

          {/* Mark as Completed */}
          <PressableScale
            haptic="light"
            style={styles.actionButton}
            onPress={() => onComplete(item.id)}
          >
            <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
            </GlassCard>
            <Text style={styles.actionLabel}>Done</Text>
          </PressableScale>

          {/* Archive */}
          <PressableScale
            haptic="light"
            style={styles.actionButton}
            onPress={() => onArchive(item.id)}
          >
            <GlassCard tint="dark" radius={27} style={styles.actionGlass}>
              <Ionicons name="archive" size={24} color="#fff" />
            </GlassCard>
            <Text style={styles.actionLabel}>Archive</Text>
          </PressableScale>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: width,
    height: height,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  reelOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Push title/badge BELOW the floating category-chip strip (which sits at
    // top:0 + safe-area inset + ~40px chips). Tuned so a 4-line title clears
    // the chips on every iPhone size.
    paddingTop: 120,
    paddingHorizontal: 20,
    zIndex: 1,
  },
  reelHeader: {
    alignItems: 'flex-start',
  },
  reelTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginTop: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  gradient: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    paddingTop: 80,
    paddingBottom: 120,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    flex: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  description: {
    fontSize: 18,
    color: '#fff',
    lineHeight: 28,
    marginBottom: 20,
    opacity: 0.95,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  tag: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  tagText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  placeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  placeText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 8,
  },
  durationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 8,
  },
  actions: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    marginBottom: 18,
  },
  // 54px circle behind each rail icon (GlassCard supplies blur + hairline).
  actionGlass: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
  reelAuthor: {
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  embedFallback: {
    backgroundColor: '#0b0b0f',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  embedFallbackTitle: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  embedFallbackSub: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  embedOpenBtn: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
  },
  embedOpenBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  embedLoading: {
    position: 'absolute',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  embedLoadingText: {
    color: 'rgba(255,255,255,0.8)',
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
  },
});

// Memoized: this is a full-screen FlatList row in the reel feed.
export default React.memo(StreamCard);

