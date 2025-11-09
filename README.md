# Silo - AI-Powered Content Management App

Silo is a mobile app for saving, organizing, and rediscovering content (links, screenshots, notes). It uses AI to automatically classify content and schedule review sessions, with a TikTok-style feed for browsing and calendar integration.

## Features

- **TikTok-Style Feed**: Swipe through content items with full-screen cards and audio narration
- **AI Classification**: Automatic content categorization using Google Gemini
- **Text-to-Speech**: AI-generated audio summaries via ElevenLabs
- **Smart Scheduling**: AI-suggested review times with calendar integration
- **Screenshot Detection**: Automatic import and analysis of device screenshots
- **Stacks (Collections)**: Organize related content into custom collections
- **Multi-Input Support**: Add links, screenshots, photos, and notes
- **Cloud Storage**: Audio files hosted on Vultr CDN

## Architecture

### Backend (Cloudflare Workers)

- **Platform**: Cloudflare Workers (serverless)
- **AI**: Google Gemini API for image/link analysis
- **TTS**: ElevenLabs API for audio generation
- **Storage**: Vultr Object Storage for audio files
- **CDN**: Vultr CDN for fast audio delivery

### Frontend (React Native/Expo)

- **Framework**: Expo SDK 54 with TypeScript
- **Routing**: Expo Router (file-based)
- **Storage**: AsyncStorage (local device storage)
- **UI**: Native iOS tab bar, gradient backgrounds, swipeable feed

## Project Structure

```
silo/
├── app/                          # Expo Router screens
│   ├── _layout.tsx              # Root layout
│   ├── (tabs)/                  # Tab navigation
│   │   ├── _layout.tsx          # Native tabs layout
│   │   ├── reel.tsx             # Streams feed (TikTok-style)
│   │   ├── index.tsx            # Stacks view
│   │   ├── calendar.tsx         # Calendar view
│   │   ├── screenshots.tsx      # Screenshot review
│   │   └── add.tsx              # Add content
│   ├── item/[id].tsx            # Item detail
│   └── silo/[id].tsx            # Stack detail
├── lib/                          # Frontend utilities
│   ├── types.ts                 # TypeScript interfaces
│   ├── storage.ts               # AsyncStorage wrapper
│   ├── api.ts                   # Backend API client
│   ├── scheduler.ts             # Calendar integration
│   ├── screenshots.ts           # Screenshot detection
│   └── seed.ts                  # Example data
├── components/                   # React components
│   ├── StreamCard.tsx           # Reel feed card
│   ├── TagPicker.tsx            # Tag selector
│   └── ItemCard.tsx             # Item list card
├── workers/                      # Cloudflare Workers
│   ├── index.ts                 # Main router
│   ├── types.ts                 # Worker types
│   ├── analyze-image.ts         # Image analysis
│   ├── analyze-link.ts          # Link analysis
│   ├── generate-audio.ts        # Audio generation
│   └── suggest-schedule.ts      # Schedule suggestions
├── package.json                  # Frontend dependencies
├── tsconfig.json                # TypeScript config
├── wrangler.toml                # Cloudflare Workers config
└── README.md                     # This file
```

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- Expo CLI (`npm install -g expo-cli`)
- Wrangler CLI (`npm install -g wrangler`)
- iOS/Android device or simulator
- API keys:
  - Google Gemini API key
  - ElevenLabs API key
  - Vultr Object Storage credentials

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd silo
npm install
```

### 2. Configure Backend (Cloudflare Workers)

#### Set up Cloudflare Workers

```bash
# Login to Cloudflare
wrangler login

# Configure secrets
wrangler secret put GEMINI_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put ELEVENLABS_VOICE_ID
wrangler secret put VULTR_ACCESS_KEY
wrangler secret put VULTR_SECRET_KEY
wrangler secret put VULTR_BUCKET
wrangler secret put VULTR_ENDPOINT
wrangler secret put VULTR_CDN_DOMAIN
```

#### Deploy Workers

```bash
wrangler deploy
```

Note the deployed Worker URL (e.g., `https://silo-api.your-subdomain.workers.dev`)

### 3. Configure Frontend

Create `.env` file:

```bash
EXPO_PUBLIC_API_BASE_URL=https://silo-api.your-subdomain.workers.dev
```

### 4. Configure Vultr Object Storage

1. Create a Vultr account at https://vultr.com
2. Create an Object Storage instance
3. Create a bucket (e.g., `silo-audio`)
4. Configure CORS:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

5. Enable CDN for the bucket
6. Note the endpoint URL and CDN domain

### 5. Get API Keys

#### Google Gemini API

1. Visit https://makersuite.google.com/app/apikey
2. Create a new API key
3. Copy the key

#### ElevenLabs API

1. Visit https://elevenlabs.io
2. Create an account and go to Profile → API Keys
3. Create a new API key
4. Copy the key and a voice ID (e.g., `21m00Tcm4TlvDq8ikWAM`)

### 6. Run the App

```bash
# Start Expo development server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android

# Run on physical device
# Scan the QR code with Expo Go app
```

## API Endpoints

### Backend (Cloudflare Workers)

#### POST `/api/analyze-image`

Analyze an image with Gemini AI.

**Request:**
```json
{
  "imageBase64": "base64-encoded-image",
  "mimeType": "image/jpeg"
}
```

**Response:**
```json
{
  "classification": "article",
  "title": "Item title",
  "description": "Detailed description",
  "script": "Audio narration text",
  "tags": ["tag1", "tag2"],
  "duration": 10
}
```

#### POST `/api/analyze-link`

Analyze a URL with Gemini AI.

**Request:**
```json
{
  "url": "https://example.com/article"
}
```

**Response:**
```json
{
  "classification": "article",
  "title": "Article title",
  "description": "Article summary",
  "script": "Audio narration text",
  "tags": ["tag1", "tag2"],
  "duration": 5
}
```

#### POST `/api/generate-audio`

Generate TTS audio and upload to Vultr.

**Request:**
```json
{
  "text": "Text to convert to speech",
  "itemId": "unique-item-id"
}
```

**Response:**
```json
{
  "audioUrl": "https://cdn.vultr.com/audio/item_123.mp3"
}
```

#### POST `/api/suggest-schedule`

Get AI-powered schedule suggestions.

**Request:**
```json
{
  "title": "Item title",
  "classification": "article",
  "description": "Description",
  "duration": 10
}
```

**Response:**
```json
{
  "date": "2025-03-15",
  "time": "09:00",
  "reason": "Morning is best for focused reading"
}
```

## Development

### Frontend

```bash
# Type check
npm run type-check

# Lint code
npm run lint
```

### Backend

```bash
# Test worker locally
wrangler dev

# Deploy to production
wrangler deploy

# View logs
wrangler tail
```

## Data Storage

### Local Storage (AsyncStorage)

All content items and metadata are stored locally on the device using AsyncStorage:

- **Items**: Array of content items (links, screenshots, notes)
- **Stacks**: Array of collection/stack definitions
- **Settings**: User preferences
- **Events**: Scheduled calendar events

### Cloud Storage (Vultr)

Only audio files (MP3 from ElevenLabs) are stored in Vultr Object Storage and delivered via CDN.

## Security

- ✅ API keys stored server-side only (Cloudflare Workers secrets)
- ✅ No sensitive data in frontend code
- ✅ CORS configured for mobile app
- ✅ Local storage encrypted by device OS
- ✅ HTTPS for all API communication

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend Framework | Expo SDK 54, React Native |
| Language | TypeScript (strict mode) |
| Routing | Expo Router (file-based) |
| Local Storage | AsyncStorage |
| Backend | Cloudflare Workers |
| AI (Image/Link) | Google Gemini API |
| Text-to-Speech | ElevenLabs API |
| Audio Storage | Vultr Object Storage |
| CDN | Vultr CDN |
| Calendar | expo-calendar |
| Media | expo-media-library, expo-image-picker |
| Audio | expo-av |

## License

MIT

## Support

For issues and questions, please open a GitHub issue.

