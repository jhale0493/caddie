# CADDIE — Golf Tracker

## Deploy to Vercel (5 minutes)

### Option A: GitHub + Vercel (recommended)
1. Create a new GitHub repo (github.com → New repository → name it `caddie`)
2. Upload all these files into it (drag & drop in the GitHub UI)
3. Go to vercel.com → Add New Project → Import your GitHub repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Your app is live at `caddie.vercel.app` (or similar)

### Option B: Vercel CLI (if you have Node installed)
```bash
npm install
npm run dev        # test locally first
npx vercel         # deploys instantly, gives you a URL
```

## Add to iPhone Home Screen
1. Open your Vercel URL in **Safari**
2. Tap the Share button (box with arrow)
3. Scroll down → **Add to Home Screen**
4. Name it CADDIE → Add
5. Launches full-screen, no browser chrome

## Add to Android Home Screen
1. Open your Vercel URL in **Chrome**
2. Tap the 3-dot menu → **Add to Home screen**

## Features
- Shot tracking with club, distance, result, shape
- GPS distance measurement (Haversine formula)
- USGA World Handicap System calculation
- River Pines Golf Course (all 5 tees) pre-loaded
- AI coach insights after each round
