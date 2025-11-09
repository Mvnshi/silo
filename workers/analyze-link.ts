/**
 * Cloudflare Worker: Analyze Link with Gemini AI
 * 
 * This worker receives URLs from the mobile app, fetches the content,
 * sends it to Google Gemini API for analysis, and returns structured
 * classification data.
 * 
 * Endpoint: POST /api/analyze-link
 * 
 * Request Body:
 * {
 *   url: string  // URL to analyze
 * }
 * 
 * Response:
 * {
 *   classification: string,
 *   title: string,
 *   description?: string,
 *   script?: string,
 *   tags?: string[],
 *   duration?: number
 * }
 * 
 * Environment Variables Required:
 * - GEMINI_API_KEY: Google Gemini API key (server-side only)
 */

import { Env, ClassificationResult, ErrorResponse } from './types';

/**
 * Extract basic info from Reddit URL
 */
function extractRedditInfo(url: string): { title: string; description: string; subreddit?: string } {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // Reddit URL format: /r/subreddit/comments/postid/title/
    if (pathParts[0] === 'r' && pathParts.length >= 2) {
      const subreddit = pathParts[1];
      const title = pathParts.length >= 4 ? decodeURIComponent(pathParts[3].replace(/_/g, ' ')) : 'Reddit Post';
      
      return {
        title: title,
        description: `Reddit post from r/${subreddit}`,
        subreddit: subreddit,
      };
    }
    
    return {
      title: 'Reddit Post',
      description: 'A Reddit post or discussion',
    };
  } catch {
    return {
      title: 'Reddit Post',
      description: 'A Reddit post or discussion',
    };
  }
}

/**
 * Fetch webpage content and extract meaningful text
 */
async function fetchPageContent(url: string): Promise<string> {
  try {
    // Special handling for Reddit - they block automated requests
    if (url.includes('reddit.com')) {
      const redditInfo = extractRedditInfo(url);
      return `Reddit Post: ${redditInfo.title}\n\n${redditInfo.description}\n\nSubreddit: ${redditInfo.subreddit || 'unknown'}\n\nNote: Reddit blocks automated content fetching. This is a Reddit post or discussion thread.`;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      // If 403, try to provide helpful info
      if (response.status === 403) {
        throw new Error(`Access denied (403). This website may block automated requests. Try copying the content manually or use a different URL.`);
      }
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    
    // Basic HTML text extraction (remove scripts, styles, tags)
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 5000); // Limit to 5000 chars

    return text;
  } catch (error) {
    throw new Error(`Failed to fetch page content: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse Gemini API response and extract structured classification data
 */
function parseGeminiResponse(geminiText: string, url: string): ClassificationResult {
  try {
    const jsonMatch = geminiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        classification: parsed.classification || 'article',
        title: parsed.title || url,
        description: parsed.description,
        script: parsed.script,
        tags: parsed.tags || [],
        duration: parsed.duration,
      };
    }
    throw new Error('Failed to parse Gemini response');
  } catch (error) {
    return {
      classification: 'article',
      title: url,
      description: geminiText.substring(0, 200),
      tags: [],
    };
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

      // Validate URL
      try {
        new URL(url);
      } catch {
        return new Response(
          JSON.stringify({ 
            error: 'Invalid URL',
            details: 'Please provide a valid URL'
          } as ErrorResponse),
          { status: 400, headers: corsHeaders }
        );
      }

      // Fetch page content (with special handling for Reddit)
      let pageContent: string;
      let isReddit = url.includes('reddit.com');
      
      try {
        pageContent = await fetchPageContent(url);
      } catch (fetchError) {
        // If it's Reddit and fetch failed, use extracted info
        if (isReddit) {
          const redditInfo = extractRedditInfo(url);
          pageContent = `Reddit Post: ${redditInfo.title}\n\n${redditInfo.description}\n\nSubreddit: ${redditInfo.subreddit || 'unknown'}\n\nThis is a Reddit post or discussion thread. Reddit blocks automated content fetching, so we're using the URL structure to identify it.`;
        } else {
          throw fetchError;
        }
      }

      // Construct prompt for Gemini
      const analysisPrompt = `Analyze this webpage content and classify it into one of these categories: article, video, recipe, product, event, place, idea, fitness, food, career, academia, or other.

URL: ${url}

Content:
${pageContent}

Return a JSON object with the following structure:
{
  "classification": "category",
  "title": "article/page title",
  "description": "detailed summary (2-3 sentences)",
  "script": "contextual spoken summary for text-to-speech (10-30 seconds when read aloud, max 150 words). Make it contextual: if fitness-related, mention key benefits and main points; if food-related, describe taste, main ingredients, and prep time if applicable; if a tool/product, highlight key benefits and use cases; if an article/idea, summarize main takeaways. Keep it conversational and natural.",
  "tags": ["tag1", "tag2", "tag3"],
  "duration": estimated_minutes_to_read
}

Be concise and accurate. The script should sound natural when spoken aloud and be contextual to the classification type.`;

      // Call Gemini API
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: analysisPrompt }]
            }]
          })
        }
      );

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
      }

      const geminiData = await geminiResponse.json() as any;
      const generatedText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!generatedText) {
        throw new Error('No text generated by Gemini');
      }

      const result = parseGeminiResponse(generatedText, url);

      return new Response(JSON.stringify(result), {
        headers: corsHeaders
      });

    } catch (error) {
      console.error('Link analysis error:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Provide more helpful error messages
      let userFriendlyError = 'Failed to analyze link';
      if (errorMessage.includes('403') || errorMessage.includes('Access denied')) {
        userFriendlyError = 'This website blocks automated requests. Try copying the content manually or use a different URL.';
      } else if (errorMessage.includes('Failed to fetch')) {
        userFriendlyError = 'Could not access this URL. It may be private, require login, or block automated requests.';
      } else if (errorMessage.includes('Invalid URL')) {
        userFriendlyError = 'Please provide a valid URL (e.g., https://example.com)';
      }
      
      return new Response(
        JSON.stringify({ 
          error: userFriendlyError,
          details: errorMessage
        } as ErrorResponse),
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  }
};

