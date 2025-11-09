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
 * Proper implementation for S3-compatible storage
 */
async function generateAwsSignatureV4(
  method: string,
  endpoint: string,
  bucket: string,
  key: string,
  accessKey: string,
  secretKey: string,
  contentType: string,
  body: Uint8Array
): Promise<{ authorization: string; amzDate: string }> {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().slice(0, 19).replace(/[:-]|\.\d{3}/g, '') + 'Z';
  
  // Detect region from endpoint (e.g., ewr1 -> us-east-1, lax1 -> us-west-1)
  let region = 'us-east-1';
  if (endpoint.includes('ewr1') || endpoint.includes('nj')) {
    region = 'us-east-1';
  } else if (endpoint.includes('lax1') || endpoint.includes('la')) {
    region = 'us-west-1';
  } else if (endpoint.includes('sjc1') || endpoint.includes('sj')) {
    region = 'us-west-1';
  }
  
  const service = 's3';
  
  // Step 1: Create canonical request
  // Use path-style: /key (bucket is in hostname for virtual-hosted-style)
  const canonicalUri = `/${key}`;
  const canonicalQueryString = '';
  // Headers must be lowercase and sorted
  const canonicalHeaders = `content-type:${contentType}\nhost:${endpoint}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const payloadHash = await sha256(body);
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  
  // Step 2: Create string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;
  
  // Step 3: Calculate signature (AWS4 prefix is part of the key derivation)
  const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = toHex(signatureBytes);
  
  // Step 4: Create authorization header
  const authorization = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  return { authorization, amzDate };
}

/**
 * SHA-256 hash
 */
async function sha256(data: string | Uint8Array): Promise<string> {
  const encoder = typeof data === 'string' ? new TextEncoder() : null;
  const buffer = typeof data === 'string' ? encoder!.encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return toHex(new Uint8Array(hash));
}

/**
 * HMAC-SHA256
 */
async function hmacSha256(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyBuffer = typeof key === 'string' ? encoder.encode(key) : key;
  const dataBuffer = encoder.encode(data);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
  return new Uint8Array(signature);
}

/**
 * Convert Uint8Array to hex string
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
      
      // Try virtual-hosted-style URL (bucket in hostname)
      const vultrUrl = `https://${env.VULTR_BUCKET}.${env.VULTR_ENDPOINT}/${fileName}`;
      
      // Generate proper AWS Signature Version 4
      const { authorization, amzDate } = await generateAwsSignatureV4(
        'PUT',
        `${env.VULTR_BUCKET}.${env.VULTR_ENDPOINT}`, // Virtual-hosted-style hostname
        env.VULTR_BUCKET,
        fileName,
        env.VULTR_ACCESS_KEY,
        env.VULTR_SECRET_KEY,
        'audio/mpeg',
        audioBlob
      );

      const uploadHeaders: Record<string, string> = {
        'Content-Type': 'audio/mpeg',
        'x-amz-date': amzDate,
        'Authorization': authorization,
      };

      const uploadResponse = await fetch(vultrUrl, {
        method: 'PUT',
        headers: uploadHeaders,
        body: audioBlob,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Vultr upload failed:', errorText);
        // For hackathon: Return a data URL as fallback so audio still works
        // Convert audio to base64 and return as data URL
        const base64Audio = btoa(String.fromCharCode(...audioBlob));
        const dataUrl = `data:audio/mpeg;base64,${base64Audio}`;
        console.log('Using data URL fallback for audio');
        return new Response(
          JSON.stringify({ audioUrl: dataUrl }),
          { headers: corsHeaders }
        );
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

