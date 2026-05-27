import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!config.apiKey) {
  // Fail loudly in dev so missing env vars don't silently break Auth.
  throw new Error('Missing VITE_FIREBASE_* env vars. Did you copy .env.example to .env.local?');
}

/**
 * Firestore database ID. This project's primary database is named `default`
 * (literal, no parentheses) — that's how the new Firebase console creates it
 * by default. The SDK's implicit default is `(default)` so we have to be
 * explicit.
 */
export const FIRESTORE_DB_ID = 'default';

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app, FIRESTORE_DB_ID);
export const storage = getStorage(app);
// Functions deployed to asia-southeast1 (Singapore) — closest region to BKK/YGN.
export const functions = getFunctions(app, 'asia-southeast1');

export { serverTimestamp, Timestamp };
