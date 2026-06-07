import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, serverTimestamp, Timestamp } from 'firebase/firestore';
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
// Use initializeFirestore (NOT getFirestore) so we can pass settings — this
// must run before any getFirestore(app, ...) call elsewhere in the bundle.
//
// `experimentalForceLongPolling: true` skips the WebChannel probe entirely
// and uses plain long-polling XHR from the very first connect. We tried
// `experimentalAutoDetectLongPolling` first — the SDK's auto-detect heuristic
// did NOT fall back in our network (Listen requests kept hitting WebChannel
// with TYPE=xmlhttp, RID=rpc, returning 400). Forcing long-polling
// unconditionally bypasses the broken WebChannel handshake path so reads
// just work, at the cost of slightly higher request overhead per snapshot
// (acceptable for an admin tool sending tens of reads per minute, not
// thousands per second). The two flags are mutually exclusive — only force
// is set here; auto-detect is removed.
//
// Failure mode this works around: some middleware (browser extensions
// intercepting XHR, corporate proxies that mangle chunked transfer encoding,
// captive portals, certain VPN clients) corrupts the WebChannel protocol —
// exactly the cause of the 400 Bad Request on
// /google.firestore.v1.Firestore/Listen/channel?… that locked the admin app
// out. Long-polling uses normal XHR (same transport as Firebase Auth, which
// was unaffected throughout the incident), so any environment that can
// speak HTTPS to googleapis.com can still read.
export const db = initializeFirestore(
  app,
  { experimentalForceLongPolling: true },
  FIRESTORE_DB_ID,
);
export const storage = getStorage(app);
// Functions deployed to asia-southeast1 (Singapore) — closest region to BKK/YGN.
export const functions = getFunctions(app, 'asia-southeast1');

// [firebase-debug] One-time boot log so we can confirm at runtime which
// Firebase project + database + bucket the client actually connected to.
// Critical for diagnosing "rules look right, reads still fail" cases where
// .env.local points at a different project than the one the rules were
// deployed to. Remove this block once the lockout is resolved.
// eslint-disable-next-line no-console
console.log('[firebase-debug] client connected:', {
  projectId: config.projectId,
  authDomain: config.authDomain,
  storageBucket: config.storageBucket,
  firestoreDbId: FIRESTORE_DB_ID,
  functionsRegion: 'asia-southeast1',
});

export { serverTimestamp, Timestamp };
