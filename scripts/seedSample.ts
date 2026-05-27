/**
 * Seed a single sample customer + flyer + order so the dashboard isn't empty
 * on first run. Idempotent-ish — bails if anything already exists.
 *
 *   npm run seed-sample
 *
 * Also seeds default settings (business info + a placeholder PromptPay method)
 * so the public tracking page has something to show.
 */
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

const db = getFirestore(getApp(), DB_ID);

// ---- Slug helper (same alphabet as src/lib/tracking.ts) ----
const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
function slug(len = 10) {
  let out = '';
  for (let i = 0; i < len; i++) out += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  return out;
}
function pad(n: number, w: number) { return String(n).padStart(w, '0'); }
function orderNumber(d = new Date()) {
  const y = pad(d.getFullYear() % 100, 2);
  const m = pad(d.getMonth() + 1, 2);
  const day = pad(d.getDate(), 2);
  return `${y}${m}${day}-${pad(Math.floor(Math.random() * 1000), 3)}`;
}

async function main() {
  // --- Settings doc (only if missing) ---
  const settingsRef = db.collection('settings').doc('app');
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    await settingsRef.set({
      business: {
        name: 'PP Logistics',
        tagline: 'Hand-carry between Bangkok ↔ Myanmar',
        contactPhone: '+66 99 123 4567',
        contactTelegram: '@pp_logistics',
      },
      payment: {
        methods: [
          {
            id: 'sample-promptpay',
            type: 'promptpay',
            label: 'PromptPay (sample)',
            accountName: 'PP Logistics Co., Ltd.',
            accountNumber: '0991234567',
            qrUrl: '',
            isDefault: true,
            isActive: true,
          },
        ],
      },
      templates: {
        en: 'Hi {customerName}, your order #{orderNumber} is ready. Total {totalAmount} for {totalWeight}. Track and pay here: {trackingUrl}',
        th: 'สวัสดีค่ะ {customerName} ออเดอร์ #{orderNumber} พร้อมแล้วค่ะ ยอดรวม {totalAmount} น้ำหนัก {totalWeight} ตรวจสอบและชำระได้ที่: {trackingUrl}',
        my: 'မင်္ဂလာပါ {customerName}၊ သင့်အော်ဒါ #{orderNumber} ပြင်ဆင်ပြီးပါပြီ။ စုစုပေါင်း {totalAmount}၊ အလေးချိန် {totalWeight}။ ဤနေရာတွင် စစ်ဆေး၍ ငွေပေးချေနိုင်ပါသည် - {trackingUrl}',
      },
    });
    console.log('✓ Seeded settings/app');
  } else {
    console.log('· settings/app exists — skipped');
  }

  // --- Customer ---
  const customerQ = await db.collection('customers').where('name', '==', 'Sample Shop').limit(1).get();
  let customerId: string;
  let customerName = 'Sample Shop';
  if (customerQ.empty) {
    const ref = await db.collection('customers').add({
      name: 'Sample Shop',
      phone: '+66 88 222 3333',
      telegram: '@sample_shop',
      type: 'shop',
      totalOrders: 0,
      totalSpent: 0,
      outstandingBalance: 0,
      notes: 'Sample customer — feel free to delete.',
      createdAt: FieldValue.serverTimestamp(),
    });
    customerId = ref.id;
    console.log('✓ Created customer "Sample Shop"');
  } else {
    customerId = customerQ.docs[0].id;
    customerName = String(customerQ.docs[0].data().name);
    console.log('· customer exists — skipped');
  }

  // --- Flyer ---
  const flyerQ = await db.collection('flyers').where('name', '==', 'Sample Flyer').limit(1).get();
  let flyerId: string;
  let flyerName = 'Sample Flyer';
  let flyerRate = 200;
  if (flyerQ.empty) {
    const flightDate = new Date();
    flightDate.setDate(flightDate.getDate() + 7);
    const ref = await db.collection('flyers').add({
      name: 'Sample Flyer',
      phone: '+66 88 999 0000',
      route: 'BKK→YGN',
      flightDate: Timestamp.fromDate(flightDate),
      flightNumber: 'TG303',
      kgAvailable: 15,
      kgUsed: 0,
      ratePerKg: flyerRate,
      prohibitedItems: ['liquids', 'batteries'],
      status: 'upcoming',
      notes: 'Sample flyer — feel free to delete.',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    flyerId = ref.id;
    console.log('✓ Created flyer "Sample Flyer"');
  } else {
    flyerId = flyerQ.docs[0].id;
    const d = flyerQ.docs[0].data();
    flyerName = String(d.name);
    flyerRate = Number(d.ratePerKg);
    console.log('· flyer exists — skipped');
  }

  // --- Category lookup ---
  const catQ = await db.collection('categories').where('name', '==', 'Clothes').limit(1).get();
  if (catQ.empty) {
    console.warn('⚠ No "Clothes" category — run `npm run seed-categories` first.');
    return;
  }
  const cat = catQ.docs[0];
  const catId = cat.id;
  const catName = String(cat.data().name);
  const catRate = Number(cat.data().defaultRatePerKg);

  // --- Order ---
  const orderQ = await db.collection('orders').where('customerId', '==', customerId).limit(1).get();
  if (orderQ.empty) {
    const weight = 3;
    const itemRate = catRate;
    const subtotal = weight * itemRate;
    const payoutRate = flyerRate;
    const payout = weight * payoutRate;

    const oRef = await db.collection('orders').add({
      orderNumber: orderNumber(),
      trackingSlug: slug(),
      customerId,
      customerName,
      customerPhone: '+66 88 222 3333',
      items: [{ description: 'T-shirts (sample)', categoryId: catId, categoryName: catName, weightKg: weight, ratePerKg: itemRate, subtotal }],
      totalWeightKg: weight,
      totalAmount: subtotal,
      flyerAssignments: [{ flyerId, flyerName, weightKg: weight, payoutRatePerKg: payoutRate, payoutAmount: payout }],
      totalPayout: payout,
      profit: subtotal - payout,
      status: 'pending',
      statusHistory: [{ status: 'pending', timestamp: Timestamp.now(), note: 'Order created (seed)' }],
      paymentInstructions: { enabledMethodIds: ['sample-promptpay'] },
      photos: [],
      notes: 'Sample order created by seedSample.ts',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('✓ Created sample order', oRef.id);
  } else {
    console.log('· orders exist — skipped');
  }

  console.log('\n✓ Done.');
}

main().catch((e) => {
  console.error('✗ Failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
