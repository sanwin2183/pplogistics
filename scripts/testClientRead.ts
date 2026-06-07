/**
 * Client-SDK reachability test from Node — companion to scripts/testRead.ts.
 *
 * testRead.ts uses the Admin SDK (gRPC over HTTP/2 to a different endpoint).
 * THIS script uses the CLIENT SDK — the exact same package the browser bundle
 * uses (firebase/app + firebase/firestore) — and hits the same
 * /google.firestore.v1.Firestore/Listen channel the browser hits, with the
 * same `experimentalForceLongPolling: true` setting that's now staged in
 * src/lib/firebase.ts. The only thing this DOESN'T share with the browser is
 * the browser itself: no service worker, no extensions, no DevTools, no
 * cookies, no profile-level state.
 *
 * What this isolates:
 *   - If this script reaches Firestore (succeeds OR comes back with a
 *     structured Firestore error like permission-denied / unauthenticated),
 *     the Listen endpoint is reachable from this machine via the client SDK's
 *     XHR transport. The lockout must therefore be specific to the BROWSER
 *     ENVIRONMENT — extensions, a stale service worker, profile corruption,
 *     IndexedDB cache, something at the browser session level.
 *   - If this script gets the same 400 Bad Request / "transport errored.
 *     Name: undefined Message: undefined" the browser is getting, the bug is
 *     at the network layer between this machine and firestore.googleapis.com
 *     for the Listen path — not browser-specific. Suspect ISP / corporate
 *     proxy / DNS filter / VPN client / firewall rule.
 *
 * Runs UNAUTHENTICATED. We don't need a successful read — we just need to
 * see what comes back. `permission-denied` from a rules eval is a SUCCESS for
 * this test because it proves the request reached Firestore.
 *
 * Usage: npm run test-client-read
 */
import { initializeApp } from 'firebase/app';
import {
  collection,
  getDocs,
  initializeFirestore,
  limit,
  query,
} from 'firebase/firestore';
import fs from 'node:fs';
import path from 'node:path';

// --- Load .env.local manually. Node doesn't honour Vite's import.meta.env. ---
const root = path.resolve(import.meta.dirname ?? '.', '..');
const ENV_PATH = path.join(root, '.env.local');
if (!fs.existsSync(ENV_PATH)) {
  console.error(`✗ .env.local not found at ${ENV_PATH}`);
  console.error('  This script needs the same VITE_FIREBASE_* values the web client uses.');
  process.exit(1);
}
const env: Record<string, string> = Object.fromEntries(
  fs
    .readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      return [k, v];
    }),
);

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

console.log('');
console.log('· loaded .env.local config (same values browser bundle uses):');
console.log(`  projectId:    ${config.projectId}`);
console.log(`  authDomain:   ${config.authDomain}`);
console.log(`  storageBucket:${config.storageBucket}`);
console.log(`  apiKey:       ${config.apiKey ? `(set, ${config.apiKey.length} chars)` : '(missing)'}`);

if (!config.apiKey || !config.projectId) {
  console.error('✗ apiKey or projectId missing — check .env.local');
  process.exit(1);
}

const app = initializeApp(config);
// Match the deployed client's exact Firestore settings: forced long-polling
// + literal 'default' DB name.
const db = initializeFirestore(
  app,
  { experimentalForceLongPolling: true },
  'default',
);

async function main(): Promise<void> {
  console.log('');
  console.log(`· running: getDocs(query(collection(db, 'customers'), limit(5)))`);
  console.log(`  (unauthenticated — we expect rules to deny, but ONLY if the`);
  console.log(`   request reaches Firestore at all. Transport reachability is`);
  console.log(`   what we're actually testing.)`);
  const t0 = Date.now();
  try {
    const snap = await getDocs(query(collection(db, 'customers'), limit(5)));
    const elapsedMs = Date.now() - t0;
    console.log('');
    console.log(`✓ query SUCCEEDED in ${elapsedMs} ms — docs returned: ${snap.size}`);
    console.log('');
    console.log('CONCLUSION: Client SDK reached Firestore AND the rules allowed an');
    console.log('  unauthenticated read. That second part is unexpected with the');
    console.log('  current rules — either rules drifted from what we think, or');
    console.log('  some default rule allows reads. Open question, but transport works.');
    console.log('  → Browser lockout is BROWSER-ENVIRONMENT-SPECIFIC.');
  } catch (e) {
    const elapsedMs = Date.now() - t0;
    console.log('');
    console.log(`✗ query failed in ${elapsedMs} ms`);
    const code = (e as { code?: string }).code ?? '(no code)';
    const message = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '(no name)';
    console.log(`  name:    ${name}`);
    console.log(`  code:    ${code}`);
    console.log(`  message: ${message}`);
    console.log('');
    if (code === 'permission-denied' || code === 'unauthenticated') {
      console.log('CONCLUSION: Client SDK Listen transport WORKS from this machine.');
      console.log(`  Got "${code}" — the request reached Firestore, rules evaluated,`);
      console.log('  and denied. That proves the Listen channel is reachable for the');
      console.log('  client SDK at the network layer from this Windows host.');
      console.log('  → Browser lockout is BROWSER-ENVIRONMENT-SPECIFIC (extensions,');
      console.log('    cached service worker, profile / IndexedDB corruption).');
    } else if (
      code === 'unavailable' ||
      /400/.test(message) ||
      /transport errored/i.test(message) ||
      /Listen.*channel/i.test(message)
    ) {
      console.log('CONCLUSION: Client SDK Listen transport FAILS from this machine.');
      console.log('  Same failure mode the browser sees. The bug is at the NETWORK');
      console.log('  LAYER between this machine and firestore.googleapis.com /Listen,');
      console.log('  not browser-specific. Suspect ISP / corporate proxy / DNS filter');
      console.log('  / VPN client / firewall blocking or mangling the Listen endpoint.');
      console.log('  Test from a different network (mobile data tether) to confirm.');
    } else {
      console.log('CONCLUSION: Unfamiliar error code. Compare to what the browser shows:');
      console.log('  - if identical (same code + similar message) → same root cause;');
      console.log('  - if different → client SDK reached Firestore but failed for a');
      console.log('    different reason than the browser. Worth investigating the');
      console.log('    specific code.');
    }
    if (e instanceof Error && e.stack) {
      console.log('');
      console.log('  stack (first 6 lines):');
      console.log(
        e.stack
          .split('\n')
          .slice(0, 6)
          .map((l) => `    ${l}`)
          .join('\n'),
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL (outside main):', e);
    process.exit(1);
  });
