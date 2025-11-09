# 🔧 How Silo Backend Works - Complete Architecture Explanation

This document explains exactly how Cloudflare Workers, Gemini AI, ElevenLabs, and Vultr all work together to power Silo.

---

## 🏗️ Architecture Overview

```
Mobile App (React Native)
    ↓
    ↓ HTTP POST requests
    ↓
Cloudflare Workers (Serverless Backend)
    ↓
    ├─→ Gemini API (Image/Link Analysis)
    ├─→ ElevenLabs API (Text-to-Speech)
    └─→ Vultr Object Storage (Audio File Storage)
    ↓
    ↓ CDN URL
    ↓
Mobile App (Plays Audio)
```

---

## 📱 Step-by-Step: What Happens When You Add Content

### Scenario 1: Adding an Image/Screenshot

1. **User takes action**: User swipes right on a screenshot or adds an image
2. **App converts image**: Image is converted to base64 string
3. **App sends request**: 
   ```
   POST https://silo-api.you.workers.dev/api/analyze-image
   Body: {
     imageBase64: "iVBORw0KGgoAAAANS...",
     mimeType: "image/jpeg"
   }
   ```
4. **Cloudflare Worker receives request**: `workers/analyze-image.ts` handles it
5. **Worker calls Gemini API**:
   - Sends base64 image + analysis prompt to Gemini
   - Gemini analyzes the image and returns JSON with:
     - Classification (article, video, fitness, etc.)
     - Title
     - Description
     - Tags
     - TTS script (text for audio narration)
6. **Worker returns result** to mobile app
7. **App saves item** locally with the analysis data
8. **App generates audio** (if description exists):
   - Calls `/api/generate-audio` with the TTS script
   - Worker calls ElevenLabs → gets MP3 audio
   - Worker uploads MP3 to Vultr Object Storage
   - Worker returns CDN URL (e.g., `https://ewr1.vultrobjects.com/audio/item_123.mp3`)
9. **App saves audio URL** and plays it in the Streams feed

### Scenario 2: Adding a Link/URL

1. **User adds URL**: Pastes a link in the Add screen
2. **App sends request**:
   ```
   POST https://silo-api.you.workers.dev/api/analyze-link
   Body: { url: "https://example.com/article" }
   ```
3. **Cloudflare Worker receives request**: `workers/analyze-link.ts` handles it
4. **Worker fetches webpage**: Downloads the HTML content
5. **Worker calls Gemini API**:
   - Sends webpage text + analysis prompt to Gemini
   - Gemini analyzes content and returns classification data
6. **Worker returns result** to mobile app
7. **App saves item** and generates audio (same as image flow)

---

## 🔄 How Each Service Works

### 1. Cloudflare Workers (The Orchestrator)

**What it does:**
- Receives HTTP requests from your mobile app
- Routes requests to the right handler
- Calls external APIs (Gemini, ElevenLabs)
- Manages file uploads to Vultr
- Returns responses to your app

**Files:**
- `workers/index.ts` - Main router (decides which handler to use)
- `workers/analyze-image.ts` - Handles image analysis
- `workers/analyze-link.ts` - Handles URL analysis
- `workers/generate-audio.ts` - Handles TTS + Vultr upload
- `workers/suggest-schedule.ts` - Handles schedule suggestions

**Why Cloudflare Workers?**
- Serverless (no server to manage)
- Fast (runs at the edge, close to users)
- Free tier: 100,000 requests/day
- Perfect for API orchestration

---

### 2. Google Gemini API (The AI Brain)

**What it does:**
- Analyzes images and understands what's in them
- Reads webpage content and extracts meaning
- Classifies content into categories
- Generates summaries and tags
- Creates natural-sounding TTS scripts

**How it's used:**

**For Images:**
```javascript
// Worker sends image + prompt to Gemini
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_KEY
Body: {
  contents: [{
    parts: [
      { inlineData: { data: "base64image...", mimeType: "image/jpeg" } },
      { text: "Analyze this image and classify it..." }
    ]
  }]
}
```

**For Links:**
```javascript
// Worker sends webpage text + prompt to Gemini
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=YOUR_KEY
Body: {
  contents: [{
    parts: [{ text: "Analyze this webpage: [content]..." }]
  }]
}
```

**Gemini Response:**
```json
{
  "candidates": [{
    "content": {
      "parts": [{
        "text": "{\"classification\":\"article\",\"title\":\"...\",\"description\":\"...\"}"
      }]
    }
  }]
}
```

**Why Gemini?**
- Free tier with generous limits
- Excellent image understanding
- Fast responses
- Good at structured JSON output

---

### 3. ElevenLabs API (The Voice Generator)

**What it does:**
- Converts text to natural-sounding speech
- Generates MP3 audio files
- Uses AI voices (not robotic)

**How it's used:**

```javascript
// Worker calls ElevenLabs TTS API
POST https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID
Headers: {
  'xi-api-key': 'YOUR_ELEVENLABS_KEY',
  'Content-Type': 'application/json'
}
Body: {
  text: "This is a summary of the content...",
  model_id: "eleven_monolingual_v1",
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75
  }
}
```

**ElevenLabs Response:**
- Returns MP3 audio as binary data (ArrayBuffer)
- Worker receives the audio file directly

**Why ElevenLabs?**
- Best quality AI voices
- Natural-sounding speech
- Fast generation
- Free tier: 10,000 characters/month

---

### 4. Vultr Object Storage (The File Host)

**What it does:**
- Stores audio files (MP3s from ElevenLabs)
- Serves files via CDN for fast delivery
- S3-compatible API (works like AWS S3)

**How it's used:**

**Step 1: Worker receives audio from ElevenLabs**
```javascript
const audioArrayBuffer = await elevenLabsResponse.arrayBuffer();
```

**Step 2: Worker uploads to Vultr**
```javascript
PUT https://ewr1.vultrobjects.com/silo-audio/audio/item_123.mp3
Headers: {
  'Authorization': 'AWS ACCESS_KEY:SIGNATURE',
  'Content-Type': 'audio/mpeg'
}
Body: [MP3 binary data]
```

**Step 3: Worker returns CDN URL**
```javascript
return { audioUrl: "https://ewr1.vultrobjects.com/audio/item_123.mp3" }
```

**Why Vultr?**
- Cheap object storage
- Fast CDN included
- S3-compatible (easy to use)
- Pay-as-you-go pricing

---

## 🔐 Security & API Keys

**All API keys are stored server-side only:**

1. **Gemini API Key** → Stored as Cloudflare Worker secret
2. **ElevenLabs API Key** → Stored as Cloudflare Worker secret
3. **Vultr Keys** → Stored as Cloudflare Worker secrets

**Your mobile app NEVER sees these keys!**

The app only knows:
- The Cloudflare Worker URL (public)
- How to send requests (public endpoints)

All sensitive operations happen in the Cloudflare Worker.

---

## 📊 Complete Flow Diagram

```
┌─────────────────┐
│  Mobile App     │
│  (React Native) │
└────────┬────────┘
         │
         │ POST /api/analyze-image
         │ { imageBase64, mimeType }
         ↓
┌─────────────────────────┐
│  Cloudflare Worker      │
│  (workers/analyze-image)│
└────────┬────────────────┘
         │
         │ POST to Gemini API
         │ { image + prompt }
         ↓
┌─────────────────┐
│  Gemini API     │
│  (Google AI)    │
└────────┬────────┘
         │
         │ Returns JSON:
         │ { classification, title, description, script }
         ↓
┌─────────────────────────┐
│  Cloudflare Worker      │
│  (parses & returns)     │
└────────┬────────────────┘
         │
         │ Returns analysis
         ↓
┌─────────────────┐
│  Mobile App     │
│  (saves item)   │
└────────┬────────┘
         │
         │ POST /api/generate-audio
         │ { text: script, itemId }
         ↓
┌─────────────────────────┐
│  Cloudflare Worker      │
│  (workers/generate-audio)│
└────────┬────────────────┘
         │
         ├─→ POST to ElevenLabs
         │   Returns: MP3 audio
         │
         └─→ PUT to Vultr
             Uploads: MP3 file
         │
         │ Returns: CDN URL
         ↓
┌─────────────────┐
│  Mobile App     │
│  (plays audio)  │
└─────────────────┘
```

---

## 🎯 Why This Architecture?

1. **Serverless**: No server to manage, scales automatically
2. **Fast**: Cloudflare Workers run at the edge (close to users)
3. **Secure**: API keys never exposed to mobile app
4. **Cost-effective**: Free tiers cover most use cases
5. **Reliable**: Cloudflare's global network ensures uptime

---

## 🛠️ What Each File Does

### `workers/index.ts`
- Main entry point
- Routes requests to correct handler
- Handles CORS headers
- Health check endpoint

### `workers/analyze-image.ts`
- Receives base64 image
- Calls Gemini API with image
- Parses Gemini response
- Returns structured data

### `workers/analyze-link.ts`
- Receives URL
- Fetches webpage HTML
- Extracts text content
- Calls Gemini API with text
- Returns structured data

### `workers/generate-audio.ts`
- Receives text + itemId
- Calls ElevenLabs API → gets MP3
- Uploads MP3 to Vultr Object Storage
- Returns CDN URL

### `workers/suggest-schedule.ts`
- Receives item metadata
- Calls Gemini API for schedule suggestion
- Returns date, time, and reason

---

## 💡 Key Points

1. **Mobile app is "dumb"** - It just sends requests and displays results
2. **Cloudflare Worker is "smart"** - It orchestrates all the AI services
3. **API keys are secret** - Only the Worker knows them
4. **Audio files are stored** - In Vultr, served via CDN
5. **Everything is async** - Fast, non-blocking operations

---

## 🚀 Performance

- **Image Analysis**: ~2-3 seconds (Gemini API)
- **Link Analysis**: ~3-5 seconds (fetch + Gemini)
- **Audio Generation**: ~5-8 seconds (ElevenLabs + Vultr upload)
- **Total**: Usually under 10 seconds for complete flow

---

This architecture ensures your app is fast, secure, and scalable! 🎉

