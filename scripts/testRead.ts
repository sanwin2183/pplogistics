/**
 * Definitive service-level read test.
 *
 * Bypasses the React/PWA stack entirely:
 *   - Uses Admin SDK (rules don't apply — Admin SDK is privileged).
 *   - Doesn't touch the web API key (uses the service-account private key).
 *   - Doesn't go through App Check (Admin SDK has no enforcement layer).
 *   - Doesn't run in a browser (no CORS / origin / referrer headers).
 *   - Doesn't depend on cookies, IndexedDB, the service worker, or any
 *     client-side caching.
 *
 * If this script reads docs back successfully, the data + Firestore service
 * + named-database ('default') are all healthy and the lockout is something
 * specific to the WEB CLIENT. If this script fails or returns zero rows, the
 * problem is at the GCP service level and needs to be escalated there.
 *
 * Usage:
 *   npm run test-read
 */
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

async function main() {
  console.log('');
  console.log(`· connecting to Firestore database: '${DB_ID}'`);
  const db = getFirestore(getApp(), DB_ID);

  console.log(`· running: db.collection('customers').limit(5).get()`);
  const t0 = Date.now();
  const snap = await db.collection('customers').limit(5).get();
  const elapsedMs = Date.now() - t0;

  console.log('');
  console.log(`✓ query succeeded in ${elapsedMs} ms`);
  console.log(`  docs returned: ${snap.size}`);
  console.log(`  empty:         ${snap.empty}`);
  console.log('');

  if (snap.empty) {
    console.log('  (collection has zero docs — but the query itself worked,');
    console.log('   so the service is healthy and the connection is good.)');
    return;
  }

  console.log('  First doc summary:');
  snap.docs.forEach((d, i) => {
    const data = d.data();
    // Show id + the few fields most useful for confirming it's the user's
    // real data and not a stale test fixture.
    const summary = {
      id: d.id,
      name: data.name,
      phone: data.phone,
      type: data.type,
      totalOrders: data.totalOrders,
    };
    console.log(`  [${i + 1}] ${JSON.stringify(summary)}`);
  });

  console.log('');
  console.log('CONCLUSION:');
  console.log('  Firestore service is healthy. The data exists. The named-DB');
  console.log("  argument ('default') is correct. The lockout is specifically");
  console.log('  in the WEB CLIENT — App Check / CSP / extension / proxy /');
  console.log('  network-layer rejection that does NOT affect the Admin SDK.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('');
    console.error('✗ Read FAILED.');
    console.error('  This means the problem is at the Firestore service level,');
    console.error('  not in the web client. Escalate via the GCP console.');
    console.error('');
    if (e instanceof Error) {
      console.error('  name:    ', e.name);
      console.error('  message: ', e.message);
      // gRPC / Firestore errors often carry a numeric `code` (e.g. 5 = NOT_FOUND,
      // 7 = PERMISSION_DENIED, 16 = UNAUTHENTICATED). Surface it so we can tell
      // them apart at a glance.
      const code = (e as { code?: number | string }).code;
      if (code !== undefined) console.error('  code:    ', code);
      if (e.stack) {
        console.error('');
        console.error('  stack:');
        console.error(e.stack.split('\n').slice(0, 5).map((l) => `    ${l}`).join('\n'));
      }
    } else {
      console.error('  ', e);
    }
    process.exit(1);
  });
