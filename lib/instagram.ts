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
  // Try https first, fallback to http
  return `https://eeinstagram.com/reel/${reelId}/`;
}

/**
 * Download Instagram post/reel directly using public APIs (no backend required)
 * Uses multiple fallback strategies for maximum compatibility
 */
export async function downloadInstagramDirect(url: string): Promise<{
  success: boolean;
  videoUrl?: string;
  imageUrl?: string;
  caption?: string;
  username?: string;
  type: 'video' | 'image' | 'carousel';
}> {
  try {
    // Extract post ID
    const postId = extractInstagramReelId(url);
    if (!postId) {
      throw new Error('Invalid Instagram URL');
    }

    let metadata: {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
      html?: string;
    } = {};

    // Strategy 1: Try Instagram oEmbed API with proper headers
    try {
      const oembedUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`;
      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json',
        },
      });

      if (oembedResponse.ok) {
        const contentType = oembedResponse.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          metadata = await oembedResponse.json() as typeof metadata;
        } else {
          // If we get HTML instead of JSON, try to parse it or skip
          console.warn('oEmbed returned non-JSON response');
        }
      }
    } catch (error) {
      console.warn('oEmbed fetch error (non-critical):', error);
      // Continue with other strategies
    }

    // Strategy 2: Try alternative downloader services
    const downloaderServices = [
      {
        url: 'https://api.saveig.app/api/ajaxSearch',
        method: 'POST',
        body: new URLSearchParams({ q: url, t: 'media', lang: 'en' }).toString(),
      },
      {
        url: `https://www.instagram.com/p/${postId}/?__a=1&__d=dis`,
        method: 'GET',
        body: null,
      },
    ];

    for (const service of downloaderServices) {
      try {
        const response = await fetch(service.url, {
          method: service.method,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'application/json',
          },
          body: service.body,
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json() as any;

            // Parse saveig.app response
            if (data.status === 'ok' && data.items && data.items.length > 0) {
              const item = data.items[0];
              return {
                success: true,
                videoUrl: item.video || item.url,
                imageUrl: item.image || item.thumbnail || metadata.thumbnail_url,
                caption: item.caption || item.description || metadata.title,
                username: item.username || item.author || metadata.author_name,
                type: (item.type === 'video' || item.video) ? 'video' : 'image',
              };
            }

            // Parse Instagram API response (if available)
            if (data.graphql?.shortcode_media) {
              const media = data.graphql.shortcode_media;
              return {
                success: true,
                videoUrl: media.video_url,
                imageUrl: media.display_url || metadata.thumbnail_url,
                caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || metadata.title,
                username: media.owner?.username || metadata.author_name,
                type: media.is_video ? 'video' : 'image',
              };
            }
          }
        }
      } catch (error) {
        console.warn(`Downloader service error (${service.url}):`, error);
        // Continue to next service
        continue;
      }
    }

    // Strategy 3: Fallback - Return basic data from URL and metadata
    // At minimum, we can create an item with the URL and let StreamCard handle embedding
    const isReel = url.includes('/reel/') || url.includes('/reels/');
    
    return {
      success: true,
      imageUrl: metadata.thumbnail_url,
      caption: metadata.title || `Instagram ${isReel ? 'reel' : 'post'}`,
      username: metadata.author_name,
      type: isReel ? 'video' : 'image',
    };
  } catch (error) {
    console.error('Instagram download error:', error);
    // Even if everything fails, we can still save the URL and let the app handle it
    const postId = extractInstagramReelId(url);
    const isReel = url.includes('/reel/') || url.includes('/reels/');
    
    return {
      success: true, // Return success so user can still save the URL
      caption: `Instagram ${isReel ? 'reel' : 'post'}`,
      type: isReel ? 'video' : 'image',
    };
  }
}

