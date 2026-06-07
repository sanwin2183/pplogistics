import type { Flyer, Order, OrderStatus, Route, FsTs, FlyerAssignment } from '../../types';
import { toDate } from '../../lib/formatters';

/**
 * Trip-level payout grouping.
 *
 * A "trip" is the set of orders sharing the same {flyerId, route, flightDate}
 * key on a flyer assignment. In the current schema a flyer doc IS a trip
 * (each flyer record has one route + one flightDate), so grouping by
 * flyerId would suffice — but the key is over-specified deliberately so:
 *   - data drift (flyer doc edited after assignments exist) doesn't silently
 *     re-group historical orders;
 *   - a future "trips across flyers" overview page can reuse this grouping
 *     without rework.
 *
 * Storage model: NO new collection. Trips are pure render-time derivations.
 * Marking a trip paid sets `paidOutAt` on each constituent assignment
 * (existing field).
 */

/**
 * Order statuses that contribute to a trip's payable total.
 *
 * `with_flyer` is INCLUDED here (corrected 2026-05-29). Real-world
 * semantics: once the flyer has the cargo in hand, they've earned the
 * fee — payout doesn't wait for the plane to leave the gate. The
 * original threshold (in_transit and later only) under-counted earned
 * payout the entire window between handover and takeoff, hid
 * with_flyer orders from the flyer detail page's Payable section, and
 * caused the user to see orders silently disappear from trip cards.
 */
export const TRIP_PAYABLE_STATUSES: OrderStatus[] = [
  'with_flyer',
  'in_transit',
  'delivered',
  'awaiting_payment',
  'paid',
];

/**
 * Order statuses that appear in a trip's "upcoming" bucket (not yet
 * payable). Trims to the truly-not-yet-handed-off statuses: `pending`
 * (just placed) and `received` (at our warehouse, not yet given to the
 * flyer).
 */
export const TRIP_UPCOMING_STATUSES: OrderStatus[] = ['pending', 'received'];

export function isTripPayableStatus(status: OrderStatus): boolean {
  return TRIP_PAYABLE_STATUSES.includes(status);
}

export function isTripUpcomingStatus(status: OrderStatus): boolean {
  return TRIP_UPCOMING_STATUSES.includes(status);
}

/**
 * All matching assignments on an order for this flyer.
 *
 * An order CAN legitimately have multiple assignments to the same flyer
 * — this was the pre-categoryRates pattern for per-category-rate payouts
 * on a legacy order (e.g. one row at ฿250/kg for 56 kg of clothes + a
 * second row at ฿270/kg for 11 kg of shoes, same flyer, same order).
 * The new categoryRates shape replaces this for new orders, but the
 * legacy rows are still in the data and must render + pay out correctly.
 *
 * Callers that need a single assignment can use `[0]`; callers that
 * sum or render across all rows iterate the returned array. The older
 * singular `findAssignmentForFlyer` is kept as a thin wrapper around
 * `.find()` for the few legitimate single-assignment cases.
 */
export function findAssignmentsForFlyer(
  order: Order,
  flyerId: string,
): FlyerAssignment[] {
  return order.flyerAssignments.filter((a) => a.flyerId === flyerId);
}

/** @deprecated Use `findAssignmentsForFlyer` and iterate. Kept temporarily
 *  for any caller that legitimately wants a single representative assignment
 *  (e.g. a check that the flyer is on the order at all). */
export function findAssignmentForFlyer(
  order: Order,
  flyerId: string,
): FlyerAssignment | undefined {
  return order.flyerAssignments.find((a) => a.flyerId === flyerId);
}

export interface Trip {
  /** Stable key for keying React lists + matching to a `Flyer` doc. */
  key: string;
  flyerId: string;
  flyerName: string;
  route: Route;
  flightDate: FsTs;
  /** All orders that have an assignment to this flyer for this trip. */
  orders: Order[];
}

/**
 * Build a stable composite key from the three trip dimensions. flightDate
 * normalised to its epoch-ms so two equivalent Timestamps don't compare
 * unequal by reference identity.
 */
export function tripKey(flyerId: string, route: string, flightDate: FsTs): string {
  const d = toDate(flightDate);
  return `${flyerId}|${route}|${d ? d.getTime() : 'no-date'}`;
}

/**
 * Group an order list into trips. `flyerLookup` provides each flyer's
 * canonical route + flightDate (needed because the assignment carries only
 * `flyerId`/`flyerName` — the trip-defining dimensions live on the flyer
 * doc).
 *
 * Today the flyer detail page always passes a single-element lookup (the
 * flyer being viewed), so callers see exactly one trip per page. Designed
 * to scale to N flyers without a code change.
 */
export function groupOrdersIntoTrips(
  orders: Order[],
  flyerLookup: Map<string, Flyer>,
): Trip[] {
  const byKey = new Map<string, Trip>();
  for (const o of orders) {
    // Per-order trip-key tracker. If the same order has multiple
    // assignments that resolve to the SAME trip key (data drift, legacy
    // double-add, or any future race that lets the form post duplicate
    // flyer rows), we count the order ONCE per trip. The form prevents
    // duplicate-flyer assignments today, but this helper is the source of
    // truth for trip composition — trusting upstream invariants here
    // produced the "order #260529-520 shows twice in Hnin Su's trip"
    // image-double bug. Self-defending dedup is the right shape.
    const seenTripKeysForThisOrder = new Set<string>();
    for (const a of o.flyerAssignments) {
      const flyer = flyerLookup.get(a.flyerId);
      if (!flyer) continue;
      const k = tripKey(flyer.id, flyer.route, flyer.flightDate);
      if (seenTripKeysForThisOrder.has(k)) continue;
      seenTripKeysForThisOrder.add(k);
      const existing = byKey.get(k);
      if (existing) {
        existing.orders.push(o);
      } else {
        byKey.set(k, {
          key: k,
          flyerId: flyer.id,
          flyerName: flyer.name,
          route: flyer.route,
          flightDate: flyer.flightDate,
          orders: [o],
        });
      }
    }
  }

  // Invariant: within any single trip, every orderId appears at most once.
  // console.assert is a no-op in production builds with the default Vite
  // config but loud in dev — surfaces regressions immediately rather than
  // silently producing duplicate rows in the captured payout image.
  if (import.meta.env.DEV) {
    for (const trip of byKey.values()) {
      const ids = trip.orders.map((o) => o.id);
      const unique = new Set(ids);
      // eslint-disable-next-line no-console
      console.assert(
        unique.size === ids.length,
        `[tripHelpers] duplicate orders within trip ${trip.key}: ${ids.join(', ')}`,
      );
    }
  }

  return Array.from(byKey.values());
}

export interface CategorizedTrip {
  trip: Trip;
  upcomingOrders: Order[];
  eligibleOrders: Order[];
  paidEligibleOrders: Order[];
  unpaidEligibleOrders: Order[];
  /** Section the trip card renders into. See decision matrix below. */
  section: 'upcoming' | 'payable' | 'paid';
  /** Sum of payoutAmount across UNPAID eligible orders' matching assignments
   *  — what the owner would hand the flyer cash for. */
  payableTotal: number;
  /** Sum of payoutAmount across PAID eligible orders' assignments — for the
   *  Paid section display. */
  paidTotal: number;
  /** Most recent paidOutAt timestamp across paid eligible assignments, used
   *  as the "date paid" in the Paid card header. */
  lastPaidAt: Date | null;
}

/**
 * Categorise a trip's orders + assign the trip to a UI section.
 *
 * Section decision matrix:
 *   - has any UNPAID eligible order  →  'payable'
 *   - else has any PAID eligible order →  'paid'
 *   - else                              →  'upcoming'
 *
 * Rationale: a trip with mixed paid/unpaid eligible orders is "in progress
 * on the payout side" — it goes to Payable so the unpaid ones are
 * actionable. Pure-upcoming trips (no orders past `received`) go to
 * Upcoming. Trips where every eligible order has paidOutAt go to Paid.
 *
 * The upcoming-orders list inside the trip is shown for context regardless
 * of section, but DOES NOT contribute to payableTotal — payouts only flow
 * once the flyer has the cargo (with_flyer or later). This matches the
 * spec: pending / received orders are visible but cannot be paid yet.
 */
export function categorizeTrip(trip: Trip): CategorizedTrip {
  const upcomingOrders: Order[] = [];
  const eligibleOrders: Order[] = [];
  const paidEligibleOrders: Order[] = [];
  const unpaidEligibleOrders: Order[] = [];
  let payableTotal = 0;
  let paidTotal = 0;
  let lastPaidAtMs = 0;

  for (const o of trip.orders) {
    // ALL matching assignments — an order can have more than one
    // assignment to this flyer (legacy per-category-rate pattern). Each
    // contributes independently to the totals.
    const assignments = findAssignmentsForFlyer(o, trip.flyerId);
    if (assignments.length === 0) continue;

    if (isTripUpcomingStatus(o.status)) {
      upcomingOrders.push(o);
      continue;
    }
    if (!isTripPayableStatus(o.status)) continue;

    eligibleOrders.push(o);

    // Sum payouts across ALL matching assignments, splitting by paid vs
    // unpaid at the ASSIGNMENT level. An order with 2 assignments where
    // one is paid and one is unpaid contributes to BOTH paidTotal and
    // payableTotal — money already paid AND money still owed coexist on
    // the same order line.
    let orderHasUnpaid = false;
    let orderHasPaid = false;
    for (const a of assignments) {
      if (a.paidOutAt) {
        orderHasPaid = true;
        paidTotal += a.payoutAmount || 0;
        const ms = toDate(a.paidOutAt)?.getTime() ?? 0;
        if (ms > lastPaidAtMs) lastPaidAtMs = ms;
      } else {
        orderHasUnpaid = true;
        payableTotal += a.payoutAmount || 0;
      }
    }

    // Per-order bucket: if ANY assignment is unpaid, the order is still
    // actionable → unpaidEligible. Only when EVERY assignment is paid is
    // the order considered fully settled → paidEligible.
    if (orderHasUnpaid) unpaidEligibleOrders.push(o);
    else if (orderHasPaid) paidEligibleOrders.push(o);
  }

  let section: CategorizedTrip['section'];
  if (unpaidEligibleOrders.length > 0) section = 'payable';
  else if (paidEligibleOrders.length > 0) section = 'paid';
  else section = 'upcoming';

  return {
    trip,
    upcomingOrders,
    eligibleOrders,
    paidEligibleOrders,
    unpaidEligibleOrders,
    section,
    payableTotal,
    paidTotal,
    lastPaidAt: lastPaidAtMs ? new Date(lastPaidAtMs) : null,
  };
}
