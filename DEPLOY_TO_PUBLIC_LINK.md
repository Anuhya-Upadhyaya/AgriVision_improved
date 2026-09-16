# Getting AgriVision onto one link that works on any phone

AgriVision has two parts, and both need to be online (not just running on your
laptop) before a link will work for someone else:

1. **Backend** (`backend/`) — FastAPI service that loads the 11 ML models.
2. **Frontend** (`frontend/`) — the web app people actually open.

`http://127.0.0.1:8000` only exists on your own machine, so step 1 has to be
done first, and the URL it gives you gets pasted into the frontend before
step 2.

---

## Step 1 — Put the backend online (Render, free tier)

> ⚠️ **Before you push to GitHub:** `backend/models/random_forest_soil_model.pkl`
> is ~104.9MB — just over GitHub's hard 100MB-per-file limit. A plain
> `git add`/`git push` of this repo **will be rejected**. This project already
> includes a `.gitattributes` that tracks it (and the other model files) with
> **Git LFS**, so set that up once before your first commit:
>
> ```bash
> git lfs install          # one-time, per machine
> cd AgriVision_improved
> git init
> git add .gitattributes   # must be added before the .pkl files
> git add .
> git commit -m "Initial commit"
> git remote add origin <your-empty-github-repo-url>
> git push -u origin main
> ```
>
> No Git LFS account/billing is needed for a repo this size (GitHub's free
> LFS quota is 1GB storage / 1GB bandwidth per month). Render pulls LFS
> objects automatically during its build — no extra Render configuration
> needed. If you don't have `git-lfs` installed locally, get it from
> [git-lfs.com](https://git-lfs.com) first (`apt install git-lfs`,
> `brew install git-lfs`, or the Windows installer).

1. Push this project to a **GitHub repo** (Render deploys from Git).
2. Go to [render.com](https://render.com) → sign up/log in → **New +** →
   **Web Service** → connect your GitHub repo.
3. Set:
   - **Root directory:** `backend`
   - **Environment:** Docker (Render will detect `backend/Dockerfile`
     automatically)
   - **Instance type:** Free
4. Under **Environment Variables**, add:
   - `ALLOWED_ORIGINS` = `https://agrivision-84da7.web.app,https://agrivision-84da7.firebaseapp.com`
     (the backend already trusts these two by default even without this
     variable set, so this step is mainly needed if you're deploying under
     a different Firebase project/domain — set it explicitly then so the
     backend isn't left trusting `*`).
5. Click **Create Web Service**. First build takes a few minutes (it's
   installing scikit-learn/xgboost/lightgbm/catboost).
6. When it's live, Render gives you a URL like:
   `https://agrivision-backend.onrender.com`
7. Open `https://agrivision-backend.onrender.com/health` in a browser —
   you should see `"status": "healthy"` and `"models_loaded": 11`.

> `render.yaml` in the project root already encodes steps 3–4 as a Render
> "Blueprint" if you'd rather click **New +** → **Blueprint** and point it
> at this repo instead of doing it by hand.

> Free-tier services on Render sleep after inactivity and take ~30–60s to
> wake up on the next request — normal for a free demo, mention it if
> classmates say the first prediction feels slow.

**Alternative:** Railway.app works the same way (Dockerfile auto-detected)
if you'd rather use that instead of Render.

## Step 2 — Point the frontend at that backend

Open `frontend/app.js` and find this block near the top:

```js
const API_BASE_URL =
  (window.location.hostname === "localhost" ||
   window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000"
    : "https://agrivision-backend-bhp8.onrender.com";
```

It already auto-detects local development (no editing needed there). The
part to change is only the string after the `:` on the last line — replace
`https://agrivision-backend-bhp8.onrender.com` with your own Render URL
from Step 1. This is the only place the backend URL is configured — the
frontend has no in-app settings screen, so re-pointing it to a new backend
always means editing this line and redeploying the frontend (Step 3).

## Step 3 — Put the frontend online (Firebase Hosting — already configured)

This repo already has `firebase.json`, `.firebaserc` and `firestore.rules`
pointed at the `agrivision-84da7` Firebase project, and the frontend already
calls Firebase Auth + Firestore from `frontend/firebase-config.js`.

From the project root (needs [Node.js](https://nodejs.org) installed):

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore
```

Firebase Hosting will print your public link, e.g.:

```
https://agrivision-84da7.web.app
```

Send **that one link** to anyone — it opens correctly on any phone's
browser (Chrome/Safari), and because it's a PWA (`manifest.json` +
`service-worker.js`) people can also tap "Add to Home Screen" to install it

## What's in this build

- **All 11 models, real weighted ensemble**: every prediction runs all
  successfully loaded models and combines them using normalized R² weights
  — no external service, no fake/simplified ensemble.
- **Model Agreement**: every prediction returns a High/Moderate/Low
  agreement score (coefficient of variation across the 11 models'
  predictions), shown as a badge on the result screen. This is explicitly
  *not* a confidence score — it only says how much the models agree with
  each other.
- **Dataset-only location handling, no external geocoding**: the supplied
  dataset (`Crop and fertilizer dataset.csv`) has exactly one location
  column, `District_Name`. District is the only part of the location
  checked against real data — the District dropdown is populated straight
  from `/districts`, and `/predict` rejects any district it can't find in
  the dataset (see `location_sourcing` in the API response). State and
  Village/Area are plain farmer-supplied text, clearly labeled as
  "user-provided" everywhere they're shown, never claimed to be verified.
  No OpenStreetMap, Nominatim, Google Maps, or any other geocoding service
  is called anywhere in this app.
- **Locked-down CORS**: the backend only accepts requests from the origins
  you set in `ALLOWED_ORIGINS` (see Step 1.4) instead of `*`.
- **Installable PWA**: `manifest.json` now ships real icons and
  `service-worker.js` is actually registered from `app.js` (it previously
  existed in the project but nothing loaded it), so "Add to Home Screen" /
  the browser install prompt genuinely works.
- **Working State → District dropdowns and a working "Analyze My Land"
  button**: see the "What was fixed in this pass" section of `README.md`
  for the details — both were previously non-functional.
- **Splash → Get Started → Login**, satisfying the no-auto-login
  requirement: the app opens on a splash screen, not straight into the
  login form or the dashboard.

Before deploying, in the [Firebase Console](https://console.firebase.google.com)
for this project, make sure:
- **Authentication → Sign-in method → Email/Password** is enabled
- **Firestore Database** has been created (any region)

## Alternative to Firebase Hosting

If you'd rather not use the Firebase CLI, any static host works just as
well since `frontend/` is plain HTML/CSS/JS — e.g. drag-and-drop the
`frontend` folder onto [Netlify Drop](https://app.netlify.com/drop) or
[Vercel](https://vercel.com), which also hand you a public link instantly.
Firebase Auth/Firestore still work from those hosts — only the ML backend
URL in `app.js` needs to be correct.

## Quick temporary option (same-day demo, laptop must stay on)

If you just need a link for the next hour (e.g. showing a professor live)
and don't want to deploy anywhere:

```bash
# terminal 1 — backend
cd backend && uvicorn backend_v2:app --host 0.0.0.0 --port 8000
# terminal 2 — frontend
python -m http.server 5500 --directory frontend
# terminal 3 — tunnel each so phones off your Wi-Fi can reach them
npx localtunnel --port 8000   # note the URL, e.g. https://xyz.loca.lt
npx localtunnel --port 5500
```

Before running this, edit the production URL inside the `API_BASE_URL`
block near the top of `frontend/app.js` to your backend tunnel URL (e.g.
`https://xyz.loca.lt`), same as Step 2 above, then start the two terminals.
This stops working the moment you close the terminals — use Steps 1–3 above
for anything that needs to keep working later.
