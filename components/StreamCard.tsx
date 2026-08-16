/**
 * StreamCard Component
 *
 * A TikTok-style full-screen card for displaying content items in the reel feed.
 * Renders inline social embeds (via lib/embed) or a gradient content card, with
 * audio playback and interactive Schedule / Done / Archive controls.
 *
 * Two things make this screen behave:
 *
 * 1. **Only the active card mounts a WebView.** A WKWebView is expensive and a
 *    playing one keeps playing when it scrolls away. Inactive cards render the
 *    poster image instead, so the feed holds exactly one live player no matter
 *    how far you scroll.
 * 2. **The embed gets its natural aspect box, not the whole screen.** A 16:9
 *    player stretched to a portrait card scales its own chrome up until the
 *    title bar collides with the status bar. Here it sits in a centred box over
 *    a blurred poster fill, with scrims top and bottom so Silo's overlay stays
 *    legible over arbitrary media.
 *
 * Props:
 * - item: Content item to display
 * - active: True when this card is the one on screen (drives WebView mount)
 * - onArchive / onSchedule / onComplete: action callbacks
 *
 * Dependencies:
 * - expo-av: Audio playback
 * - expo-linear-gradient: Background gradients / scrims
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Audio } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Glass, { GlassGroup } from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import { GRADIENTS, RADIUS, SHADOW, SPACE, TYPE } from '@/lib/theme';
import { Item } from '@/lib/types';
import { getEmbed } from '@/lib/embed';
import { classConfig, classGradient } from '@/lib/classification';

/** Height of the floating category chip strip the overlay must clear. */
const CHIP_STRIP = 52;

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
  /** True when this card is the visible page — only then does a WebView mount. */
  active?: boolean;
  onArchive: (itemId: string) => void;
  onSchedule: (itemId: string) => void;
  onComplete: (itemId: string) => void;
}

function StreamCard({ item, active = false, onArchive, onSchedule, onComplete }: StreamCardProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [webViewError, setWebViewError] = useState(false);
  const [webViewLoading, setWebViewLoading] = useState(true);
  // Poster-first players (YouTube/Vimeo) only mount their WebView once tapped.
  const [playRequested, setPlayRequested] = useState(false);
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
   * Scrolling away tears the player down: narration pauses and a poster-first
   * video reverts to its poster, so nothing keeps playing off-screen.
   */
  useEffect(() => {
    if (active) return;
    if (isPlaying) {
      soundRef.current?.pauseAsync().catch(() => {});
      setIsPlaying(false);
    }
    setPlayRequested(false);
  }, [active, isPlaying]);

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

  /** The action rail — identical for embed and gradient cards. */
  function renderActions(extra?: React.ReactNode) {
    return (
      // A cluster of sibling controls, so it's grouped: the buttons lens as one
      // shape rather than three unrelated blurs. The merge distance stays tight
      // because each button's label sits in the gap below it — widen it and the
      // glass smears across the text.
      <GlassGroup spacing={SPACE.md} style={[styles.actions, { bottom: insets.bottom + 92 }]}>
        {extra}
        <RailButton icon="calendar" label="Schedule" onPress={() => onSchedule(item.id)} />
        <RailButton icon="checkmark-circle" label="Done" onPress={() => onComplete(item.id)} />
        <RailButton icon="archive" label="Archive" onPress={() => onArchive(item.id)} />
      </GlassGroup>
    );
  }

  // ---------------------------------------------------------------------------
  // Inline embed for saved social links — render the platform's own player.
  // ---------------------------------------------------------------------------
  if (embed.kind !== 'none') {
    const label = (item.platform || 'link').toUpperCase();
    const openSource = () => {
      const u = item.url || '';
      if (/^https?:\/\//i.test(u)) Linking.openURL(u).catch(() => {});
    };

    // Give the embed its natural box instead of stretching it edge-to-edge.
    const embedBox =
      embed.aspect === 'wide'
        ? { width, height: Math.round(width * (9 / 16)) }
        : embed.aspect === 'card'
          ? { width: width - SPACE.base * 2, height: Math.round(height * 0.62) }
          : { width, height };

    // Poster-first platforms draw our thumbnail until the user taps play, so an
    // un-played card costs no WKWebView and shows no platform chrome.
    const posterFirst = embed.kind === 'uri' && embed.posterFirst === true;
    const showPlayer = active && (!posterFirst || playRequested);
    const playerUri =
      embed.kind === 'uri' ? (playRequested && embed.autoplayUri) || embed.uri : undefined;

    return (
      <View style={[styles.container, { width, height }]}>
        {/* Ambient backdrop: the poster, blurred and dimmed, fills the card so a
            16:9 player never sits on a dead black field. */}
        {item.imageUri ? (
          <Image
            source={{ uri: item.imageUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={28}
          />
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.backdropTint]} />

        {/* Centre the player in the space ABOVE the meta block, not in the raw
            card — otherwise the media reads as sunk toward the bottom half. */}
        <View
          style={[
            styles.embedCentre,
            embed.aspect === 'tall'
              ? null
              : { paddingBottom: insets.bottom + 150, paddingTop: insets.top + CHIP_STRIP },
          ]}
          pointerEvents="box-none"
        >
          {webViewError ? (
            // Fallback UI if the embed can't load (private / region-locked / deleted).
            <View style={[embedBox, styles.embedFallback]}>
              <Ionicons name={platformIcon(item.platform)} size={56} color="#fff" />
              <Text style={styles.embedFallbackTitle}>{item.title || 'Open this post'}</Text>
              <Text style={styles.embedFallbackSub}>We couldn’t play this one here.</Text>
              <PressableScale haptic="light" onPress={openSource} accessibilityRole="button">
                <LinearGradient
                  colors={GRADIENTS.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.embedOpenBtn}
                >
                  <Text style={styles.embedOpenBtnText}>Open in {item.platform || 'browser'}</Text>
                </LinearGradient>
              </PressableScale>
            </View>
          ) : showPlayer ? (
            // Only the on-screen card mounts a player. Everything else shows the
            // poster, so the feed never holds more than one live WKWebView.
            <View style={[embedBox, styles.embedClip]}>
              <WebView
                source={
                  embed.kind === 'uri'
                    ? { uri: playerUri as string, headers: embed.headers }
                    : { html: embed.html, baseUrl: embed.baseUrl }
                }
                style={styles.webview}
                // The embed is a fixed player, not a scrolling page. Internal
                // scrolling must stay OFF or the WebView swallows vertical pans
                // and the feed's swipe-to-next-card gesture stops working.
                scrollEnabled={embed.aspect === 'card'}
                allowsFullscreenVideo
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                originWhitelist={['https://*', 'about:*', 'data:*']}
                onShouldStartLoadWithRequest={(req) => {
                  const url = req.url;
                  // Allow the embed's own initial load and any non-http(s) scheme
                  // (about:/data:/blob:/intent: the player itself uses).
                  if (!/^https?:\/\//i.test(url)) return true;
                  if (embed.kind === 'uri' && (url === embed.uri || url === embed.autoplayUri))
                    return true;
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
              />
            </View>
          ) : (
            // Poster. On a poster-first platform this IS the player until
            // tapped; on others it's the placeholder for an off-screen card.
            <PressableScale
              haptic="medium"
              scaleTo={0.985}
              disabled={!posterFirst || !active}
              onPress={() => setPlayRequested(true)}
              accessibilityRole="button"
              accessibilityLabel={posterFirst ? `Play ${item.title || 'video'}` : undefined}
              style={[embedBox, styles.embedClip, styles.posterIdle]}
            >
              {item.imageUri ? (
                <Image
                  source={{ uri: item.imageUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name={platformIcon(item.platform)} size={56} color="rgba(255,255,255,0.5)" />
              )}
              {posterFirst && (
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={30} color="#fff" style={styles.playGlyph} />
                </View>
              )}
            </PressableScale>
          )}

          {/* Honest loading state — poster + spinner, sized to the embed box so
              it can't be mistaken for a blank card. */}
          {showPlayer && webViewLoading && !webViewError && (
            <View style={[embedBox, styles.embedClip, styles.embedLoading]} pointerEvents="none">
              {item.imageUri ? (
                <Image
                  source={{ uri: item.imageUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  blurRadius={2}
                />
              ) : null}
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.embedLoadingText}>Loading…</Text>
            </View>
          )}
        </View>

        {/* Scrims: keep the status bar and the overlay legible over any media. */}
        <LinearGradient
          colors={[...GRADIENTS.topScrim]}
          style={[styles.topScrim, { height: insets.top + CHIP_STRIP + SPACE.lg }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[...GRADIENTS.mediaScrim]}
          style={[styles.bottomScrim, { height: insets.bottom + 300 }]}
          pointerEvents="none"
        />

        {/* Meta sits bottom-left, clear of the action rail — the layout every
            vertical feed uses, and it keeps the middle of the card for media. */}
        <View
          style={[styles.reelMeta, { bottom: insets.bottom + 88 }]}
          pointerEvents="box-none"
        >
          <View style={styles.badge}>
            <Ionicons name={platformIcon(item.platform)} size={14} color="#fff" />
            <Text style={styles.badgeText}>{label}</Text>
          </View>
          {item.title ? (
            <Text style={styles.reelTitle} numberOfLines={3}>
              {item.title}
            </Text>
          ) : null}
          {item.author ? <Text style={styles.reelAuthor}>{item.author}</Text> : null}
        </View>

        {renderActions()}
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Regular content card (no embeddable link) — classification gradient.
  // ---------------------------------------------------------------------------
  return (
    <View style={[styles.container, { width, height }]}>
      <LinearGradient colors={[...classGradient(item.classification)]} style={styles.gradient}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + CHIP_STRIP + SPACE.lg, paddingBottom: insets.bottom + 200 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Title with Classification Badge */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.badge}>
              <Ionicons name={classConfig(item.classification).icon} size={14} color="#fff" />
              <Text style={styles.badgeText}>{(item.classification || 'other').toUpperCase()}</Text>
            </View>
          </View>

          {/* Description */}
          {item.description && <Text style={styles.description}>{item.description}</Text>}

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
            <View style={styles.metaRow}>
              <Ionicons name="location" size={16} color="#fff" />
              <Text style={styles.metaText}>{item.place_name}</Text>
            </View>
          )}

          {/* Duration */}
          {item.duration && (
            <View style={styles.metaRow}>
              <Ionicons name="time-outline" size={16} color="#fff" />
              <Text style={styles.metaText}>{item.duration} min</Text>
            </View>
          )}
        </ScrollView>

        {renderActions(
          item.audio_url ? (
            <RailButton
              icon={isPlaying ? 'pause' : 'play'}
              label={isPlaying ? 'Pause' : 'Read'}
              onPress={togglePlayback}
            />
          ) : null
        )}
      </LinearGradient>
    </View>
  );
}

/** One 54pt circular dark-glass control on the right-hand action rail. */
function RailButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="light"
      style={styles.actionButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Pinned dark: the rail is always over media, whatever the appearance.
          `clear` is the thin material, so the frame behind the rail stays
          readable; `interactive` gives the button its own specular press. */}
      <Glass tint="dark" variant="clear" interactive radius={27} style={styles.actionGlass}>
        <Ionicons name={icon} size={24} color="#fff" />
      </Glass>
      <Text style={styles.actionLabel}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#08080c',
  },
  backdropTint: {
    backgroundColor: 'rgba(6, 6, 10, 0.45)',
  },
  embedCentre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  embedClip: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  posterIdle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  topScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  reelMeta: {
    position: 'absolute',
    left: SPACE.lg,
    // Clear of the 54pt action rail plus its right margin.
    right: 92,
    alignItems: 'flex-start',
    zIndex: 1,
  },
  reelTitle: {
    ...TYPE.title3,
    color: '#fff',
    marginTop: SPACE.sm,
    textShadowColor: 'rgba(0, 0, 0, 0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  playBadge: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(10, 10, 14, 0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.floating,
  },
  playGlyph: {
    // Optical centring: a triangle's visual centre sits left of its bounding box.
    marginLeft: 4,
  },
  reelAuthor: {
    ...TYPE.subhead,
    color: 'rgba(255,255,255,0.85)',
    marginTop: SPACE.xs,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  gradient: {
    flex: 1,
    paddingHorizontal: SPACE.lg,
    overflow: 'hidden',
  },
  content: {
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACE.md,
    marginBottom: SPACE.base,
  },
  title: {
    ...TYPE.display,
    color: '#fff',
    flex: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.38)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    gap: SPACE.xs,
  },
  badgeText: {
    ...TYPE.overline,
    color: '#fff',
  },
  description: {
    ...TYPE.body,
    fontSize: 18,
    lineHeight: 27,
    color: '#fff',
    marginBottom: SPACE.lg,
    opacity: 0.95,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginBottom: SPACE.base,
  },
  tag: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: SPACE.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  tagText: {
    ...TYPE.subhead,
    color: '#fff',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    marginBottom: SPACE.sm,
  },
  metaText: {
    ...TYPE.callout,
    color: '#fff',
  },
  actions: {
    position: 'absolute',
    right: SPACE.base,
    alignItems: 'center',
  },
  actionButton: {
    alignItems: 'center',
    marginBottom: SPACE.base,
  },
  // 54px circle behind each rail icon (Glass supplies the material + hairline).
  // No shadow: the surface clips to its own rounded bounds, so a shadow set here
  // never escaped them — the rim and the bottom scrim do the separating.
  actionGlass: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    ...TYPE.caption,
    color: '#fff',
    marginTop: 5,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  embedFallback: {
    backgroundColor: 'rgba(11, 11, 15, 0.92)',
    borderRadius: RADIUS.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACE.xxl,
  },
  embedFallbackTitle: {
    ...TYPE.headline,
    color: '#fff',
    marginTop: SPACE.base,
    textAlign: 'center',
  },
  embedFallbackSub: {
    ...TYPE.subhead,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.65)',
    marginTop: SPACE.sm,
    marginBottom: SPACE.lg,
    textAlign: 'center',
  },
  embedOpenBtn: {
    paddingHorizontal: SPACE.xl,
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.pill,
  },
  embedOpenBtnText: {
    ...TYPE.subhead,
    fontWeight: '700',
    color: '#fff',
  },
  embedLoading: {
    position: 'absolute',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  embedLoadingText: {
    ...TYPE.footnote,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    marginTop: SPACE.sm,
  },
});

// Memoized: this is a full-screen FlatList row in the reel feed.
export default React.memo(StreamCard);
