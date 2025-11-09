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
 * Fetch webpage content and extract meaningful text
 */
async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SiloBot/1.0)'
      }
    });
    
    if (!response.ok) {
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

      // Fetch page content
      const pageContent = await fetchPageContent(url);

      // Construct prompt for Gemini
      const analysisPrompt = `Analyze this webpage content and classify it into one of these categories: article, video, recipe, product, event, idea, or other.

URL: ${url}

Content:
${pageContent}

Return a JSON object with the following structure:
{
  "classification": "category",
  "title": "article/page title",
  "description": "detailed summary (2-3 sentences)",
  "script": "natural spoken summary for text-to-speech (1-2 sentences)",
  "tags": ["tag1", "tag2", "tag3"],
  "duration": estimated_minutes_to_read
}

Be concise and accurate. The script should sound natural when spoken aloud.`;

      // Call Gemini API
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
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
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to analyze link',
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

