# AgriVision

AI-powered smart agriculture and soil intelligence PWA. A farmer signs up,
enters soil/location data (typed, or extracted from a PDF soil report or a
photo), gets a nitrogen prediction from an 11-model weighted ensemble with
farmer-friendly recommendations, and every analysis is saved to that
farmer's own history in Firestore.

**Want the fastest path to one public link you can hand to someone else?**
→ see [`DEPLOY_TO_PUBLIC_LINK.md`](./DEPLOY_TO_PUBLIC_LINK.md). This README
covers the same ground in more depth, plus how to verify everything works.

---

## 1. Project structure

```
AgriVision/
├── frontend/                    Firebase-hosted PWA (HTML/CSS/vanilla JS)
│   ├── index.html               All views (splash, auth, dashboard, analysis,
│   │                            report/image extraction, result, history,
│   │                            profile) — one page, JS shows/hides sections
│   ├── app.js                   Firebase Auth, Firestore, API calls, all UI logic
│   ├── firebase-config.js       Firebase Web SDK config for project agrivision-84da7
│   ├── style.css                Responsive styling (mobile bottom nav / desktop top nav)
│   ├── manifest.json            PWA manifest
│   ├── service-worker.js        Network-first service worker
│   └── icons/                   PWA icons
├── backend/
│   ├── backend_v2.py            FastAPI app: /predict, /districts, /health, /extract/*
│   ├── requirements.txt
│   ├── Dockerfile               Render-compatible container build
│   ├── .env.example
│   ├── data/
│   │   └── Crop and fertilizer dataset.csv
│   └── models/                  11 trained model .pkl files (tracked with Git LFS)
├── firebase.json                Hosting config (public dir = frontend/, SPA rewrite)
├── firestore.rules              Per-user security rules
├── firestore.indexes.json
├── .firebaserc                  Points at project agrivision-84da7
├── render.yaml                  Render "Blueprint" for the backend
├── research_assets/             Original training notebook/artifacts (not used at runtime)
└── README.md / DEPLOY_TO_PUBLIC_LINK.md
```

---

## 2. Firebase setup

The real project config is already in `frontend/firebase-config.js` and
`.firebaserc` (project ID `agrivision-84da7`) — nothing to invent. In the
[Firebase Console](https://console.firebase.google.com) for that project,
enable, once:

1. **Authentication → Sign-in method → Email/Password** — turn it on.
2. **Firestore Database → Create database** — any region, production mode
   (the rules below lock it down; you do not need "test mode").

## 3. Firestore data model

Every completed analysis is written by the browser (never the backend) to:

```
prediction_history/{autoId}
  userId: <Firebase Auth uid of whoever is signed in>
  ...analysis fields (state, district, crop, predicted_nitrogen, ...)
```

`userId` always comes from `auth.currentUser.uid` at write time — the app
never sends or trusts a client-supplied user id. History reads use
`where("userId", "==", auth.currentUser.uid)`, so a signed-in user only ever
queries their own documents.

## 4. Firestore security rules

`firestore.rules` (already in the repo, deployed with `firebase deploy`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /prediction_history/{docId} {
      allow read: if request.auth != null && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

This is enforced **server-side by Firestore itself**, independent of the
app's own `where("userId", ...)` filtering — even a modified client, or a
raw REST/SDK call with someone else's document ID, is rejected unless
`request.auth.uid` matches. There is no `allow read, write: if true;`
anywhere.

## 5. Firebase Hosting setup

`firebase.json` already points Hosting at `frontend/` and includes the SPA
rewrite (`"**" → "/index.html"`) needed because this is a single-page app.
Nothing to edit here for the existing project.

## 6. Render backend setup

The backend needs to run somewhere reachable from the internet — Render's
free tier works. Full click-by-click steps (including the required Git LFS
setup for the 104MB model file) are in
[`DEPLOY_TO_PUBLIC_LINK.md`](./DEPLOY_TO_PUBLIC_LINK.md#step-1--put-the-backend-online-render-free-tier).
Short version:

1. Push the repo to GitHub (with Git LFS set up first — see the linked doc).
2. Render → New → Web Service → your repo → root directory `backend`,
   environment **Docker** (or use `render.yaml` as a Blueprint).
3. Add environment variable `ALLOWED_ORIGINS` =
   `https://agrivision-84da7.web.app,https://agrivision-84da7.firebaseapp.com`
4. Deploy. Render assigns a URL like `https://your-service.onrender.com`.

⚠️ **Known limitation, stated honestly rather than glossed over:** the 11
loaded models (scikit-learn, XGBoost, LightGBM, CatBoost together) plus the
~105MB Random Forest pickle push memory use close to, and sometimes over,
Render's free-tier 512MB RAM limit. If the service repeatedly fails to
start or gets OOM-killed on Render specifically, the fix is a paid Render
plan with more RAM — not a code change, and not something to fake around by
silently dropping a model or fabricating results.

## 7. Local development

**Backend** — from the **project root**:

```bash
cd backend && python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..
python -m uvicorn backend.backend_v2:app --reload
```

This exact command (`python -m uvicorn backend.backend_v2:app --reload`,
run from the project root) is verified working — all 11 models and the
dataset load successfully. If you'd rather run it from inside `backend/`
instead, `uvicorn backend_v2:app --reload` also works (the app resolves its
own `data/` and `models/` paths relative to its own file location, not the
current working directory, so both forms find the right files).

API: `http://127.0.0.1:8000` · Interactive docs: `http://127.0.0.1:8000/docs`

**Frontend** — Firebase Auth/Firestore require a real web origin, so don't
just open `index.html` from disk. Serve it, from the project root:

```bash
python -m http.server 5500 --directory frontend
```

Then open `http://127.0.0.1:5500`. `app.js` auto-detects `localhost` /
`127.0.0.1` and points itself at `http://127.0.0.1:8000` in that case —
nothing to configure for local dev.

## 8. How to start the backend (recap)

Project root, one line: `python -m uvicorn backend.backend_v2:app --reload`.
Confirm it's healthy before touching the frontend — see §10 below.

## 9. How to deploy to Firebase Hosting

```bash
npm install -g firebase-tools   # once
firebase login
firebase use agrivision-84da7
firebase deploy --only hosting,firestore
```

Firebase prints the live URL — `https://agrivision-84da7.web.app`. Open it
on a phone, tablet, or desktop; it's the same PWA everywhere, and people can
"Add to Home Screen" to install it.

## 10. How to verify the backend

```bash
curl https://your-backend.onrender.com/health
```

Expect `"status": "healthy"`, `"models_loaded": 11`,
`"models_expected": 11`, and an empty `"failed_models"`. If any model is
missing, the response tells you which one and Render's build logs will show
why (usually a dependency version mismatch — `requirements.txt` already
pins the exact versions the models were trained with, so this shouldn't
happen unless something in that file is changed).

## 11. How to verify State → District

1. Open the app, sign in, go to **Analyze → Manual**.
2. The **District** field starts disabled, showing "Select State First".
3. Pick **Karnataka** in **State** — District becomes enabled and lists only
   Karnataka districts (Bengaluru Urban, Mysuru, ...), never Maharashtra's.
4. Switch **State** to **Maharashtra** — the previously selected Karnataka
   district is cleared automatically, and District repopulates with only
   Maharashtra districts.
5. This is driven entirely by `GET /districts`, which returns
   `{state, district}` pairs built from an explicit backend mapping
   cross-checked against the dataset — not guessed, and not derived from a
   `State` column the CSV doesn't have (it only has `District_Name`).

## 12. How to test login (no-auto-login check)

1. Open the Hosting URL in a fresh/incognito browser tab.
2. You should land on the **splash screen** (logo + "Get Started"), not the
   dashboard and not a pre-filled login form.
3. Tap **Get Started** → the Login form appears, both fields empty.
4. Submitting with empty fields, a malformed email, or a wrong
   password/unknown account all show a clear inline message and do **not**
   sign you in.
5. Only a correct email + password, explicitly submitted, calls Firebase
   `signInWithEmailAndPassword` and reaches the dashboard.
6. Reloading the tab afterwards restores that same session (Firebase's own
   persisted auth state) — that's session *restoration*, not a new
   automatic login, and it only ever applies to a browser that already has
   a valid session.
7. **Logout** fully signs out; reloading afterwards returns to the splash
   screen, and the dashboard/analysis/history views are inaccessible.

## 13. How to test user-specific history

1. Sign up as User A, run one manual analysis, check **Reports** — it
   appears.
2. Log out, sign up as User B (different email), check **Reports** — empty
   state, no sign of User A's analysis.
3. Run an analysis as User B, log out, log back in as User A — User A still
   only sees their own single analysis, not User B's.
4. This is enforced twice: the app's own Firestore query filters by
   `auth.currentUser.uid`, and `firestore.rules` independently rejects any
   read/write whose document `userId` doesn't match the caller's
   `request.auth.uid` — so it holds even against a modified client.

---

## What was fixed in this pass

The previous state of this project (the "fixed" zip supplied) already had a
lot right — a working 11-model backend with a real, dataset-verified
state↔district mapping, secure Firestore rules, a correct no-auto-login
`onAuthStateChanged` flow, and a complete set of UI pieces (validation
ranges, chart renderers, PDF/photo extraction, Firestore save/read). What it
was missing was the code that connected those pieces together:

- **State/District dropdowns did nothing.** `loadDistricts()` and
  `filterDistrictsByState()` were called from the auth/extraction flows but
  never defined anywhere in `app.js`, so State stayed on "Select State/UT"
  and District stayed stuck on "Loading districts..." forever. Both
  functions are now implemented, plus the `change` listener that clears the
  previous district whenever the state changes.
- **The manual analysis form had no submit handler at all.** There was no
  fetch call to `/predict` anywhere in the frontend — pressing "Analyze My
  Land" would have triggered a native (broken) HTML form submission. A full
  handler now exists: client-side validation → the four-stage loading
  animation (using the `globalLoader` markup that already existed in
  `index.html` but was never triggered) → `POST /predict` → rendering the
  result (farm info, district averages, recommendations, model breakdown,
  charts) → saving to Firestore → showing the result screen.
- **`renderDistrictInformation()` looked for the wrong field names**
  (`district_reference`/`avg_p_by_district`) and would have silently shown
  "no data" even once wired up. It now reads the backend's actual
  `district_averages.phosphorus` / `.potassium` fields.
- **A backend 422 validation-error path crashed with a 500.** Pydantic v2
  puts the raw exception object in `errors()[i]["ctx"]["error"]` for any
  validator that raises `ValueError` (every out-of-range soil value hits
  this) — that raw object isn't JSON-serializable, so the custom error
  handler's own `JSONResponse` construction threw `TypeError` and Starlette
  fell back to a plain-text `"Internal Server Error"`. Fixed by wrapping the
  error list in FastAPI's `jsonable_encoder()`. Verified with `curl`:
  out-of-range Phosphorus now correctly returns
  `422 {"detail": {"message": "Phosphorus must be between 10 and 120.", ...}}`.
- **No Splash → Get Started screen.** The app previously opened directly on
  the Login/Create Account card. A splash screen (logo, tagline, one "Get
  Started" button) now shows first; it never auto-signs anyone in — it only
  reveals the (empty, unsubmitted) login form, or goes straight to the
  dashboard if Firebase reports an already-active session.
- **Documentation drift.** This README and `DEPLOY_TO_PUBLIC_LINK.md`
  referenced a `localStorage.setItem('agrivision_api_url', ...)` override
  that no longer exists in the code, and an example Render URL
  (`...-gbae.onrender.com`) that didn't match the actual configured one
  (`...-bhp8.onrender.com`). Both corrected.

Everything above was verified by actually running the backend
(`python -m uvicorn backend.backend_v2:app`) and calling `/health`,
`/districts`, `/predict` (valid and invalid payloads), and
`/district-summary/{district}` with `curl`, and by syntax-checking the
full, edited `app.js` with `node --check`. What couldn't be verified in this
environment: an actual `firebase deploy` and an actual Render deployment
(no network access to those services here) — the configuration is correct
and matches what's documented, but you should still do a real deploy and
click through the checklist above once, yourself.

## Model usage

`model_choice` defaults to `"auto"`, which runs all 11 loaded models and
combines them into a normalized-R²-weighted ensemble; the farmer never
picks an individual model. **On prediction accuracy specifically:** this
project does not fabricate an accuracy percentage anywhere. What's reported
is *model agreement* — how much the 11 models' predictions vary from each
other (a High/Moderate/Low badge, via coefficient of variation) — which is
a consistency signal, not a validated accuracy claim. If you want a real
accuracy number, that requires evaluating the models against a held-out
test set, which is outside what this project's supplied files establish.

## Fixed previously: Gradient Boosting failed to load

`gradient_boosting_tuned.pkl` was trained with a scikit-learn build whose
compiled loss module registered itself under the bare name `_loss` instead
of `sklearn._loss._loss`. `backend_v2.py` aliases that module before loading
any models, and `requirements.txt` pins `scikit-learn==1.8.0` with
`numpy>=2.0` (the versions the models were actually trained with), so all 11
models load. You may see a harmless `UserWarning` from XGBoost in the logs
about the pickle being from an older version — it still loads and predicts
correctly; the warning is XGBoost being cautious, not an error.

## PDF / photo / camera soil report input

In addition to manual entry, the Analyze screen accepts a PDF soil report,
an uploaded photo, or a camera photo (`capture="environment"` on mobile):

- `POST /extract/pdf` reads the PDF's text layer with `pdfplumber`.
- `POST /extract/image` runs OCR (`pytesseract`) on the photo.

Both only ever return a field if it was actually found in the text —
nothing is guessed. Whatever comes back (and whatever doesn't) is loaded
into the same manual-input form used for typed entry, so the farmer always
reviews and can correct every value before pressing Analyze, and there is
exactly one prediction code path (`/predict`) regardless of how the data
arrived.

## Backend input validation

`/predict` enforces the same ranges as the frontend form (Phosphorus
10–120, Potassium 50–300, pH 5.5–8.5, Rainfall 200–2000, Temperature
15–40) with matching error messages, so a request made directly against the
API (bypassing the browser) is validated too, not just trusted.

## Docker

From `backend/`:

```bash
docker build -t agrivision-backend .
docker run -p 8000:8080 agrivision-backend
```

Building/running this container locally does not itself create a cloud bill.

## Preserved original artifacts

`research_assets/` keeps the original training notebook/artifacts from the
supplied project for reference. The running application uses only the
models in `backend/models/`; `cluster_router.pkl` is not used for
inference.
