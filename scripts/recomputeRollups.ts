/**
 * One-shot repair for customer + flyer rollup drift.
 *
 * Why this exists:
 *   Orders deleted before useDeleteOrder was made transactional (commit
 *   6fe844b) did NOT reverse their contribution to:
 *     customer.totalOrders
 *     customer.outstandingBalance (when unpaid at delete)
 *     customer.totalSpent         (when paid at delete)
 *     flyer.kgUsed                (sum of assigned kg per flyer)
 *   This script walks the orders collection — the source of truth — and
 *   rewrites every customer and flyer's rollups to match. After running
 *   it once, the rollups are guaranteed consistent with the data.
 *
 * Idempotent:
 *   The script computes targets from scratch on every run. Running it
 *   twice in a row writes nothing the second time — the diff is empty.
 *
 * Math (mirrors how the app maintains these — §5):
 *   For each customer (by id):
 *     totalOrders        = count of orders where customerId == customer.id
 *     totalSpent         = Σ totalAmount for those orders where status === 'paid'
 *     outstandingBalance = Σ totalAmount for those orders where status !== 'paid'
 *   For each flyer (by id):
 *     kgUsed             = Σ a.weightKg across every order's
 *                          flyerAssignments[] where a.flyerId == flyer.id
 *   Customers / flyers with zero matching orders → all rollups become 0.
 *
 * Output:
 *   Prints a before → after diff per customer / flyer that needed
 *   correcting. Silent for entities already consistent. Final line
 *   reports total corrections.
 *
 * Run:
 *   npm run recompute-rollups
 *
 * Safety:
 *   - Uses the named "default" Firestore database (§10 Quirk 1).
 *   - Reads everything first, then writes — no read/write interleave.
 *   - Floating-point compare via |a - b| > 0.005 so sub-satang accumulation
 *     noise doesn't trigger writes.
 *   - Refuses to touch orders themselves; only customer + flyer docs.
 *   - Orphan orders (orders whose customerId / a.flyerId doesn't exist
 *     in customers or flyers) are reported via a warning but don't
 *     halt the script — the missing customer/flyer can't be updated
 *     anyway, and skipping that contribution is the correct behaviour.
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();
const db = getFirestore(getApp(), DB_ID);

/** Tolerance for comparing accumulated money / kg numbers. Half a satang. */
const EPSILON = 0.005;

interface CustomerTarget {
  totalOrders: number;
  totalSpent: number;
  outstandingBalance: number;
}

function nearEq(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

async function main(): Promise<void> {
  console.log('· loading orders / customers / flyers …');
  const [ordersSnap, customersSnap, flyersSnap] = await Promise.all([
    db.collection('orders').get(),
    db.collection('customers').get(),
    db.collection('flyers').get(),
  ]);
  console.log(
    `  ${ordersSnap.size} order(s), ${customersSnap.size} customer(s), ${flyersSnap.size} flyer(s)`,
  );

  // --- Phase 1: compute customer targets (seeded with 0 for every known customer) ---
  const customerTargets = new Map<string, CustomerTarget>();
  for (const c of customersSnap.docs) {
    customerTargets.set(c.id, { totalOrders: 0, totalSpent: 0, outstandingBalance: 0 });
  }

  // --- Phase 2: compute flyer targets (seeded with 0 for every known flyer) ---
  const flyerTargets = new Map<string, number>();
  for (const f of flyersSnap.docs) {
    flyerTargets.set(f.id, 0);
  }

  // --- Phase 3: walk the orders collection and accumulate ---
  for (const oDoc of ordersSnap.docs) {
    const o = oDoc.data();
    const orderId = String(o.orderNumber ?? oDoc.id);
    const total = Number(o.totalAmount ?? 0);

    // Customer side
    const customerId = String(o.customerId ?? '');
    if (customerId) {
      const tgt = customerTargets.get(customerId);
      if (!tgt) {
        console.warn(
          `  ! order #${orderId} references missing customer ${customerId} — skipping its customer contribution`,
        );
      } else {
        tgt.totalOrders += 1;
        if (o.status === 'paid') tgt.totalSpent += total;
        else tgt.outstandingBalance += total;
      }
    }

    // Flyer side — sum every assignment's FLYER-side kg into its
    // flyer's bucket. Post 2026-06-07 split: source is flyerWeightKg
    // (denormalised flyer-side total set by the form at submit),
    // falling back to weightKg for legacy assignments where the new
    // field is absent. Must match the read used by useCreateOrder /
    // useDeleteOrder so this recompute lands on the same number.
    const assignments: Array<Record<string, unknown>> = Array.isArray(o.flyerAssignments)
      ? (o.flyerAssignments as Array<Record<string, unknown>>)
      : [];
    for (const a of assignments) {
      const flyerId = String(a.flyerId ?? '');
      const flyerKg =
        a.flyerWeightKg != null ? Number(a.flyerWeightKg) : Number(a.weightKg ?? 0);
      if (!flyerId) continue;
      if (!flyerTargets.has(flyerId)) {
        console.warn(
          `  ! order #${orderId} references missing flyer ${flyerId} — skipping its flyer contribution`,
        );
        continue;
      }
      flyerTargets.set(flyerId, (flyerTargets.get(flyerId) ?? 0) + flyerKg);
    }
  }

  // --- Phase 4: diff + write customers ---
  console.log('\n· customers');
  let customerChanges = 0;
  for (const cDoc of customersSnap.docs) {
    const before = cDoc.data();
    const target = customerTargets.get(cDoc.id)!;
    const beforeOrders = Number(before.totalOrders ?? 0);
    const beforeSpent = Number(before.totalSpent ?? 0);
    const beforeOutstanding = Number(before.outstandingBalance ?? 0);

    const changed =
      beforeOrders !== target.totalOrders ||
      !nearEq(beforeSpent, target.totalSpent) ||
      !nearEq(beforeOutstanding, target.outstandingBalance);

    if (!changed) continue;
    customerChanges++;
    const name = String(before.name ?? cDoc.id);
    console.log(`  · ${name}  (${cDoc.id})`);
    if (beforeOrders !== target.totalOrders) {
      console.log(`      totalOrders         ${beforeOrders} → ${target.totalOrders}`);
    }
    if (!nearEq(beforeSpent, target.totalSpent)) {
      console.log(`      totalSpent          ${beforeSpent} → ${target.totalSpent}`);
    }
    if (!nearEq(beforeOutstanding, target.outstandingBalance)) {
      console.log(`      outstandingBalance  ${beforeOutstanding} → ${target.outstandingBalance}`);
    }
    await cDoc.ref.update({
      totalOrders: target.totalOrders,
      totalSpent: target.totalSpent,
      outstandingBalance: target.outstandingBalance,
    });
  }
  if (customerChanges === 0) console.log('  ✓ all customers already consistent');

  // --- Phase 5: diff + write flyers ---
  console.log('\n· flyers');
  let flyerChanges = 0;
  for (const fDoc of flyersSnap.docs) {
    const before = fDoc.data();
    const target = flyerTargets.get(fDoc.id) ?? 0;
    const beforeKg = Number(before.kgUsed ?? 0);
    if (nearEq(beforeKg, target)) continue;
    flyerChanges++;
    const name = String(before.name ?? fDoc.id);
    console.log(`  · ${name}  (${fDoc.id})`);
    console.log(`      kgUsed              ${beforeKg} → ${target}`);
    await fDoc.ref.update({
      kgUsed: target,
      // The app updates updatedAt whenever kgUsed changes (see
      // useCreateOrder / useDeleteOrder); keep that invariant.
      updatedAt: Timestamp.now(),
    });
  }
  if (flyerChanges === 0) console.log('  ✓ all flyers already consistent');

  console.log(
    `\n· done — ${customerChanges} customer(s) corrected, ${flyerChanges} flyer(s) corrected`,
  );
  if (customerChanges === 0 && flyerChanges === 0) {
    console.log('  Nothing was written. Run anytime; safe to re-run.');
  } else {
    console.log('  Reload the admin app to see the corrected numbers.');
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
