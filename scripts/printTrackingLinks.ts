/**
 * Print all live tracking URLs in the project. Handy for testing the public
 * /t/:slug page right after seeding.
 *
 *   npm run tracking-links
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();
const db = getFirestore(getApp(), DB_ID);

async function main() {
  const snap = await db.collection('orders').orderBy('createdAt', 'desc').get();
  if (snap.empty) {
    console.log('No orders yet.');
    return;
  }
  console.log(`Found ${snap.size} order(s):\n`);
  snap.docs.forEach((d) => {
    const o = d.data();
    console.log(`#${o.orderNumber}  ${o.customerName}  ${o.totalAmount} THB  [${o.status}]`);
    console.log(`  → /t/${o.trackingSlug}\n`);
  });
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
