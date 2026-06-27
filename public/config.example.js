// config.example.js — TEMPLATE. Copy this file to config.js and fill in
// your own real credentials. config.js is gitignored and never committed.
//
//   cp config.example.js config.js
//
// Then edit config.js with your actual Firebase / Gemini / Google Calendar keys.

export const GEMINI_KEY = 'YOUR_GEMINI_API_KEY';

export const GCAL_CLIENT_ID = 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com';
export const GCAL_API_KEY   = 'YOUR_GOOGLE_CALENDAR_API_KEY';

export const firebaseConfig = {
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
  measurementId: 'YOUR_MEASUREMENT_ID'
};
