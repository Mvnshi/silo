/**
 * Cloudflare Workers Main Entry Point
 * 
 * This file routes incoming requests to the appropriate worker handler
 * based on the URL path. All AI processing, TTS generation, and schedule
 * suggestions go through these endpoints.
 * 
 * Routes:
 * - POST /api/analyze-image - Image analysis with Gemini AI
 * - POST /api/analyze-link - Link/URL analysis with Gemini AI
 * - POST /api/generate-audio - TTS generation with ElevenLabs + Vultr upload
 * - POST /api/suggest-schedule - Schedule suggestions with Gemini AI
 */

import { Env } from './types';
import analyzeImage from './analyze-image';
import analyzeLink from './analyze-link';
import generateAudio from './generate-audio';
import suggestSchedule from './suggest-schedule';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Enable CORS for all routes
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204,
        headers: corsHeaders 
      });
    }

    // Route to appropriate handler
    switch (path) {
      case '/api/analyze-image':
        return analyzeImage.fetch(request, env);
      
      case '/api/analyze-link':
        return analyzeLink.fetch(request, env);
      
      case '/api/generate-audio':
        return generateAudio.fetch(request, env);
      
      case '/api/suggest-schedule':
        return suggestSchedule.fetch(request, env);
      
      case '/':
      case '/api':
        // Health check endpoint
        return new Response(
          JSON.stringify({ 
            status: 'ok',
            service: 'Silo API',
            version: '1.0.0',
            endpoints: [
              '/api/analyze-image',
              '/api/analyze-link',
              '/api/generate-audio',
              '/api/suggest-schedule'
            ]
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        );
      
      default:
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        );
    }
  }
};

