/**
 * READ-ONLY inspector for per-flyer split data on recent orders.
 *
 * Purpose: dump the flyer-side allocation (flyerSplits) for the most
 * recently created orders so we can confirm whether the per-item
 * per-flyer split was actually captured at save time.
 *
 * Creation field: Order.createdAt (FsTs, written as serverTimestamp();
 * useOrders already lists with orderBy('createdAt','desc')). We sort by
 * that and fall back to the doc's createTime for display.
 *
 * SAFETY: ONLY calls .get(). No write/update/delete of any kind.
 * Output is console-only.
 *
 * Usage:
 *   npx tsx scripts/inspectOrderSplits.ts
 */
import { getApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

/** Render a Firestore Timestamp / Date / plain {_seconds} into a readable
 *  string, or '—' when absent. */
function fmtTs(v: unknown): string {
  if (!v) return '—';
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null) {
    const o = v as { seconds?: number; _seconds?: number };
    const secs = o.seconds ?? o._seconds;
    if (typeof secs === 'number') return new Date(secs * 1000).toISOString();
  }
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return '(unrenderable)';
}

/** Render a value with its runtime type, so string-vs-number is visible. */
function withType(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  return `${JSON.stringify(v)} (${typeof v})`;
}

async function main(): Promise<void> {
  console.log('');
  console.log(`· connecting to Firestore database: '${DB_ID}'`);
  const db = getFirestore(getApp(), DB_ID);

  console.log(`· running: orders.orderBy('createdAt','desc').limit(3).get()  [READ ONLY]`);
  const snap = await db.collection('orders').orderBy('createdAt', 'desc').limit(3).get();
  console.log(`· fetched ${snap.size} order(s)\n`);

  if (snap.empty) {
    console.log('(no orders found)');
    return;
  }

  snap.docs.forEach((doc, i) => {
    const o = doc.data() as Record<string, unknown>;
    console.log('═'.repeat(70));
    console.log(`ORDER ${i + 1} of ${snap.size}`);
    console.log(`  orderId      : ${doc.id}`);
    console.log(`  orderNumber  : ${String(o.orderNumber ?? '—')}`);
    console.log(`  customerName : ${String(o.customerName ?? '—')}`);
    console.log(`  status       : ${String(o.status ?? '—')}`);
    console.log(`  createdAt    : ${fmtTs(o.createdAt)}`);
    console.log(`  (doc.createTime: ${doc.createTime ? doc.createTime.toDate().toISOString() : '—'})`);
    console.log(`  totalWeightKg: ${withType(o.totalWeightKg)}`);

    // ---- Flyer assignments ----
    const assignments = Array.isArray(o.flyerAssignments)
      ? (o.flyerAssignments as Array<Record<string, unknown>>)
      : [];
    console.log(`\n  flyerAssignments (${assignments.length}):`);
    if (assignments.length === 0) {
      console.log('    (none)');
    } else {
      assignments.forEach((a, ai) => {
        console.log(`    [${ai}] ${String(a.flyerName ?? '—')}  (flyerId: ${String(a.flyerId ?? '—')})`);
        console.log(`         weightKg (customer)      : ${withType(a.weightKg)}`);
        console.log(`         flyerWeightKg (portion)  : ${withType(a.flyerWeightKg)}`);
        console.log(`         payoutAmount             : ${withType(a.payoutAmount)}`);
      });
    }

    // ---- Items + flyerSplits ----
    const items = Array.isArray(o.items) ? (o.items as Array<Record<string, unknown>>) : [];
    console.log(`\n  items (${items.length}):`);
    if (items.length === 0) {
      console.log('    (none)');
    } else {
      items.forEach((it, ii) => {
        const mode = it.pricingMode === 'per_piece' ? 'per_piece' : 'per_kg';
        console.log(`    [${ii}] "${String(it.description ?? '—')}"  (pricingMode: ${mode})`);
        console.log(`         customer weightKg  : ${withType(it.weightKg)}`);
        if (mode === 'per_piece') {
          console.log(`         customer pieceCount: ${withType(it.pieceCount)}`);
        }

        // flyerSplits — the crucial field.
        const splits = it.flyerSplits;
        if (splits === undefined) {
          console.log(`         flyerSplits        : UNDEFINED`);
        } else if (!Array.isArray(splits)) {
          console.log(`         flyerSplits        : (present but NOT an array) ${withType(splits)}`);
        } else if (splits.length === 0) {
          console.log(`         flyerSplits        : [] (empty array)`);
        } else {
          console.log(`         flyerSplits (${splits.length}):`);
          (splits as Array<Record<string, unknown>>).forEach((s, si) => {
            const parts = [`flyerId: ${String(s.flyerId ?? '—')}`];
            if ('weightKg' in s) parts.push(`weightKg: ${withType(s.weightKg)}`);
            if ('pieceCount' in s) parts.push(`pieceCount: ${withType(s.pieceCount)}`);
            console.log(`             [${si}] ${parts.join(', ')}`);
          });
        }

        // Legacy single-quantity fields, only printed when present.
        if (it.flyerWeightKg !== undefined) {
          console.log(`         legacy flyerWeightKg  : ${withType(it.flyerWeightKg)}`);
        }
        if (it.flyerPieceCount !== undefined) {
          console.log(`         legacy flyerPieceCount: ${withType(it.flyerPieceCount)}`);
        }
      });
    }
    console.log('');
  });

  console.log('═'.repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('');
    console.error('✗ Inspect FAILED to run (no data was modified — this is read-only).');
    if (e instanceof Error) {
      console.error('  name:    ', e.name);
      console.error('  message: ', e.message);
      const code = (e as { code?: number | string }).code;
      if (code !== undefined) console.error('  code:    ', code);
    } else {
      console.error('  ', e);
    }
    process.exit(1);
  });
