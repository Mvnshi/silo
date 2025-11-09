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
  | 'other';

/**
 * Content item types
 */
export type ItemType = 'link' | 'screenshot' | 'note';

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
  created_at: string;
  viewed: boolean;
  archived: boolean;
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
}

/**
 * API response from backend audio generation
 */
export interface GenerateAudioResponse {
  audioUrl: string;
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

