/**
 * Backend API Client
 * 
 * Handles all communication with Cloudflare Workers backend.
 * All AI processing (image analysis, link analysis, audio generation)
 * goes through these API endpoints.
 * 
 * Features:
 * - Image analysis with Gemini AI
 * - Link/URL analysis with Gemini AI
 * - Text-to-speech audio generation with ElevenLabs
 * - Schedule suggestions with Gemini AI
 * 
 * Environment Variable Required:
 * - EXPO_PUBLIC_API_BASE_URL: Cloudflare Worker base URL
 * 
 * Dependencies:
 * - None (uses native fetch)
 */

import {
  AnalyzeImageResponse,
  AnalyzeLinkResponse,
  GenerateAudioResponse,
  ScheduleSuggestionResponse,
  InstagramDownloadResponse,
  ApiErrorResponse,
} from './types';

// Get API base URL from environment variable
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';

/**
 * Check if API is configured
 */
export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

/**
 * Handle API errors
 */
function handleApiError(error: unknown): never {
  if (error instanceof Error) {
    throw new Error(`API Error: ${error.message}`);
  }
  throw new Error('An unknown API error occurred');
}

/**
 * Analyze an image using Gemini AI
 * 
 * @param imageBase64 - Base64-encoded image data
 * @param mimeType - Image MIME type (e.g., 'image/jpeg')
 * @returns Classification result with title, description, tags, etc.
 */
export async function analyzeImage(
  imageBase64: string,
  mimeType: string
): Promise<AnalyzeImageResponse> {
  try {
    if (!isApiConfigured()) {
      throw new Error('API base URL not configured');
    }

    const response = await fetch(`${API_BASE_URL}/api/analyze-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ApiErrorResponse;
      throw new Error(errorData.error || 'Failed to analyze image');
    }

    return (await response.json()) as AnalyzeImageResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Analyze a URL/link using Gemini AI
 * 
 * @param url - URL to analyze
 * @returns Classification result with title, description, tags, etc.
 */
export async function analyzeLink(url: string): Promise<AnalyzeLinkResponse> {
  try {
    if (!isApiConfigured()) {
      throw new Error('API base URL not configured');
    }

    const response = await fetch(`${API_BASE_URL}/api/analyze-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ApiErrorResponse;
      throw new Error(errorData.error || 'Failed to analyze link');
    }

    return (await response.json()) as AnalyzeLinkResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Generate audio narration for text using ElevenLabs TTS
 * 
 * @param text - Text to convert to speech
 * @param itemId - Unique item ID for file naming
 * @returns Vultr CDN URL for the generated audio file
 */
export async function generateAudio(
  text: string,
  itemId: string
): Promise<GenerateAudioResponse> {
  try {
    if (!isApiConfigured()) {
      throw new Error('API base URL not configured');
    }

    const response = await fetch(`${API_BASE_URL}/api/generate-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, itemId }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ApiErrorResponse;
      throw new Error(errorData.error || 'Failed to generate audio');
    }

    return (await response.json()) as GenerateAudioResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Get AI-powered schedule suggestion for content review
 * 
 * @param data - Content metadata (title, classification, description, duration)
 * @returns Suggested date, time, and reason
 */
export async function suggestScheduleTime(data: {
  title: string;
  classification: string;
  description?: string;
  duration?: number;
}): Promise<ScheduleSuggestionResponse> {
  try {
    if (!isApiConfigured()) {
      throw new Error('API base URL not configured');
    }

    const response = await fetch(`${API_BASE_URL}/api/suggest-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ApiErrorResponse;
      throw new Error(errorData.error || 'Failed to suggest schedule');
    }

    return (await response.json()) as ScheduleSuggestionResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * AI-powered semantic search
 * Uses semantic matching to find relevant content based on meaning, not just keywords
 * 
 * @param query - Search query
 * @param items - Array of items to search through
 * @returns Array of items sorted by relevance
 */
export async function aiSearch(
  query: string,
  items: Array<{ id?: string; title: string; description?: string; tags: string[]; classification: string }>
): Promise<string[]> {
  try {
    if (!isApiConfigured() || !query.trim()) {
      // Fallback to keyword search if API not configured
      return items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          const q = query.toLowerCase();
          return (
            item.title.toLowerCase().includes(q) ||
            item.description?.toLowerCase().includes(q) ||
            item.tags.some(tag => tag.toLowerCase().includes(q)) ||
            item.classification.toLowerCase().includes(q)
          );
        })
        .map(({ index }) => index.toString());
    }

    const response = await fetch(`${API_BASE_URL}/api/ai-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, items }),
    });

    if (!response.ok) {
      // Fallback to keyword search on error
      return items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          const q = query.toLowerCase();
          return (
            item.title.toLowerCase().includes(q) ||
            item.description?.toLowerCase().includes(q) ||
            item.tags.some(tag => tag.toLowerCase().includes(q))
          );
        })
        .map(({ index }) => index.toString());
    }

    const result = await response.json() as { itemIds: string[] };
    return result.itemIds;
  } catch (error) {
    // Fallback to keyword search on error
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const q = query.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.tags.some(tag => tag.toLowerCase().includes(q))
        );
      })
      .map(({ index }) => index.toString());
  }
}

/**
 * Download Instagram post/video content
 * 
 * @param url - Instagram post/reel URL
 * @returns Instagram content data (video URL, image URL, caption, etc.)
 */
export async function downloadInstagram(
  url: string
): Promise<InstagramDownloadResponse> {
  try {
    if (!isApiConfigured()) {
      throw new Error('API base URL not configured');
    }

    const response = await fetch(`${API_BASE_URL}/api/instagram-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ApiErrorResponse;
      throw new Error(errorData.error || 'Failed to download Instagram content');
    }

    return (await response.json()) as InstagramDownloadResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

