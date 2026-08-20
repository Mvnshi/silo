/**
 * Add Content Screen — the capture home.
 *
 * Capture paths: quick-paste field, clipboard hand-off, recent screenshots,
 * camera, gallery, and free-text notes. Links and images run through the AI
 * extractor; everything remains editable (and saveable) if that fails.
 *
 * Capture principles this screen holds to:
 * - **Never lose a save.** Every failure path still leaves a titled, saveable
 *   item — analysis is an enhancement, not a gate.
 * - **Never block on the network for confirmation.** The save is confirmed the
 *   moment storage accepts it; geocoding and schedule suggestions run after.
 * - **Never spend a permission/paste prompt the user didn't ask for.** The
 *   clipboard is only *sniffed* (hasUrlAsync, no banner) and photo access is
 *   only *checked* until the user taps the matching affordance.
 * - **Errors are inline notices, not modals** — a modal hides the very fields
 *   it is telling you to fix.
 *
 * Dependencies:
 * - expo-image-picker: camera and gallery access
 * - expo-media-library: recent-screenshot peek (opt-in)
 * - lib/api: backend AI analysis (cancellable, 20s budget)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
// expo-image handles iOS PHAsset `ph://` URIs (screenshots from the photo
// library); RN's stock Image does not, so use this for any photo-library URI.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';

/**
 * Defer the expo-clipboard load via require(). It's a native module added in
 * pass 7 — if the running binary was built before the pod landed, requiring it
 * at module-load time throws "Cannot find native module 'ExpoClipboard'".
 * Lazy-require + try/catch lets the rest of the screen work in that case (we
 * just don't surface the clipboard suggestion). Cleared on first native rebuild.
 */
function clipboardModule(): typeof import('expo-clipboard') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-clipboard');
  } catch {
    return null;
  }
}

/**
 * Pasteboard *sniff*: iOS answers this from the pasteboard's pattern metadata,
 * so it does NOT trigger the "Silo pasted from Safari" banner. Reading the
 * actual string does — which is why that is deferred until the user taps.
 */
async function clipboardHasUrl(): Promise<boolean> {
  try {
    return (await clipboardModule()?.hasUrlAsync()) ?? false;
  } catch {
    return false;
  }
}

async function readClipboardString(): Promise<string> {
  try {
    return (await clipboardModule()?.getStringAsync()) ?? '';
  } catch {
    return '';
  }
}
import TagPicker from '@/components/TagPicker';
import ChatBot from '@/components/ChatBot';
import { analyzeImage, extractLink, isPremiumRequired, suggestScheduleTime } from '@/lib/api';
import { describeRemaining, shouldWarn } from '@/lib/allowance';
import OptionCard from '@/components/ui/OptionCard';
import PressableScale from '@/components/ui/PressableScale';
import Glass from '@/components/ui/Glass';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import {
  ACCENT,
  BRAND,
  GRADIENTS,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  TEXT,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';
import { enterList, LAYOUT, staggerDelay, usePrefersReducedMotion } from '@/lib/motion';
import { celebrationHaptic } from '@/lib/haptics';
import { addItem, addStack, updateItem, getItems, getStacks } from '@/lib/storage';
import { scheduleItemReview } from '@/lib/scheduler';
import { Classification, CLASSIFICATIONS, SocialPlatform, Item, Stack } from '@/lib/types';
import { createItem } from '@/lib/items';
import { detectPlatform } from '@/lib/embed';
import { imageUriToBase64, getRecentScreenshots, Screenshot } from '@/lib/screenshots';
import { classConfig, classGradient } from '@/lib/classification';
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

/** Photo-library access as this screen reasons about it (never an enum compare). */
type PhotoAccess = 'unknown' | 'undetermined' | 'granted' | 'denied';

/**
 * An inline, dismissable-by-fixing error. Capture never uses `Alert` for these:
 * a modal covers the exact field it is asking the user to edit.
 */
interface Notice {
  message: string;
  tone?: 'info' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
}

function InlineNotice({ message, tone = 'info', actionLabel, onAction }: Notice) {
  const c = useThemeColors();
  const danger = tone === 'danger';
  const body = (
    <View style={[styles.notice, { backgroundColor: danger ? c.dangerSoft : c.brandSoft }]}>
      <Ionicons name="alert-circle" size={16} color={danger ? c.danger : ACCENT[500]} />
      <Text style={[styles.noticeText, { color: c.textSecondary }]}>{message}</Text>
      {actionLabel ? (
        <Text style={[styles.noticeAction, { color: c.textBrand }]}>{actionLabel}</Text>
      ) : null}
    </View>
  );
  if (!onAction) return body;
  return (
    <PressableScale
      haptic="light"
      onPress={onAction}
      accessibilityLabel={actionLabel ? `${message} ${actionLabel}` : message}
    >
      {body}
    </PressableScale>
  );
}

/**
 * Staggered entrance for a block that holds glass.
 *
 * `enterList` is a FADE, and an opacity animation on a glass surface — or on
 * ANY ancestor of one — stops the material rendering rather than fading it: the
 * clipboard offer would have arrived as an empty hole. Same stagger, on a
 * transform instead. Blocks with no glass in them keep `enterList`.
 */
function RiseIn({
  index,
  style,
  children,
}: {
  index: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const offset = useSharedValue<number>(SPACE.md);

  useEffect(() => {
    offset.value = reduced ? 0 : withDelay(staggerDelay(index), withSpring(0, SPRING.enter));
  }, [index, offset, reduced]);

  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return <Animated.View style={[style, rise]}>{children}</Animated.View>;
}

/**
 * The tint every glass surface on this screen hands to `Glass`.
 *
 * Bare material borrows its colour from the page wash beneath it, which on light
 * is a pale violet that body text drifts under. `2e` ≈ 18% of the palette's own
 * card colour: enough to hold the text, far too little to read as a fill. (Both
 * palettes state `card` as a 6-digit hex, so the alpha suffix is all this needs.)
 */
function cardTint(c: ThemeColors): string {
  return `${c.card}2e`;
}

/**
 * The capture form's surface — the panel behind the URL / photo / note steps and
 * the shared fields below them.
 *
 * It floats on the page gradient with nothing between it and the wash, which is
 * the one place a material actually has something to lens. Two things it can't
 * do, both handled here:
 *  - cast a shadow: glass clips to its own bounds, so the lift that separated the
 *    opaque card lives on the wrapper;
 *  - hold a second material: every field inside it stays opaque (a caret over
 *    moving glass is unreadable, and stacked materials read as mud).
 */
function FormCard({ children }: { children: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={styles.formLift}>
      <Glass radius={RADIUS.xl} tintColor={cardTint(c)} style={styles.form}>
        {children}
      </Glass>
    </View>
  );
}

/**
 * OptionCard derives its entrance delay as `index * 70`. Offsetting the index by
 * 160/70 pushes the whole (demoted) capture grid to ~160ms, so the primary
 * zones — clipboard, photos, recent saves — land first.
 */
const OPTION_ENTER_OFFSET = 160 / 70;

/**
 * The appearance-dependent half of `styles`. A plain object rather than
 * StyleSheet.create so it can be memoised per palette — StyleSheet.create here
 * would register a fresh sheet on every render.
 *
 * Every surface that carries a border already gets the palette hairline, which
 * is what separates cards from the page on dark (where SHADOW.card is invisible).
 */
function makeDynamicStyles(c: ThemeColors) {
  return {
    pageTitle: { color: c.text },
    pageSubtitle: { color: c.textSecondary },
    quickField: { backgroundColor: c.card, borderColor: c.hairline },
    quickInput: { color: c.text },
    clipEyebrow: { color: c.textTertiary },
    clipUrl: { color: c.text },
    peekTitle: { color: c.textTertiary },
    peekTile: { backgroundColor: c.field, borderColor: c.hairline },
    permIcon: { backgroundColor: c.brandSoft },
    permTitle: { color: c.text },
    permSub: { color: c.textTertiary },
    recentRow: { backgroundColor: c.card, borderColor: c.hairline },
    recentTitle: { color: c.text },
    orTitle: { color: c.textTertiary },
    label: { color: c.textSecondary },
    // `sunken` keeps the field a step recessed from the card in both
    // appearances; the hairline is what actually draws the edge.
    input: { backgroundColor: c.sunken, borderColor: c.hairline, color: c.text },
    fieldHelp: { color: c.danger },
    capturedImage: { backgroundColor: c.field },
    /**
     * Unselected chip. Light keeps its 90%-white wash on the white form card —
     * carried over to dark that would be an invisible smear, so dark falls back
     * to the field role.
     */
    chip: {
      backgroundColor: c.appearance === 'dark' ? c.field : 'rgba(255, 255, 255, 0.9)',
      borderColor: c.hairline,
    },
    chipText: { color: c.textTertiary },
    stackChipNew: { backgroundColor: c.brandSoft, borderColor: c.brandBorder },
    stackChipNewText: { color: c.textBrand },
    cancelButtonText: { color: c.textBrand },
    loadingText: { color: c.textTertiary },
    previewCard: { backgroundColor: c.raised, borderColor: c.hairline },
    previewThumb: { backgroundColor: c.field },
    previewPlatform: { color: c.textBrand },
    previewAuthor: { color: c.text },
    previewTitle: { color: c.textSecondary },
    /** What every glass surface on this screen is tinted with — see `cardTint`. */
    glassTint: cardTint(c),
  };
}

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const c = useThemeColors();
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);
  const reduced = usePrefersReducedMotion();
  const [inputType, setInputType] = useState<'url' | 'note' | 'image' | null>(null);
  const [url, setUrl] = useState('');
  const [noteText, setNoteText] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<Classification>('other');
  const [tags, setTags] = useState<string[]>([]);
  const [stackId, setStackId] = useState<string | undefined>(undefined);
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
  /** Aborts the in-flight extraction (Cancel button / leaving the form). */
  const analyzeAbortRef = useRef<AbortController | null>(null);

  // ---- Inline notices. One state per render site, so a message can never
  //      appear somewhere the user can't act on it. ----
  const [homeNotice, setHomeNotice] = useState<Notice | null>(null);
  const [urlNotice, setUrlNotice] = useState<Notice | null>(null);
  const [imageNotice, setImageNotice] = useState<Notice | null>(null);
  const [saveNotice, setSaveNotice] = useState<Notice | null>(null);
  /**
   * The last save threw. Kept as a flag rather than a Notice carrying a handler
   * so "try again" always runs the CURRENT handleSave — a stored callback would
   * close over the field values from the failed attempt and re-save those.
   */
  const [saveFailed, setSaveFailed] = useState(false);
  /** The extractor came back thin — nudge the user to check the fields. */
  const [degraded, setDegraded] = useState(false);
  /** Save was attempted with an empty title. */
  const [titleMissing, setTitleMissing] = useState(false);

  // ---- Anticipatory-capture state (see "AT-A-GLANCE" zone below). ----
  /** What the user typed/pasted in the always-visible quick-capture field. */
  const [quickText, setQuickText] = useState('');
  /** True once the user accepted/dismissed the current clipboard offer. */
  const clipboardHandledRef = useRef(false);
  /** Whether to offer the clipboard link. Content is unread until they tap. */
  const [clipboardOffer, setClipboardOffer] = useState(false);
  /** Photo-library access, checked (never requested) on focus. */
  const [photoAccess, setPhotoAccess] = useState<PhotoAccess>('unknown');
  /** A small peek of the user's recent screenshots (4) for one-tap import. */
  const [recentShots, setRecentShots] = useState<Screenshot[]>([]);
  /** Last 3 saved items so the user can re-enter quickly without rummaging. */
  const [recentItems, setRecentItems] = useState<Item[]>([]);
  /** Stacks to file into at capture time. */
  const [stacks, setStacks] = useState<Stack[]>([]);

  /**
   * Reload the "You just saved" strip. Extracted from the focus effect because
   * the tab never loses focus during a save — without an explicit refresh the
   * strip would show the state from before the item the user just captured.
   */
  const refreshRecents = useCallback(async () => {
    try {
      const items = await getItems();
      setRecentItems(
        items
          .filter((i) => !i.archived)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 3),
      );
    } catch {
      /* storage error — leave the strip as it is */
    }
  }, []);

  const refreshStacks = useCallback(async () => {
    try {
      setStacks(await getStacks());
    } catch {
      /* storage error — the chip row just shows "New stack" */
    }
  }, []);

  /**
   * On focus, light up the AT-A-GLANCE zone: clipboard sniff + recent shots +
   * recent saves + stacks. Everything is best-effort and, critically, prompt-free:
   * the clipboard is sniffed via hasUrlAsync (no paste banner) and photo access
   * is only *read* — the request happens when the user taps the opt-in tile.
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!clipboardHandledRef.current) {
          const hasLink = await clipboardHasUrl();
          if (alive && hasLink) setClipboardOffer(true);
        }

        const permission = await MediaLibrary.getPermissionsAsync().catch(() => null);
        if (!alive) return;
        const access: PhotoAccess = permission
          ? (String(permission.status) as PhotoAccess)
          : 'unknown';
        setPhotoAccess(access);
        if (access === 'granted') {
          try {
            const shots = await getRecentScreenshots(4);
            if (alive) setRecentShots(shots);
          } catch {
            if (alive) setRecentShots([]);
          }
        }

        if (!alive) return;
        await refreshRecents();
        if (alive) await refreshStacks();
      })();
      return () => {
        alive = false;
        // Leaving the tab is the one signal we have that the pasteboard may hold
        // something new: we can't compare contents without reading (and reading
        // is what shows the banner), so "offer once per visit" is the rule.
        clipboardHandledRef.current = false;
      };
    }, [refreshRecents, refreshStacks]),
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
      setDescription(value);
      setQuickText('');
    }
  }

  /**
   * The user asked for the clipboard link — only now do we read the string
   * (and spend iOS's one paste banner).
   */
  async function acceptClipboard() {
    clipboardHandledRef.current = true;
    setClipboardOffer(false);
    const value = (await readClipboardString()).trim();
    setInputType('url');
    if (!isUrlLike(value)) {
      // The pasteboard changed between the sniff and the read.
      setUrlNotice({ message: 'That link slipped away — paste it here instead.' });
      return;
    }
    setUrl(value);
    handleAnalyzeUrl(value);
  }

  /** Dismiss the clipboard offer without saving (don't nag again this visit). */
  function dismissClipboard() {
    clipboardHandledRef.current = true;
    setClipboardOffer(false);
  }

  /** Ask for photo access — only ever from a tap on the opt-in tile. */
  async function enablePhotoPeek() {
    const permission = await MediaLibrary.requestPermissionsAsync().catch(() => null);
    const access: PhotoAccess = permission ? (String(permission.status) as PhotoAccess) : 'denied';
    setPhotoAccess(access);
    if (access !== 'granted') return;
    try {
      setRecentShots(await getRecentScreenshots(4));
    } catch {
      setRecentShots([]);
    }
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
    // Anything still in flight is now for a form that no longer exists.
    analyzeAbortRef.current?.abort();
    analyzeAbortRef.current = null;
    setLoading(false);
    setInputType(null);
    setUrl('');
    setNoteText('');
    setImageUri(null);
    setTitle('');
    setDescription('');
    setClassification('other');
    setTags([]);
    setStackId(undefined);
    setScript('');
    setPlaceName('');
    setPlaceAddress('');
    setThumbnailUri(null);
    setAuthor('');
    setPlatform(undefined);
    setSourceUrl('');
    setHomeNotice(null);
    setUrlNotice(null);
    setImageNotice(null);
    setSaveNotice(null);
    setSaveFailed(false);
    setDegraded(false);
    setTitleMissing(false);
    void refreshRecents();
  }

  /**
   * Resolve + analyze a pasted URL. The universal extractor pulls oEmbed/OG
   * metadata (title / author / caption / thumbnail) plus a classification + tags
   * via the Gemini chain. On a private/dead link the Worker returns ok:false with
   * whatever it has; on a hard failure we still populate the raw URL — either
   * way the user can save (never lose a save). Both thin cases surface as the
   * inline "degraded" notice inside the preview card, not as a modal.
   *
   * Accepts an explicit `urlArg` so one-tap entry points (clipboard suggestion,
   * quick-paste field) can pass the URL directly — bypassing the React-state
   * race where setUrl()'s value isn't yet visible to the closure.
   */
  async function handleAnalyzeUrl(urlArg?: string) {
    const candidate = (urlArg ?? url).trim();
    if (!candidate) {
      setUrlNotice({ message: 'Paste a link first' });
      return;
    }
    if (!isUrlLike(candidate)) {
      setUrlNotice({ message: 'That doesn’t look like a link — it needs to start with https://' });
      return;
    }
    setUrlNotice(null);
    setDegraded(false);

    const urlToAnalyze = candidate;
    // One extraction at a time; a new one supersedes whatever was in flight.
    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    try {
      setLoading(true);
      const result = await extractLink(urlToAnalyze, controller.signal);
      // The user cancelled while the response was on the wire — the form they
      // were filling is gone, so writing into it would resurrect it.
      if (controller.signal.aborted) return;

      setTitle(result.title || urlToAnalyze);
      setDescription(result.description || result.caption || '');
      setClassification(result.classification);
      setTags(result.tags || []);
      setThumbnailUri(result.thumbnailUrl || null);
      setAuthor(result.author || '');
      setPlatform(result.platform);
      setSourceUrl(result.sourceUrl || urlToAnalyze);
      setScript('');

      // Rich metadata wasn't available (private / login-walled / dead). The form
      // is still populated with what we have so the user can edit and save.
      setDegraded(!result.ok);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Failed to extract URL:', error);
      // Hard failure (e.g. backend unreachable): fall back to a manually-editable
      // item from the raw URL so the save is never lost. The embed still works —
      // platform is detected from the URL itself.
      setTitle((prev) => prev || urlToAnalyze);
      setSourceUrl(urlToAnalyze);
      setPlatform(detectPlatform(urlToAnalyze));
      setDegraded(true);
    } finally {
      if (analyzeAbortRef.current === controller) analyzeAbortRef.current = null;
      setLoading(false);
    }
  }

  /**
   * Handle image selection from camera or gallery
   */
  async function handleSelectImage(source: 'camera' | 'gallery') {
    setHomeNotice(null);
    try {
      let result;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setHomeNotice({
            message: 'Silo needs camera access to snap things',
            actionLabel: 'Open Settings',
            onAction: () => Linking.openSettings(),
          });
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setHomeNotice({
            message: 'Silo needs photo access to pull one in',
            actionLabel: 'Open Settings',
            onAction: () => Linking.openSettings(),
          });
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
      setHomeNotice({
        message: 'That photo didn’t come through — try again?',
        tone: 'danger',
        actionLabel: 'Retry',
        onAction: () => handleSelectImage(source),
      });
    }
  }

  /**
   * Analyze a captured image. A failure must still leave a saveable item, so the
   * catch fills a plain-language title and the neutral classification and offers
   * a retry inline — the photo itself is already captured and previewed.
   */
  async function analyzeSelectedImage(uri: string) {
    setImageNotice(null);
    // The image request isn't abortable (analyzeImage takes no signal), but the
    // controller still acts as the "did the user walk away?" flag.
    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    try {
      setLoading(true);
      const base64 = await imageUriToBase64(uri);
      const analysis = await analyzeImage(base64, 'image/jpeg');
      if (controller.signal.aborted) return;

      setTitle(analysis.title);
      setDescription(analysis.description || '');
      setClassification(analysis.classification);
      setTags(analysis.tags || []);
      setScript(analysis.script || ''); // Store script for audio generation
      // Warn only as the allowance runs low. Counting down from ten would make
      // a working feature feel like a countdown timer from the first use.
      if (shouldWarn()) {
        setImageNotice({
          message: `${describeRemaining()}. Premium keeps this running.`,
          actionLabel: 'See Premium',
          onAction: () => router.push('/paywall?context=screenshot'),
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const stamp = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      setTitle((prev) => prev || `Photo from ${stamp}`);
      setClassification('other');
      // The gate is not a failure, and dressing it as one ("couldn't read that")
      // teaches the user the app is broken rather than that there is something
      // to buy. This is the moment the feature has just proven itself, so it is
      // the moment to make the offer — with the photo still saved either way.
      if (isPremiumRequired(error)) {
        setImageNotice({
          message: 'Silo can title and file this for you with Premium. It’s saved either way.',
          actionLabel: 'See Premium',
          onAction: () => router.push('/paywall?context=screenshot'),
        });
      } else {
        console.error('Failed to analyze image:', error);
        setImageNotice({
          message: 'Couldn’t read that one. Add a title yourself and it’s still saved.',
          actionLabel: 'Try again',
          onAction: () => analyzeSelectedImage(uri),
        });
      }
    } finally {
      if (analyzeAbortRef.current === controller) analyzeAbortRef.current = null;
      setLoading(false);
    }
  }

  /** Create a stack inline so capture can file an item the moment it's caught. */
  function handleNewStack() {
    Alert.prompt('New stack', 'What should this one be called?', async (name) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return;
      try {
        const stack: Stack = {
          id: `stack_${Date.now()}`,
          name: trimmed,
          color: BRAND[500],
          item_count: 0,
          created_at: new Date().toISOString(),
        };
        await addStack(stack);
        await refreshStacks();
        setStackId(stack.id);
      } catch (error) {
        console.error('Failed to create stack:', error);
        setSaveNotice({ message: 'Couldn’t make that stack. Try once more.', tone: 'danger' });
      }
    });
  }

  /**
   * Best-effort enrichment that must never delay the save confirmation:
   * a place with an address but no coordinates gets geocoded in the background.
   */
  async function geocodeInBackground(item: Item) {
    if (!(item.place_name || item.place_address)) return;
    if (item.place_latitude && item.place_longitude) return;
    try {
      const addressToGeocode = item.place_address || item.place_name || '';
      if (!addressToGeocode) return;
      const geocoded = await Location.geocodeAsync(addressToGeocode);
      if (geocoded && geocoded.length > 0) {
        const { latitude, longitude } = geocoded[0];
        await updateItem(item.id, { place_latitude: latitude, place_longitude: longitude });
      }
    } catch (error) {
      console.warn('Failed to geocode address (continuing without coordinates):', error);
    }
  }

  /**
   * Toast "Schedule it" action: ask the model when to revisit, then book it.
   * Runs entirely after the save, so a slow/absent AI never gates confirmation.
   */
  async function scheduleSavedItem(item: Item) {
    try {
      const suggestion = await suggestScheduleTime({
        title: item.title,
        classification: item.classification || 'other',
        description: item.description,
        duration: item.duration,
      });
      const scheduledEvent = await scheduleItemReview(
        item,
        suggestion.date,
        suggestion.time,
        item.duration || 15
      );
      // A null return is a real failure (permission denied, no writable
      // calendar) — celebrating it would promise a slot that doesn't exist.
      if (!scheduledEvent) {
        toast.show({
          message: 'Couldn’t add that to your calendar.',
          tone: 'danger',
          action: { label: 'Retry', onPress: () => scheduleSavedItem(item) },
        });
        return;
      }
      // Persist the slot too, or the item reads as unscheduled next to a live event.
      await updateItem(item.id, {
        scheduled_date: suggestion.date,
        scheduled_time: suggestion.time,
      });
      void celebrationHaptic();
      toast.show({
        message: `On your calendar — ${suggestion.date}, ${suggestion.time}`,
        tone: 'success',
      });
    } catch (error) {
      // Same rule as image analysis: a closed gate is an offer, not an error.
      if (isPremiumRequired(error)) {
        toast.show({
          message: 'Premium picks the time for you.',
          tone: 'neutral',
          action: {
            label: 'See Premium',
            onPress: () => router.push('/paywall?context=schedule'),
          },
        });
        return;
      }
      console.error('Failed to schedule item:', error);
      toast.show({
        message: 'Couldn’t add that to your calendar.',
        tone: 'danger',
        action: { label: 'Retry', onPress: () => scheduleSavedItem(item) },
      });
    }
  }

  /**
   * Save the item to storage. Confirmation fires as soon as storage accepts it —
   * geocoding and the schedule suggestion are strictly post-save.
   */
  async function handleSave() {
    if (!title.trim()) {
      setTitleMissing(true);
      return;
    }
    setTitleMissing(false);
    setSaveNotice(null);
    setSaveFailed(false);

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
        // Filing at capture time — without this every in-app save is unfiled
        // forever and the Stacks tab can only ever show seeded data.
        stack_id: stackId,
        // Include location data if detected by AI or if classification is 'place'
        place_name: placeName.trim() || (classification === 'place' ? title.trim() : undefined),
        place_address:
          placeAddress.trim() || (classification === 'place' ? description.trim() : undefined),
      });

      // (Voice narration is a roadmap feature, default-off — see lib/config.ts.
      //  Apple's on-device Speech framework can fill it later for free, no paid TTS.)

      await addItem(item);

      // Confirm NOW. Everything below this line is best-effort enrichment.
      void celebrationHaptic();
      resetForm();
      toast.show({
        message: 'Saved to Silo',
        tone: 'success',
        action: { label: 'Schedule it', onPress: () => scheduleSavedItem(item) },
      });

      // (No server-side embeddings or vector DB — the assistant retrieves
      //  on-device via keyword + tag matching, which is free.)
      void geocodeInBackground(item);
    } catch (error) {
      console.error('Failed to save item:', error);
      setSaveFailed(true);
    } finally {
      setLoading(false);
      savingRef.current = false;
    }
  }

  const degradedNotice = (
    <InlineNotice message="We couldn’t read much from this link — check the details before saving." />
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Gradient Background — the page wash is the one gradient that follows
          the appearance; brand gradients below stay brand in both. */}
      <LinearGradient colors={[...c.pageGradient]} style={StyleSheet.absoluteFill} />
      <ChatBot onClose={() => {}} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 4),
            // Tab bar + the assistant FAB that floats above it — without the
            // extra clearance the last capture row sits under the FAB.
            paddingBottom: insets.bottom + 176,
          },
        ]}
        // "never", not "automatic": the explicit paddingTop above already
        // accounts for the safe area, and automatic adds it a second time.
        contentInsetAdjustmentBehavior="never"
        // Without "handled" every capture costs two taps: the first is eaten
        // dismissing the keyboard before the button ever sees it.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Input Type Selection — anticipatory capture */}
        {!inputType && (
          <View style={styles.typeSelection}>
            <Text style={[styles.pageTitle, dyn.pageTitle]} accessibilityRole="header">
              Capture
            </Text>
            <Text style={[styles.pageSubtitle, dyn.pageSubtitle]}>
              Paste, jot, or snap — Silo files it.
            </Text>

            {/* Always-visible quick-paste field. Acts as Save Link on URLs,
                New Note on free text. */}
            <View style={[styles.quickField, dyn.quickField]}>
              <Ionicons name="sparkles" size={18} color={c.decorative} />
              <TextInput
                style={[styles.quickInput, dyn.quickInput]}
                placeholder="Paste a link or type a thought"
                placeholderTextColor={c.textPlaceholder}
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
                      color={TEXT.inverse}
                    />
                  </LinearGradient>
                </PressableScale>
              )}
            </View>

            {homeNotice ? <InlineNotice {...homeNotice} /> : null}

            {/* Clipboard offer. We know a link is there (pattern sniff) but have
                deliberately not read it — tapping Paste link is what spends the
                one "pasted from" banner iOS allows. */}
            {clipboardOffer && (
              <RiseIn index={0}>
                <Glass variant="regular" radius={RADIUS.lg} tintColor={dyn.glassTint} style={styles.clipCard}>
                  <View style={styles.clipInner}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.clipEyebrow, dyn.clipEyebrow]}>FROM YOUR CLIPBOARD</Text>
                      <Text style={[styles.clipUrl, dyn.clipUrl]} numberOfLines={1}>
                        There’s a link ready to save
                      </Text>
                    </View>
                    <PressableScale
                      haptic="selection"
                      onPress={dismissClipboard}
                      style={styles.clipDismiss}
                      accessibilityLabel="Dismiss"
                    >
                      <Ionicons name="close" size={18} color={c.textTertiary} />
                    </PressableScale>
                    <PressableScale
                      haptic="light"
                      onPress={acceptClipboard}
                      accessibilityLabel="Paste link"
                    >
                      <LinearGradient
                        colors={[...GRADIENTS.brand]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.clipSaveBtn}
                      >
                        <Text style={styles.clipSaveText}>Paste link</Text>
                      </LinearGradient>
                    </PressableScale>
                  </View>
                </Glass>
              </RiseIn>
            )}

            {/* Recent screenshots peek — one tap to import + analyze. Mounted
                only once we know what to show, so the entrance plays on the
                content rather than on an empty box. */}
            {(photoAccess === 'undetermined' ||
              photoAccess === 'denied' ||
              recentShots.length > 0) && (
              <RiseIn index={1}>
                {photoAccess === 'granted' && recentShots.length > 0 && (
                  <View style={styles.peekSection}>
                    <Text style={[styles.peekTitle, dyn.peekTitle]}>From your photos</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.peekStrip}
                      keyboardShouldPersistTaps="handled"
                    >
                      {recentShots.map((s) => (
                        <PressableScale
                          key={s.id}
                          haptic="light"
                          onPress={() => importRecentShot(s)}
                          style={[styles.peekTile, dyn.peekTile]}
                          accessibilityLabel="Import this screenshot"
                        >
                          <Image
                            source={{ uri: s.uri }}
                            style={styles.peekImg}
                            contentFit="cover"
                          />
                        </PressableScale>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Opt-in tile. The permission sheet only ever fires from this tap.
                    The tile IS a control, so it takes the material and the
                    specular press that comes with it. */}
                {photoAccess === 'undetermined' && (
                  <View style={styles.peekSection}>
                    <Text style={[styles.peekTitle, dyn.peekTitle]}>From your photos</Text>
                    <PressableScale haptic="light" onPress={enablePhotoPeek} scaleTo={0.985}>
                      <Glass
                        interactive
                        radius={RADIUS.lg}
                        tintColor={dyn.glassTint}
                        style={styles.permTile}
                      >
                        <View style={[styles.permIcon, dyn.permIcon]}>
                          <Ionicons name="images" size={18} color={c.textBrand} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.permTitle, dyn.permTitle]}>
                            Show my recent screenshots
                          </Text>
                          <Text style={[styles.permSub, dyn.permSub]}>
                            Save one in a single tap.
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={c.decorative} />
                      </Glass>
                    </PressableScale>
                  </View>
                )}

                {/* Denial leaves a way back rather than a dead strip. */}
                {photoAccess === 'denied' && (
                  <View style={styles.peekSection}>
                    <Text style={[styles.peekTitle, dyn.peekTitle]}>From your photos</Text>
                    <PressableScale
                      haptic="light"
                      onPress={() => Linking.openSettings()}
                      scaleTo={0.985}
                    >
                      <Glass
                        interactive
                        radius={RADIUS.lg}
                        tintColor={dyn.glassTint}
                        style={styles.permTile}
                      >
                        <View style={[styles.permIcon, dyn.permIcon]}>
                          <Ionicons name="lock-closed" size={18} color={c.textBrand} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.permTitle, dyn.permTitle]}>Photo access is off</Text>
                          <Text style={[styles.permSub, dyn.permSub]}>
                            Turn it on in Settings to peek here.
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={c.decorative} />
                      </Glass>
                    </PressableScale>
                  </View>
                )}
              </RiseIn>
            )}

            {/* Last 3 saves — re-enter recent items without rummaging. */}
            {recentItems.length > 0 && (
              <Animated.View entering={enterList(2, reduced)} style={styles.peekSection}>
                <Text style={[styles.peekTitle, dyn.peekTitle]}>You just saved</Text>
                {recentItems.map((item, index) => {
                  const cfg = classConfig(item.classification);
                  return (
                    <Animated.View
                      key={item.id}
                      layout={LAYOUT}
                      entering={enterList(index, reduced)}
                    >
                      <PressableScale
                        haptic="light"
                        onPress={() => router.push(`/item/${item.id}`)}
                        style={[styles.recentRow, dyn.recentRow]}
                        scaleTo={0.985}
                      >
                        <LinearGradient
                          colors={[cfg.from, cfg.to]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.recentIcon}
                        >
                          {/* On a brand/classification gradient the glyph is white
                              in both appearances. */}
                          <Ionicons name={cfg.icon} size={16} color={TEXT.inverse} />
                        </LinearGradient>
                        <View style={{ flex: 1, marginLeft: SPACE.sm, minWidth: 0 }}>
                          <Text style={[styles.recentTitle, dyn.recentTitle]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          {/* `deep` is darkened for light grounds and drops to ~2.3:1
                              on the dark card — the lighter gradient stop keeps the
                              hue and roughly doubles the contrast. */}
                          <Text
                            style={[
                              styles.recentSub,
                              { color: c.appearance === 'dark' ? cfg.to : cfg.deep },
                            ]}
                            numberOfLines={1}
                          >
                            {cfg.label.toUpperCase()}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={c.decorative} />
                      </PressableScale>
                    </Animated.View>
                  );
                })}
              </Animated.View>
            )}

            {/* The four explicit capture routes. Full-width rows, not a 2-up
                grid: OptionCard is a row (52pt tile + title + subtitle), and at
                48% width every subtitle wrapped onto a second line. */}
            <Text style={[styles.orTitle, dyn.orTitle]}>OR CAPTURE SOMETHING NEW</Text>
            <View style={styles.optionList}>
              <OptionCard
                index={OPTION_ENTER_OFFSET}
                icon="link"
                colors={GRADIENTS.brand}
                title="Link"
                subtitle="Paste a URL"
                onPress={() => setInputType('url')}
              />
              <OptionCard
                index={OPTION_ENTER_OFFSET + 1}
                icon="camera"
                colors={classGradient('video')}
                title="Camera"
                subtitle="Snap a photo"
                onPress={() => handleSelectImage('camera')}
              />
              <OptionCard
                index={OPTION_ENTER_OFFSET + 2}
                icon="images"
                colors={classGradient('place')}
                title="Gallery"
                subtitle="From your photos"
                onPress={() => handleSelectImage('gallery')}
              />
              <OptionCard
                index={OPTION_ENTER_OFFSET + 3}
                icon="create"
                colors={classGradient('product')}
                title="Note"
                subtitle="Jot a quick thought"
                onPress={() => setInputType('note')}
              />
            </View>
          </View>
        )}

        {/* URL Input */}
        {inputType === 'url' && (
          <FormCard>
            <View style={styles.inputGroup}>
              <View style={styles.urlHeader}>
                <PressableScale
                  haptic="light"
                  style={styles.backButton}
                  onPress={() => resetForm()}
                  accessibilityLabel="Back to capture"
                >
                  <Ionicons name="arrow-back" size={24} color={c.textSecondary} />
                </PressableScale>
                <Text style={[styles.label, dyn.label]}>URL</Text>
              </View>
              <TextInput
                style={[styles.input, dyn.input]}
                placeholder="https://example.com"
                placeholderTextColor={c.textPlaceholder}
                value={url}
                onChangeText={(text) => {
                  setUrl(text);
                  if (urlNotice) setUrlNotice(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {urlNotice ? <InlineNotice {...urlNotice} /> : null}
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
                    <ActivityIndicator color={TEXT.inverse} />
                  ) : (
                    <Text style={styles.analyzeButtonText}>Analyze with AI</Text>
                  )}
                </LinearGradient>
              </PressableScale>
            </View>
          </FormCard>
        )}

        {/* Image capture — the photo itself is the header, so a failed analysis
            still lands on something recognisable with a way back. */}
        {inputType === 'image' && (
          <FormCard>
            <View style={styles.inputGroup}>
              <View style={styles.urlHeader}>
                <PressableScale
                  haptic="light"
                  style={styles.backButton}
                  onPress={() => resetForm()}
                  accessibilityLabel="Back to capture"
                >
                  <Ionicons name="arrow-back" size={24} color={c.textSecondary} />
                </PressableScale>
                <Text style={[styles.label, dyn.label]}>Photo</Text>
              </View>
              {imageUri ? (
                <Image
                  source={{ uri: imageUri }}
                  style={[styles.capturedImage, dyn.capturedImage]}
                  contentFit="cover"
                  transition={220}
                  accessibilityLabel="Captured photo"
                />
              ) : null}
              {imageNotice ? <InlineNotice {...imageNotice} /> : null}
            </View>
          </FormCard>
        )}

        {/* Note Input */}
        {inputType === 'note' && (
          <FormCard>
            <View style={styles.inputGroup}>
              <View style={styles.urlHeader}>
                <PressableScale
                  haptic="light"
                  style={styles.backButton}
                  onPress={() => resetForm()}
                  accessibilityLabel="Back to capture"
                >
                  <Ionicons name="arrow-back" size={24} color={c.textSecondary} />
                </PressableScale>
                <Text style={[styles.label, dyn.label]}>Note</Text>
              </View>
              <TextInput
                style={[styles.input, styles.textArea, dyn.input]}
                placeholder="Write your note..."
                placeholderTextColor={c.textPlaceholder}
                value={noteText}
                onChangeText={(text) => {
                  setNoteText(text);
                  setDescription(text);
                }}
                multiline
                numberOfLines={5}
              />
            </View>
          </FormCard>
        )}

        {/* Common Fields (shown after analysis or for manual entry) */}
        {(title || inputType === 'note') && (
          <FormCard>
            {/* The link preview stays an opaque inset panel: it sits ON the
                form's material, and two stacked materials read as mud. The
                surface that floats over the page wash is the one that gets to
                be glass. */}
            {inputType === 'url' && (thumbnailUri || author || platform) ? (
              <View style={[styles.previewCard, dyn.previewCard]}>
                <View style={styles.previewRow}>
                  {thumbnailUri ? (
                    <Image
                      source={{ uri: thumbnailUri }}
                      style={[styles.previewThumb, dyn.previewThumb]}
                      contentFit="cover"
                      transition={220}
                    />
                  ) : (
                    <View style={[styles.previewThumb, dyn.previewThumb, styles.previewThumbFallback]}>
                      <Ionicons name="link" size={22} color={c.textBrand} />
                    </View>
                  )}
                  <View style={styles.previewMeta}>
                    {platform ? (
                      <Text style={[styles.previewPlatform, dyn.previewPlatform]}>
                        {platform.toUpperCase()}
                      </Text>
                    ) : null}
                    {author ? (
                      <Text style={[styles.previewAuthor, dyn.previewAuthor]} numberOfLines={1}>
                        {author}
                      </Text>
                    ) : null}
                    {title ? (
                      <Text style={[styles.previewTitle, dyn.previewTitle]} numberOfLines={2}>
                        {title}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {degraded ? degradedNotice : null}
              </View>
            ) : degraded ? (
              degradedNotice
            ) : null}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, dyn.label]}>Title</Text>
              <TextInput
                style={[styles.input, dyn.input]}
                placeholder="Item title"
                placeholderTextColor={c.textPlaceholder}
                value={title}
                onChangeText={(text) => {
                  setTitle(text);
                  if (titleMissing) setTitleMissing(false);
                }}
              />
              {titleMissing ? (
                <Text style={[styles.fieldHelp, dyn.fieldHelp]}>
                  Give it a title so you can find it later
                </Text>
              ) : null}
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, dyn.label]}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea, dyn.input]}
                placeholder="Add a description..."
                placeholderTextColor={c.textPlaceholder}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, dyn.label]}>Classification</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {CLASSIFICATIONS.map((type) => (
                  <PressableScale
                    key={type}
                    haptic="selection"
                    selected={classification === type}
                    style={[
                      styles.classificationChip,
                      dyn.chip,
                      // The selected chip is a brand fill — it stays BRAND[600]
                      // with white text in both appearances.
                      classification === type && styles.classificationChipActive,
                    ]}
                    onPress={() => setClassification(type as Classification)}
                  >
                    <Text
                      style={[
                        styles.classificationChipText,
                        dyn.chipText,
                        classification === type && styles.classificationChipTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>
            </View>

            {/* Filing happens here or never — the Stacks tab reads `stack_id`. */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, dyn.label]}>Stack</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.stackRow}
                keyboardShouldPersistTaps="handled"
              >
                {stacks.map((stack) => {
                  const active = stackId === stack.id;
                  return (
                    <PressableScale
                      key={stack.id}
                      haptic="selection"
                      selected={active}
                      style={[styles.stackChip, dyn.chip, active && styles.stackChipActive]}
                      // Tapping the selected stack unfiles — filing must be undoable
                      // without leaving the form.
                      onPress={() => setStackId(active ? undefined : stack.id)}
                    >
                      <Text
                        style={[
                          styles.stackChipText,
                          dyn.chipText,
                          active && styles.stackChipTextActive,
                        ]}
                      >
                        {stack.name}
                      </Text>
                    </PressableScale>
                  );
                })}
                <PressableScale
                  haptic="light"
                  onPress={handleNewStack}
                  style={[styles.stackChipNew, dyn.stackChipNew]}
                  accessibilityLabel="New stack"
                >
                  <Ionicons name="add" size={14} color={c.textBrand} />
                  <Text style={[styles.stackChipNewText, dyn.stackChipNewText]}>New stack</Text>
                </PressableScale>
              </ScrollView>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.label, dyn.label]}>Tags</Text>
              <TagPicker selectedTags={tags} onTagsChange={setTags} />
            </View>

            {saveNotice ? <InlineNotice {...saveNotice} /> : null}
            {saveFailed ? (
              <InlineNotice
                message="That didn’t save. Tap to try again."
                tone="danger"
                onAction={handleSave}
              />
            ) : null}

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
                  <ActivityIndicator color={TEXT.inverse} />
                ) : (
                  <Text style={styles.saveButtonText}>Save Item</Text>
                )}
              </LinearGradient>
            </PressableScale>

            {/* Discard, not "Cancel" — this clears the whole draft. The old
                Cancel only hid the input type, leaving a populated form stacked
                under the capture home that saved as an untyped note. */}
            <PressableScale haptic="light" style={styles.cancelButton} onPress={() => resetForm()}>
              <Text style={[styles.cancelButtonText, dyn.cancelButtonText]}>Discard</Text>
            </PressableScale>
          </FormCard>
        )}

        {loading && !title && (
          // The wait gets a surface of its own: loose skeletons on the page wash
          // read as the screen having broken, a panel reads as work in flight.
          <Glass radius={RADIUS.xl} tintColor={dyn.glassTint} style={styles.loadingContainer}>
            {/* Preview-shaped skeleton so the analysis wait feels like content arriving. */}
            <Skeleton height={180} radius={RADIUS.lg} />
            <Skeleton width="72%" height={18} style={styles.loadingLine} />
            <Skeleton width="48%" height={14} style={styles.loadingLine} />
            <Text style={[styles.loadingText, dyn.loadingText]}>Analyzing with AI...</Text>
            <PressableScale haptic="light" style={styles.cancelButton} onPress={() => resetForm()}>
              <Text style={[styles.cancelButtonText, dyn.cancelButtonText]}>Cancel</Text>
            </PressableScale>
          </Glass>
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
    padding: SPACE.base,
    paddingTop: 0,
  },
  typeSelection: {
    gap: SPACE.md,
  },
  pageTitle: { ...TYPE.display },
  pageSubtitle: { ...TYPE.callout, marginTop: SPACE.xs },
  /* Anticipatory-capture zone styles */
  quickField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...SHADOW.card,
  },
  quickInput: { flex: 1, ...TYPE.callout, paddingVertical: SPACE.sm },
  quickSendBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipCard: {
    marginTop: SPACE.xxs,
  },
  clipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: 14,
  },
  clipEyebrow: { ...TYPE.overline },
  clipUrl: { ...TYPE.footnote, marginTop: SPACE.xs },
  clipDismiss: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
  },
  /* On the brand gradient this stays white in both appearances. */
  clipSaveText: { ...TYPE.subhead, fontWeight: '700', color: TEXT.inverse },
  peekSection: { gap: SPACE.sm, marginTop: 6 },
  peekTitle: {
    ...TYPE.overline,
    marginLeft: SPACE.xxs,
  },
  peekStrip: { gap: SPACE.sm, paddingRight: SPACE.base },
  peekTile: {
    width: 80,
    height: 110,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
  },
  peekImg: { width: '100%', height: '100%' },
  /**
   * Photo-access opt-in / recovery tile (same shape as a recent row). Glass
   * supplies the radius, the clip and the rim; the hairline shadow it used to
   * carry can't escape a clipped surface anyway, and the rim replaces it.
   */
  permTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    padding: SPACE.md,
  },
  permIcon: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permTitle: { ...TYPE.subhead },
  permSub: { ...TYPE.caption, fontWeight: '500', marginTop: SPACE.xxs },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACE.sm + 2,
  },
  recentIcon: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: { ...TYPE.subhead },
  recentSub: { ...TYPE.overline, marginTop: SPACE.xxs },
  orTitle: {
    ...TYPE.overline,
    marginTop: 14,
    marginLeft: SPACE.xxs,
  },
  optionList: { marginTop: SPACE.xs },
  // Lift + radius on the wrapper, padding inside: the material clips to its own
  // bounds, so a shadow set on it would never leave them. The rim `Glass` draws
  // replaces the card's old 1px border.
  formLift: {
    borderRadius: RADIUS.xl,
    ...SHADOW.card,
  },
  form: {
    gap: SPACE.lg,
    padding: SPACE.base,
  },
  inputGroup: {
    gap: SPACE.sm,
  },
  urlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    marginBottom: SPACE.xs,
  },
  backButton: {
    padding: SPACE.xs,
    marginLeft: -SPACE.xs,
  },
  label: {
    ...TYPE.bodyStrong,
  },
  input: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACE.base,
    ...TYPE.body,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  fieldHelp: {
    ...TYPE.footnote,
    marginLeft: SPACE.xxs,
  },
  capturedImage: {
    width: '100%',
    height: 220,
    borderRadius: RADIUS.lg,
  },
  /* Inline notice — replaces the Alert.alert('Error', …) family. */
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm + 2,
  },
  noticeText: { ...TYPE.footnote, flex: 1 },
  noticeAction: { ...TYPE.footnote, fontWeight: '800' },
  analyzeButton: {
    borderRadius: RADIUS.pill,
    padding: SPACE.base,
    alignItems: 'center',
  },
  analyzeButtonText: {
    ...TYPE.headline,
    color: TEXT.inverse,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  classificationChip: {
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    marginRight: SPACE.sm,
    borderWidth: 1,
    ...SHADOW.hairline,
  },
  /* Selected chips are brand FILLS — violet with white text in both appearances. */
  classificationChipActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
  },
  classificationChipText: {
    ...TYPE.subhead,
    textTransform: 'capitalize',
  },
  classificationChipTextActive: {
    color: TEXT.inverse,
  },
  stackRow: { gap: SPACE.sm, paddingRight: SPACE.base },
  stackChip: {
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    ...SHADOW.hairline,
  },
  stackChipActive: {
    backgroundColor: BRAND[600],
    borderColor: BRAND[600],
  },
  stackChipText: { ...TYPE.subhead },
  stackChipTextActive: { color: TEXT.inverse },
  stackChipNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  stackChipNewText: { ...TYPE.subhead },
  // Layout wrapper around the gradient save pill (margin lives here so the
  // press-scale transform doesn't shift it). The form is a column, so unlike
  // reel.tsx's row variant this wrapper must NOT take flex: 1 — in an
  // auto-height parent that would collapse the button to zero height.
  saveButtonWrap: {
    marginTop: SPACE.sm,
  },
  saveButton: {
    borderRadius: RADIUS.pill,
    padding: SPACE.base,
    alignItems: 'center',
  },
  saveButtonText: {
    ...TYPE.title3,
    color: TEXT.inverse,
  },
  cancelButton: {
    padding: SPACE.base,
    alignItems: 'center',
  },
  cancelButtonText: {
    ...TYPE.bodyStrong,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: SPACE.xxxl,
    // The skeletons can't run into the material's rim, so the panel insets them.
    paddingHorizontal: SPACE.base,
  },
  // Skeleton text line under the preview-shaped block.
  loadingLine: {
    marginTop: SPACE.md,
  },
  loadingText: {
    ...TYPE.body,
    marginTop: SPACE.base,
  },
  previewCard: {
    gap: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACE.md,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
  },
  previewThumb: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.sm,
  },
  previewThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewMeta: {
    flex: 1,
    gap: SPACE.xxs,
  },
  previewPlatform: {
    ...TYPE.overline,
  },
  previewAuthor: {
    ...TYPE.subhead,
    fontWeight: '700',
  },
  previewTitle: {
    ...TYPE.footnote,
  },
});
