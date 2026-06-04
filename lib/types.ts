/**
 * Frontend Type Definitions
 * 
 * This file contains all TypeScript interfaces and types used throughout
 * the Silo mobile app. These types ensure type safety and provide
 * autocompletion for development.
 * 
 * Key Types:
 * - Item: Individual content item (link, screenshot, note)
 * - Stack: Collection of related items
 * - Classification: AI-determined content category
 */

/**
 * Content item classification types
 */
export type Classification = 
  | 'article' 
  | 'video' 
  | 'recipe' 
  | 'product' 
  | 'event' 
  | 'place' 
  | 'idea'
  | 'fitness'
  | 'food'
  | 'career'
  | 'academia'
  | 'other';

/**
 * Content item types
 */
export type ItemType = 'link' | 'screenshot' | 'note';

/**
 * Source platform for a saved link, set by the universal social-link extractor.
 * 'web' = any non-social URL (generic Open Graph). Mirrors the Worker's Platform.
 */
export type SocialPlatform =
  | 'youtube'
  | 'tiktok'
  | 'twitter'
  | 'instagram'
  | 'reddit'
  | 'threads'
  | 'facebook'
  | 'vimeo'
  | 'web';

/**
 * Individual content item saved by the user
 */
export interface Item {
  id: string;
  type: ItemType;
  classification: Classification;
  title: string;
  description?: string;
  url?: string;
  imageUri?: string;
  audio_url?: string;
  script?: string;
  tags: string[];
  stack_id?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  duration?: number;
  place_name?: string;
  place_address?: string;
  place_latitude?: number;
  place_longitude?: number;
  created_at: string;
  /** @deprecated prefer `status`; retained for back-compat. "Seen in the feed". */
  viewed: boolean;
  /** @deprecated prefer `status === 'archived'`; retained for back-compat. */
  archived: boolean;
  /** @deprecated prefer `status === 'bucketed'` + `bucketlist_meta`; retained for back-compat. */
  bucketlist?: boolean;
  /** @deprecated prefer `status === 'done'` + `completed_at`; retained for back-compat. */
  bucketlist_completed?: boolean;
  notes?: string;
  checklist?: ChecklistItem[];

  // --- Phase 2 unified schema (all optional; back-filled idempotently by lib/items.normalizeItem) ---
  /** Last modification time (ISO). Maintained by storage.updateItem / items.touchItem. */
  updated_at?: string;
  /** Completion time (ISO); set when status becomes 'done'. */
  completed_at?: string;
  /** Unified lifecycle status; supersedes the viewed/archived/bucketlist booleans. */
  status?: ItemStatus;
  /** User- or AI-assigned priority. */
  priority?: Priority;
  /** When the user should act on this (ISO date); distinct from scheduled_date (a review slot). */
  due_date?: string;
  /** Structured geo; supersedes the flat place_* fields above. */
  location?: GeoLocation;
  /** Bucket-list engine state: blocked reason, conditions, triggers, computed readiness. */
  bucketlist_meta?: BucketListMeta;
  /** Optional local copy of the item's embedding vector (enables on-device retrieval fallback). */
  embedding?: number[];
  /** Metadata about the embedding (model, dims, freshness, whether server-indexed). */
  embedding_meta?: EmbeddingMeta;
  /** OCR'd text extracted from a screenshot (feeds tagging + retrieval). */
  ocr_text?: string;
  /** Owning user id (device id today; a real account id once auth exists). */
  userId?: string;

  // --- Social extraction (set by the universal link extractor) ---
  /** Source platform of a saved link (drives the inline embed in cards/Streams). */
  platform?: SocialPlatform;
  /** Author / creator from oEmbed/OG (channel name, display name, or @handle). */
  author?: string;
}

/**
 * Checklist item for workouts, recipes, tasks, etc.
 */
export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

/**
 * Stack (collection) of related items
 */
export interface Stack {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  item_count: number;
  created_at: string;
}

/**
 * User preferences and settings
 */
export interface UserSettings {
  notifications_enabled: boolean;
  auto_schedule: boolean;
  default_duration: number;
  preferred_review_times: string[];
  theme: 'light' | 'dark' | 'auto';
}

/**
 * Calendar event for scheduled content review
 */
export interface ScheduledEvent {
  id: string;
  item_id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  calendar_event_id?: string;
}

/**
 * API response from backend image analysis
 */
export interface AnalyzeImageResponse {
  classification: Classification;
  title: string;
  description?: string;
  script?: string;
  tags?: string[];
  duration?: number;
  place_name?: string;
  place_address?: string;
}

/**
 * API response from backend link analysis
 */
export interface AnalyzeLinkResponse {
  classification: Classification;
  title: string;
  description?: string;
  script?: string;
  tags?: string[];
  duration?: number;
  place_name?: string;
  place_address?: string;
}

/**
 * API response from backend audio generation
 */
export interface GenerateAudioResponse {
  audioUrl: string;
}

/**
 * Normalized result from the universal social-link extractor (`task: 'extract'`).
 * `ok:false` means rich metadata couldn't be obtained (dead/private/login-walled)
 * — the client still saves the raw link plus whatever fields are present.
 */
export interface ExtractedLinkResponse {
  platform: SocialPlatform;
  kind: 'video' | 'image' | 'article' | 'post' | 'link';
  title: string;
  author?: string;
  caption?: string;
  /** From the classify chain; falls back to `caption`. */
  description?: string;
  thumbnailUrl?: string;
  /** Clean iframe src (YouTube/TikTok) when available. */
  embedUrl?: string;
  /** oEmbed html (TikTok/X) when provided. */
  embedHtml?: string;
  duration?: number;
  /** Resolved/canonical URL after following redirects. */
  sourceUrl: string;
  ok: boolean;
  reason?: string;
  classification: Classification;
  tags: string[];
}

/**
 * API response from backend schedule suggestion
 */
export interface ScheduleSuggestionResponse {
  date: string;
  time: string;
  reason: string;
}

/**
 * Error response from API
 */
export interface ApiErrorResponse {
  error: string;
  details?: string;
}

// =====================================================================
// Phase 2 unified-schema types
// =====================================================================

/** Unified item lifecycle status. Derived from legacy booleans by lib/items.computeStatus. */
export type ItemStatus = 'inbox' | 'scheduled' | 'bucketed' | 'done' | 'archived';

/** User- or AI-assigned priority. */
export type Priority = 'low' | 'normal' | 'high';

/** Structured geo for a saved item (supersedes flat place_* fields). */
export interface GeoLocation {
  latitude: number;
  longitude: number;
  address?: string;
  name?: string;
}

/** Metadata about an item's embedding vector. */
export interface EmbeddingMeta {
  model?: string;
  dims?: number;
  updatedAt?: string;
  /** Whether the vector has been indexed in the server-side store. */
  indexed?: boolean;
}

// ---------------------------------------------------------------------
// Bucket-list engine model
// ---------------------------------------------------------------------

/** Why an item can't be acted on yet (drives copy + which triggers to set up). */
export type BucketBlockedReason =
  | 'location_far'
  | 'wrong_time_of_day'
  | 'wrong_date_or_season'
  | 'needs_planning'
  | 'needs_another_person'
  | 'needs_money'
  | 'future_trip'
  | 'near_a_place'
  | 'someday'
  | 'other';

export type BucketConditionType =
  | 'location_proximity'
  | 'time_of_day'
  | 'date_after'
  | 'date_range'
  | 'day_of_week'
  | 'calendar_free'
  | 'manual';

interface BucketConditionBase {
  id: string;
  /** Human-readable label for UI ("Within 2 km of the trailhead"). */
  label?: string;
  /** Last time the evaluator checked this condition (ISO). */
  lastEvaluatedAt?: string;
  /** Whether the condition was satisfied at lastEvaluatedAt. */
  satisfied?: boolean;
}

export interface LocationProximityCondition extends BucketConditionBase {
  type: 'location_proximity';
  latitude: number;
  longitude: number;
  radiusMeters: number;
  placeLabel?: string;
}
export interface TimeOfDayCondition extends BucketConditionBase {
  type: 'time_of_day';
  /** Local hour window [startHour, endHour), each 0–23. */
  startHour: number;
  endHour: number;
}
export interface DateAfterCondition extends BucketConditionBase {
  type: 'date_after';
  /** Ready on/after this ISO date. */
  date: string;
}
export interface DateRangeCondition extends BucketConditionBase {
  type: 'date_range';
  startDate: string;
  endDate: string;
}
export interface DayOfWeekCondition extends BucketConditionBase {
  type: 'day_of_week';
  /** 0=Sunday … 6=Saturday. */
  daysOfWeek: number[];
}
export interface CalendarFreeCondition extends BucketConditionBase {
  type: 'calendar_free';
  minFreeMinutes: number;
}
export interface ManualCondition extends BucketConditionBase {
  type: 'manual';
  /** Optional reminder time (ISO datetime). */
  remindAt?: string;
}

/** A single condition that must be satisfied for a bucket-list item to be "ready now". */
export type BucketCondition =
  | LocationProximityCondition
  | TimeOfDayCondition
  | DateAfterCondition
  | DateRangeCondition
  | DayOfWeekCondition
  | CalendarFreeCondition
  | ManualCondition;

/** Convenience aggregate for the common geofence case. */
export interface LocationTrigger {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  placeLabel?: string;
}

/** Convenience aggregate for the common temporal case. */
export interface TimeTrigger {
  /** Local hour window, each 0–23. */
  startHour?: number;
  endHour?: number;
  /** 0=Sunday … 6=Saturday. */
  daysOfWeek?: number[];
  afterDate?: string;
  beforeDate?: string;
}

/** Per-item bucket-list state evaluated by the trigger engine. */
export interface BucketListMeta {
  blockedReason?: BucketBlockedReason;
  /** Conditions to satisfy before the item becomes actionable. */
  conditions: BucketCondition[];
  locationTrigger?: LocationTrigger;
  timeTrigger?: TimeTrigger;
  /** A user-set manual reminder (ISO datetime). */
  manualReminderAt?: string;
  suggestedNextAction?: string;
  /** Computed by the evaluation loop: every condition currently satisfied. */
  readyNow?: boolean;
  /** Why it's ready — used as the notification body. */
  readyReason?: string;
  lastEvaluatedAt?: string;
  /** When we last fired a "ready" notification, for dedupe. */
  notifiedAt?: string;
}

