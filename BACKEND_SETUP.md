# Complete Backend Setup Guide for Silo

This guide will walk you through setting up all backend services (Cloudflare Workers, Gemini AI, ElevenLabs, and Vultr) so everything works perfectly.

## Prerequisites

- Node.js 18+ installed
- A Cloudflare account (free tier works)
- A Vultr account
- A Google account (for Gemini API)
- An ElevenLabs account

---

## Step 1: Get Google Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Select or create a Google Cloud project
5. Copy the API key (starts with `AIza...`)
6. **Save this key** - you'll need it in Step 4

**Note**: Gemini API has a free tier with generous limits for development.

---

## Step 2: Get ElevenLabs API Key & Voice ID

### Get API Key:
1. Go to https://elevenlabs.io
2. Sign up for an account (free tier available)
3. Go to **Profile** → **API Keys**
4. Click **"Create API Key"**
5. Copy the API key
6. **Save this key** - you'll need it in Step 4

### Get Voice ID:
1. Go to https://elevenlabs.io/voice-library
2. Browse voices and pick one you like (e.g., "Rachel", "Adam", "Antoni")
3. Click on a voice to see its details
4. Copy the **Voice ID** from the URL or voice details page
   - Example: `21m00Tcm4TlvDq8ikWAM` (Rachel)
   - Example: `pNInz6obpgDQGcFmaJgB` (Adam)
5. **Save this Voice ID** - you'll need it in Step 4

**Popular Voice IDs:**
- Rachel: `21m00Tcm4TlvDq8ikWAM`
- Adam: `pNInz6obpgDQGcFmaJgB`
- Antoni: `ErXwobaYiN019PkySvjV`
- Bella: `EXAVITQu4vr4xnSDxMaL`

---

## Step 3: Set Up Vultr Object Storage

### 3.1 Create Vultr Account
1. Go to https://vultr.com
2. Sign up for an account
3. Add payment method (required, but free tier available)

### 3.2 Create Object Storage Instance
1. In Vultr dashboard, go to **Products** → **Object Storage**
2. Click **"Deploy Object Storage"**
3. Choose a location (closest to you, e.g., "New Jersey" or "Los Angeles")
4. Click **"Deploy"**
5. Wait 1-2 minutes for deployment

### 3.3 Create a Bucket
1. Once deployed, click on your Object Storage instance
2. Go to **"Buckets"** tab
3. Click **"Create Bucket"**
4. Name it: `silo-audio` (or any name you prefer)
5. Click **"Create"**

### 3.4 Get Access Keys
1. In your Object Storage instance, go to **"S3 Compatible"** tab
2. Click **"Create Access Key"**
3. Copy both:
   - **Access Key** (starts with `VULTR...`)
   - **Secret Key** (long random string)
4. **Save both keys** - you'll need them in Step 4

### 3.5 Get Endpoint & CDN Domain
1. Still in **"S3 Compatible"** tab, you'll see:
   - **Endpoint**: Something like `ewr1.vultrobjects.com` or `lax1.vultrobjects.com`
   - **CDN Domain**: Something like `ewr1.vultrobjects.com` or your custom CDN domain
2. **Save both** - you'll need them in Step 4

### 3.6 Enable CDN (Optional but Recommended)
1. Go to **"CDN"** tab in your Object Storage instance
2. Enable CDN for your bucket
3. Note the CDN domain (might be the same as endpoint or custom)

### 3.7 Configure CORS (Important!)
1. You can configure CORS via Vultr dashboard or we'll handle it in the worker
2. For now, the worker will handle CORS headers

**Summary - Save These Vultr Values:**
- ✅ Access Key
- ✅ Secret Key
- ✅ Bucket Name (e.g., `silo-audio`)
- ✅ Endpoint (e.g., `ewr1.vultrobjects.com`)
- ✅ CDN Domain (e.g., `ewr1.vultrobjects.com` or custom CDN)

---

## Step 4: Install Wrangler CLI

```bash
npm install -g wrangler
```

Verify installation:
```bash
wrangler --version
```

---

## Step 5: Login to Cloudflare

```bash
wrangler login
```

This will open a browser window. Sign in with your Cloudflare account (or create one for free).

---

## Step 6: Configure Cloudflare Worker Secrets

Run these commands one by one. When prompted, paste the corresponding value:

```bash
# Google Gemini API Key
wrangler secret put GEMINI_API_KEY
# Paste your Gemini API key when prompted

# ElevenLabs API Key
wrangler secret put ELEVENLABS_API_KEY
# Paste your ElevenLabs API key when prompted

# ElevenLabs Voice ID
wrangler secret put ELEVENLABS_VOICE_ID
# Paste your ElevenLabs voice ID when prompted (e.g., 21m00Tcm4TlvDq8ikWAM)

# Vultr Access Key
wrangler secret put VULTR_ACCESS_KEY
# Paste your Vultr access key when prompted

# Vultr Secret Key
wrangler secret put VULTR_SECRET_KEY
# Paste your Vultr secret key when prompted

# Vultr Bucket Name
wrangler secret put VULTR_BUCKET
# Enter your bucket name (e.g., silo-audio)

# Vultr Endpoint
wrangler secret put VULTR_ENDPOINT
# Enter your Vultr endpoint (e.g., ewr1.vultrobjects.com)

# Vultr CDN Domain
wrangler secret put VULTR_CDN_DOMAIN
# Enter your Vultr CDN domain (e.g., ewr1.vultrobjects.com or your custom CDN)
```

**Tip**: You can verify secrets were set by running:
```bash
wrangler secret list
```

---

## Step 7: Install Worker Dependencies

```bash
cd workers
npm install
cd ..
```

---

## Step 8: Deploy Cloudflare Worker

```bash
wrangler deploy
```

**Important**: After deployment, you'll see output like:
```
✨ Deployment complete!
🌍 https://silo-api.your-username.workers.dev
```

**Copy this URL** - this is your API base URL!

---

## Step 9: Configure Frontend

Create a `.env` file in the project root:

```bash
touch .env
```

Add this line to `.env`:
```
EXPO_PUBLIC_API_BASE_URL=https://silo-api.your-username.workers.dev
```

**Replace** `your-username` with your actual Cloudflare Workers subdomain.

**Example**:
```
EXPO_PUBLIC_API_BASE_URL=https://silo-api.myname.workers.dev
```

---

## Step 10: Test the Setup

### Test Backend Endpoints

You can test if your backend is working by making a test request:

```bash
# Test analyze-link endpoint
curl -X POST https://silo-api.your-username.workers.dev/api/analyze-link \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

If you get a JSON response, your backend is working! 🎉

### Test in App

1. Restart your Expo server:
   ```bash
   npm start
   ```

2. In the app, try adding a link or image
3. It should analyze with AI and generate audio

---

## Troubleshooting

### Issue: "API base URL not configured"
**Solution**: Make sure your `.env` file exists and has `EXPO_PUBLIC_API_BASE_URL` set. Restart Expo server after creating/editing `.env`.

### Issue: "Failed to analyze image/link"
**Solution**: 
- Check that `GEMINI_API_KEY` secret is set correctly: `wrangler secret list`
- Check Cloudflare Worker logs: `wrangler tail`
- Verify Gemini API key is valid at https://aistudio.google.com/app/apikey

### Issue: "Failed to generate audio"
**Solution**:
- Check that `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are set correctly
- Verify ElevenLabs API key at https://elevenlabs.io/app/settings/api-keys
- Check your ElevenLabs account has credits/quota remaining

### Issue: "Failed to upload to Vultr"
**Solution**:
- Verify all Vultr secrets are set: `wrangler secret list`
- Check that bucket name, endpoint, and CDN domain are correct
- Verify Vultr access keys are valid in Vultr dashboard

### Issue: Worker deployment fails
**Solution**:
- Make sure you're logged in: `wrangler whoami`
- Check `wrangler.toml` exists and is valid
- Make sure `workers/index.ts` exists

### View Worker Logs
```bash
wrangler tail
```

This shows real-time logs from your deployed worker. Very helpful for debugging!

---

## Quick Reference

### All Required Secrets:
1. `GEMINI_API_KEY` - From Google AI Studio
2. `ELEVENLABS_API_KEY` - From ElevenLabs profile
3. `ELEVENLABS_VOICE_ID` - From ElevenLabs voice library
4. `VULTR_ACCESS_KEY` - From Vultr Object Storage
5. `VULTR_SECRET_KEY` - From Vultr Object Storage
6. `VULTR_BUCKET` - Your bucket name (e.g., `silo-audio`)
7. `VULTR_ENDPOINT` - Your Vultr endpoint (e.g., `ewr1.vultrobjects.com`)
8. `VULTR_CDN_DOMAIN` - Your Vultr CDN domain

### Frontend Environment Variable:
- `EXPO_PUBLIC_API_BASE_URL` - Your Cloudflare Worker URL

---

## Cost Estimates (Free Tiers)

- **Cloudflare Workers**: Free tier includes 100,000 requests/day
- **Google Gemini API**: Free tier with generous limits
- **ElevenLabs**: Free tier includes 10,000 characters/month
- **Vultr Object Storage**: Pay-as-you-go, very cheap (~$5/month for moderate use)

---

## Next Steps

Once everything is set up:

1. ✅ Test adding a link - should analyze with AI
2. ✅ Test adding an image - should analyze with AI
3. ✅ Check that audio narration is generated
4. ✅ Verify audio files are accessible via CDN

If all of these work, your backend is fully configured! 🚀

