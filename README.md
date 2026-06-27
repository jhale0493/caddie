# CADDIE — Golf Tracker

## Deploy to Vercel (5 minutes)

### Option A: GitHub + Vercel (recommended)
1. Create a new GitHub repo (github.com → New repository → name it `caddie`)
2. Upload all these files into it (drag & drop in the GitHub UI)
3. Go to vercel.com → Add New Project → Import your GitHub repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Your app is live at `caddie.vercel.app` (or similar)

### Option B: Vercel CLI
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

## Add to Android Home Screen
1. Open your Vercel URL in **Chrome**
2. Tap the 3-dot menu → **Add to Home screen**

## Features
- Shot tracking: club, distance, result, shape
- GPS distance measurement (Haversine formula)
- Map mode: tap-to-mark ball position with auto distance + score calculation
- USGA World Handicap System calculation
- Strokes Gained (Putting, Tee-to-Green, Total)
- Driving accuracy & GIR tracking
- Course notes per hole
- River Pines, St. Marlo CC, RTJ Grand National (Links) pre-loaded
- MyGSGA score posting deep link
- CSV export
- AI coach insights after each round

## Note on Map Mode
A Google Maps Static API key is already wired into `src/App.jsx`. Satellite
imagery will load automatically once deployed. If the map ever shows a blank
or fallback screen, check that:
1. The Maps Static API is enabled in your Google Cloud project
2. Billing is active on the project (required by Google even for free tier)
3. If you added an HTTP referrer restriction on the key, it includes your
   deployed Vercel domain (e.g. `caddie.vercel.app/*`)

