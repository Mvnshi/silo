/**
 * Date/time helpers for the app's stored 'YYYY-MM-DD' (date) and 'HH:MM' (time)
 * strings.
 *
 * Why parseLocalDate exists: `new Date('2026-06-05')` is parsed as **UTC**
 * midnight, so in any negative-UTC timezone it renders / pre-fills the PREVIOUS
 * day. These helpers build dates from the parts in LOCAL time to avoid that
 * off-by-one — use them everywhere a stored date string becomes a Date.
 */

/** Parse a 'YYYY-MM-DD' (with optional 'HH:MM') string as a LOCAL Date. */
export function parseLocalDate(dateStr: string, timeStr?: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = (timeStr ?? '00:00').split(':').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0);
}

/** Format a Date as 'YYYY-MM-DD' in LOCAL time (inverse of parseLocalDate). */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Default review slot used as a scheduling pre-fill: tomorrow at 09:00. */
export function defaultReviewSlot(): { date: string; time: string } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: toLocalDateString(tomorrow), time: '09:00' };
}
