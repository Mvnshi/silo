/**
 * Floating assistant sheet.
 *
 * Grounded Q&A over the user's own saves. Retrieval runs on-device: the
 * question is matched against the library with `aiSearch` and only the matching
 * items are sent to the Gemini proxy to be phrased, so answers are about what
 * the user actually saved rather than "the 30 newest things". Every answer
 * renders its sources as chips that deep-link to the item.
 *
 * LAYOUT NOTE: the sheet anchors to the bottom of its parent and lifts itself
 * with `useAnimatedKeyboard()`. It must NOT be wrapped in a
 * KeyboardAvoidingView — the lift would be applied twice.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeOut,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { aiSearch, ragQuery } from '@/lib/api';
import { getItems } from '@/lib/storage';
import type { Item } from '@/lib/types';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import EmptyState from '@/components/ui/EmptyState';
import { usePrefersReducedMotion } from '@/lib/motion';
import {
  BRAND,
  DURATION,
  MIN_TAP,
  RADIUS,
  SHADOW,
  SPACE,
  SPRING,
  TEXT,
  TYPE,
  type ThemeColors,
} from '@/lib/theme';
import { useThemeColors } from '@/lib/useTheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Resting sheet height; shrinks to fit when the keyboard is up. */
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.55);

/** FAB diameter. Also its corner radius — glass rounds to a number, not `pill`. */
const FAB_SIZE = 60;

/**
 * The FAB is glass, but it is still the brand control: violet dense enough to
 * hold a white glyph, thin enough that the material behind it keeps lensing.
 * Pinned to BRAND[600] in both appearances — the palette's `brand` lightens two
 * steps on dark, and white on that pale violet drops under 3:1.
 */
const FAB_TINT = `${BRAND[600]}bf`;

/** How many retrieved items we hand the model. Enough context, bounded cost. */
const RETRIEVAL_LIMIT = 30;

const GREETING =
  "Hi — I'm Silo. Ask me anything about what you've saved and I'll answer from your own library.\n\nTry:\n• \"What fitness content do I have?\"\n• \"Find that pasta recipe\"\n• \"What did I save about design?\"";

/** Monotonic message ids — `Date.now()` collides when two land in the same ms. */
let messageSeq = 0;
const nextId = () => `m${++messageSeq}`;

interface ChatSource {
  id: string;
  title: string;
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  /** Saved items the answer was grounded on — rendered as deep-link chips. */
  sources?: ChatSource[];
  /** This bubble is a failure, not an answer: distinct styling + retryable. */
  isError?: boolean;
  /** The question to re-run when the user taps "Try again". */
  retryQuery?: string;
}

interface ChatBotProps {
  onClose: () => void;
}

/**
 * Question words that carry no retrieval signal. Without this, "what fitness
 * content do I have?" would match every item containing "have".
 */
const STOP_WORDS = new Set([
  'about', 'again', 'all', 'and', 'any', 'anything', 'are', 'been', 'can', 'content',
  'could', 'did', 'does', 'find', 'for', 'from', 'get', 'give', 'got', 'had', 'has',
  'have', 'how', 'into', 'item', 'items', 'like', 'me', 'more', 'my', 'need', 'please',
  'save', 'saved', 'show', 'some', 'something', 'stuff', 'tell', 'that', 'the', 'their',
  'them', 'there', 'these', 'they', 'thing', 'things', 'this', 'those', 'was', 'were',
  'what', 'whats', 'when', 'where', 'which', 'who', 'why', 'with', 'would', 'you',
  'your', 'yours',
]);

/**
 * Rank the user's items against a question.
 *
 * `aiSearch` is a substring match over the WHOLE query string, so a
 * natural-language question matches nothing. We run it once per content word
 * instead and rank by how many words hit — cheap, on-device, and it is what
 * makes the assistant grounded rather than answering off the newest 30 saves.
 */
async function retrieve(query: string, items: Item[]): Promise<Item[]> {
  const words = Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    )
  );
  if (words.length === 0) return [];

  const hits = new Map<number, number>();
  for (const word of words) {
    for (const index of await aiSearch(word, items)) {
      const i = Number(index);
      hits.set(i, (hits.get(i) ?? 0) + 1);
    }
  }

  return Array.from(hits.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]) // most words matched, then newest
    .map(([index]) => items[index])
    .filter(Boolean);
}

/**
 * The appearance-dependent half of `styles` — a plain object so it can be
 * memoised per palette rather than re-registered as a sheet on every render.
 */
function makeDynamicStyles(c: ThemeColors) {
  return {
    backdropTint: { backgroundColor: c.scrim },
    /**
     * The sheet is glass, so it has no fill — but bare material borrows its
     * colour from the (blurred, arbitrary) page beneath, and a chat is a wall of
     * body text. `2e` ≈ 18% of the palette's own card colour: enough to hold the
     * text, far too little to read as a fill. Both palettes state `card` as a
     * 6-digit hex, so the alpha suffix is all this needs.
     */
    sheetTint: `${c.card}2e`,
    header: { borderBottomColor: c.hairline },
    avatar: { backgroundColor: c.brandSoft },
    headerTitle: { color: c.text },
    headerSubtitle: { color: c.textTertiary },
    botBubble: { backgroundColor: c.field },
    botBubbleText: { color: c.text },
    errorBubble: { backgroundColor: c.dangerSoft, borderColor: c.danger },
    errorLabel: { color: c.danger },
    retryButton: { backgroundColor: c.card, borderColor: c.danger },
    retryText: { color: c.danger },
    sourceChip: { backgroundColor: c.brandSoft, borderColor: c.brandBorder },
    sourceChipText: { color: c.textBrand },
    /**
     * No fill of its own — a solid slab across the bottom of a glass sheet
     * would read as a patch. The hairline separates it; the field inside it
     * stays opaque, because a caret over moving material is unreadable.
     */
    composer: { borderTopColor: c.hairline },
    input: { backgroundColor: c.field, color: c.text },
    sendButtonDisabled: { backgroundColor: c.field },
  };
}

export default function ChatBot({ onClose }: ChatBotProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = usePrefersReducedMotion();
  const keyboard = useAnimatedKeyboard();
  const c = useThemeColors();
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);

  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), text: GREETING, isUser: false },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  /** null until the library has been counted, so we don't flash the empty state. */
  const [libraryEmpty, setLibraryEmpty] = useState<boolean | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** 0 = parked below the screen, 1 = open. Drives a translate, never opacity. */
  const progress = useSharedValue(0);

  useEffect(() => {
    const target = isExpanded ? 1 : 0;
    progress.value = reduced ? target : withSpring(target, SPRING.settle);
  }, [isExpanded, progress, reduced]);

  // An empty library has nothing to ground an answer on — check on open so we
  // can short-circuit the model entirely instead of paying for "you have none".
  useEffect(() => {
    if (!isExpanded) return;
    let alive = true;
    getItems()
      .then((items) => {
        if (alive) setLibraryEmpty(items.length === 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isExpanded]);

  /** Bottom anchor: clears the home indicator without hugging the edge. */
  const bottomGap = Math.max(insets.bottom, SPACE.md) + SPACE.sm;

  /**
   * Height, keyboard lift, and open/closed — as ONE transform.
   *
   * The sheet used to fade and scale in on `progress`. It is glass now, and an
   * opacity animation on a glass view doesn't fade it, it deletes it: the
   * closed sheet would have been an empty hole rather than an invisible one. So
   * "closed" is parked below the screen instead — its own height, plus the gap
   * it sits in, plus enough to clear the shadow.
   */
  const sheetStyle = useAnimatedStyle(() => {
    // The keyboard frame is measured from the screen edge, so it already
    // contains the inset we reserve below the sheet.
    const lift = Math.max(keyboard.height.value - bottomGap, 0);
    const available = SCREEN_HEIGHT - insets.top - SPACE.base - bottomGap - lift;
    const height = Math.min(SHEET_HEIGHT, available);
    const parked = (1 - progress.value) * (height + bottomGap + SPACE.huge);
    return {
      height,
      transform: [{ translateY: parked - lift }],
    };
  });

  const closeChat = useCallback(() => {
    setIsExpanded(false);
    onClose();
  }, [onClose]);

  const openSource = useCallback(
    (id: string) => {
      closeChat();
      router.push(`/item/${id}`);
    },
    [closeChat, router]
  );

  /** Retrieve → ask → append. Errors land as a retryable error bubble. */
  const runQuery = useCallback(async (question: string) => {
    setLoading(true);
    try {
      const allItems = await getItems();
      // Nothing to ground on — never spend a model call to say "you have none".
      if (allItems.length === 0) {
        setLibraryEmpty(true);
        return;
      }

      const matched = await retrieve(question, allItems);
      // A keyword miss must not tell the model "nothing is saved" — fall back to
      // the newest items so it can still answer from something real.
      const grounding = (matched.length > 0 ? matched : allItems).slice(0, RETRIEVAL_LIMIT);

      const response = await ragQuery({
        query: question,
        items: grounding.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          tags: item.tags,
          classification: item.classification,
        })),
      });

      // Only keep sources we actually sent, so every chip resolves to a real item.
      const byId = new Map(grounding.map((item) => [item.id, item]));
      const seen = new Set<string>();
      const sources: ChatSource[] = [];
      for (const source of response.sources) {
        const item = byId.get(source.itemId);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        sources.push({ id: item.id, title: item.title });
      }

      setMessages((prev) => [
        ...prev,
        { id: nextId(), text: response.answer, isUser: false, sources },
      ]);
    } catch (error) {
      console.error('Assistant query failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          // Surface the real reason — the "add your Worker URL" case is the one
          // error the user can actually fix, and generic copy hides it.
          text: error instanceof Error ? error.message : 'Something went wrong.',
          isUser: false,
          isError: true,
          retryQuery: question,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSend() {
    const question = inputText.trim();
    if (!question || loading) return;
    setMessages((prev) => [...prev, { id: nextId(), text: question, isUser: true }]);
    setInputText('');
    void runQuery(question);
  }

  /** Drop the failed bubble and ask the same question again. */
  function handleRetry(messageId: string, question: string) {
    setMessages((prev) => prev.filter((message) => message.id !== messageId));
    void runQuery(question);
  }

  const canSend = !!inputText.trim() && !loading;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {!isExpanded && (
        <PressableScale
          haptic="medium"
          accessibilityLabel="Open assistant"
          // Sits above the floating tab bar on every device.
          containerStyle={[styles.fabContainer, { bottom: insets.bottom + 66 }]}
          // Glass clips to its own bounds, so the brand lift that separates the
          // FAB from the page has to live outside it.
          style={styles.fabLift}
          onPress={() => setIsExpanded(true)}
        >
          {/* A control, so the material takes the press (Apple's specular
              response) — and a brand tint so it still reads as THE button
              rather than a blurred hole. The glyph stays white on it. */}
          <Glass interactive radius={FAB_SIZE / 2} tintColor={FAB_TINT} style={styles.fab}>
            <Ionicons name="chatbubbles" size={26} color={TEXT.inverse} />
          </Glass>
        </PressableScale>
      )}

      {isExpanded && (
        <Animated.View
          style={StyleSheet.absoluteFill}
          entering={FadeIn.duration(DURATION.base)}
          exiting={FadeOut.duration(DURATION.fast)}
        >
          <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
          <PressableScale
            scaleTo={1}
            haptic="light"
            accessibilityLabel="Close assistant"
            containerStyle={StyleSheet.absoluteFill}
            style={[styles.backdropTint, dyn.backdropTint]}
            onPress={closeChat}
          />
        </Animated.View>
      )}

      <Animated.View
        style={[styles.sheet, { bottom: bottomGap }, sheetStyle]}
        pointerEvents={isExpanded ? 'auto' : 'none'}
        accessibilityElementsHidden={!isExpanded}
        importantForAccessibility={isExpanded ? 'auto' : 'no-hide-descendants'}
      >
        {/* The material IS the sheet: no fill, just a whisper of the card
            colour so a wall of chat text stays legible over whatever page the
            sheet is floating on. */}
        <Glass
          variant="regular"
          radius={RADIUS.xl}
          tintColor={dyn.sheetTint}
          style={styles.sheetInner}
        >
          <View style={[styles.header, dyn.header]}>
            <View style={styles.headerLeft}>
              <View style={[styles.avatar, dyn.avatar]}>
                <Ionicons name="sparkles" size={22} color={c.textBrand} />
              </View>
              <View>
                <Text style={[styles.headerTitle, dyn.headerTitle]}>Assistant</Text>
                <Text style={[styles.headerSubtitle, dyn.headerSubtitle]}>
                  Answers from your saves
                </Text>
              </View>
            </View>
            <PressableScale
              haptic="light"
              accessibilityLabel="Close assistant"
              style={styles.closeButton}
              onPress={closeChat}
            >
              <Ionicons name="close" size={22} color={c.textSecondary} />
            </PressableScale>
          </View>

          {libraryEmpty ? (
            // Scrolls rather than clips: the sheet is short on small devices.
            <ScrollView contentContainerStyle={styles.emptyWrap}>
              <EmptyState
                icon="sparkles"
                title="Nothing to ask about yet"
                subtitle="Save a few links or notes and I'll answer questions about them."
                cta={{ label: 'Start capturing', onPress: closeChat }}
              />
            </ScrollView>
          ) : (
            <>
              <ScrollView
                ref={scrollRef}
                style={styles.messages}
                contentContainerStyle={styles.messagesContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                nestedScrollEnabled
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              >
                {messages.map((message) => (
                  <Animated.View
                    key={message.id}
                    entering={
                      reduced
                        ? FadeIn.duration(DURATION.fast)
                        : message.isUser
                          ? FadeInRight.duration(DURATION.base)
                          : FadeInDown.duration(DURATION.base)
                    }
                  >
                    <View
                      style={[
                        styles.bubble,
                        // The user's own bubble is a brand fill in both
                        // appearances — only the assistant's follows the palette.
                        message.isUser
                          ? styles.userBubble
                          : message.isError
                            ? [styles.errorBubble, dyn.errorBubble]
                            : [styles.botBubble, dyn.botBubble],
                      ]}
                    >
                      {message.isError && (
                        <View style={styles.errorHeader}>
                          <Ionicons name="alert-circle" size={15} color={c.danger} />
                          <Text style={[styles.errorLabel, dyn.errorLabel]}>
                            Couldn&apos;t answer
                          </Text>
                        </View>
                      )}

                      <Text
                        style={[
                          styles.bubbleText,
                          message.isUser ? styles.userBubbleText : dyn.botBubbleText,
                        ]}
                      >
                        {message.text}
                      </Text>

                      {message.isError && !!message.retryQuery && (
                        <PressableScale
                          haptic="light"
                          accessibilityLabel="Try again"
                          style={[styles.retryButton, dyn.retryButton]}
                          onPress={() => handleRetry(message.id, message.retryQuery!)}
                        >
                          <Ionicons name="refresh" size={14} color={c.danger} />
                          <Text style={[styles.retryText, dyn.retryText]}>Try again</Text>
                        </PressableScale>
                      )}
                    </View>

                    {!!message.sources?.length && (
                      <View style={styles.sourceRow}>
                        {message.sources.map((source) => (
                          <PressableScale
                            key={source.id}
                            haptic="selection"
                            accessibilityLabel={`Open ${source.title}`}
                            style={[styles.sourceChip, dyn.sourceChip]}
                            onPress={() => openSource(source.id)}
                          >
                            <Ionicons name="link" size={12} color={c.textBrand} />
                            <Text
                              style={[styles.sourceChipText, dyn.sourceChipText]}
                              numberOfLines={1}
                            >
                              {source.title}
                            </Text>
                          </PressableScale>
                        ))}
                      </View>
                    )}
                  </Animated.View>
                ))}

                {loading && (
                  <Animated.View
                    entering={FadeIn.duration(DURATION.fast)}
                    style={[styles.bubble, styles.botBubble, dyn.botBubble, styles.typingBubble]}
                    accessibilityLabel="Thinking"
                  >
                    {[0, 1, 2].map((i) => (
                      <TypingDot key={i} index={i} reduced={reduced} />
                    ))}
                  </Animated.View>
                )}
              </ScrollView>

              <View style={[styles.composer, dyn.composer]}>
                <TextInput
                  style={[styles.input, dyn.input]}
                  placeholder="Ask about your saved content..."
                  placeholderTextColor={c.textPlaceholder}
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  maxLength={500}
                  onSubmitEditing={handleSend}
                  // iOS multiline never fires onSubmitEditing without this — the
                  // return key would just insert a newline.
                  submitBehavior="submit"
                  returnKeyType="send"
                  accessibilityLabel="Ask the assistant"
                />
                <PressableScale
                  haptic="light"
                  disabled={!canSend}
                  accessibilityLabel="Send message"
                  style={[styles.sendButton, !canSend && dyn.sendButtonDisabled]}
                  onPress={handleSend}
                >
                  {/* Enabled = white on the brand fill; disabled = a decorative
                      glyph on the neutral field. */}
                  <Ionicons name="send" size={18} color={canSend ? TEXT.inverse : c.decorative} />
                </PressableScale>
              </View>
            </>
          )}
        </Glass>
      </Animated.View>
    </View>
  );
}

/** One dot of the three-dot "thinking" indicator, offset by `index`. */
function TypingDot({ index, reduced }: { index: number; reduced: boolean }) {
  const c = useThemeColors();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withDelay(
      index * 140,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DURATION.base }),
          withTiming(0, { duration: DURATION.base })
        ),
        -1,
        false
      )
    );
  }, [index, reduced, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.65,
    transform: [{ translateY: -3 * pulse.value }],
  }));

  return <Animated.View style={[styles.typingDot, { backgroundColor: c.textTertiary }, style]} />;
}

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  backdropTint: {
    flex: 1,
  },
  fabContainer: {
    position: 'absolute',
    right: SPACE.lg,
  },
  // The brand lift, on the wrapper — the glass itself clips to its own bounds,
  // so a shadow set on it would never escape them.
  fabLift: {
    borderRadius: FAB_SIZE / 2,
    ...SHADOW.brandFloating,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: SPACE.lg,
    right: SPACE.lg,
    borderRadius: RADIUS.xl,
    ...SHADOW.floating,
  },
  // Fills the animated height above it; Glass supplies the radius, the clip and
  // the rim, so all this has left to do is stretch.
  sheetInner: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: SPACE.base,
    paddingRight: SPACE.sm,
    paddingVertical: SPACE.md,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...TYPE.headline,
  },
  headerSubtitle: {
    ...TYPE.caption,
    fontWeight: '500',
    marginTop: SPACE.xxs,
  },
  closeButton: {
    padding: SPACE.sm,
    borderRadius: RADIUS.pill,
  },
  emptyWrap: {
    flexGrow: 1,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: SPACE.base,
    paddingBottom: SPACE.sm,
    gap: SPACE.sm,
  },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderRadius: RADIUS.lg,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: BRAND[600],
    borderBottomRightRadius: RADIUS.xs,
  },
  botBubble: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: RADIUS.xs,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderBottomLeftRadius: RADIUS.xs,
  },
  bubbleText: {
    ...TYPE.body,
  },
  /* White on the violet user bubble in both appearances. */
  userBubbleText: {
    color: TEXT.inverse,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    marginBottom: SPACE.xs,
  },
  errorLabel: {
    ...TYPE.overline,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACE.xs,
    marginTop: SPACE.sm,
    paddingVertical: SPACE.xs,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  retryText: {
    ...TYPE.footnote,
    fontWeight: '700',
  },
  sourceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.xs,
    marginTop: SPACE.xs,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    maxWidth: 200,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  sourceChipText: {
    ...TYPE.caption,
    flexShrink: 1,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingVertical: SPACE.md,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: RADIUS.pill,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACE.sm,
    padding: SPACE.md,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    maxHeight: 96,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE.base,
    paddingVertical: SPACE.md,
    ...TYPE.body,
  },
  /* Brand fill — violet in both appearances. */
  sendButton: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: RADIUS.pill,
    backgroundColor: BRAND[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
