/**
 * Add Content Screen
 * 
 * Main screen for adding new content to Silo. Supports multiple input methods:
 * - Paste or type URLs
 * - Take photos with camera
 * - Select images from gallery
 * - Create text notes
 * 
 * Features:
 * - AI analysis for links and images
 * - Manual classification editing
 * - Tag management
 * - Stack assignment
 * - Auto-schedule suggestions
 * 
 * Dependencies:
 * - expo-image-picker: Camera and gallery access
 * - lib/api: Backend AI analysis
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image as RNImage,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
// expo-image handles iOS PHAsset `ph://` URIs (screenshots from the photo
// library); RN's stock Image does not, so use this for any photo-library URI.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

/**
 * Defer the expo-clipboard load via require(). It's a native module added in
 * pass 7 — if the running binary was built before the pod landed, requiring it
 * at module-load time throws "Cannot find native module 'ExpoClipboard'".
 * Lazy-require + try/catch lets the rest of the screen work in that case (we
 * just don't surface the clipboard suggestion). Cleared on first native rebuild.
 */
function readClipboardString(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard');
    return Clipboard.getStringAsync();
  } catch {
    return Promise.resolve('');
  }
}
import TagPicker from '@/components/TagPicker';
import ChatBot from '@/components/ChatBot';
import { analyzeImage, extractLink, suggestScheduleTime } from '@/lib/api';
import OptionCard from '@/components/ui/OptionCard';
import PressableScale from '@/components/ui/PressableScale';
import GlassCard from '@/components/ui/GlassCard';
import Skeleton from '@/components/ui/Skeleton';
import { BRAND, GRADIENTS, HAIRLINE, INK, RADIUS } from '@/lib/theme';
import { addItem, updateItem, getItems } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';
import { Classification, CLASSIFICATIONS, SocialPlatform, Item } from '@/lib/types';
import { createItem } from '@/lib/items';
import { detectPlatform } from '@/lib/embed';
import { imageUriToBase64, getRecentScreenshots, Screenshot } from '@/lib/screenshots';
import { classConfig } from '@/lib/classification';
import * as Location from 'expo-location';

/** True iff `s` looks like a usable http(s) URL. */
function isUrlLike(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [inputType, setInputType] = useState<'url' | 'note' | 'image' | null>(null);
  const [url, setUrl] = useState('');
  const [noteText, setNoteText] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<Classification>('other');
  const [tags, setTags] = useState<string[]>([]);
  const [script, setScript] = useState<string>(''); // AI-generated script for audio
  const [placeName, setPlaceName] = useState<string>(''); // Place name from AI
  const [placeAddress, setPlaceAddress] = useState<string>(''); // Place address from AI
  const [loading, setLoading] = useState(false);
  // Social-extraction fields (URL captures)
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [author, setAuthor] = useState('');
  const [platform, setPlatform] = useState<SocialPlatform | undefined>(undefined);
  const [sourceUrl, setSourceUrl] = useState(''); // resolved/canonical URL to persist
  // Guards against a fast double-tap on "Save" creating duplicate items.
  const savingRef = useRef(false);

  // ---- Anticipatory-capture state (see "AT-A-GLANCE" zone below). ----
  /** What the user typed/pasted in the always-visible quick-capture field. */
  const [quickText, setQuickText] = useState('');
  /** Most-recent URL we surfaced from the clipboard — guards against re-nagging. */
  const handledClipboardRef = useRef<string | null>(null);
  /** Last clipboard URL we want to offer one-tap save for. null = nothing to show. */
  const [clipboardSuggestion, setClipboardSuggestion] = useState<string | null>(null);
  /** A small peek of the user's recent screenshots (4) for one-tap import. */
  const [recentShots, setRecentShots] = useState<Screenshot[]>([]);
  /** Last 3 saved items so the user can re-enter quickly without rummaging. */
  const [recentItems, setRecentItems] = useState<Item[]>([]);

  /**
   * On focus, light up the AT-A-GLANCE zone: clipboard sniff + recent shots +
   * recent saves. Everything is best-effort — denied permissions or empty
   * results simply hide that zone (we never bug the user with permission
   * prompts here; the user opted in elsewhere).
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const text = (await readClipboardString()).trim();
          if (alive && isUrlLike(text) && handledClipboardRef.current !== text) {
            setClipboardSuggestion(text);
          }
        } catch {
          /* clipboard unavailable on web/older OS; ignore */
        }
        try {
          const shots = await getRecentScreenshots(4);
          if (alive) setRecentShots(shots);
        } catch {
          if (alive) setRecentShots([]);
        }
        try {
          const items = await getItems();
          if (alive) {
            setRecentItems(
              items
                .filter((i) => !i.archived)
                .sort(
                  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )
                .slice(0, 3)
            );
          }
        } catch {
          /* storage error — leave the strip empty */
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  /** Quick-paste field submit — URL gets the extractor, anything else becomes a note. */
  function commitQuickText() {
    const value = quickText.trim();
    if (!value) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isUrlLike(value)) {
      setInputType('url');
      setUrl(value);
      setQuickText('');
      // Pass the value explicitly; setUrl above hasn't committed yet for this
      // tick, so reading state in handleAnalyzeUrl would see the empty string.
      handleAnalyzeUrl(value);
    } else {
      setInputType('note');
      setNoteText(value);
      setQuickText('');
    }
  }

  /** One-tap save on the clipboard suggestion. */
  function acceptClipboard() {
    if (!clipboardSuggestion) return;
    const value = clipboardSuggestion;
    handledClipboardRef.current = value;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputType('url');
    setUrl(value);
    setClipboardSuggestion(null);
    handleAnalyzeUrl(value);
  }

  /** Dismiss the clipboard suggestion without saving (don't nag again for the same URL). */
  function dismissClipboard() {
    if (!clipboardSuggestion) return;
    handledClipboardRef.current = clipboardSuggestion;
    Haptics.selectionAsync();
    setClipboardSuggestion(null);
  }

  /** Tap a recent screenshot thumbnail to import + analyze (reuses existing flow). */
  function importRecentShot(s: Screenshot) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImageUri(s.uri);
    setInputType('image');
    analyzeSelectedImage(s.uri);
  }

  /** Reset the entire capture form to its initial state (single source of truth). */
  function resetForm() {
    setInputType(null);
    setUrl('');
    setNoteText('');
    setImageUri(null);
    setTitle('');
    setDescription('');
    setClassification('other');
    setTags([]);
    setScript('');
    setPlaceName('');
    setPlaceAddress('');
    setThumbnailUri(null);
    setAuthor('');
    setPlatform(undefined);
    setSourceUrl('');
  }

  /**
   * Resolve + analyze a pasted URL. The universal extractor pulls oEmbed/OG
   * metadata (title / author / caption / thumbnail) plus a classification + tags
   * via the Gemini chain. On a private/dead link the Worker returns ok:false with
   * whatever it has; on a hard failure we still populate the raw URL — either
   * way the user can save (never lose a save).
   *
   * Accepts an explicit `urlArg` so one-tap entry points (clipboard suggestion,
   * quick-paste field) can pass the URL directly — bypassing the React-state
   * race where setUrl()'s value isn't yet visible to the closure.
   */
  async function handleAnalyzeUrl(urlArg?: string) {
    const candidate = (urlArg ?? url).trim();
    if (!candidate) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }

    const urlToAnalyze = candidate;
    try {
      new URL(urlToAnalyze);
    } catch {
      Alert.alert('Invalid URL', 'Please enter a valid URL (e.g., https://example.com)');
      return;
    }

    try {
      setLoading(true);
      const result = await extractLink(urlToAnalyze);

      setTitle(result.title || urlToAnalyze);
      setDescription(result.description || result.caption || '');
      setClassification(result.classification);
      setTags(result.tags || []);
      setThumbnailUri(result.thumbnailUrl || null);
      setAuthor(result.author || '');
      setPlatform(result.platform);
      setSourceUrl(result.sourceUrl || urlToAnalyze);
      setScript('');

      if (!result.ok) {
        // Rich metadata wasn't available (private / login-walled / dead). The form
        // is still populated with what we have so the user can edit and save.
        Alert.alert(
          'Limited preview',
          'This link is private or couldn’t be fully read, but you can still save it and edit the details below.'
        );
      }
    } catch (error) {
      console.error('Failed to extract URL:', error);
      // Hard failure (e.g. backend unreachable): fall back to a manually-editable
      // item from the raw URL so the save is never lost. The embed still works —
      // platform is detected from the URL itself.
      setTitle((prev) => prev || urlToAnalyze);
      setSourceUrl(urlToAnalyze);
      setPlatform(detectPlatform(urlToAnalyze));
      Alert.alert('Heads up', 'Couldn’t fetch details for this link, but you can still save it below.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle image selection from camera or gallery
   */
  async function handleSelectImage(source: 'camera' | 'gallery') {
    try {
      let result;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Camera access is needed to take photos');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission Required', 'Photo library access is needed');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets[0]) {
        setImageUri(result.assets[0].uri);
        setInputType('image');
        await analyzeSelectedImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Failed to select image:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  }

  /**
   * Analyze selected image with AI
   */
  async function analyzeSelectedImage(uri: string) {
    try {
      setLoading(true);
      const base64 = await imageUriToBase64(uri);
      const analysis = await analyzeImage(base64, 'image/jpeg');
      
      setTitle(analysis.title);
      setDescription(analysis.description || '');
      setClassification(analysis.classification);
      setTags(analysis.tags || []);
      setScript(analysis.script || ''); // Store script for audio generation
    } catch (error) {
      console.error('Failed to analyze image:', error);
      Alert.alert('Error', 'Failed to analyze image. Please enter details manually.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Save the item to storage
   */
  async function handleSave() {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }

    // In-flight guard: a fast double-tap must not create two items.
    if (savingRef.current) return;
    savingRef.current = true;

    try {
      setLoading(true);

      // Create item — createItem fills id/created_at/updated_at/status + defaults
      // and derives `location`/status from the fields below.
      const item = createItem({
        type: inputType === 'url' ? 'link' : inputType === 'image' ? 'screenshot' : 'note',
        classification,
        title: title.trim(),
        description: description.trim() || undefined,
        // Persist the resolved/canonical URL so embeds + "open" work reliably.
        url: inputType === 'url' ? (sourceUrl || url).trim() : undefined,
        // Thumbnail for URL captures; the picked photo for image captures.
        imageUri: (inputType === 'url' ? thumbnailUri : imageUri) || undefined,
        platform: inputType === 'url' ? platform : undefined,
        author: inputType === 'url' ? author.trim() || undefined : undefined,
        script: script.trim() || undefined, // Store AI-generated script
        tags,
        // Include location data if detected by AI or if classification is 'place'
        place_name: placeName.trim() || (classification === 'place' ? title.trim() : undefined),
        place_address: placeAddress.trim() || (classification === 'place' ? description.trim() : undefined),
      });

      // (Voice narration is a roadmap feature, default-off — see lib/config.ts.
      //  Apple's on-device Speech framework can fill it later for free, no paid TTS.)

      // Save item
      await addItem(item);

      // If it's a place with address but no coordinates, geocode it
      if ((item.place_name || item.place_address) && !item.place_latitude && !item.place_longitude) {
        try {
          const addressToGeocode = item.place_address || item.place_name || '';
          if (addressToGeocode) {
            const geocoded = await Location.geocodeAsync(addressToGeocode);
            if (geocoded && geocoded.length > 0) {
              const { latitude, longitude } = geocoded[0];
              // Update item with coordinates
              await updateItem(item.id, {
                place_latitude: latitude,
                place_longitude: longitude,
              });
            }
          }
        } catch (error) {
          console.warn('Failed to geocode address (continuing without coordinates):', error);
          // Don't show error - geocoding is optional
        }
      }

      // (No server-side embeddings or vector DB — the assistant retrieves
      //  on-device via keyword + tag matching, which is free.)

      // Suggest scheduling (like screenshots tab)
      try {
        const suggestion = await suggestScheduleTime({
          title: item.title,
          classification: item.classification || 'other',
          description: item.description,
          duration: item.duration,
        });
        
        // Show alert with suggestion
        Alert.alert(
          'Schedule this item?',
          `${suggestion.reason}\n\nDate: ${suggestion.date}\nTime: ${suggestion.time}`,
          [
            {
              text: 'No thanks',
              style: 'cancel',
              onPress: () => resetForm(),
            },
            {
              text: 'Add to Calendar',
              onPress: async () => {
                try {
                  await scheduleItemReview(item, suggestion.date, suggestion.time, item.duration || 15);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Success', 'Event added to calendar', [
                    { text: 'OK', onPress: () => resetForm() },
                  ]);
                } catch (error) {
                  console.error('Failed to schedule event:', error);
                  Alert.alert('Error', 'Failed to add event to calendar', [
                    { text: 'OK', onPress: () => resetForm() },
                  ]);
                }
              },
            },
          ]
        );
      } catch (error) {
        console.warn('Failed to suggest schedule (continuing without suggestion):', error);
        // Don't show error - schedule suggestion is optional
        Alert.alert('Success', 'Item added successfully', [
          { text: 'OK', onPress: () => resetForm() },
        ]);
      }
    } catch (error) {
      console.error('Failed to save item:', error);
      Alert.alert('Error', 'Failed to save item');
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Gradient Background */}
      <LinearGradient
        colors={[...GRADIENTS.page]}
        style={StyleSheet.absoluteFill}
      />
      <ChatBot onClose={() => {}} />
      <ScrollView 
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, 4), paddingBottom: insets.bottom + 120 }
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Input Type Selection — anticipatory capture */}
        {!inputType && (
          <View style={styles.typeSelection}>
            <Text className="text-[34px] font-extrabold tracking-tight text-ink-900">Capture</Text>
            <Text className="mb-4 mt-1.5 text-[15px] leading-[20px] text-ink-500">
              Paste, jot, or snap — Silo files it.
            </Text>

            {/* Always-visible quick-paste field. Acts as Save Link on URLs,
                New Note on free text. */}
            <View style={styles.quickField}>
              <Ionicons name="sparkles" size={18} color={INK[400]} />
              <TextInput
                style={styles.quickInput}
                placeholder="Paste a link or type a thought"
                placeholderTextColor={INK[400]}
                value={quickText}
                onChangeText={setQuickText}
                onSubmitEditing={commitQuickText}
                returnKeyType="send"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {quickText.trim().length > 0 && (
                <PressableScale haptic="light" onPress={commitQuickText} accessibilityLabel="Save">
                  <LinearGradient
                    colors={[...GRADIENTS.brand]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.quickSendBtn}
                  >
                    <Ionicons
                      name={isUrlLike(quickText) ? 'arrow-forward' : 'pencil'}
                      size={18}
                      color="#fff"
                    />
                  </LinearGradient>
                </PressableScale>
              )}
            </View>

            {/* Clipboard suggestion — only renders when we have a fresh URL. */}
            {clipboardSuggestion && (
              <GlassCard
                tint="light"
                intensity={45}
                radius={RADIUS.lg}
                style={styles.clipCard}
              >
                <View style={styles.clipInner}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.clipEyebrow}>FROM YOUR CLIPBOARD</Text>
                    <Text style={styles.clipUrl} numberOfLines={1}>
                      {clipboardSuggestion}
                    </Text>
                  </View>
                  <PressableScale
                    haptic="selection"
                    onPress={dismissClipboard}
                    style={styles.clipDismiss}
                    accessibilityLabel="Dismiss"
                  >
                    <Ionicons name="close" size={18} color={INK[500]} />
                  </PressableScale>
                  <PressableScale
                    haptic="light"
                    onPress={acceptClipboard}
                    accessibilityLabel="Save link"
                  >
                    <LinearGradient
                      colors={[...GRADIENTS.brand]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.clipSaveBtn}
                    >
                      <Text style={styles.clipSaveText}>Save</Text>
                    </LinearGradient>
                  </PressableScale>
                </View>
              </GlassCard>
            )}

            {/* Recent screenshots peek — one tap to import + analyze. */}
            {recentShots.length > 0 && (
              <View style={styles.peekSection}>
                <Text style={styles.peekTitle}>From your photos</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.peekStrip}
                >
                  {recentShots.map((s) => (
                    <PressableScale
                      key={s.id}
                      haptic="light"
                      onPress={() => importRecentShot(s)}
                      style={styles.peekTile}
                    >
                      <Image source={{ uri: s.uri }} style={styles.peekImg} />
                    </PressableScale>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Last 3 saves — re-enter recent items without rummaging. */}
            {recentItems.length > 0 && (
              <View style={styles.peekSection}>
                <Text style={styles.peekTitle}>You just saved</Text>
                {recentItems.map((item) => {
                  const cfg = classConfig(item.classification);
                  return (
                    <PressableScale
                      key={item.id}
                      haptic="light"
                      onPress={() => router.push(`/item/${item.id}`)}
                      style={styles.recentRow}
                    >
                      <LinearGradient
                        colors={[cfg.from, cfg.to]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.recentIcon}
                      >
                        <Ionicons name={cfg.icon} size={16} color="#fff" />
                      </LinearGradient>
                      <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
                        <Text style={styles.recentTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.recentSub} numberOfLines={1}>
                          {item.classification.toUpperCase()}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={INK[300]} />
                    </PressableScale>
                  );
                })}
              </View>
            )}

            {/* The original 4 OptionCards — demoted to a compact grid. */}
            <Text style={styles.orTitle}>Or capture something new</Text>
            <View style={styles.optionGrid}>
              <View style={styles.optionGridCell}>
                <OptionCard
                  index={0}
                  icon="link"
                  colors={['#6366f1', '#8b5cf6']}
                  title="Link"
                  subtitle="Paste a URL"
                  onPress={() => setInputType('url')}
                />
              </View>
              <View style={styles.optionGridCell}>
                <OptionCard
                  index={1}
                  icon="camera"
                  colors={['#ec4899', '#f472b6']}
                  title="Camera"
                  subtitle="Snap a photo"
                  onPress={() => handleSelectImage('camera')}
                />
              </View>
              <View style={styles.optionGridCell}>
                <OptionCard
                  index={2}
                  icon="images"
                  colors={['#06b6d4', '#22d3ee']}
                  title="Gallery"
                  subtitle="From photos"
                  onPress={() => handleSelectImage('gallery')}
                />
              </View>
              <View style={styles.optionGridCell}>
                <OptionCard
                  index={3}
                  icon="create"
                  colors={['#10b981', '#34d399']}
                  title="Note"
                  subtitle="Quick thought"
                  onPress={() => setInputType('note')}
                />
              </View>
            </View>
          </View>
        )}

        {/* URL Input */}
        {inputType === 'url' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <View style={styles.urlHeader}>
                <PressableScale haptic="light" style={styles.backButton} onPress={() => resetForm()}>
                  <Ionicons name="arrow-back" size={24} color={INK[700]} />
                </PressableScale>
                <Text style={styles.label}>URL</Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="https://example.com"
                placeholderTextColor={INK[400]}
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <PressableScale
                haptic="light"
                onPress={() => handleAnalyzeUrl()}
                disabled={loading}
                style={loading && styles.buttonDisabled}
              >
                <LinearGradient
                  colors={[...GRADIENTS.brand]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.analyzeButton}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.analyzeButtonText}>Analyze with AI</Text>
                  )}
                </LinearGradient>
              </PressableScale>
            </View>
          </View>
        )}

        {/* Note Input */}
        {inputType === 'note' && (
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Note</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Write your note..."
                placeholderTextColor={INK[400]}
                value={noteText}
                onChangeText={text => {
                  setNoteText(text);
                  setDescription(text);
                }}
                multiline
                numberOfLines={5}
              />
            </View>
          </View>
        )}

        {/* Common Fields (shown after analysis or for manual entry) */}
        {(title || inputType === 'note') && (
          <View style={styles.form}>
            {inputType === 'url' && (thumbnailUri || author || platform) ? (
              <View style={styles.previewCard}>
                {thumbnailUri ? (
                  <RNImage source={{ uri: thumbnailUri }} style={styles.previewThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.previewThumb, styles.previewThumbFallback]}>
                    <Ionicons name="link" size={22} color="#6366f1" />
                  </View>
                )}
                <View style={styles.previewMeta}>
                  {platform ? <Text style={styles.previewPlatform}>{platform.toUpperCase()}</Text> : null}
                  {author ? (
                    <Text style={styles.previewAuthor} numberOfLines={1}>
                      {author}
                    </Text>
                  ) : null}
                  {title ? (
                    <Text style={styles.previewTitle} numberOfLines={2}>
                      {title}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Item title"
                placeholderTextColor={INK[400]}
                value={title}
                onChangeText={setTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Add a description..."
                placeholderTextColor={INK[400]}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Classification</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {CLASSIFICATIONS.map(type => (
                  <PressableScale
                    key={type}
                    haptic="selection"
                    style={[
                      styles.classificationChip,
                      classification === type && styles.classificationChipActive,
                    ]}
                    onPress={() => setClassification(type as Classification)}
                  >
                    <Text
                      style={[
                        styles.classificationChipText,
                        classification === type && styles.classificationChipTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Tags</Text>
              <TagPicker selectedTags={tags} onTagsChange={setTags} />
            </View>

            <PressableScale
              haptic="light"
              onPress={handleSave}
              disabled={loading}
              style={[styles.saveButtonWrap, loading && styles.buttonDisabled]}
            >
              <LinearGradient
                colors={[...GRADIENTS.brand]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.saveButton}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Item</Text>
                )}
              </LinearGradient>
            </PressableScale>

            <PressableScale
              haptic="light"
              style={styles.cancelButton}
              onPress={() => setInputType(null)}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </PressableScale>
          </View>
        )}

        {loading && !title && (
          <View style={styles.loadingContainer}>
            {/* Preview-shaped skeleton so the analysis wait feels like content arriving. */}
            <Skeleton height={180} radius={RADIUS.lg} />
            <Skeleton width="72%" height={18} style={styles.loadingLine} />
            <Skeleton width="48%" height={14} style={styles.loadingLine} />
            <Text style={styles.loadingText}>Analyzing with AI...</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 0,
  },
  typeSelection: {
    gap: 12,
  },
  /* Anticipatory-capture zone styles */
  quickField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowColor: INK[900],
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  quickInput: { flex: 1, fontSize: 15, color: INK[900], paddingVertical: 10 },
  quickSendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipCard: {
    marginTop: 2,
  },
  clipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  clipEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: INK[400],
  },
  clipUrl: { fontSize: 13, color: INK[800], marginTop: 4 },
  clipDismiss: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  clipSaveText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  peekSection: { gap: 8, marginTop: 6 },
  peekTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: INK[400],
    marginLeft: 2,
  },
  peekStrip: { gap: 10, paddingRight: 16 },
  peekTile: {
    width: 80,
    height: 110,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: INK[100],
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  peekImg: { width: '100%', height: '100%' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 10,
  },
  recentIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: { fontSize: 14, fontWeight: '600', color: INK[900] },
  recentSub: { fontSize: 10, fontWeight: '700', color: INK[400], marginTop: 2, letterSpacing: 0.6 },
  orTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: INK[400],
    letterSpacing: 0.6,
    marginTop: 14,
    marginLeft: 2,
  },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionGridCell: { width: '48%' },
  form: {
    gap: 20,
    backgroundColor: '#fff',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  inputGroup: {
    gap: 8,
  },
  urlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  backButton: {
    padding: 4,
    marginLeft: -4,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: INK[700],
  },
  input: {
    backgroundColor: INK[50],
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
    fontSize: 16,
    color: INK[900],
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  analyzeButton: {
    borderRadius: RADIUS.pill,
    padding: 16,
    alignItems: 'center',
  },
  analyzeButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  classificationChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: INK[900],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  classificationChipActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
  },
  classificationChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: INK[500],
    textTransform: 'capitalize',
  },
  classificationChipTextActive: {
    color: '#fff',
  },
  // Layout wrapper around the gradient save pill (margin lives here so the
  // press-scale transform doesn't shift it). The form is a column, so unlike
  // reel.tsx's row variant this wrapper must NOT take flex: 1 — in an
  // auto-height parent that would collapse the button to zero height.
  saveButtonWrap: {
    marginTop: 8,
  },
  saveButton: {
    borderRadius: RADIUS.pill,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND[600],
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  // Skeleton text line under the preview-shaped block.
  loadingLine: {
    marginTop: 12,
  },
  loadingText: {
    fontSize: 16,
    color: INK[500],
    marginTop: 16,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 14,
    padding: 12,
  },
  previewThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
  },
  previewThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: {
    flex: 1,
    gap: 2,
  },
  previewPlatform: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6366f1',
    letterSpacing: 0.5,
  },
  previewAuthor: {
    fontSize: 14,
    fontWeight: '700',
    color: INK[700],
  },
  previewTitle: {
    fontSize: 13,
    color: INK[500],
  },
});

