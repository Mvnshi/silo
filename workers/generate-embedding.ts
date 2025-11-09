/**
 * Cloudflare Worker: Generate Embeddings
 * 
 * Generates vector embeddings for content items using Gemini's embedding API.
 * These embeddings are stored in Vultr Object Storage for RAG (Retrieval Augmented Generation).
 * 
 * Endpoint: POST /api/generate-embedding
 * 
 * Request Body:
 * {
 *   userId: string,      // User ID (can be device ID or user identifier)
 *   itemId: string,      // Item ID
 *   title: string,       // Item title
 *   description?: string, // Item description
 *   tags?: string[]      // Item tags
 * }
 * 
 * Response:
 * {
 *   embedding: number[], // Vector embedding
 *   stored: boolean      // Whether embedding was stored successfully
 * }
 */

import { Env, ErrorResponse } from './types';

/**
 * Generate embedding using Gemini API
 */
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  try {
    // Use Gemini's embedding model
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'models/embedding-001',
          content: {
            parts: [{ text }],
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      // If quota exceeded, return empty embedding instead of throwing
      if (response.status === 429) {
        console.warn('Embedding quota exceeded, returning empty embedding');
        return [];
      }
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json();
    return data.embedding?.values || [];
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    throw error;
  }
}

/**
 * Store embedding in Vultr Object Storage
 */
async function storeEmbedding(
  userId: string,
  itemId: string,
  embedding: number[],
  metadata: { title: string; description?: string; tags?: string[] },
  env: Env
): Promise<boolean> {
  try {
    const key = `embeddings/${userId}/${itemId}.json`;
    const data = {
      itemId,
      embedding,
      metadata,
      timestamp: new Date().toISOString(),
    };

    // Generate AWS Signature for Vultr Object Storage
    const endpoint = env.VULTR_ENDPOINT.replace('https://', '').replace('http://', '');
    const path = `/${env.VULTR_BUCKET}/${key}`;
    const date = new Date().toUTCString();
    const contentType = 'application/json';

    // Simplified signature (for production, use proper AWS SigV4)
    const stringToSign = `PUT\n\n${contentType}\n${date}\n${path}`;
    const encoder = new TextEncoder();
    const keyData = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.VULTR_SECRET_KEY),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', keyData, encoder.encode(stringToSign));
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const url = `${env.VULTR_ENDPOINT}/${env.VULTR_BUCKET}/${key}`;
    const putResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        Date: date,
        Authorization: `AWS ${env.VULTR_ACCESS_KEY}:${signatureBase64}`,
      },
      body: JSON.stringify(data),
    });

    return putResponse.ok;
  } catch (error) {
    console.error('Failed to store embedding:', error);
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' } as ErrorResponse),
        {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      const body = await request.json();
      const { userId, itemId, title, description, tags } = body;

      if (!userId || !itemId || !title) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: userId, itemId, title' } as ErrorResponse),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Combine text for embedding
      const text = [
        title,
        description || '',
        tags ? tags.join(' ') : '',
      ].filter(Boolean).join(' ');

      // Generate embedding
      const embedding = await generateEmbedding(text, env.GEMINI_API_KEY);

      // If embedding is empty (quota exceeded), return success but don't store
      if (embedding.length === 0) {
        return new Response(
          JSON.stringify({
            embedding: [],
            stored: false,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Store embedding in Vultr
      const stored = await storeEmbedding(
        userId,
        itemId,
        embedding,
        { title, description, tags },
        env
      );

      return new Response(
        JSON.stringify({
          embedding,
          stored,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('Embedding generation error:', error);
      return new Response(
        JSON.stringify({
          error: 'Failed to generate embedding',
          details: error instanceof Error ? error.message : 'Unknown error',
        } as ErrorResponse),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

