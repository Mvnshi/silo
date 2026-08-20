/**
 * Local notifications — the "recommendation comes to you" half of the VISION
 * loop, done entirely on-device.
 *
 * These are LOCAL notifications only. No push token, no device registration, no
 * server that knows what you saved — which is the only architecture consistent
 * with the privacy stance (VISION.md "Privacy architecture is the moat").
 *
 * Three lanes, each mapping to a mechanic that already exists in
 * lib/resurface.ts:
 *
 *  1. **Daily digest** — "3 things you could do today", at the user's first
 *     preferred review time. This is the product's core promise: you don't ask,
 *     it volunteers.
 *  2. **After-event check-in** — fires shortly after a scheduled slot ends:
 *     "How did the HIIT workout go?" Nothing else on the phone asks this, and
 *     it is what feeds the north-star metric.
 *  3. **Weekly tidy-up** — "N saves are going stale", the anti-hoarding nudge.
 *  4. **Trigger fired** — the conditions you attached to a bucket-list item just
 *     became true ("You said when you had half an hour"). This is the one lane
 *     that is genuinely proactive rather than periodic, and it is why the
 *     trigger engine exists: the recommendation arrives at the moment it is
 *     actionable, without the app being open.
 *
 * We deliberately do NOT mirror calendar reminders: `scheduleItemReview` already
 * creates a real calendar event, and iOS Calendar fires its own alert. Doubling
 * it would be noise, and noise is how notification permission gets revoked.
 *
 * Everything is rebuilt from scratch on each sync (cancel-then-schedule), so
 * repeated calls are idempotent and stale reminders can't accumulate.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Item, UserSettings } from './types';
import { getCleanupCandidates } from './stats';
import { scheduledEnd } from './resurface';
import { isSchedulable, nextReadyAt } from './triggers';

/** Tags every notification this module owns, so we never cancel someone else's. */
const OWNER = 'silo';

export type SiloNotificationKind = 'digest' | 'checkin' | 'tidy' | 'ready';

interface SiloNotificationData extends Record<string, unknown> {
  owner: typeof OWNER;
  kind: SiloNotificationKind;
  /** Deep-link target, so tapping the notification lands somewhere useful. */
  route: string;
  itemId?: string;
}

/** Minutes after a scheduled slot ends before we ask how it went. */
const CHECKIN_DELAY_MIN = 20;
/** Don't queue more than this many check-ins — iOS caps pending locals at 64. */
const MAX_CHECKINS = 24;
/** And leave room for the trigger lane inside that same 64. */
const MAX_READY = 16;

/**
 * Install the foreground presentation handler. Call once at app boot, at module
 * scope level — not inside a component that might remount.
 */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask for permission. Returns whether we're allowed to post.
 *
 * Only call this from a moment where the user has just expressed intent (the
 * Settings toggle, or the onboarding priming slide) — a cold prompt is the
 * highest-denial-rate pattern on iOS.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch (error) {
    console.warn('Notification permission request failed:', error);
    return false;
  }
}

/** Whether we currently hold permission, without prompting. */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Cancel every notification this module owns, leaving any others alone. */
export async function cancelSiloNotifications(): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((n) => (n.content.data as SiloNotificationData | undefined)?.owner === OWNER)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch (error) {
    console.warn('Failed to clear Silo notifications:', error);
  }
}

/**
 * Rebuild the entire local-notification schedule from current state.
 *
 * Idempotent by construction: it cancels everything it owns first, so calling it
 * on every foreground can't accumulate duplicates. Silently no-ops when the
 * user has notifications off or permission is missing — this must never block
 * or throw into app startup.
 */
export async function syncNotifications(
  items: Item[],
  settings: UserSettings,
  now: Date = new Date()
): Promise<void> {
  try {
    if (!settings.notifications_enabled) {
      await cancelSiloNotifications();
      return;
    }
    if (!(await hasNotificationPermission())) return;

    await cancelSiloNotifications();

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('silo', {
        name: 'Silo',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await Promise.all([
      scheduleDigest(items, settings),
      scheduleCheckins(items, now),
      scheduleTidyNudge(items, settings, now),
      scheduleReadyTriggers(items, now),
    ]);
  } catch (error) {
    // Notifications are a nicety; a failure here must never affect the app.
    console.warn('Notification sync failed:', error);
  }
}

/* ---------------------------------------------------------------------------
 * Lanes
 * ------------------------------------------------------------------------- */

/**
 * The daily "here's what you could do" nudge, repeating at the user's first
 * preferred review time. Copy is deliberately specific — a generic "You have
 * saved items" is exactly the notification people mute.
 */
async function scheduleDigest(items: Item[], settings: UserSettings): Promise<void> {
  const actionable = items.filter(
    (i) => !i.archived && i.status !== 'archived' && i.status !== 'done' && !i.viewed
  ).length;
  if (actionable === 0) return;

  const [hour, minute] = parseTime(settings.preferred_review_times?.[0] ?? '09:00');

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '3 things you could do today',
      body:
        actionable === 1
          ? 'One saved thing is waiting on you.'
          : `${actionable} saved things are waiting. Here are the ones worth doing.`,
      data: { owner: OWNER, kind: 'digest', route: '/(tabs)/calendar' } satisfies SiloNotificationData,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

/**
 * One check-in per upcoming scheduled item, fired after the slot ends. This is
 * the only lane that references a specific item, so it deep-links straight to
 * the Today view where the verdict buttons live.
 */
async function scheduleCheckins(items: Item[], now: Date): Promise<void> {
  const upcoming = items
    .filter((item) => {
      if (item.archived || item.status === 'archived' || item.status === 'done') return false;
      const end = scheduledEnd(item);
      return end !== null && end.getTime() > now.getTime();
    })
    .sort((a, b) => (scheduledEnd(a)?.getTime() ?? 0) - (scheduledEnd(b)?.getTime() ?? 0))
    .slice(0, MAX_CHECKINS);

  await Promise.all(
    upcoming.map((item) => {
      const end = scheduledEnd(item);
      if (!end) return Promise.resolve();
      const fireAt = new Date(end.getTime() + CHECKIN_DELAY_MIN * 60_000);
      return Notifications.scheduleNotificationAsync({
        content: {
          title: 'How did it go?',
          body: item.title,
          data: {
            owner: OWNER,
            kind: 'checkin',
            route: '/(tabs)/calendar',
            itemId: item.id,
          } satisfies SiloNotificationData,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
      });
    })
  );
}

/**
 * A weekly tidy-up nudge, only when there is actually a pile worth clearing.
 * Threshold rather than "any stale item" so this stays rare enough to be worth
 * reading.
 */
async function scheduleTidyNudge(
  items: Item[],
  settings: UserSettings,
  now: Date
): Promise<void> {
  const stale = getCleanupCandidates(items, now).length;
  if (stale < 10) return;

  const [hour, minute] = parseTime(settings.preferred_review_times?.[0] ?? '09:00');

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${stale} saves are going stale`,
      body: 'Keep the ones you still want, let the rest go. Takes a minute.',
      data: { owner: OWNER, kind: 'tidy', route: '/stats' } satisfies SiloNotificationData,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      // 1 = Sunday in expo-notifications' weekday numbering.
      weekday: 1,
      hour,
      minute,
    },
  });
}

/** 'HH:MM' → [hour, minute], falling back to 9am on anything unparseable. */
function parseTime(value: string): [number, number] {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  const hour = Number.isFinite(h) && h >= 0 && h <= 23 ? h : 9;
  const minute = Number.isFinite(m) && m >= 0 && m <= 59 ? m : 0;
  return [hour, minute];
}

/** The route a tapped notification should open. */
/**
 * The trigger lane: one notification per item, fired at the instant its
 * conditions become true.
 *
 * Only items whose conditions are predictable from the clock get one — see
 * `isSchedulable`. An item gated on where you are, or on how free your
 * afternoon is, cannot be scheduled ahead of time without background location
 * or a calendar daemon, so it stays a foreground evaluation and appears in
 * Today (and in the digest) instead. Being honest about that boundary is what
 * keeps this lane trustworthy: every notification it sends is one the user
 * actually asked for, at a moment that is actually true.
 *
 * Rebuilt from scratch on every sync, like every other lane, so a condition the
 * user edits or an item they complete cannot leave a stale alarm behind.
 */
async function scheduleReadyTriggers(items: Item[], now: Date): Promise<void> {
  const candidates = items
    .filter((item) => {
      if (item.archived || item.status === 'archived') return false;
      if (item.status === 'done' || item.bucketlist_completed) return false;
      if (item.rating === 'retired') return false;
      // Something already on the calendar will produce its own event alert;
      // two notifications for one intention is how permission gets revoked.
      if (item.scheduled_date) return false;
      return isSchedulable(item);
    })
    .map((item) => ({ item, at: nextReadyAt(item, now) }))
    .filter((entry): entry is { item: Item; at: Date } => entry.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_READY);

  await Promise.all(
    candidates.map(({ item, at }) =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Now’s a good time',
          // The item's own words, not ours — the user wrote the condition, so
          // the notification should read like their note coming back.
          body: item.title,
          data: {
            owner: OWNER,
            kind: 'ready',
            route: `/item/${item.id}`,
            itemId: item.id,
          } satisfies SiloNotificationData,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
      })
    )
  );
}

export function routeForResponse(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as SiloNotificationData | undefined;
  if (!data || data.owner !== OWNER) return null;
  return data.route ?? null;
}
