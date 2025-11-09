/**
 * Cloudflare Worker: Instagram Post/Video Downloader
 * 
 * This worker handles downloading Instagram posts and videos using
 * the Instagram Video Downloader API approach.
 * 
 * Endpoint: POST /api/instagram-download
 * 
 * Request Body:
 * {
 *   url: string  // Instagram post/reel URL
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   videoUrl?: string,      // Direct video URL if available
 *   imageUrl?: string,      // Image URL if it's a photo post
 *   caption?: string,       // Post caption
 *   username?: string,       // Instagram username
 *   type: 'video' | 'image' | 'carousel'
 * }
 * 
 * Note: This uses a public Instagram downloader service approach.
 * For production, you may want to use a more robust solution.
 */

import { Env, ErrorResponse } from './types';

/**
 * Extract Instagram post ID from URL
 */
function extractPostId(url: string): string | null {
  try {
    // Match patterns: /p/POST_ID/, /reel/REEL_ID/, /reels/REEL_ID/
    const patterns = [
      /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/reels\/([A-Za-z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch Instagram post data using Instagram's oEmbed API and public downloader services
 * This uses a combination of oEmbed (for metadata) and downloader services (for media)
 */
async function fetchInstagramData(url: string): Promise<{
  videoUrl?: string;
  imageUrl?: string;
  caption?: string;
  username?: string;
  type: 'video' | 'image' | 'carousel';
}> {
  const postId = extractPostId(url);
  if (!postId) {
    throw new Error('Invalid Instagram URL');
  }

  try {
    // First, try to get metadata from Instagram's oEmbed API
    const oembedUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`;
    const oembedResponse = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    let metadata: {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
      html?: string;
    } = {};

    if (oembedResponse.ok) {
      metadata = await oembedResponse.json() as typeof metadata;
    }

    // Try to get media URLs from public downloader services
    // Option 1: Try saveig.app API
    try {
      const downloaderUrl = `https://api.saveig.app/api/ajaxSearch`;
      const response = await fetch(downloaderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: new URLSearchParams({
          q: url,
          t: 'media',
          lang: 'en',
        }),
      });

      if (response.ok) {
        const data = await response.json() as {
          status?: string;
          items?: Array<{
            video?: string;
            url?: string;
            image?: string;
            thumbnail?: string;
            caption?: string;
            description?: string;
            username?: string;
            author?: string;
            type?: string;
          }>;
        };

        if (data.status === 'ok' && data.items && data.items.length > 0) {
          const item = data.items[0];
          return {
            videoUrl: item.video || item.url,
            imageUrl: item.image || item.thumbnail || metadata.thumbnail_url,
            caption: item.caption || item.description || metadata.title,
            username: item.username || item.author || metadata.author_name,
            type: (item.type === 'video' || item.video) ? 'video' : 'image',
          };
        }
      }
    } catch (error) {
      console.error('Downloader service error:', error);
    }

    // Fallback: Use oEmbed data only
    return {
      imageUrl: metadata.thumbnail_url,
      caption: metadata.title,
      username: metadata.author_name,
      type: 'image', // oEmbed doesn't specify type, default to image
    };
  } catch (error) {
    console.error('Instagram fetch error:', error);
    throw error;
  }
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' } as ErrorResponse),
        { 
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const { url } = await request.json() as { url: string };

      if (!url) {
        return new Response(
          JSON.stringify({ 
            error: 'Missing required field',
            details: 'url is required'
          } as ErrorResponse),
          { status: 400, headers: corsHeaders }
        );
      }

      // Validate Instagram URL
      if (!url.includes('instagram.com')) {
        return new Response(
          JSON.stringify({ 
            error: 'Invalid URL',
            details: 'URL must be an Instagram post or reel'
          } as ErrorResponse),
          { status: 400, headers: corsHeaders }
        );
      }

      // Fetch Instagram data
      const instagramData = await fetchInstagramData(url);

      return new Response(
        JSON.stringify({
          success: true,
          ...instagramData,
        }),
        { headers: corsHeaders }
      );

    } catch (error) {
      console.error('Instagram download error:', error);
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to download Instagram content',
          details: error instanceof Error ? error.message : 'Unknown error'
        } as ErrorResponse),
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  }
};

