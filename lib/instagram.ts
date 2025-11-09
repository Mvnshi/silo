/**
 * Instagram Reel Utilities
 * 
 * Functions to detect and extract Instagram reel IDs from URLs
 * and generate embed URLs using the eeinstagram.com service.
 */

/**
 * Extract Instagram reel ID from various URL formats
 * Supports:
 * - https://www.instagram.com/reel/DOE-opugX2H/
 * - https://instagram.com/reel/DOE-opugX2H/
 * - https://www.instagram.com/reels/DOE-opugX2H/
 * - https://instagram.com/reels/DOE-opugX2H/
 * - https://www.instagram.com/p/DOE-opugX2H/ (posts can also be reels)
 */
export function extractInstagramReelId(url: string): string | null {
  if (!url) return null;

  // Normalize URL
  const normalizedUrl = url.trim();

  // Check if it's an Instagram URL
  if (!normalizedUrl.includes('instagram.com')) {
    return null;
  }

  // Match patterns for reel URLs
  // Pattern: /reel/REEL_ID/ or /reels/REEL_ID/
  const reelPattern = /instagram\.com\/(?:reel|reels)\/([A-Za-z0-9_-]+)/;
  const reelMatch = normalizedUrl.match(reelPattern);
  
  if (reelMatch && reelMatch[1]) {
    return reelMatch[1];
  }

  // Also check for /p/ pattern (posts can be reels)
  const postPattern = /instagram\.com\/p\/([A-Za-z0-9_-]+)/;
  const postMatch = normalizedUrl.match(postPattern);
  
  if (postMatch && postMatch[1]) {
    return postMatch[1];
  }

  return null;
}

/**
 * Check if a URL is an Instagram reel
 */
export function isInstagramReel(url: string): boolean {
  return extractInstagramReelId(url) !== null;
}

/**
 * Generate embed URL using eeinstagram.com service
 */
export function getInstagramEmbedUrl(reelId: string): string {
  return `http://eeinstagram.com/reel/${reelId}/`;
}

