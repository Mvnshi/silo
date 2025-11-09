/**
 * Cloudflare Worker: Generate Audio and Upload to Vultr
 * 
 * This worker handles text-to-speech conversion and audio storage:
 * 1. Calls ElevenLabs API to generate TTS audio from text
 * 2. Uploads the audio file to Vultr Object Storage
 * 3. Returns the CDN URL for the audio file
 * 
 * Endpoint: POST /api/generate-audio
 * 
 * Request Body:
 * {
 *   text: string,    // Text to convert to speech
 *   itemId: string   // Unique item ID for file naming
 * }
 * 
 * Response:
 * {
 *   audioUrl: string  // Vultr CDN URL for the audio file
 * }
 * 
 * Environment Variables Required:
 * - ELEVENLABS_API_KEY: ElevenLabs API key
 * - ELEVENLABS_VOICE_ID: Voice ID for ElevenLabs TTS
 * - VULTR_ACCESS_KEY: Vultr Object Storage access key
 * - VULTR_SECRET_KEY: Vultr Object Storage secret key
 * - VULTR_BUCKET: Vultr bucket name
 * - VULTR_ENDPOINT: Vultr Object Storage endpoint URL
 * - VULTR_CDN_DOMAIN: Vultr CDN domain for audio delivery
 */

import { Env, ErrorResponse } from './types';

/**
 * Generate AWS Signature Version 4 for Vultr Object Storage authentication
 */
async function generateAwsSignature(
  method: string,
  path: string,
  headers: Record<string, string>,
  secretKey: string
): Promise<string> {
  // Simplified signature - in production, use a proper AWS SDK or library
  // This is a basic implementation for demonstration
  const stringToSign = `${method}\n${headers['Content-MD5'] || ''}\n${headers['Content-Type']}\n${headers['Date']}\n${path}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(stringToSign)
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
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
      const { text, itemId } = await request.json() as {
        text: string;
        itemId: string;
      };

      if (!text || !itemId) {
        return new Response(
          JSON.stringify({ 
            error: 'Missing required fields',
            details: 'text and itemId are required'
          } as ErrorResponse),
          { status: 400, headers: corsHeaders }
        );
      }

      // Limit text length for TTS (ElevenLabs has character limits)
      const ttsText = text.substring(0, 500);

      // Step 1: Generate audio with ElevenLabs
      console.log('Generating audio with ElevenLabs...');
      const elevenLabsResponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': env.ELEVENLABS_API_KEY,
          },
          body: JSON.stringify({
            text: ttsText,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        }
      );

      if (!elevenLabsResponse.ok) {
        const errorText = await elevenLabsResponse.text();
        throw new Error(`ElevenLabs API error: ${elevenLabsResponse.status} - ${errorText}`);
      }

      const audioArrayBuffer = await elevenLabsResponse.arrayBuffer();
      const audioBlob = new Uint8Array(audioArrayBuffer);

      // Step 2: Upload to Vultr Object Storage
      console.log('Uploading to Vultr Object Storage...');
      const fileName = `audio/${itemId}_${Date.now()}.mp3`;
      const vultrUrl = `https://${env.VULTR_ENDPOINT}/${env.VULTR_BUCKET}/${fileName}`;
      
      const uploadHeaders: Record<string, string> = {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBlob.length.toString(),
        'Date': new Date().toUTCString(),
        'x-amz-acl': 'public-read'
      };

      // Generate AWS signature
      const signature = await generateAwsSignature(
        'PUT',
        `/${env.VULTR_BUCKET}/${fileName}`,
        uploadHeaders,
        env.VULTR_SECRET_KEY
      );

      uploadHeaders['Authorization'] = `AWS ${env.VULTR_ACCESS_KEY}:${signature}`;

      const uploadResponse = await fetch(vultrUrl, {
        method: 'PUT',
        headers: uploadHeaders,
        body: audioBlob,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Vultr upload error: ${uploadResponse.status} - ${errorText}`);
      }

      // Step 3: Return CDN URL
      const cdnUrl = `https://${env.VULTR_CDN_DOMAIN}/${fileName}`;
      
      console.log('Audio generated and uploaded successfully:', cdnUrl);

      return new Response(
        JSON.stringify({ audioUrl: cdnUrl }),
        { headers: corsHeaders }
      );

    } catch (error) {
      console.error('Audio generation error:', error);
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to generate audio',
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

