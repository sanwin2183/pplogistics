/**
 * READ-ONLY audit for bad flyer-side weight / count data.
 *
 * Why this exists:
 *   The order form stores <input type="number"> values as STRINGS in
 *   react-hook-form state. A bug could let a flyer-side quantity be saved
 *   as a string, or as a string-CONCATENATION artifact (e.g. two weight
 *   inputs "35" + "12" concatenating to "3512" instead of summing to 47).
 *   This script walks every order and flags:
 *     1. Any item flyerWeightKg / flyerPieceCount / flyerSplits[].weightKg
 *        / flyerSplits[].pieceCount stored as typeof 'string'.
 *     2. Any assignment flyerWeightKg / weightKg / payoutAmount stored as
 *        typeof 'string'.
 *     3. Per-kg items whose resolved flyer-side weight exceeds the
 *        customer weightKg by > 50% (the concatenation fingerprint — a
 *        legitimate "pay flyer less" override is always ≤ customer weight).
 *     4. Assignment flyerWeightKg exceeding the order's totalWeightKg by
 *        > 50% (same fingerprint at the assignment level).
 *
 * SAFETY: This script ONLY calls .get(). It NEVER writes, updates, or
 * deletes anything in Firestore. Output is console-only.
 *
 * Usage:
 *   npx tsx scripts/auditFlyerWeights.ts
 */
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

/** Ratio above which a flyer-side weight looks like a concatenation rather
 *  than a legitimate "pay flyer less" override. 1.5 = "more than 50% over
 *  the customer weight". */
const ANOMALY_RATIO = 1.5;

/** Coerce a possibly-string numeric to a number, tolerant of the bad data
 *  we're hunting for. Returns NaN for genuinely non-numeric values. */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

interface Flag {
  reason: string;
}

async function main(): Promise<void> {
  console.log('');
  console.log(`· connecting to Firestore database: '${DB_ID}'`);
  const db = getFirestore(getApp(), DB_ID);

  console.log(`· running: db.collection('orders').get()  [READ ONLY]`);
  const snap = await db.collection('orders').get();
  console.log(`· scanned ${snap.size} order(s)\n`);

  let stringTypedOrders = 0;
  let anomalyOrders = 0;
  const flaggedLines: string[] = [];

  for (const doc of snap.docs) {
    const o = doc.data() as Record<string, unknown>;
    const orderId = doc.id;
    const orderNumber = String(o.orderNumber ?? orderId);
    const customerName = String(o.customerName ?? '(unknown)');
    const totalWeightKg = toNum(o.totalWeightKg);

    const stringFlags: Flag[] = [];
    const anomalyFlags: Flag[] = [];

    // ---- Items ----
    const items = Array.isArray(o.items) ? (o.items as Array<Record<string, unknown>>) : [];
    items.forEach((it, idx) => {
      const desc = String(it.description ?? `item ${idx + 1}`);
      const isPiece = it.pricingMode === 'per_piece';
      const customerWeight = toNum(it.weightKg);

      // (1) string-typed flyer fields on the item
      if (typeof it.flyerWeightKg === 'string') {
        stringFlags.push({ reason: `item "${desc}".flyerWeightKg is a STRING (${JSON.stringify(it.flyerWeightKg)})` });
      }
      if (typeof it.flyerPieceCount === 'string') {
        stringFlags.push({ reason: `item "${desc}".flyerPieceCount is a STRING (${JSON.stringify(it.flyerPieceCount)})` });
      }
      const splits = Array.isArray(it.flyerSplits)
        ? (it.flyerSplits as Array<Record<string, unknown>>)
        : [];
      splits.forEach((s, si) => {
        const fid = String(s.flyerId ?? `split ${si + 1}`);
        if (typeof s.weightKg === 'string') {
          stringFlags.push({ reason: `item "${desc}".flyerSplits[${fid}].weightKg is a STRING (${JSON.stringify(s.weightKg)})` });
        }
        if (typeof s.pieceCount === 'string') {
          stringFlags.push({ reason: `item "${desc}".flyerSplits[${fid}].pieceCount is a STRING (${JSON.stringify(s.pieceCount)})` });
        }
      });

      // (3) per-kg item flyer-weight anomaly heuristic. Gather every stored
      //     flyer-side weight candidate (legacy single + each split),
      //     resolve tolerant of strings, and flag any that balloon past the
      //     customer weight. Skip per-piece items (no kg concept) and items
      //     with no positive customer weight (ratio undefined).
      if (!isPiece && Number.isFinite(customerWeight) && customerWeight > 0) {
        const candidates: Array<{ label: string; raw: unknown }> = [];
        if (it.flyerWeightKg !== undefined && it.flyerWeightKg !== null) {
          candidates.push({ label: 'flyerWeightKg', raw: it.flyerWeightKg });
        }
        splits.forEach((s, si) => {
          if (s.weightKg !== undefined && s.weightKg !== null) {
            candidates.push({ label: `flyerSplits[${String(s.flyerId ?? si)}].weightKg`, raw: s.weightKg });
          }
        });
        for (const c of candidates) {
          const n = toNum(c.raw);
          if (Number.isFinite(n) && n > customerWeight * ANOMALY_RATIO) {
            anomalyFlags.push({
              reason:
                `item "${desc}" ${c.label}=${JSON.stringify(c.raw)} ` +
                `(typeof ${typeof c.raw}, =${n}) exceeds customer weightKg ${customerWeight} ` +
                `by >${Math.round((ANOMALY_RATIO - 1) * 100)}% — concatenation fingerprint`,
            });
          }
        }
      }
    });

    // ---- Assignments ----
    const assignments = Array.isArray(o.flyerAssignments)
      ? (o.flyerAssignments as Array<Record<string, unknown>>)
      : [];
    assignments.forEach((a, idx) => {
      const who = String(a.flyerName ?? a.flyerId ?? `assignment ${idx + 1}`);

      // (2) string-typed assignment fields
      for (const field of ['flyerWeightKg', 'weightKg', 'payoutAmount'] as const) {
        if (typeof a[field] === 'string') {
          stringFlags.push({ reason: `assignment "${who}".${field} is a STRING (${JSON.stringify(a[field])})` });
        }
      }

      // (4) assignment-level flyerWeightKg anomaly vs order total weight
      if (Number.isFinite(totalWeightKg) && totalWeightKg > 0 && a.flyerWeightKg !== undefined && a.flyerWeightKg !== null) {
        const fw = toNum(a.flyerWeightKg);
        if (Number.isFinite(fw) && fw > totalWeightKg * ANOMALY_RATIO) {
          anomalyFlags.push({
            reason:
              `assignment "${who}".flyerWeightKg=${JSON.stringify(a.flyerWeightKg)} ` +
              `(typeof ${typeof a.flyerWeightKg}, =${fw}) exceeds order totalWeightKg ${totalWeightKg} ` +
              `by >${Math.round((ANOMALY_RATIO - 1) * 100)}% — concatenation fingerprint`,
          });
        }
      }
    });

    if (stringFlags.length > 0) stringTypedOrders++;
    if (anomalyFlags.length > 0) anomalyOrders++;

    if (stringFlags.length > 0 || anomalyFlags.length > 0) {
      const tags: string[] = [];
      if (stringFlags.length > 0) tags.push('STRING-TYPED');
      if (anomalyFlags.length > 0) tags.push('ANOMALY');
      flaggedLines.push(`  · #${orderNumber} (${orderId}) — ${customerName}  [${tags.join(', ')}]`);
      for (const f of [...stringFlags, ...anomalyFlags]) {
        flaggedLines.push(`      - ${f.reason}`);
      }
    }
  }

  // ---- Summary ----
  console.log('─'.repeat(64));
  console.log('SUMMARY');
  console.log(`  orders scanned ................ ${snap.size}`);
  console.log(`  orders w/ string-typed fields . ${stringTypedOrders}`);
  console.log(`  orders w/ anomaly heuristic .... ${anomalyOrders}`);
  console.log('─'.repeat(64));

  if (flaggedLines.length === 0) {
    console.log('All flyer weights are numeric and within expected bounds — no bad data.');
  } else {
    console.log('FLAGGED ORDERS:');
    for (const line of flaggedLines) console.log(line);
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('');
    console.error('✗ Audit FAILED to run (no data was modified — this is read-only).');
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
