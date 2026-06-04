/**
 * Instagram URL utilities — detect Instagram links and extract the reel/post
 * shortcode from the various URL shapes. Inline playback is handled by the
 * official Instagram embed (see lib/embed.ts); the old eeinstagram.com proxy
 * and the unofficial scraper download path were removed (Tier-1 only — see
 * TODO "Social Extraction").
 */

/**
 * Extract an Instagram reel/post shortcode from common URL formats:
 * - https://www.instagram.com/reel/<id>/   (and /reels/)
 * - https://instagram.com/p/<id>/          (posts can also be reels)
 */
export function extractInstagramReelId(url: string): string | null {
  if (!url) return null;
  const normalizedUrl = url.trim();
  if (!normalizedUrl.includes('instagram.com')) return null;

  const reelMatch = normalizedUrl.match(/instagram\.com\/(?:reel|reels)\/([A-Za-z0-9_-]+)/);
  if (reelMatch && reelMatch[1]) return reelMatch[1];

  const postMatch = normalizedUrl.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/);
  if (postMatch && postMatch[1]) return postMatch[1];

  return null;
}

/** Check whether a URL is an Instagram reel/post. */
export function isInstagramReel(url: string): boolean {
  return extractInstagramReelId(url) !== null;
}
