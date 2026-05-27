/**
 * Seed the default category set. Idempotent: skips if a category with the same
 * name already exists.
 *
 *   npm run seed-categories
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

const DEFAULTS = [
  { name: 'Clothes',     defaultRatePerKg: 300, isProhibited: false, notes: 'T-shirts, jeans, etc.' },
  { name: 'Electronics', defaultRatePerKg: 500, isProhibited: false, notes: 'Phones, accessories — declare value' },
  { name: 'Cosmetics',   defaultRatePerKg: 400, isProhibited: false, notes: 'Skincare, makeup' },
  { name: 'Documents',   defaultRatePerKg: 200, isProhibited: false, notes: 'Papers, contracts' },
  { name: 'Food',        defaultRatePerKg: 350, isProhibited: false, notes: 'Dry/sealed only — no liquids' },
  { name: 'Liquids',     defaultRatePerKg: 0,   isProhibited: true,  notes: 'Prohibited on flights' },
  { name: 'Other',       defaultRatePerKg: 350, isProhibited: false },
];

async function main() {
  const db = getFirestore(getApp(), DB_ID);
  const existing = await db.collection('categories').get();
  const existingNames = new Set(existing.docs.map((d) => String(d.data().name)));
  let created = 0;
  for (const c of DEFAULTS) {
    if (existingNames.has(c.name)) {
      console.log(`· skip "${c.name}" (exists)`);
      continue;
    }
    await db.collection('categories').add(c);
    console.log(`✓ created "${c.name}" (${c.defaultRatePerKg} THB/kg)`);
    created++;
  }
  console.log(`\nDone — ${created} new categories.`);
}

main().catch((e) => {
  console.error('✗ Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
