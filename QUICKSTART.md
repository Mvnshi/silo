# Silo - Quick Start Guide

Get Silo up and running in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- Expo CLI: `npm install -g expo-cli`
- Wrangler CLI: `npm install -g wrangler`
- iOS Simulator or Android Emulator (or Expo Go app on your phone)

## 5-Minute Setup

### 1. Install Dependencies (1 min)

```bash
cd ubhak
npm install
cd workers && npm install && cd ..
```

### 2. Get API Keys (2 min)

You need three API keys:

- **Gemini API**: https://makersuite.google.com/app/apikey
- **ElevenLabs API**: https://elevenlabs.io/app/speech-synthesis → API Keys
- **Vultr Account**: https://vultr.com (create Object Storage instance)

### 3. Deploy Backend (1 min)

```bash
# Login to Cloudflare
wrangler login

# Set your API keys
wrangler secret put GEMINI_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put ELEVENLABS_VOICE_ID
wrangler secret put VULTR_ACCESS_KEY
wrangler secret put VULTR_SECRET_KEY
wrangler secret put VULTR_BUCKET
wrangler secret put VULTR_ENDPOINT
wrangler secret put VULTR_CDN_DOMAIN

# Deploy
wrangler deploy
```

Copy the deployed URL (e.g., `https://silo-api.your-name.workers.dev`)

### 4. Configure Frontend (30 sec)

Create `.env`:

```bash
EXPO_PUBLIC_API_BASE_URL=https://silo-api.your-name.workers.dev
```

### 5. Run App (30 sec)

```bash
npm start
```

Press `i` for iOS or `a` for Android!

## What's Included

✅ Complete backend (Cloudflare Workers)  
✅ Full mobile app (React Native/Expo)  
✅ AI-powered content analysis (Gemini)  
✅ Text-to-speech narration (ElevenLabs)  
✅ TikTok-style feed UI  
✅ Calendar integration  
✅ Screenshot detection  
✅ Example data pre-loaded  

## First Steps in the App

1. **Browse the Feed**: Swipe through example content on the "Streams" tab
2. **View Stacks**: Check organized collections on the "Stacks" tab
3. **Add Content**: Tap the "Add" tab to add a link or note
4. **Review Screenshots**: Grant permissions and import screenshots
5. **Check Calendar**: See scheduled content reviews

## Testing Without API Keys

Want to test the UI without setting up the backend? The app includes seed data and will work offline (without AI features) by default. Just:

```bash
npm start
```

AI features (analysis, audio generation) will show friendly error messages if the backend isn't configured.

## Next Steps

- Read **SETUP.md** for detailed configuration
- Read **README.md** for architecture overview
- Customize the seed data in `lib/seed.ts`
- Add your own app icons in `assets/`

## Need Help?

- **Backend issues**: Check `wrangler tail` for logs
- **Frontend issues**: Check Expo console for errors
- **API errors**: Verify keys with `wrangler secret list`

Happy organizing! 🚀

