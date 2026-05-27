/**
 * Promote a Firebase Auth user to admin by setting `role=admin` custom claim.
 *
 * Usage:
 *   npm run set-admin -- you@example.com
 *
 *   or with a UID:
 *   npm run set-admin -- --uid=XmGs95p7sSb5L4zZVO9nxHThe6B3
 *
 * Requires `serviceAccount.json` in the project root (gitignored).
 * Get yours from: Firebase console → Project settings → Service accounts.
 */
import { getAuth } from 'firebase-admin/auth';
import { initAdminApp } from './_initAdmin';

initAdminApp();

async function main() {
  const args = process.argv.slice(2);
  const uidArg = args.find((a) => a.startsWith('--uid='))?.replace('--uid=', '');
  const email = args.find((a) => !a.startsWith('--'));

  if (!uidArg && !email) {
    console.error('Usage: npm run set-admin -- <email>  OR  npm run set-admin -- --uid=<uid>');
    process.exit(1);
  }

  const auth = getAuth();
  const user = uidArg ? await auth.getUser(uidArg) : await auth.getUserByEmail(email!);
  await auth.setCustomUserClaims(user.uid, { role: 'admin' });

  console.log(`✓ Promoted to admin:`);
  console.log(`  uid:   ${user.uid}`);
  console.log(`  email: ${user.email}`);
  console.log('');
  console.log('Have the user sign out and back in (or refresh) for the claim to take effect.');
}

main().catch((e) => {
  console.error('✗ Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
