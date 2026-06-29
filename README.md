# Aeris — AI Productivity Companion

Aeris is a gamified task & habit tracker with an AI coach, XP/leagues, Google Calendar sync, and installable PWA support. Built on Firebase (Auth + Firestore + Hosting) with a vanilla JS frontend — no build step required.

## Features

- **Tasks** — create, prioritize, schedule, and complete tasks; overdue tasks automatically apply an XP penalty.
- **Habits** — daily habit tracking with streaks.
- **XP & Leagues** — completing tasks/habits earns XP that moves you up a league ladder; a leaderboard ranks XP across users.
- **AI Coach** — a chat assistant (powered by Gemini) with real context: your current tasks, deadlines, habit streaks, and recent activity. Also generates a short daily briefing on the dashboard. Maintains short-term conversation memory (last 2 messages) for continuity without bloating each request.
- **AI Task Setup** — describe your day/goals in plain text (e.g. "exam Thursday, report due tomorrow 6pm, want to start gym 3x a week") and Gemini breaks it into structured tasks — title, priority, category, and computed deadline — created directly in your task list.
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
├── .gitignore             # Excludes public/config.js from version control
├── firebase.json          # Hosting + Firestore config
├── firestore.rules        # Per-user data access rules
└── public/                # Everything served by Firebase Hosting
    ├── index.html
    ├── style.css
    ├── app.js
    ├── config.js           # Real API keys (gitignored - never committed)
    ├── config.example.js   # Placeholder template (committed to git)
    ├── manifest.json       # PWA manifest
    ├── sw.js               # Service worker (offline shell + install support)
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-512-maskable.png
    └── apple-touch-icon.png
```

## Setup

### 1. Config file

All credentials live in `public/config.js`, which is excluded from version control via `.gitignore` so real keys never reach GitHub.

```bash
cd public
cp config.example.js config.js
```

Then fill in `config.js` with your real values as you go through steps 2–4 below. `app.js` imports everything from this file — no other source file needs editing.

### 2. Firebase

1. Create a Firebase project (or use an existing one) at [console.firebase.google.com](https://console.firebase.google.com).
2. Enable **Authentication → Email/Password** sign-in method.
3. Enable **Firestore Database**.
4. In `config.js`, set `firebaseConfig` to your project's web app config (Project Settings → General → Your apps).
5. Update `.firebaserc` with your project ID:
   ```json
   { "projects": { "default": "YOUR_PROJECT_ID" } }
   ```

### 3. Gemini API (AI Coach + AI Task Setup)

1. Generate an API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. Set `GEMINI_KEY` in `config.js`.
3. Note: keys are sent via the `x-goog-api-key` header, not a `?key=` query param — required for the newer `AQ.`-format Gemini keys.

### 4. Google Calendar (optional)

1. In [Google Cloud Console](https://console.cloud.google.com), enable the **Google Calendar API** for the project tied to your Firebase app.
2. Create an OAuth 2.0 Client ID (Web application) and an API key under **APIs & Services → Credentials**.
3. Set `GCAL_CLIENT_ID` and `GCAL_API_KEY` in `config.js`.
4. Add your Hosting URL to **Authorized JavaScript origins** on the OAuth client.
5. While the OAuth consent screen is unpublished ("Testing" mode), only users added under **OAuth consent screen → Test users** can connect their calendar — anyone else will see a "Google hasn't verified this app" block. Add reviewer/tester emails there before any demo or review.

### 5. Deploy

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

- **Google Calendar sync** requires reviewer/tester Google accounts to be whitelisted under the OAuth consent screen while the app is unverified (see Setup §4).
- **Gemini free-tier quota** is limited per day/minute; the app caches the daily briefing and retries transient failures automatically, but a fully exhausted daily quota will fall back to a generic message until it resets. AI Task Setup and AI Coach chat draw from the same quota.
- **AI Task Setup** relies on the model returning well-formed JSON; if Gemini's response can't be parsed or contains no valid items, the app shows an error toast rather than creating partial/incorrect tasks. Always review AI-generated tasks afterward in My Tasks.
- Client-side API keys (Firebase, Gemini, Google Calendar) are still visible to anyone inspecting the deployed site's network requests, even though they're kept out of the GitHub repo via `config.js` — this is normal for small/personal Firebase apps, but **for a production/public launch these calls should be proxied through a backend (e.g. Cloud Functions)** so keys aren't exposed to end users at all.

## Security

- Firestore rules restrict every user to reading/writing only their own data under `users/{uid}/...` — see `firestore.rules`.
- All Firestore paths in `app.js` are scoped to the signed-in user's UID at runtime.
- API keys are isolated in `public/config.js`, which is listed in `.gitignore` and never committed; `public/config.example.js` is the safe, key-free template that ships in the repo instead.
