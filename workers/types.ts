/**
 * Cloudflare Workers Type Definitions
 * 
 * This file contains TypeScript interfaces for Cloudflare Workers environment
 * variables and common API response types used across all worker endpoints.
 */

/**
 * Environment variables available in Cloudflare Workers context
 * These are configured in wrangler.toml and Cloudflare dashboard
 */
export interface Env {
  // Google Gemini API key for image and link analysis
  GEMINI_API_KEY: string;
  
  // ElevenLabs API configuration
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  
  // Vultr Object Storage configuration
  VULTR_ACCESS_KEY: string;
  VULTR_SECRET_KEY: string;
  VULTR_BUCKET: string;
  VULTR_ENDPOINT: string;
  VULTR_CDN_DOMAIN: string;
}

/**
 * Classification result returned by AI analysis
 */
export interface ClassificationResult {
  classification: 'article' | 'video' | 'recipe' | 'product' | 'event' | 'place' | 'idea' | 'other';
  title: string;
  description?: string;
  script?: string;
  tags?: string[];
  duration?: number;
  place_name?: string;
  place_address?: string;
}

/**
 * Schedule suggestion response
 */
export interface ScheduleSuggestion {
  date: string;
  time: string;
  reason: string;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

