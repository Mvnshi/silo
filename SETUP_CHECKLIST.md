# 🚀 Silo Backend Setup Checklist

Quick checklist to get your backend running in 15 minutes.

## ✅ Step-by-Step Checklist

### 1. Get API Keys (5 min)

- [ ] **Google Gemini API Key**
  - [ ] Go to https://aistudio.google.com/app/apikey
  - [ ] Create API key
  - [ ] Copy key: `AIza...`

- [ ] **ElevenLabs API Key & Voice ID**
  - [ ] Sign up at https://elevenlabs.io
  - [ ] Go to Profile → API Keys → Create key
  - [ ] Copy API key
  - [ ] Go to https://elevenlabs.io/voice-library
  - [ ] Pick a voice and copy Voice ID (e.g., `21m00Tcm4TlvDq8ikWAM`)

### 2. Set Up Vultr (5 min)

- [ ] **Create Vultr Account**
  - [ ] Sign up at https://vultr.com
  - [ ] Add payment method

- [ ] **Create Object Storage**
  - [ ] Products → Object Storage → Deploy
  - [ ] Choose location → Deploy
  - [ ] Wait for deployment

- [ ] **Create Bucket**
  - [ ] Name: `silo-audio`
  - [ ] Create bucket

- [ ] **Get Credentials**
  - [ ] S3 Compatible tab → Create Access Key
  - [ ] Copy: Access Key, Secret Key, Endpoint, CDN Domain
  - [ ] Save all 4 values!

### 3. Install & Configure Cloudflare (3 min)

- [ ] **Install Wrangler**
  ```bash
  npm install -g wrangler
  ```

- [ ] **Login to Cloudflare**
  ```bash
  wrangler login
  ```

- [ ] **Set All Secrets** (run each command, paste value when prompted)
  ```bash
  wrangler secret put GEMINI_API_KEY
  wrangler secret put ELEVENLABS_API_KEY
  wrangler secret put ELEVENLABS_VOICE_ID
  wrangler secret put VULTR_ACCESS_KEY
  wrangler secret put VULTR_SECRET_KEY
  wrangler secret put VULTR_BUCKET
  wrangler secret put VULTR_ENDPOINT
  wrangler secret put VULTR_CDN_DOMAIN
  ```

### 4. Deploy Backend (2 min)

- [ ] **Install Worker Dependencies**
  ```bash
  cd workers
  npm install
  cd ..
  ```

- [ ] **Deploy Worker**
  ```bash
  wrangler deploy
  ```

- [ ] **Copy Worker URL** (e.g., `https://silo-api.yourname.workers.dev`)

### 5. Configure Frontend (1 min)

- [ ] **Create .env file**
  ```bash
  cp .env.example .env
  ```

- [ ] **Add Worker URL to .env**
  ```
  EXPO_PUBLIC_API_BASE_URL=https://silo-api.yourname.workers.dev
  ```

- [ ] **Restart Expo**
  ```bash
  # Stop current server (Ctrl+C)
  npm start
  ```

### 6. Test Everything

- [ ] **Test Backend Health**
  ```bash
  curl https://silo-api.yourname.workers.dev/
  ```
  Should return JSON with status "ok"

- [ ] **Test in App**
  - [ ] Add a link → Should analyze with AI
  - [ ] Add an image → Should analyze with AI
  - [ ] Check audio narration is generated
  - [ ] Verify audio plays in Streams feed

## 🎯 Quick Command Reference

```bash
# View all set secrets
wrangler secret list

# View worker logs (real-time)
wrangler tail

# Test worker locally
cd workers
wrangler dev

# Deploy worker
wrangler deploy
```

## 🆘 Common Issues

**"API base URL not configured"**
→ Check `.env` file exists and has `EXPO_PUBLIC_API_BASE_URL` set. Restart Expo.

**"Failed to analyze"**
→ Check `wrangler secret list` to verify GEMINI_API_KEY is set. Check logs: `wrangler tail`

**"Failed to generate audio"**
→ Verify ElevenLabs API key and Voice ID are correct. Check account has credits.

**Worker won't deploy**
→ Make sure you're logged in: `wrangler whoami`. Check `wrangler.toml` exists.

## 📝 What You Need (Summary)

1. **Gemini API Key** - From Google AI Studio
2. **ElevenLabs API Key** - From ElevenLabs profile
3. **ElevenLabs Voice ID** - From voice library
4. **Vultr Access Key** - From Object Storage
5. **Vultr Secret Key** - From Object Storage
6. **Vultr Bucket Name** - Your bucket (e.g., `silo-audio`)
7. **Vultr Endpoint** - Your endpoint (e.g., `ewr1.vultrobjects.com`)
8. **Vultr CDN Domain** - Your CDN domain
9. **Cloudflare Worker URL** - After deployment

Once all checked ✅, your backend is ready! 🎉

