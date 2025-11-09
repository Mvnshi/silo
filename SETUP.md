# Silo Setup Guide

This guide will walk you through setting up the Silo app from scratch.

## Quick Start

### 1. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install worker dependencies
cd workers
npm install
cd ..
```

### 2. Get API Keys

You'll need the following API keys:

#### Google Gemini API
1. Go to https://makersuite.google.com/app/apikey
2. Click "Create API Key"
3. Copy the generated key

#### ElevenLabs API
1. Go to https://elevenlabs.io
2. Sign up and navigate to Profile → API Keys
3. Create a new API key
4. Copy the API key
5. Choose a voice from https://elevenlabs.io/voice-library and copy the voice ID

#### Vultr Object Storage
1. Sign up at https://vultr.com
2. Go to Products → Object Storage
3. Deploy a new Object Storage instance
4. Create a bucket (e.g., "silo-audio")
5. Copy the:
   - Access Key
   - Secret Key
   - Endpoint (e.g., "ewr1.vultrobjects.com")
6. Enable CDN and copy the CDN domain

### 3. Configure Backend (Cloudflare Workers)

```bash
# Install Wrangler CLI globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Set environment secrets
wrangler secret put GEMINI_API_KEY
# Paste your Gemini API key when prompted

wrangler secret put ELEVENLABS_API_KEY
# Paste your ElevenLabs API key

wrangler secret put ELEVENLABS_VOICE_ID
# Paste your ElevenLabs voice ID

wrangler secret put VULTR_ACCESS_KEY
# Paste your Vultr access key

wrangler secret put VULTR_SECRET_KEY
# Paste your Vultr secret key

wrangler secret put VULTR_BUCKET
# Enter your bucket name (e.g., "silo-audio")

wrangler secret put VULTR_ENDPOINT
# Enter your Vultr endpoint (e.g., "ewr1.vultrobjects.com")

wrangler secret put VULTR_CDN_DOMAIN
# Enter your Vultr CDN domain
```

### 4. Deploy Backend

```bash
# Deploy the Cloudflare Workers
wrangler deploy

# Note the deployed URL (e.g., https://silo-api.your-subdomain.workers.dev)
```

### 5. Configure Frontend

Create a `.env` file in the project root:

```bash
EXPO_PUBLIC_API_BASE_URL=https://silo-api.your-subdomain.workers.dev
```

Replace the URL with your actual Cloudflare Workers URL from step 4.

### 6. Configure Vultr CORS

Set up CORS for your Vultr bucket to allow mobile app access:

```bash
# Using AWS CLI (Vultr is S3-compatible)
aws s3api put-bucket-cors \
  --bucket silo-audio \
  --cors-configuration file://cors.json \
  --endpoint-url https://ewr1.vultrobjects.com
```

Create `cors.json`:
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

### 7. Run the App

```bash
# Start Expo development server
npm start

# Then choose:
# - Press 'i' for iOS simulator
# - Press 'a' for Android emulator
# - Scan QR code with Expo Go app for physical device
```

## Testing the Backend

Test your Cloudflare Workers endpoints:

```bash
# Health check
curl https://silo-api.your-subdomain.workers.dev/api

# Test link analysis (requires API to be deployed)
curl -X POST https://silo-api.your-subdomain.workers.dev/api/analyze-link \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Troubleshooting

### Backend Issues

**Issue**: Workers deployment fails
- Run `wrangler whoami` to check authentication
- Ensure wrangler.toml is properly configured
- Check that all secrets are set with `wrangler secret list`

**Issue**: API returns errors
- Check worker logs: `wrangler tail`
- Verify all API keys are correct
- Test API keys independently before deploying

### Frontend Issues

**Issue**: "API base URL not configured"
- Ensure `.env` file exists in project root
- Check that `EXPO_PUBLIC_API_BASE_URL` is set
- Restart Expo server after creating `.env`

**Issue**: Images/Screenshots not working
- Grant permissions when app requests them
- On iOS simulator: Photos app may not have screenshots
- Use real device or manually add images to simulator

**Issue**: Audio not playing
- Check that audio files are being generated (check worker logs)
- Verify Vultr CDN is properly configured
- Test audio URL directly in browser

### Common Errors

**"Failed to analyze image"**
- Check Gemini API key is valid
- Verify image is in supported format (JPEG, PNG)
- Check image size isn't too large (reduce quality in ImagePicker config)

**"Failed to generate audio"**
- Check ElevenLabs API key and voice ID
- Verify you have sufficient ElevenLabs credits
- Check Vultr bucket permissions

**"Calendar permission denied"**
- Go to device Settings → Silo → enable Calendar access
- On iOS, permissions must be granted from Settings app

## Development Tips

### Local Development

For faster development, you can run workers locally:

```bash
wrangler dev
```

Update your `.env` to point to localhost:
```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8787
```

### Debugging

- Use React DevTools: `npm install -g react-devtools`
- View Expo logs: They appear in terminal where you ran `npm start`
- View Worker logs: `wrangler tail` in separate terminal
- Check AsyncStorage: Use Expo dev menu → "Debug Remote JS"

### Seed Data

The app automatically seeds example data on first launch. To reset:

```javascript
// In Expo console (shake device → Debug Remote JS)
import { clearAll } from './lib/storage';
await clearAll();
// Then reload the app
```

## Production Deployment

### Backend (Cloudflare Workers)

Already deployed to Cloudflare's global network! Just run:
```bash
wrangler deploy
```

### Frontend (Mobile App)

Build for app stores:

```bash
# iOS
eas build --platform ios

# Android
eas build --platform android
```

See https://docs.expo.dev/build/introduction/ for complete guide.

## Support

- Expo docs: https://docs.expo.dev
- Cloudflare Workers: https://developers.cloudflare.com/workers
- Gemini API: https://ai.google.dev
- ElevenLabs: https://docs.elevenlabs.io
- Vultr: https://www.vultr.com/docs/

