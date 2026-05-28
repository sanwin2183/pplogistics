/**
 * Seed the default expense-category set. Idempotent: skips if a category
 * with the same name already exists in the expenseCategories collection.
 *
 *   npm run seed-expense-categories
 *
 * Mirrors scripts/seedCategories.ts (§12). Uses the named DB "default"
 * via the shared admin loader (Quirk 1).
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

const DEFAULTS = [
  { name: 'Packaging' },
  { name: 'Wrapping' },
  { name: 'Check-in fee' },
  { name: 'Transport' },
  { name: 'Other' },
];

async function main() {
  const db = getFirestore(getApp(), DB_ID);
  const existing = await db.collection('expenseCategories').get();
  const existingNames = new Set(existing.docs.map((d) => String(d.data().name)));
  let created = 0;
  for (const c of DEFAULTS) {
    if (existingNames.has(c.name)) {
      console.log(`· skip "${c.name}" (exists)`);
      continue;
    }
    await db.collection('expenseCategories').add({
      name: c.name,
      createdAt: Timestamp.now(),
    });
    console.log(`✓ created "${c.name}"`);
    created++;
  }
  console.log(`\nDone — ${created} new expense categories.`);
}

main().catch((e) => {
  console.error('✗ Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
