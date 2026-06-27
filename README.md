# Aeris — AI Productivity Companion

Aeris is a gamified task & habit tracker with an AI coach, XP/leagues, Google Calendar sync, and installable PWA support. Built on Firebase (Auth + Firestore + Hosting) with a vanilla JS frontend — no build step required.

## Features

- **Tasks** — create, prioritize, schedule, and complete tasks; overdue tasks automatically apply an XP penalty.
- **Habits** — daily habit tracking with streaks.
- **XP & Leagues** — completing tasks/habits earns XP that moves you up a league ladder; a leaderboard ranks XP across users.
- **AI Coach** — a chat assistant (powered by Gemini) with real context: your current tasks, deadlines, habit streaks, and recent activity. Also generates a short daily briefing on the dashboard.
- **Google Calendar sync** — connect your own Google Calendar to push task deadlines as events.
- **Reminders** — opt-in browser notifications fire when a task is due within 15 minutes.
- **Authentication** — email/password sign-up and login via Firebase Auth; each user's data is private and scoped to their account.
- **Installable PWA** — add Aeris to your phone's home screen or install it as a desktop app; works offline for the app shell.

## Tech Stack

- Frontend: vanilla HTML/CSS/JS (ES modules), no framework or build tool
- Auth & Database: Firebase Authentication (email/password) + Cloud Firestore
- Hosting: Firebase Hosting
- AI: Google Gemini API (`gemini-2.5-flash-lite`)
- Calendar: Google Calendar API + Google Identity Services (OAuth)
- PWA: Web App Manifest + Service Worker

## Project Structure

```
aeris-app/
├── .firebaserc            # Firebase project alias
├── firebase.json          # Hosting + Firestore config
├── firestore.rules        # Per-user data access rules
└── public/                # Everything served by Firebase Hosting
    ├── index.html
    ├── style.css
    ├── app.js
    ├── manifest.json       # PWA manifest
    ├── sw.js               # Service worker (offline shell + install support)
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-512-maskable.png
    └── apple-touch-icon.png
```

## Setup

### 1. Firebase

1. Create a Firebase project (or use an existing one) at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication → Email/Password** sign-in method.
3. Enable **Firestore Database**.
4. In `app.js`, set `firebaseConfig` (around line 16) to your project's web app config (Project Settings → General → Your apps).
5. Update `.firebaserc` with your project ID:
   ```json
   { "projects": { "default": "YOUR_PROJECT_ID" } }
   ```

### 2. Gemini API (AI Coach)

1. Generate an API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Set `GEMINI_KEY` in `app.js` (line 10).
3. Note: keys are sent via the `x-goog-api-key` header, not a `?key=` query param — required for the newer `AQ.`-format Gemini keys.

### 3. Google Calendar (optional)

1. In [Google Cloud Console](https://console.cloud.google.com), enable the **Google Calendar API** for the project tied to your Firebase app.
2. Create an OAuth 2.0 Client ID (Web application) and an API key under **APIs & Services → Credentials**.
3. Set `GCAL_CLIENT_ID` and `GCAL_API_KEY` in `app.js` (lines 12–13).
4. Add your Hosting URL to **Authorized JavaScript origins** on the OAuth client.
5. While the OAuth consent screen is unpublished ("Testing" mode), only users added under **OAuth consent screen → Test users** can connect their calendar — anyone else will see a "Google hasn't verified this app" block. Add reviewer/tester emails there before any demo or review.

### 4. Deploy

```bash
npm install -g firebase-tools   # if not already installed
firebase login
firebase use --add              # select your project, alias "default"
firebase deploy
```

This deploys both Firestore rules and Hosting. Use `firebase deploy --only hosting` to redeploy just the site, or `--only firestore:rules` for just the rules.

### 5. Cache-busting

`index.html` loads `style.css` and `app.js` with a `?v=N` query string, and `sw.js` has a `CACHE_NAME` constant. Bump both whenever you change those files and redeploy, otherwise browsers/the service worker may keep serving the previous cached version.

## Installing as an app

- **Desktop (Chrome/Edge):** open the live URL → click the install icon in the address bar → "Install Aeris."
- **Android (Chrome):** open the site → menu → "Install app" (or accept the automatic banner).
- **iPhone (Safari):** open the site → Share → "Add to Home Screen."

## Known Limitations

- **Google Calendar sync** requires reviewer/tester Google accounts to be whitelisted under the OAuth consent screen while the app is unverified (see Setup §3).
- **Gemini free-tier quota** is limited per day/minute; the app caches the daily briefing and retries transient failures automatically, but a fully exhausted daily quota will fall back to a generic message until it resets.
- Client-side API keys (Firebase, Gemini, Google Calendar) are visible in `app.js` by design for this architecture — normal for small/personal Firebase apps, but **for a production/public launch these calls should be proxied through a backend (e.g. Cloud Functions)** so keys aren't exposed to end users.

## Security

- Firestore rules restrict every user to reading/writing only their own data under `users/{uid}/...` — see `firestore.rules`.
- All Firestore paths in `app.js` are scoped to the signed-in user's UID at runtime.
