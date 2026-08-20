/**
 * Floating assistant sheet.
 *
 * Grounded Q&A over the user's own saves, and grounded ACTIONS on them.
 * Retrieval runs on-device: the question is matched against the library with
 * `aiSearch` and only the matching items are sent to the Gemini proxy to be
 * phrased, so answers are about what the user actually saved rather than "the 30
 * newest things". Every answer renders its sources as chips that deep-link to
 * the item.
 *
 * When the user asks for something to be DONE, the model proposes it as a
 * structured action and the sheet renders it as a card — see
 * `components/assistant/ActionCard.tsx` for why a card rather than the app's
 * usual apply-then-Undo. Nothing here mutates anything until that card is
 * tapped; `lib/assistant.parseActions` is what guarantees the card can only ever
 * name rows this component itself put on the wire.
 *
 * Mounted once, at the root, by `components/AssistantProvider.tsx`. Open/close
 * state and the FAB live there — this component is told whether it is `visible`.
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
import { aiSearch, isPremiumRequired, ragQuery, type AssistantContextItem } from '@/lib/api';
import { getItems } from '@/lib/storage';
import { getCleanupCandidates } from '@/lib/stats';
import { parseActions, type AssistantAction } from '@/lib/assistant';
import { confirmationMessage, runAction } from '@/lib/assistantExec';
import { bumpDataVersion } from '@/lib/dataVersion';
import { parseLocalDate, toLocalDateString } from '@/lib/datetime';
import * as Haptics from 'expo-haptics';
import { celebrationHaptic } from '@/lib/haptics';
import type { Item } from '@/lib/types';
import ActionCard, { withItems, type CardState } from '@/components/assistant/ActionCard';
import Glass from '@/components/ui/Glass';
import PressableScale from '@/components/ui/PressableScale';
import EmptyState from '@/components/ui/EmptyState';
import { ShimmerText } from '@/components/ui/Shimmer';
import { useToast } from '@/components/ui/Toast';
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

/** How many retrieved items we hand the model. Enough context, bounded cost. */
const RETRIEVAL_LIMIT = 30;

/**
 * Below this many keyword hits, the question is treated as being about the
 * library as a whole rather than a topic — see `groundingFor`.
 */
const MIN_KEYWORD_HITS = 3;

/** Stale items offered as context to a corpus-wide question. */
const CLEANUP_LANE = 12;
/** Upcoming scheduled items offered to the same. */
const UPCOMING_LANE = 8;
/** How far ahead "upcoming" reaches. Matches the trigger engine's lookahead. */
const UPCOMING_DAYS = 14;

const GREETING =
  "Hi — I'm Silo. Ask me about anything you've saved, or tell me what to do with it.\n\nTry:\n• \"What did I save about LangChain?\"\n• \"Schedule the ramen recipe for Saturday morning\"\n• \"Remind me about the trailhead hike when I'm near it\"\n• \"Archive everything I haven't touched since June\"";

/**
 * Monotonic ids for messages and proposed actions.
 *
 * `Date.now()` collides when two land in the same millisecond, so this counts
 * instead — but a bare counter is not enough on its own: Fast Refresh
 * re-evaluates this module and resets it to zero while the component's
 * `messages` state survives, so the next message reuses a key already on screen
 * and React duplicates or drops a bubble. The per-evaluation prefix keeps ids
 * unique across a reload as well as within one.
 */
let messageSeq = 0;
const ID_EPOCH = Math.random().toString(36).slice(2, 7);
const nextId = () => `m${ID_EPOCH}${++messageSeq}`;

interface ChatSource {
  id: string;
  title: string;
}

/** One proposed action plus where its card is in its life. */
interface ProposedAction {
  id: string;
  action: AssistantAction;
  state: CardState;
  error?: string;
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  /** Saved items the answer was grounded on — rendered as deep-link chips. */
  sources?: ChatSource[];
  /** Things the assistant is offering to do. Nothing runs until a card is tapped. */
  actions?: ProposedAction[];
  /** This bubble is a failure, not an answer: distinct styling + retryable. */
  isError?: boolean;
  /**
   * This bubble is the premium gate, not a failure. It is deliberately NOT an
   * error: the previous behaviour surfaced the raw gate message in a red
   * "Couldn't answer" bubble with a Try again button that could never work, so
   * the one moment the assistant proves what it is worth read as a bug.
   */
  isUpgrade?: boolean;
  /** The question to re-run when the user taps "Try again". */
  retryQuery?: string;
}

interface ChatBotProps {
  /** Open state is owned by AssistantProvider, not by this component. */
  visible: boolean;
  onClose: () => void;
  /** Pre-fills the composer, e.g. when opened from a specific item. */
  prefill?: string;
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
 * Everything the assistant is allowed to see or touch.
 *
 * `storage.getItems()` returns archived rows too — every screen filters them
 * itself. The assistant must as well: archived is the user saying "not this",
 * and an assistant that answers from put-away content, or offers to archive it
 * again, is overruling them.
 */
async function activeItems(): Promise<Item[]> {
  const items = await getItems();
  return items.filter((item) => !item.archived && item.status !== 'archived');
}

/** Items scheduled between now and `UPCOMING_DAYS` out, soonest first. */
function upcoming(items: Item[], now: Date): Item[] {
  const horizon = now.getTime() + UPCOMING_DAYS * 24 * 60 * 60 * 1000;
  return items
    .filter((item) => {
      if (!item.scheduled_date || item.archived || item.status === 'archived') return false;
      const at = parseLocalDate(item.scheduled_date, item.scheduled_time || '09:00').getTime();
      return at >= now.getTime() && at <= horizon;
    })
    .sort(
      (a, b) =>
        parseLocalDate(a.scheduled_date!, a.scheduled_time || '09:00').getTime() -
        parseLocalDate(b.scheduled_date!, b.scheduled_time || '09:00').getTime()
    );
}

/**
 * Decide what the model gets to see — and therefore what it is able to act on.
 *
 * Keyword retrieval answers a question ABOUT something. It cannot answer a
 * question about the library as a WHOLE: "archive everything I haven't touched
 * since June" selects on staleness, which is a structural property, not a word.
 * The old fallback for a keyword miss was "the newest 30", which meant such a
 * request could only ever act on an arbitrary slice.
 *
 * So a thin keyword result falls back to Silo's own structural lanes instead —
 * the cleanup pile and what's coming up — which is what those questions are
 * actually about. A rich keyword result is left alone, so a topic question pays
 * for nothing extra.
 */
function groundingFor(all: Item[], matched: Item[], now: Date): Item[] {
  if (matched.length >= MIN_KEYWORD_HITS) return matched.slice(0, RETRIEVAL_LIMIT);

  const out: Item[] = [];
  const seen = new Set<string>();
  const take = (items: Item[], limit: number) => {
    let taken = 0;
    for (const item of items) {
      if (out.length >= RETRIEVAL_LIMIT || taken >= limit) break;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      taken += 1;
    }
  };

  take(matched, matched.length);
  take(getCleanupCandidates(all, now), CLEANUP_LANE);
  take(upcoming(all, now), UPCOMING_LANE);
  take(all, RETRIEVAL_LIMIT); // newest, to fill whatever is left
  return out;
}

/** What the sheet is waiting on. Retrieval is local and quick; the model is not. */
type Thinking = null | 'retrieving' | 'asking';

const THINKING_LABEL: Record<Exclude<Thinking, null>, string> = {
  retrieving: 'Reading your library',
  asking: 'Thinking',
};

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
    // The gate bubble wears the brand, not the danger palette — it is an offer.
    upgradeBubble: { backgroundColor: c.brandSoft, borderColor: c.brandBorder },
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

export default function ChatBot({ visible, onClose, prefill }: ChatBotProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = usePrefersReducedMotion();
  const keyboard = useAnimatedKeyboard();
  const c = useThemeColors();
  const toast = useToast();
  const dyn = useMemo(() => makeDynamicStyles(c), [c]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), text: GREETING, isUser: false },
  ]);
  const [inputText, setInputText] = useState('');
  const [thinking, setThinking] = useState<Thinking>(null);
  /** null until the library has been counted, so we don't flash the empty state. */
  const [libraryEmpty, setLibraryEmpty] = useState<boolean | null>(null);
  /**
   * Titles for whatever the action cards name. Every id in here was in a
   * grounding set this component sent, so a card can never name something the
   * user does not have.
   */
  const [library, setLibrary] = useState<ReadonlyMap<string, Item>>(new Map());

  const scrollRef = useRef<ScrollView>(null);
  /** 0 = parked below the screen, 1 = open. Drives a translate, never opacity. */
  const progress = useSharedValue(0);

  useEffect(() => {
    const target = visible ? 1 : 0;
    // `gentle`, not `settle`: settle is damped for the 0.03 of travel a press
    // scale covers, where its ~15% overshoot is 0.004 and invisible. This sheet
    // travels ~530pt, so the same spring threw it 77pt past its resting point
    // and bounced it back. `gentle` is critically damped — see SPRING in
    // lib/theme, which already names it the token for long travel.
    progress.value = reduced ? target : withSpring(target, SPRING.gentle);
  }, [visible, progress, reduced]);

  // Opened with a question already in mind (e.g. from an item screen).
  useEffect(() => {
    if (visible && prefill) setInputText(prefill);
  }, [visible, prefill]);

  // An empty library has nothing to ground an answer on — check on open so we
  // can short-circuit the model entirely instead of paying for "you have none".
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    activeItems()
      .then((items) => {
        if (alive) setLibraryEmpty(items.length === 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible]);

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

  const openSource = useCallback(
    (id: string) => {
      onClose();
      router.push(`/item/${id}`);
    },
    [onClose, router]
  );

  /** Retrieve → ask → append. Errors land as a retryable (or payable) bubble. */
  const runQuery = useCallback(async (question: string) => {
    setThinking('retrieving');
    try {
      const allItems = await activeItems();
      // Nothing to ground on — never spend a model call to say "you have none".
      if (allItems.length === 0) {
        setLibraryEmpty(true);
        return;
      }

      const now = new Date();
      const matched = await retrieve(question, allItems);
      const grounding = groundingFor(allItems, matched, now);

      // Remember the titles so an action card can name what it will touch.
      setLibrary((prev) => {
        const next = new Map(prev);
        for (const item of grounding) next.set(item.id, item);
        return next;
      });

      setThinking('asking');
      const response = await ragQuery({
        query: question,
        items: grounding.map(
          (item): AssistantContextItem => ({
            id: item.id,
            title: item.title,
            description: item.description,
            tags: item.tags,
            classification: item.classification,
            scheduled_date: item.scheduled_date,
            status: item.status,
          })
        ),
        // The device's clock, not the Worker's: "Saturday morning" is only
        // meaningful in the user's own timezone.
        today: toLocalDateString(now),
        now: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
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

      // The third grounding layer: whatever the Worker returned, only ids THIS
      // component put on the wire survive. See lib/assistant.ts.
      const actions = parseActions(response.actions, new Set(byId.keys())).map((action) => ({
        id: nextId(),
        action,
        state: 'idle' as CardState,
      }));

      setMessages((prev) => [
        ...prev,
        { id: nextId(), text: response.answer, isUser: false, sources, actions },
      ]);
    } catch (error) {
      // The gate is an offer, not a failure. Retrying it can never succeed, so
      // this bubble gets a way forward instead of a way to try again.
      if (isPremiumRequired(error)) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            text: 'Asking Silo about your library is part of Premium. Everything you’ve saved stays right where it is.',
            isUser: false,
            isUpgrade: true,
          },
        ]);
        return;
      }
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
      setThinking(null);
    }
  }, []);

  /** Update one card's state in place, leaving the rest of the thread alone. */
  const patchAction = useCallback(
    (messageId: string, actionId: string, patch: Partial<ProposedAction>) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id !== messageId
            ? message
            : {
                ...message,
                actions: message.actions?.map((entry) =>
                  entry.id === actionId ? { ...entry, ...patch } : entry
                ),
              }
        )
      );
    },
    []
  );

  /**
   * Run one proposed action against the rows still ticked on its card.
   *
   * The narrowed action — not the original — is what executes, so what the card
   * says and what happens are the same value. Success is confirmed in the Toast
   * WITH Undo, which is where every other destructive action in the app puts it.
   */
  const applyAction = useCallback(
    async (messageId: string, entry: ProposedAction, itemIds: string[]) => {
      const action = withItems(entry.action, itemIds);
      patchAction(messageId, entry.id, { state: 'running', error: undefined });

      const result = await runAction(action);

      if (result.changed === 0) {
        patchAction(messageId, entry.id, {
          state: 'failed',
          error: result.error ?? 'Nothing changed.',
        });
        return;
      }

      patchAction(messageId, entry.id, { state: 'done' });
      // Screens behind the sheet never lost focus, so nothing would reload.
      bumpDataVersion();
      // The escalating celebration belongs to things that went WELL — putting it
      // on a six-item archive would congratulate someone for tidying up.
      if (action.tool === 'archive' || action.tool === 'set_trigger') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        void celebrationHaptic();
      }

      const partial = result.failed > 0 ? ` (${result.failed} couldn’t be updated)` : '';
      toast.show({
        message: confirmationMessage(action, result.changed) + partial,
        tone: result.failed > 0 ? 'neutral' : 'success',
        // The model picked these rows, not the user — see DURATION.toastLong.
        duration: DURATION.toastLong,
        action: {
          label: 'Undo',
          onPress: async () => {
            await result.undo();
            bumpDataVersion();
            // Back to idle rather than gone: undoing a suggestion is a change of
            // mind, and the offer should still be there to take up again.
            patchAction(messageId, entry.id, { state: 'idle', error: undefined });
          },
        },
      });
    },
    [patchAction, toast]
  );

  const dismissAction = useCallback(
    (messageId: string, actionId: string) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id !== messageId
            ? message
            : { ...message, actions: message.actions?.filter((entry) => entry.id !== actionId) }
        )
      );
    },
    []
  );

  const loading = thinking !== null;

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
      {visible && (
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
            onPress={onClose}
          />
        </Animated.View>
      )}

      <Animated.View
        style={[styles.sheet, { bottom: bottomGap }, sheetStyle]}
        pointerEvents={visible ? 'auto' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
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
                  Ask about your saves, or tell me what to do
                </Text>
              </View>
            </View>
            <PressableScale
              haptic="light"
              accessibilityLabel="Close assistant"
              style={styles.closeButton}
              onPress={onClose}
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
                subtitle="Save a few links or notes and I'll answer questions about them — and do things with them."
                cta={{ label: 'Start capturing', onPress: onClose }}
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
                            : message.isUpgrade
                              ? [styles.upgradeBubble, dyn.upgradeBubble]
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

                      {message.isUpgrade && (
                        <View style={styles.errorHeader}>
                          <Ionicons name="sparkles" size={15} color={c.brand} />
                          <Text style={[styles.errorLabel, { color: c.textBrand }]}>
                            Silo Premium
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

                      {message.isUpgrade && (
                        <PressableScale
                          haptic="light"
                          accessibilityLabel="See Silo Premium"
                          style={[styles.retryButton, { borderColor: c.brandBorder }]}
                          onPress={() => {
                            onClose();
                            router.push('/paywall?context=assistant');
                          }}
                        >
                          <Ionicons name="sparkles" size={14} color={c.brand} />
                          <Text style={[styles.retryText, { color: c.textBrand }]}>
                            See Premium
                          </Text>
                        </PressableScale>
                      )}

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

                    {message.actions?.map((entry) => (
                      <ActionCard
                        key={entry.id}
                        action={entry.action}
                        items={library}
                        state={entry.state}
                        error={entry.error}
                        onRun={(itemIds) => void applyAction(message.id, entry, itemIds)}
                        onDismiss={() => dismissAction(message.id, entry.id)}
                      />
                    ))}

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

                {thinking && (
                  <Animated.View
                    entering={FadeIn.duration(DURATION.fast)}
                    style={[styles.bubble, styles.botBubble, dyn.botBubble, styles.typingBubble]}
                  >
                    {[0, 1, 2].map((i) => (
                      <TypingDot key={i} index={i} reduced={reduced} />
                    ))}
                    {/* Retrieval is on-device and the model call is not, so
                        naming the phase is the difference between "working" and
                        "stuck". */}
                    <ShimmerText style={styles.thinkingLabel}>
                      {THINKING_LABEL[thinking]}
                    </ShimmerText>
                  </Animated.View>
                )}
              </ScrollView>

              <View style={[styles.composer, dyn.composer]}>
                <TextInput
                  style={[styles.input, dyn.input]}
                  placeholder="Ask, or tell me what to do…"
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
  /**
   * NO zIndex. It used to carry `zIndex: 1000`, which was harmless while the
   * sheet was mounted inside the Add tab and merely had to sit above that
   * screen's content. Mounted at the root it is actively wrong: the Toast is a
   * later sibling and should paint above the sheet, but Fabric flattens away
   * the plain wrapper `View` that AssistantProvider puts around this component,
   * which makes the sheet a DIRECT sibling of the Toast — and 1000 beats the
   * Toast's 0. The result was an Undo that mounted, logged, and rendered
   * underneath the sheet where nobody could ever tap it.
   *
   * Document order is all this needs now: the sheet is mounted after the
   * navigator and before the Toast, so it covers the app and the Toast covers
   * it. Adding a zIndex here again would re-break Undo.
   */
  wrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  backdropTint: {
    flex: 1,
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
    flexShrink: 1,
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
  upgradeBubble: {
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
  thinkingLabel: {
    marginLeft: SPACE.xs,
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
