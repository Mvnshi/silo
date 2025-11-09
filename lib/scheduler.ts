/**
 * Calendar Scheduling Module
 * 
 * This module handles integration with the device's native calendar app
 * to schedule content review sessions. It creates calendar events for
 * items based on AI suggestions or manual user input.
 * 
 * Features:
 * - Request calendar permissions
 * - Create calendar events for content review
 * - Update scheduled events
 * - Delete events
 * 
 * Dependencies:
 * - expo-calendar: Native calendar integration
 * - lib/storage: For persisting scheduled events
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { Item, ScheduledEvent } from './types';
import { getEvents, saveEvents } from './storage';

/**
 * Request calendar permissions from the user
 * 
 * @returns true if permission granted, false otherwise
 */
export async function requestCalendarPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('Failed to request calendar permissions:', error);
    return false;
  }
}

/**
 * Get the default calendar to use for scheduling
 * 
 * @returns Calendar ID or null if no calendar available
 */
async function getDefaultCalendar(): Promise<string | null> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    
    // Find the primary/default calendar
    const defaultCalendar = calendars.find(
      cal => cal.isPrimary || cal.allowsModifications
    );
    
    return defaultCalendar?.id || (calendars.length > 0 ? calendars[0].id : null);
  } catch (error) {
    console.error('Failed to get default calendar:', error);
    return null;
  }
}

/**
 * Schedule a content review event in the device calendar
 * 
 * @param item - Item to schedule
 * @param date - Date string (YYYY-MM-DD)
 * @param time - Time string (HH:MM)
 * @param duration - Duration in minutes (default: 15)
 * @returns Scheduled event or null if failed
 */
export async function scheduleItemReview(
  item: Item,
  date: string,
  time: string,
  duration: number = 15
): Promise<ScheduledEvent | null> {
  try {
    // Check permissions
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) {
      throw new Error('Calendar permission not granted');
    }

    // Get default calendar
    const calendarId = await getDefaultCalendar();
    if (!calendarId) {
      throw new Error('No calendar available');
    }

    // Parse date and time
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    
    const startDate = new Date(year, month - 1, day, hours, minutes);
    const endDate = new Date(startDate.getTime() + duration * 60000);

    // Create calendar event
    const eventId = await Calendar.createEventAsync(calendarId, {
      title: `Review: ${item.title}`,
      notes: item.description || `Review ${item.type} content`,
      startDate,
      endDate,
      alarms: [{ relativeOffset: -15 }], // Remind 15 min before
    });

    // Create scheduled event object
    const scheduledEvent: ScheduledEvent = {
      id: `event_${Date.now()}`,
      item_id: item.id,
      title: item.title,
      date,
      time,
      duration,
      calendar_event_id: eventId,
    };

    // Save to storage
    const events = await getEvents();
    events.push(scheduledEvent);
    await saveEvents(events);

    return scheduledEvent;
  } catch (error) {
    console.error('Failed to schedule item review:', error);
    return null;
  }
}

/**
 * Update a scheduled event
 * 
 * @param eventId - Event ID
 * @param date - New date string (YYYY-MM-DD)
 * @param time - New time string (HH:MM)
 * @returns true if successful, false otherwise
 */
export async function updateScheduledEvent(
  eventId: string,
  date: string,
  time: string
): Promise<boolean> {
  try {
    const events = await getEvents();
    const event = events.find(e => e.id === eventId);
    
    if (!event || !event.calendar_event_id) {
      return false;
    }

    // Parse date and time
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    
    const startDate = new Date(year, month - 1, day, hours, minutes);
    const endDate = new Date(startDate.getTime() + event.duration * 60000);

    // Update calendar event
    await Calendar.updateEventAsync(event.calendar_event_id, {
      startDate,
      endDate,
    });

    // Update stored event
    event.date = date;
    event.time = time;
    await saveEvents(events);

    return true;
  } catch (error) {
    console.error('Failed to update scheduled event:', error);
    return false;
  }
}

/**
 * Delete a scheduled event
 * 
 * @param eventId - Event ID
 * @returns true if successful, false otherwise
 */
export async function deleteScheduledEvent(eventId: string): Promise<boolean> {
  try {
    const events = await getEvents();
    const event = events.find(e => e.id === eventId);
    
    if (!event) {
      return false;
    }

    // Delete from calendar if calendar event exists
    if (event.calendar_event_id) {
      await Calendar.deleteEventAsync(event.calendar_event_id);
    }

    // Remove from storage
    const filtered = events.filter(e => e.id !== eventId);
    await saveEvents(filtered);

    return true;
  } catch (error) {
    console.error('Failed to delete scheduled event:', error);
    return false;
  }
}

/**
 * Get all scheduled events for a specific date
 * 
 * @param date - Date string (YYYY-MM-DD)
 * @returns Array of scheduled events
 */
export async function getEventsForDate(date: string): Promise<ScheduledEvent[]> {
  const events = await getEvents();
  return events.filter(event => event.date === date);
}

/**
 * Get all upcoming scheduled events
 * 
 * @returns Array of scheduled events sorted by date/time
 */
export async function getUpcomingEvents(): Promise<ScheduledEvent[]> {
  const events = await getEvents();
  const now = new Date();
  
  return events
    .filter(event => {
      const eventDate = new Date(`${event.date}T${event.time}`);
      return eventDate >= now;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time}`);
      const dateB = new Date(`${b.date}T${b.time}`);
      return dateA.getTime() - dateB.getTime();
    });
}

