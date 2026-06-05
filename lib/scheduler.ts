/**
 * Calendar scheduling — bridges saved items to the device's native calendar.
 *
 * `scheduleItemReview` is idempotent per item: scheduling (or re-scheduling) an
 * item first removes any prior review event — both the native calendar entry and
 * the stored row — so the calendar never accumulates duplicates. Stored events
 * live in AsyncStorage (lib/storage) and mirror the native events created here.
 *
 * Dependencies: expo-calendar (native calendar), lib/storage (persisted events).
 */

import * as Calendar from 'expo-calendar';
import { Item, ScheduledEvent } from './types';
import { addEvent, removeEventsForItem } from './storage';
import { newId } from './items';

/** Prefix for the native calendar event title, e.g. "Review: My Article". */
export const REVIEW_PREFIX = 'Review: ';

/** Request calendar permissions. Returns true if granted. */
export async function requestCalendarPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('Failed to request calendar permissions:', error);
    return false;
  }
}

/** Find a writable calendar to schedule into. Returns its id, or null if none. */
async function getDefaultCalendar(): Promise<string | null> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.find((cal) => cal.isPrimary || cal.allowsModifications);
    return writable?.id || (calendars.length > 0 ? calendars[0].id : null);
  } catch (error) {
    console.error('Failed to get default calendar:', error);
    return null;
  }
}

/**
 * Schedule a content-review event for an item. Idempotent: any existing review
 * event for this item is removed (native + stored) before the new one is
 * created, so re-scheduling replaces rather than duplicates.
 *
 * @param item     item to schedule a review for
 * @param date     YYYY-MM-DD
 * @param time     HH:MM
 * @param duration minutes (default 15)
 * @returns the stored event, or null if scheduling failed
 */
export async function scheduleItemReview(
  item: Item,
  date: string,
  time: string,
  duration: number = 15
): Promise<ScheduledEvent | null> {
  try {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) throw new Error('Calendar permission not granted');

    const calendarId = await getDefaultCalendar();
    if (!calendarId) throw new Error('No calendar available');

    // Idempotency: drop any prior review for this item (native + stored).
    const stale = await removeEventsForItem(item.id);
    for (const ev of stale) {
      if (ev.calendar_event_id) {
        try {
          await Calendar.deleteEventAsync(ev.calendar_event_id);
        } catch {
          // Already gone from the native calendar — ignore.
        }
      }
    }

    // Build local start/end from the parts (avoids `new Date(string)` UTC drift).
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    const startDate = new Date(year, month - 1, day, hours, minutes);
    const endDate = new Date(startDate.getTime() + duration * 60000);

    const eventId = await Calendar.createEventAsync(calendarId, {
      title: `${REVIEW_PREFIX}${item.title}`,
      notes: item.description || `Review ${item.type} content`,
      startDate,
      endDate,
      alarms: [{ relativeOffset: -15 }], // remind 15 min before
    });

    const scheduledEvent: ScheduledEvent = {
      id: newId('event'),
      item_id: item.id,
      title: item.title,
      date,
      time,
      duration,
      calendar_event_id: eventId,
    };
    await addEvent(scheduledEvent);
    return scheduledEvent;
  } catch (error) {
    console.error('Failed to schedule item review:', error);
    return null;
  }
}
