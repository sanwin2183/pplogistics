/**
 * [DIAG-KHIN-MYO-WAI]
 *
 * Diagnostic: dump the exact data the flyer detail page's trip pipeline
 * sees for "Khin Myo Wai". No mutations. Bypasses the React/PWA stack and
 * every cache — reads Firestore directly via Admin SDK so the output IS
 * ground truth.
 *
 * Tests three hypotheses simultaneously:
 *   (A) useOrdersByFlyer's `.some((a) => a.flyerId === flyerId)` filter
 *       misses an order — would show up here as "an assignment exists with
 *       a near-match flyerId that strict-equals would reject".
 *   (B) Assignment.weightKg is stale relative to the order's items[] sum
 *       — both numbers dumped side by side; mismatch is obvious.
 *   (C) Trip-key mismatch — two assignments to the same flyer but with
 *       different effective trip keys, OR an order categorised into a
 *       silent-drop status. The script reports the trip-grouping decision
 *       AND the categorise-trip decision per order.
 *
 * Usage:
 *   npm run diagnose-flyer-orders
 */
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initAdminApp, DB_ID } from './_initAdmin';

initAdminApp();

// Default name kept for the original Khin-Myo-Wai diagnostic; can be
// overridden from the CLI: `npm run diagnose-flyer-orders -- "Hnin Su"`.
const FLYER_NAME = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'Khin Myo Wai';

// Mirror of the client-side categorisation in src/features/flyers/tripHelpers.ts
// — kept in sync by hand here so we can SEE which status a given order
// would land in (or be silently dropped from).
// Mirror MUST stay in sync with src/features/flyers/tripHelpers.ts. Updated
// 2026-05-29 — with_flyer moved into payable per the real-world semantics
// (flyer has the cargo → has earned the fee).
const TRIP_UPCOMING_STATUSES = ['pending', 'received'];
const TRIP_PAYABLE_STATUSES = [
  'with_flyer',
  'in_transit',
  'delivered',
  'awaiting_payment',
  'paid',
];

function categorizeStatus(status: string): 'upcoming' | 'payable' | 'silent-drop' {
  if (TRIP_UPCOMING_STATUSES.includes(status)) return 'upcoming';
  if (TRIP_PAYABLE_STATUSES.includes(status)) return 'payable';
  return 'silent-drop';
}

async function main() {
  const db = getFirestore(getApp(), DB_ID);

  // -------------------------------------------------------------------
  // 1. Find the flyer doc
  // -------------------------------------------------------------------
  console.log('');
  console.log(`[DIAG-KHIN-MYO-WAI] looking up flyer named "${FLYER_NAME}"`);
  const flyerSnap = await db.collection('flyers').where('name', '==', FLYER_NAME).get();
  if (flyerSnap.empty) {
    console.error(`  ✗ no flyer with that exact name. Try variants (case / spacing).`);
    process.exit(1);
  }
  console.log(`  → ${flyerSnap.size} flyer doc(s) found`);
  for (const d of flyerSnap.docs) {
    const f = d.data();
    console.log('');
    console.log(`  FLYER DOC ${d.id}`);
    console.log('    name:       ', JSON.stringify(f.name));
    console.log('    nameLength: ', String(f.name ?? '').length, '(check for trailing whitespace)');
    console.log('    route:      ', f.route);
    console.log('    flightDate: ', f.flightDate && typeof f.flightDate === 'object' && 'toDate' in f.flightDate ? (f.flightDate as { toDate: () => Date }).toDate().toISOString() : f.flightDate);
    console.log('    kgAvailable:', f.kgAvailable);
    console.log('    kgUsed:     ', f.kgUsed);
    console.log('    status:     ', f.status);
  }

  // For the analysis we'll use the first match — but if there are more we
  // surface that ambiguity loudly because it's a possible root cause.
  if (flyerSnap.size > 1) {
    console.log('');
    console.log(`  ⚠ MORE THAN ONE flyer doc with this name — hypothesis (A)/(C) candidate.`);
    console.log(`    The detail page is bound to ONE id at a time; orders assigned to the`);
    console.log(`    OTHER flyer doc wouldn't show on the active detail page.`);
  }
  const flyer = flyerSnap.docs[0];
  const flyerId = flyer.id;
  const flyerData = flyer.data();
  const flyerName = String(flyerData.name);
  const flyerRoute = String(flyerData.route);
  const flyerFlightDateMs =
    flyerData.flightDate && typeof flyerData.flightDate === 'object' && 'toDate' in flyerData.flightDate
      ? (flyerData.flightDate as { toDate: () => Date }).toDate().getTime()
      : null;
  console.log('');
  console.log(`  using flyer id "${flyerId}" for downstream analysis`);

  // -------------------------------------------------------------------
  // 2. Scan ALL orders and find ones referencing this flyer
  //    (Mirrors useOrdersByFlyer's filter exactly — strict ===.)
  // -------------------------------------------------------------------
  console.log('');
  console.log('[DIAG-KHIN-MYO-WAI] scanning orders collection');
  const allOrdersSnap = await db.collection('orders').orderBy('createdAt', 'desc').get();
  console.log(`  → ${allOrdersSnap.size} orders total in collection`);

  interface MatchEntry {
    orderId: string;
    orderNumber: string;
    status: string;
    totalWeightKg: number;
    totalAmount: number;
    itemsKgSum: number;
    itemsCount: number;
    items: Array<{ description: string; categoryName: string; weightKg: number; ratePerKg: number }>;
    assignments: Array<{
      idx: number;
      flyerId: string;
      flyerName: string;
      weightKg: number;
      payoutAmount: number;
      payoutRatePerKg?: number;
      categoryRates?: Array<{ categoryId: string; ratePerKg: number }>;
      paidOutAt: string | null;
      matchesByStrictEq: boolean;
      matchesByLooseString: boolean;
    }>;
  }
  const matches: MatchEntry[] = [];
  // Also: look at NEAR-MATCH orders — ones whose assignment.flyerId is
  // ALMOST but not exactly equal (trim/case difference). Hypothesis (A).
  const nearMatches: Array<{ orderId: string; orderNumber: string; assignedFlyerId: string }> = [];

  for (const d of allOrdersSnap.docs) {
    const o = d.data() as Record<string, unknown>;
    const assignments = (o.flyerAssignments as Array<Record<string, unknown>> | undefined) ?? [];
    const items = (o.items as Array<Record<string, unknown>> | undefined) ?? [];
    let anyStrictMatch = false;
    const matchingAssignments: MatchEntry['assignments'] = [];

    assignments.forEach((a, idx) => {
      const aFlyerId = a.flyerId;
      const strictMatch = aFlyerId === flyerId;
      // Loose match — trim both sides + lowercase. Surfaces whitespace /
      // case drift that strict-equality would silently miss.
      const looseMatch =
        typeof aFlyerId === 'string' &&
        aFlyerId.trim().toLowerCase() === flyerId.trim().toLowerCase();
      if (strictMatch) anyStrictMatch = true;
      if (looseMatch || strictMatch) {
        matchingAssignments.push({
          idx,
          flyerId: String(aFlyerId),
          flyerName: String(a.flyerName ?? ''),
          weightKg: Number(a.weightKg ?? 0),
          payoutAmount: Number(a.payoutAmount ?? 0),
          payoutRatePerKg:
            a.payoutRatePerKg != null ? Number(a.payoutRatePerKg) : undefined,
          categoryRates: Array.isArray(a.categoryRates)
            ? (a.categoryRates as Array<{ categoryId: string; ratePerKg: number }>)
            : undefined,
          paidOutAt:
            a.paidOutAt && typeof a.paidOutAt === 'object' && 'toDate' in a.paidOutAt
              ? (a.paidOutAt as { toDate: () => Date }).toDate().toISOString()
              : a.paidOutAt == null
                ? null
                : String(a.paidOutAt),
          matchesByStrictEq: strictMatch,
          matchesByLooseString: looseMatch,
        });
      } else if (
        // Match-by-NAME catches the case where flyerId drifted but
        // flyerName is the same (e.g., a flyer was deleted + recreated).
        typeof a.flyerName === 'string' &&
        a.flyerName.trim().toLowerCase() === flyerName.trim().toLowerCase()
      ) {
        nearMatches.push({
          orderId: d.id,
          orderNumber: String(o.orderNumber ?? ''),
          assignedFlyerId: String(aFlyerId),
        });
      }
    });

    if (anyStrictMatch || matchingAssignments.length > 0) {
      const itemsKgSum = items.reduce(
        (s, it) => s + Number((it as { weightKg?: number }).weightKg ?? 0),
        0,
      );
      matches.push({
        orderId: d.id,
        orderNumber: String(o.orderNumber ?? ''),
        status: String(o.status ?? ''),
        totalWeightKg: Number(o.totalWeightKg ?? 0),
        totalAmount: Number(o.totalAmount ?? 0),
        itemsKgSum,
        itemsCount: items.length,
        items: items.map((it) => ({
          description: String((it as { description?: string }).description ?? ''),
          categoryName: String((it as { categoryName?: string }).categoryName ?? ''),
          weightKg: Number((it as { weightKg?: number }).weightKg ?? 0),
          ratePerKg: Number((it as { ratePerKg?: number }).ratePerKg ?? 0),
        })),
        assignments: matchingAssignments,
      });
    }
  }

  console.log(`  → ${matches.length} order(s) reference this flyer`);

  // Multi-assignment audit — count orders that have MORE THAN ONE
  // assignment to this flyer on the same trip. The new TripPayoutSummary
  // bug is silently dropping the 2nd+ assignment in these orders.
  const multiAssignmentOrders = matches.filter((m) => m.assignments.length > 1);
  console.log('');
  console.log('[DIAG] multi-assignment audit (orders with > 1 assignment to this flyer):');
  if (multiAssignmentOrders.length === 0) {
    console.log('  → none. No fix-side impact from the dedup bug for this flyer.');
  } else {
    console.log(`  → ${multiAssignmentOrders.length} order(s) have multiple matching assignments.`);
    for (const m of multiAssignmentOrders) {
      const firstPayout = m.assignments[0].payoutAmount;
      const droppedSum = m.assignments
        .slice(1)
        .reduce((s, a) => s + a.payoutAmount, 0);
      const correctSum = m.assignments.reduce((s, a) => s + a.payoutAmount, 0);
      console.log(
        `    #${m.orderNumber}: ${m.assignments.length} assignments, ` +
          `current render only shows first (฿${firstPayout}), ` +
          `dropped ฿${droppedSum}, correct order total ฿${correctSum}`,
      );
    }
  }

  if (nearMatches.length > 0) {
    console.log('');
    console.log('  ⚠ NEAR-MATCH ORDERS (flyerName matches but flyerId does NOT):');
    for (const nm of nearMatches) {
      console.log(`    #${nm.orderNumber} (id=${nm.orderId}) → assignment.flyerId="${nm.assignedFlyerId}"`);
    }
    console.log('    → Hypothesis (A) confirmed: the strict-eq filter in');
    console.log('      useOrdersByFlyer would MISS these orders.');
  }

  // -------------------------------------------------------------------
  // 3. Per-order detail dump
  // -------------------------------------------------------------------
  console.log('');
  console.log('[DIAG-KHIN-MYO-WAI] per-order breakdown');
  let kgUsedFromAssignments = 0;
  for (const m of matches) {
    console.log('');
    console.log(`  ─── ORDER #${m.orderNumber} (id=${m.orderId}) ───`);
    console.log(`    status:           ${m.status}    → categorisation: ${categorizeStatus(m.status)}`);
    if (categorizeStatus(m.status) === 'silent-drop') {
      console.log(`    ⚠ SILENT DROP — status "${m.status}" is in NEITHER`);
      console.log(`      TRIP_UPCOMING_STATUSES (${TRIP_UPCOMING_STATUSES.join(', ')})`);
      console.log(`      NOR TRIP_PAYABLE_STATUSES (${TRIP_PAYABLE_STATUSES.join(', ')}).`);
      console.log(`      → Order will NOT appear in any flyer-page section.`);
    }
    console.log(`    totalWeightKg:    ${m.totalWeightKg}    (order doc field)`);
    console.log(`    totalAmount:      ${m.totalAmount}`);
    console.log(`    items count:      ${m.itemsCount}`);
    console.log(`    items kg sum:     ${m.itemsKgSum}    (recomputed from items[])`);
    if (Math.abs(m.itemsKgSum - m.totalWeightKg) > 0.001) {
      console.log(`    ⚠ totalWeightKg ≠ Σitems.weightKg — order doc out of sync.`);
    }
    console.log('    items:');
    for (const it of m.items) {
      console.log(`      - ${it.weightKg}kg ${it.categoryName} (${it.description}) @ ${it.ratePerKg}/kg`);
    }
    console.log(`    assignments matching this flyer:`);
    for (const a of m.assignments) {
      console.log(`      [#${a.idx}] flyerId="${a.flyerId}"`);
      console.log(`           flyerName="${a.flyerName}"`);
      console.log(`           weightKg=${a.weightKg}    payoutAmount=${a.payoutAmount}`);
      if (a.categoryRates) {
        console.log(`           categoryRates (new shape): ${JSON.stringify(a.categoryRates)}`);
      } else {
        console.log(`           payoutRatePerKg=${a.payoutRatePerKg}  (LEGACY single rate)`);
      }
      console.log(`           paidOutAt=${a.paidOutAt}`);
      console.log(`           strict-eq match? ${a.matchesByStrictEq}    loose-string match? ${a.matchesByLooseString}`);
      kgUsedFromAssignments += a.weightKg;
      // Discrepancy check: assignment.weightKg vs order.totalWeightKg.
      if (Math.abs(a.weightKg - m.totalWeightKg) > 0.001) {
        console.log(
          `           ⚠ assignment.weightKg (${a.weightKg}) ≠ order.totalWeightKg (${m.totalWeightKg})`,
        );
        console.log(
          `             — could be intentional partial assignment OR stale snapshot. See §19.`,
        );
      }
    }
  }

  // -------------------------------------------------------------------
  // 4. Capacity-bar reconciliation
  // -------------------------------------------------------------------
  console.log('');
  console.log('[DIAG-KHIN-MYO-WAI] capacity reconciliation');
  console.log(`  flyer.kgUsed (stored):                 ${flyerData.kgUsed}`);
  console.log(`  Σ matching assignment.weightKg:         ${kgUsedFromAssignments.toFixed(2)}`);
  if (Math.abs(Number(flyerData.kgUsed ?? 0) - kgUsedFromAssignments) > 0.001) {
    console.log(`  ⚠ stored kgUsed disagrees with sum across visible assignments.`);
    console.log(`    Means an assignment exists in the data that the strict-eq filter`);
    console.log(`    isn't catching. Hypothesis (A) confirmed.`);
  } else {
    console.log(`  ✓ kgUsed matches sum across matched assignments.`);
    console.log(`    → If user sees fewer orders than expected, the discrepancy is`);
    console.log(`      downstream (status categorisation or render) — NOT in the query.`);
  }

  // -------------------------------------------------------------------
  // 5. Trip-key analysis (hypothesis C)
  // -------------------------------------------------------------------
  console.log('');
  console.log('[DIAG-KHIN-MYO-WAI] trip-key analysis');
  console.log(`  the client computes trip-key as: flyerId|route|flightDateMs`);
  console.log(`  current flyer doc → "${flyerId}|${flyerRoute}|${flyerFlightDateMs}"`);
  console.log(`  all matched orders compute the SAME trip key (since the key`);
  console.log(`  is derived from the FLYER doc, not from the assignment).`);
  console.log(`  → Hypothesis (C) [trip-key drift] CANNOT split the orders into`);
  console.log(`    different trips in the current architecture; ruled out by`);
  console.log(`    construction of groupOrdersIntoTrips.`);

  console.log('');
  console.log('[DIAG-KHIN-MYO-WAI] done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
