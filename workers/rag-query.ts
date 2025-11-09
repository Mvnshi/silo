/**
 * Cloudflare Worker: RAG Query
 * 
 * Retrieval Augmented Generation - Answers questions using user's saved content.
 * 1. Generates embedding for user's question
 * 2. Retrieves similar content from Vultr Object Storage
 * 3. Uses Gemini to generate answer based on retrieved context
 * 4. Can suggest calendar events based on content
 * 
 * Endpoint: POST /api/rag-query
 * 
 * Request Body:
 * {
 *   userId: string,      // User ID
 *   query: string,       // User's question
 *   suggestEvent?: boolean // Whether to suggest calendar events
 * }
 * 
 * Response:
 * {
 *   answer: string,      // AI-generated answer
 *   sources: Array<{     // Retrieved content items
 *     itemId: string,
 *     title: string,
 *     description?: string,
 *     relevance: number
 *   }>,
 *   suggestedEvent?: {   // If suggestEvent is true
 *     title: string,
 *     date: string,
 *     time: string,
 *     description: string
 *   }
 * }
 */

import { Env, ErrorResponse } from './types';

/**
 * Generate embedding using Gemini API
 */
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  try {
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
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json() as any;
    return data.embedding?.values || [];
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    throw error;
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Retrieve embeddings from Vultr Object Storage
 */
async function retrieveEmbeddings(userId: string, env: Env): Promise<Array<{
  itemId: string;
  embedding: number[];
  metadata: { title: string; description?: string; tags?: string[] };
}>> {
  try {
    // List all embeddings for user
    const prefix = `embeddings/${userId}/`;
    const endpoint = env.VULTR_ENDPOINT.replace('https://', '').replace('http://', '');
    const path = `/${env.VULTR_BUCKET}?prefix=${prefix}`;
    const date = new Date().toUTCString();

    // Simplified signature for listing
    const stringToSign = `GET\n\n\n${date}\n${path}`;
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

    const url = `${env.VULTR_ENDPOINT}/${env.VULTR_BUCKET}?prefix=${prefix}`;
    const listResponse = await fetch(url, {
      method: 'GET',
      headers: {
        Date: date,
        Authorization: `AWS ${env.VULTR_ACCESS_KEY}:${signatureBase64}`,
      },
    });

    if (!listResponse.ok) {
      console.warn('Failed to list embeddings, returning empty array');
      return [];
    }

    // Parse XML response (simplified - in production use proper XML parser)
    const xmlText = await listResponse.text();
    const items: Array<{ itemId: string; embedding: number[]; metadata: any }> = [];

    // Extract keys from XML (simplified parsing)
    const keyMatches = xmlText.matchAll(/<Key>(.*?)<\/Key>/g);
    for (const match of keyMatches) {
      const key = match[1];
      if (key.endsWith('.json')) {
        // Fetch the embedding file
        const filePath = `/${env.VULTR_BUCKET}/${key}`;
        const fileDate = new Date().toUTCString();
        const fileStringToSign = `GET\n\n\n${fileDate}\n${filePath}`;
        const fileSignature = await crypto.subtle.sign('HMAC', keyData, encoder.encode(fileStringToSign));
        const fileSignatureBase64 = btoa(String.fromCharCode(...new Uint8Array(fileSignature)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');

        const fileUrl = `${env.VULTR_ENDPOINT}/${key}`;
        const fileResponse = await fetch(fileUrl, {
          method: 'GET',
          headers: {
            Date: fileDate,
            Authorization: `AWS ${env.VULTR_ACCESS_KEY}:${fileSignatureBase64}`,
          },
        });

        if (fileResponse.ok) {
          const fileData = await fileResponse.json() as any;
          items.push({
            itemId: fileData.itemId,
            embedding: fileData.embedding,
            metadata: fileData.metadata,
          });
        }
      }
    }

    return items;
  } catch (error) {
    console.error('Failed to retrieve embeddings:', error);
    return [];
  }
}

/**
 * Generate answer using Gemini with retrieved context
 */
async function generateAnswer(
  query: string,
  context: Array<{ title: string; description?: string; tags?: string[] }>,
  suggestEvent: boolean,
  apiKey: string
): Promise<{ answer: string; suggestedEvent?: any }> {
  const contextText = context
    .map((item, idx) => {
      const classification = (item as any).classification ? ` [${(item as any).classification}]` : '';
      return `${idx + 1}. ${item.title}${item.description ? `: ${item.description}` : ''}${classification}${item.tags ? ` (Tags: ${item.tags.join(', ')})` : ''}`;
    })
    .join('\n');

  // Detect if user is asking for suggestions or is bored
  const queryLower = query.toLowerCase();
  const needsSuggestion = 
    queryLower.includes("don't know") || 
    queryLower.includes("dont know") ||
    queryLower.includes("what to do") ||
    queryLower.includes("bored") ||
    queryLower.includes("nothing to do") ||
    queryLower.includes("suggest") ||
    queryLower.includes("recommend") ||
    queryLower.includes("idea") ||
    queryLower.includes("help me");

  // Detect interests mentioned
  const interests: string[] = [];
  if (queryLower.includes("fitness") || queryLower.includes("workout") || queryLower.includes("exercise")) interests.push("fitness");
  if (queryLower.includes("food") || queryLower.includes("cook") || queryLower.includes("recipe")) interests.push("food");
  if (queryLower.includes("tech") || queryLower.includes("code") || queryLower.includes("programming")) interests.push("tech");
  if (queryLower.includes("career") || queryLower.includes("job") || queryLower.includes("work")) interests.push("career");
  if (queryLower.includes("academia") || queryLower.includes("study") || queryLower.includes("learn")) interests.push("academia");
  if (queryLower.includes("outdoor") || queryLower.includes("hike") || queryLower.includes("park")) interests.push("outdoor");
  if (queryLower.includes("place") || queryLower.includes("visit") || queryLower.includes("go")) interests.push("places");

  let prompt = `You are a proactive, friendly personal AI assistant named Silo. Your job is to help users discover and act on their saved content, and suggest new activities based on their interests.

User's Saved Content:
${contextText || "No saved content yet."}

User's Question: ${query}

${needsSuggestion ? `IMPORTANT: The user seems to be asking for suggestions or ideas. Be proactive and helpful!` : ''}
${interests.length > 0 ? `The user mentioned interests in: ${interests.join(', ')}. Focus on these areas.` : ''}

Instructions:
1. Answer their question in a friendly, conversational way
2. Reference their saved content when relevant
3. If they're asking for suggestions or seem unsure what to do:
   - Ask about their interests (fitness, food, tech, career, academia, outdoor activities, places to visit)
   - Suggest specific activities from their saved content
   - Recommend new things to try based on their interests
4. Always be encouraging and actionable
5. If they have saved content that could be scheduled, mention it naturally

${suggestEvent ? `ALWAYS suggest a calendar event if relevant! Look for:
- Workouts or fitness routines that should be scheduled
- Recipes that need time to cook
- Study plans or learning resources
- Career prep activities
- Places to visit
- Any time-bound activities

Return your response as JSON with this structure:
{
  "answer": "your conversational answer (be friendly and proactive!)",
  "suggestedEvent": {
    "title": "event title",
    "date": "YYYY-MM-DD (within next 7 days)",
    "time": "HH:MM (reasonable time like 09:00, 14:00, 18:00)",
    "description": "why this event is useful"
  }
}

If no event should be suggested, omit the "suggestedEvent" field.` : 'Return your response as plain text (no JSON).'}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }],
          }],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${error}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to parse JSON if suggestEvent is true
    if (suggestEvent) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            answer: parsed.answer || text,
            suggestedEvent: parsed.suggestedEvent,
          };
        }
      } catch (e) {
        // Fall through to return text as answer
      }
    }

    return { answer: text };
  } catch (error) {
    console.error('Failed to generate answer:', error);
    throw error;
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
      const body = await request.json() as {
        userId: string;
        query: string;
        suggestEvent?: boolean;
        items?: Array<{ id: string; title: string; description?: string; tags?: string[]; classification?: string }>;
      };
      const { userId, query, suggestEvent = false, items } = body; // items is optional - sent from frontend

      if (!userId || !query) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: userId, query' } as ErrorResponse),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      let context: Array<{ title: string; description?: string; tags?: string[] }> = [];
      let sources: Array<{ itemId: string; title: string; description?: string; relevance: number }> = [];

      // Try embeddings first, fallback to direct Gemini if quota exceeded
      try {
        // Generate embedding for query
        const queryEmbedding = await generateEmbedding(query, env.GEMINI_API_KEY);

        // If embedding is empty (quota exceeded), use fallback
        if (queryEmbedding.length === 0) {
          throw new Error('Embedding quota exceeded, using direct Gemini fallback');
        }

        // Retrieve all user embeddings
        const allEmbeddings = await retrieveEmbeddings(userId, env);

        // If no embeddings found, use fallback
        if (allEmbeddings.length === 0) {
          throw new Error('No embeddings found, using direct Gemini fallback');
        }

        // Calculate similarities and get top matches
        const similarities = allEmbeddings.map(item => ({
          ...item,
          similarity: cosineSimilarity(queryEmbedding, item.embedding),
        }));

        // Sort by similarity and take top 5
        const topMatches = similarities
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5)
          .filter(item => item.similarity > 0.3); // Minimum similarity threshold

        if (topMatches.length > 0) {
          context = topMatches.map(m => m.metadata);
          sources = topMatches.map(m => ({
            itemId: m.itemId,
            title: m.metadata.title,
            description: m.metadata.description,
            relevance: Math.round(m.similarity * 100) / 100,
          }));
        } else {
          throw new Error('No similar items found, using direct Gemini fallback');
        }
      } catch (embeddingError) {
        // Fallback: Use items sent from frontend or all items from embeddings
        console.warn('Embedding-based RAG failed, using direct Gemini fallback:', embeddingError);
        
        if (items && Array.isArray(items) && items.length > 0) {
          // Use items sent from frontend
          context = items.slice(0, 15).map((item: any) => ({
            title: item.title || '',
            description: item.description,
            tags: item.tags,
            classification: item.classification, // Include classification
          }));
          sources = items.slice(0, 15).map((item: any) => ({
            itemId: item.id || '',
            title: item.title || '',
            description: item.description,
            relevance: 0.8, // Default relevance for fallback
          }));
        } else {
          // Try to get items from embeddings metadata
          const allEmbeddings = await retrieveEmbeddings(userId, env);
          if (allEmbeddings.length > 0) {
            context = allEmbeddings.slice(0, 10).map(e => e.metadata);
            sources = allEmbeddings.slice(0, 10).map(e => ({
              itemId: e.itemId,
              title: e.metadata.title,
              description: e.metadata.description,
              relevance: 0.8,
            }));
          }
        }

        // If still no context, return helpful message
        if (context.length === 0) {
          return new Response(
            JSON.stringify({
              answer: "I couldn't find any saved content to answer your question. Try saving some content first!",
              sources: [],
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      // Generate answer with context using Gemini
      const { answer, suggestedEvent } = await generateAnswer(
        query,
        context,
        suggestEvent,
        env.GEMINI_API_KEY
      );

      return new Response(
        JSON.stringify({
          answer,
          sources,
          suggestedEvent,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('RAG query error:', error);
      return new Response(
        JSON.stringify({
          error: 'Failed to process query',
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

