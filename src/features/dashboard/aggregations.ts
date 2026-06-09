import dayjs from 'dayjs';
import { toDate } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import type { Customer, Flyer, Order, Route } from '../../types';
import {
  bucketKeyFor,
  buildBuckets,
  chartWindowForBounds,
  pickGranularity,
  type Granularity,
  type RangeBounds,
} from './dashboardRange';

/**
 * Pure aggregation helpers for the dashboard.
 *
 * Phase 1: each helper took a `windowStart` Dayjs and filtered on
 *   o.createdAt internally.
 * Phase 2: the date filter moved UP into DashboardPage (it calls
 *   filterOrdersByRange ONCE and passes the resulting subset to every
 *   helper). So these helpers now just sum/group whatever orders they
 *   receive — no time logic, no window. One filter pass per render
 *   instead of N (one per helper) ⇒ fewer chances for the windows to
 *   drift out of sync, AND lets every helper be reused for any range
 *   (lifetime, custom, pick month) without signature changes.
 *
 * Money math is untouched — every helper sums STORED fields
 * (o.totalAmount, o.profit, o.totalPayout, assignment.payoutAmount,
 * item.subtotal, customer.outstandingBalance). No rates are
 * recomputed; per-piece items already have their subtotals baked in
 * at write time so they're counted exactly the same as per-kg items.
 */

// ---------- Period-stat scalars ----------

/** Σ totalAmount on paid orders in input. */
export function sumPaidRevenue(orders: Order[]): number {
  let total = 0;
  for (const o of orders) {
    if (o.status === 'paid') total += o.totalAmount;
  }
  return total;
}

/** Σ profit on paid orders in input. */
export function sumPaidProfit(orders: Order[]): number {
  let total = 0;
  for (const o of orders) {
    if (o.status === 'paid') total += o.profit;
  }
  return total;
}

/** Orders / kg / pieces for the input array. Pieces sums item.pieceCount
 *  on per-piece items only (per-kg items have no pieceCount). */
export function sumOrdersSummary(
  orders: Order[],
  opts: { paidOnly?: boolean } = {},
): { count: number; kg: number; pieces: number } {
  let count = 0;
  let kg = 0;
  let pieces = 0;
  for (const o of orders) {
    if (opts.paidOnly && o.status !== 'paid') continue;
    count += 1;
    kg += o.totalWeightKg;
    for (const it of o.items) {
      if (it.pricingMode === 'per_piece') pieces += it.pieceCount ?? 0;
    }
  }
  return { count, kg, pieces };
}

// ---------- Revenue breakdowns ----------

export interface CategoryRevenueSlice {
  categoryName: string;
  revenue: number;
}

/** Σ item.subtotal grouped by item.categoryName across paid orders in
 *  input. Works for per-kg AND per-piece items because subtotal is the
 *  canonical stored money number for both modes. */
export function revenueByCategory(orders: Order[]): CategoryRevenueSlice[] {
  const m = new Map<string, number>();
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    for (const it of o.items) {
      m.set(it.categoryName, (m.get(it.categoryName) ?? 0) + it.subtotal);
    }
  }
  return Array.from(m.entries())
    .map(([categoryName, revenue]) => ({ categoryName, revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface RouteRevenueSlice {
  route: Route;
  label: string;
  revenue: number;
}

/**
 * Revenue by route on paid orders in input — does the order → flyer →
 * route join properly (mirrors ReportsPage byRoute, which is the
 * known-correct reference; the old kg-by-status chart on the dashboard
 * did NOT do this join, see CLAUDE.md §18 — that chart was removed in
 * Phase 1).
 *
 * Single-assignment orders: 100% of revenue → that flyer's route.
 * Multi-flyer split orders: apportioned by each flyer's REAL flown kg
 * share (a.flyerWeightKg — this flyer's portion post per-item per-flyer
 * split, 2026-06-09), which is now accurate rather than the old
 * customer-total proxy. Legacy assignments (no flyerWeightKg) fall back
 * to a.weightKg — unchanged behaviour. Falls back to an even split when
 * the total flown kg is 0 (piece-only orders, so we don't lose their
 * revenue from the route view).
 */
export function revenueByRoute(orders: Order[], flyers: Flyer[]): RouteRevenueSlice[] {
  const flyerMap = new Map(flyers.map((f) => [f.id, f]));
  const totals: Record<Route, number> = {
    'BKK→YGN': 0,
    'BKK→MDL': 0,
    'YGN→BKK': 0,
    'MDL→BKK': 0,
  };
  // This flyer's flown kg for the share math, with the legacy fallback.
  const flownKg = (a: Order['flyerAssignments'][number]) => a.flyerWeightKg ?? a.weightKg ?? 0;
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    const assignments = o.flyerAssignments;
    if (assignments.length === 0) continue;
    if (assignments.length === 1) {
      const f = flyerMap.get(assignments[0].flyerId);
      if (f) totals[f.route] += o.totalAmount;
      continue;
    }
    const totalKg = assignments.reduce((s, a) => s + flownKg(a), 0);
    for (const a of assignments) {
      const f = flyerMap.get(a.flyerId);
      if (!f) continue;
      const share =
        totalKg > 0 ? flownKg(a) / totalKg : 1 / assignments.length;
      totals[f.route] += o.totalAmount * share;
    }
  }
  return (Object.keys(totals) as Route[])
    .map((route) => ({ route, label: ROUTE_LABELS[route], revenue: totals[route] }))
    .filter((s) => s.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------- Time-series charts ----------

export interface RcpPoint {
  /** Bucket key (YYYY-MM-DD or YYYY-MM). */
  key: string;
  /** Axis label (e.g. "5 Jun" or "Jun 2026"). */
  label: string;
  revenue: number;
  cost: number;
  profit: number;
}

export interface ProfitPoint {
  key: string;
  label: string;
  profit: number;
}

/**
 * Per-bucket Revenue / Cost / Profit series across paid orders in
 * input, bucketed by `granularity` ('day' or 'month'). The bucket
 * skeleton is built from [start, end] so a gap month with no orders
 * still renders as a zero column — otherwise the chart looks like
 * orders happened back-to-back when there were actually gaps.
 *
 * Orders that fall outside [start, end] are silently dropped (this
 * matches the calling pattern where DashboardPage has already
 * range-filtered the orders, but the chart window may be slightly
 * different from the range bounds — e.g. Lifetime derives its window
 * from the earliest data, not from -∞).
 */
export function revenueCostProfitSeries(
  orders: Order[],
  start: dayjs.Dayjs,
  end: dayjs.Dayjs,
  granularity: Granularity,
): RcpPoint[] {
  const buckets = buildBuckets(start, end, granularity);
  const idx = new Map<string, RcpPoint>();
  const out: RcpPoint[] = buckets.map((b) => {
    const p: RcpPoint = {
      key: b.key,
      label: b.label,
      revenue: 0,
      cost: 0,
      profit: 0,
    };
    idx.set(b.key, p);
    return p;
  });
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    const created = toDate(o.createdAt);
    if (!created) continue;
    const p = idx.get(bucketKeyFor(created, granularity));
    if (!p) continue;
    p.revenue += o.totalAmount;
    p.cost += o.totalPayout;
    p.profit += o.profit;
  }
  return out;
}

/** Profit-only series — same shape as revenueCostProfitSeries but lighter. */
export function profitSeries(
  orders: Order[],
  start: dayjs.Dayjs,
  end: dayjs.Dayjs,
  granularity: Granularity,
): ProfitPoint[] {
  const buckets = buildBuckets(start, end, granularity);
  const idx = new Map<string, ProfitPoint>();
  const out: ProfitPoint[] = buckets.map((b) => {
    const p: ProfitPoint = { key: b.key, label: b.label, profit: 0 };
    idx.set(b.key, p);
    return p;
  });
  for (const o of orders) {
    if (o.status !== 'paid') continue;
    const created = toDate(o.createdAt);
    if (!created) continue;
    const p = idx.get(bucketKeyFor(created, granularity));
    if (!p) continue;
    p.profit += o.profit;
  }
  return out;
}

/**
 * Earliest order date in the array, or null when empty. Used by the
 * chart helpers when range is Lifetime so the X-axis doesn't paint a
 * decade of empty months before the business started.
 */
export function earliestOrderDate(orders: Order[]): Date | null {
  let earliest: Date | null = null;
  for (const o of orders) {
    const d = toDate(o.createdAt);
    if (!d) continue;
    if (!earliest || d < earliest) earliest = d;
  }
  return earliest;
}

/**
 * Convenience — resolve the chart window for a time-series, given the
 * resolved range bounds and the (already range-filtered) orders. For
 * Lifetime, derives the start from the earliest order; for any other
 * range, uses the bounds verbatim. Returns null when the bounds are
 * invalid (Custom with bad dates).
 */
export function chartWindowFromBoundsAndOrders(
  bounds: RangeBounds,
  orders: Order[],
): { start: dayjs.Dayjs; end: dayjs.Dayjs; granularity: Granularity } | null {
  if (!bounds.valid) return null;
  const granularity = pickGranularity(bounds);
  const { start, end } = chartWindowForBounds(
    bounds,
    granularity,
    earliestOrderDate(orders),
  );
  return { start, end, granularity };
}

// ---------- Top debtors (point-in-time, range-agnostic) ----------

export interface DebtorRow {
  id: string;
  name: string;
  outstanding: number;
}

/** Top N customers by stored outstandingBalance rollup. Range-agnostic:
 *  outstanding balance is a current-state number, not a period sum. */
export function topDebtors(customers: Customer[], n = 5): DebtorRow[] {
  return customers
    .filter((c) => (c.outstandingBalance ?? 0) > 0)
    .sort((a, b) => (b.outstandingBalance ?? 0) - (a.outstandingBalance ?? 0))
    .slice(0, n)
    .map((c) => ({ id: c.id, name: c.name, outstanding: c.outstandingBalance ?? 0 }));
}
