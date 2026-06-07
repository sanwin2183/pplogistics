import Papa from 'papaparse';
import dayjs from 'dayjs';
import { toDate } from '../../lib/formatters';
import { getFlyerPieceCount, getFlyerWeightKg } from '../orders/orderHelpers';
import type {
  Order,
  Customer,
  Expense,
  Flyer,
  OrderStatus,
  StatusHistoryEntry,
  FlyerAssignment,
} from '../../types';

/**
 * Flat-CSV exporters for the Settings → Export tab.
 *
 * Conventions:
 *   - Each function returns a CSV STRING with a UTF-8 BOM prepended
 *     (`﻿` — required for Excel to read Thai/Burmese characters
 *     correctly when the file is double-clicked).
 *   - Dates rendered as ISO 8601 minute precision: "YYYY-MM-DD HH:mm".
 *   - Numbers stay raw — no currency symbol, no thousand separator
 *     ("formatting belongs in Excel"). Empty / null cells become an
 *     empty string (NOT "undefined" or "null").
 *   - Multi-valued columns (multiple flyers per order, item list)
 *     joined with " | " — readable in Excel and trivially splittable.
 *   - Lookups built ONCE per export call (Map by id), then rows are
 *     enriched in O(1) — never N+1.
 *
 * All exports are pure with no side effects: caller passes in arrays
 * already fetched (typically via the existing useOrders /
 * useCustomers / useExpenses / useFlyers hooks).
 */

const BOM = '﻿';
const MULTI_SEP = ' | ';

/** ISO 8601 minute precision, blank for missing dates. */
function fmtIso(d: unknown): string {
  const date = toDate(d);
  return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '';
}

/** Date-only variant, used for filter inputs / "expenses on a given day". */
function fmtIsoDate(d: unknown): string {
  const date = toDate(d);
  return date ? dayjs(date).format('YYYY-MM-DD') : '';
}

/** Number rendered as a plain string for the CSV cell. NaN/0/undefined → ''. */
function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '';
  return String(n);
}

/** Convert a date range filter (in YYYY-MM-DD strings) into a predicate
 *  on a Firestore timestamp / Date value. Either end can be empty. */
function buildDateRangeFilter(
  startStr: string,
  endStr: string,
): (raw: unknown) => boolean {
  const start = startStr ? dayjs(startStr).startOf('day') : null;
  // End is INCLUSIVE in the UI ("up to and including this date"), so we
  // bump it to the next day's midnight for the comparison.
  const end = endStr ? dayjs(endStr).add(1, 'day').startOf('day') : null;
  return (raw: unknown) => {
    const d = toDate(raw);
    if (!d) return false;
    const m = dayjs(d);
    if (start && m.isBefore(start)) return false;
    if (end && !m.isBefore(end)) return false;
    return true;
  };
}

/** Find a StatusHistoryEntry by its `status` value (first occurrence). */
function firstHistoryTimestamp(
  history: StatusHistoryEntry[] | undefined,
  status: OrderStatus,
): unknown {
  if (!history) return null;
  for (const h of history) if (h.status === status) return h.timestamp;
  return null;
}

/** Derive a human-readable payment proof status from the order. */
function proofStatus(o: Order): string {
  if (o.status === 'paid') {
    if (o.paymentProof) return 'approved';
    return 'marked_paid_external';
  }
  if (o.paymentProof) return 'submitted_pending_review';
  return 'none';
}

/** Derive payout status across the order's assignments. */
function orderPayoutStatus(assignments: FlyerAssignment[]): string {
  if (!assignments.length) return '';
  const paid = assignments.filter((a) => a.paidOutAt).length;
  if (paid === 0) return 'unpaid';
  if (paid === assignments.length) return 'paid';
  return 'partial';
}

/**
 * Serialise an array of OrderItems into a single readable cell.
 *
 * Mode-aware (added 2026-05-29):
 *   per_kg    → "{desc} ({kg}kg @ {ratePerKg} THB/kg = {subtotal})"
 *   per_piece → "{desc} ({count} pcs @ {ratePerPiece} THB/pc = {subtotal})"
 *
 * Legacy items with absent pricingMode read as per_kg via the helper.
 * subtotal is trusted stored money for both modes — no recomputation.
 */
function summariseItems(items: Order['items']): string {
  return items
    .map((it) => {
      if (it.pricingMode === 'per_piece') {
        return `${it.description} (${it.pieceCount ?? 0} pcs @ ${it.ratePerPiece ?? 0} THB/pc = ${it.subtotal})`;
      }
      return `${it.description} (${it.weightKg}kg @ ${it.ratePerKg} THB/kg = ${it.subtotal})`;
    })
    .join(MULTI_SEP);
}

// ─── ORDERS ─────────────────────────────────────────────────────────────

export interface OrdersExportOptions {
  /** Inclusive start date "YYYY-MM-DD"; empty = no lower bound. */
  startDate: string;
  /** Inclusive end date "YYYY-MM-DD"; empty = no upper bound. */
  endDate: string;
  /** Empty / 'all' = all statuses. */
  status: OrderStatus | 'all' | '';
}

export function ordersToCsv(
  orders: Order[],
  customers: Customer[],
  // flyers + expenses available but not currently joined into the orders rows.
  // Reserved here so the call sites pass a consistent argument shape and a
  // future iteration that adds e.g. customer email / flyer route doesn't
  // require updating every callsite.
  _flyers: Flyer[],
  opts: OrdersExportOptions,
): string {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const inRange = buildDateRangeFilter(opts.startDate, opts.endDate);

  const filtered = orders.filter((o) => {
    if (!inRange(o.createdAt)) return false;
    if (opts.status && opts.status !== 'all' && o.status !== opts.status) return false;
    return true;
  });

  const rows = filtered.map((o) => {
    const customer = customerById.get(o.customerId);
    const flyerNames = o.flyerAssignments.map((a) => a.flyerName).join(MULTI_SEP);
    const flyerPayoutAmounts = o.flyerAssignments
      .map((a) => String(a.payoutAmount))
      .join(MULTI_SEP);
    return {
      order_id: o.id,
      order_number: o.orderNumber,
      status: o.status,
      created_at: fmtIso(o.createdAt),
      received_at: fmtIso(firstHistoryTimestamp(o.statusHistory, 'received')),
      paid_at: fmtIso(o.paymentApprovedAt),
      customer_id: o.customerId,
      customer_name: o.customerName,
      customer_phone: o.customerPhone,
      // Customer schema doesn't store an address; column kept for the
      // user's requested shape so a future Customer.address field would
      // populate automatically.
      customer_address: '',
      customer_type: customer?.type ?? '',
      customer_telegram: customer?.telegram ?? '',
      items_summary: summariseItems(o.items),
      weight_kg: fmtNum(o.totalWeightKg),
      total_thb: fmtNum(o.totalAmount),
      total_payout_thb: fmtNum(o.totalPayout),
      profit_thb: fmtNum(o.profit),
      // No specific "method" is tracked beyond paidVia (proof / external).
      payment_method: o.paidVia ?? '',
      payment_proof_status: proofStatus(o),
      flyer_names: flyerNames,
      flyer_payout_amounts: flyerPayoutAmounts,
      payout_status: orderPayoutStatus(o.flyerAssignments),
      tracking_slug: o.trackingSlug,
      notes: o.notes ?? '',
    };
  });

  return BOM + Papa.unparse(rows, { newline: '\r\n' });
}

// ─── CUSTOMERS ──────────────────────────────────────────────────────────

export function customersToCsv(customers: Customer[], orders: Order[]): string {
  // Compute first / last paid-order dates per customer in one pass.
  // (We use createdAt as the "order date" — that's how the dashboard /
  // tracking page report orders too.)
  const firstByCustomer = new Map<string, Date>();
  const lastByCustomer = new Map<string, Date>();
  for (const o of orders) {
    const d = toDate(o.createdAt);
    if (!d) continue;
    const f = firstByCustomer.get(o.customerId);
    if (!f || d < f) firstByCustomer.set(o.customerId, d);
    const l = lastByCustomer.get(o.customerId);
    if (!l || d > l) lastByCustomer.set(o.customerId, d);
  }

  const rows = customers.map((c) => ({
    customer_id: c.id,
    name: c.name,
    phone: c.phone,
    // No address field on the customer schema — column kept blank for
    // forward-compat; see note in ordersToCsv.
    address: '',
    telegram: c.telegram ?? '',
    type: c.type,
    notes: c.notes ?? '',
    total_orders: fmtNum(c.totalOrders),
    total_spent_thb: fmtNum(c.totalSpent),
    outstanding_balance_thb: fmtNum(c.outstandingBalance),
    first_order_date: fmtIsoDate(firstByCustomer.get(c.id)),
    last_order_date: fmtIsoDate(lastByCustomer.get(c.id)),
    customer_created_at: fmtIso(c.createdAt),
  }));

  return BOM + Papa.unparse(rows, { newline: '\r\n' });
}

// ─── EXPENSES ───────────────────────────────────────────────────────────

export interface ExpensesExportOptions {
  startDate: string;
  endDate: string;
}

export function expensesToCsv(expenses: Expense[], opts: ExpensesExportOptions): string {
  const inRange = buildDateRangeFilter(opts.startDate, opts.endDate);
  const filtered = expenses.filter((e) => inRange(e.date));

  const rows = filtered.map((e) => ({
    expense_id: e.id,
    date: fmtIsoDate(e.date),
    // categoryName is denormalised on the expense doc at write time —
    // surviving the expenseCategory being renamed or deleted later.
    category_name: e.categoryName,
    category_id: e.categoryId,
    amount_thb: fmtNum(e.amount),
    note: e.note ?? '',
    created_at: fmtIso(e.createdAt),
  }));

  return BOM + Papa.unparse(rows, { newline: '\r\n' });
}

// ─── FLYER PAYOUTS ──────────────────────────────────────────────────────

/**
 * One row per flyerAssignment across all orders. The "payout" entity
 * doesn't exist as its own collection in the schema — assignments live
 * on the order — so we synthesise a payout_id as `<orderId>:<flyerId>`
 * which is stable + unique per row.
 */
export function flyerPayoutsToCsv(orders: Order[], flyers: Flyer[]): string {
  const flyerById = new Map(flyers.map((f) => [f.id, f]));

  const rows: Record<string, string>[] = [];
  for (const o of orders) {
    for (const a of o.flyerAssignments) {
      const flyer = flyerById.get(a.flyerId);
      // Rate-shape distinction so legacy + new assignments coexist in one CSV:
      //   LEGACY (`categoryRates` absent/empty): `payout_rate_per_kg` carries
      //     the single flat rate. New rate-effective + breakdown columns blank.
      //   NEW (`categoryRates` populated): per-category rates can differ, so a
      //     single "rate" doesn't exist. `payout_rate_per_kg_effective` holds
      //     the blended rate (payoutAmount / weightKg) — what the flyer earned
      //     per kg averaged across categories. `category_rate_breakdown` is the
      //     per-category detail string `<categoryName>:<kg>kg@<rate>` joined
      //     with " | " for spreadsheet-side splitting.
      //
      // PER-PIECE (2026-05-29) + FLYER-QTY SPLIT (2026-06-07): every
      // payout figure on THIS row uses flyer-side quantities. The
      // assignment is a payout — what the FLYER was paid on, not what
      // the customer was billed. Customer-side aggregates live on
      // ordersToCsv instead.
      //
      // weight_kg                       → assignment's flyer total
      //                                  (a.flyerWeightKg ?? a.weightKg)
      // payout_rate_per_kg_effective    → payoutAmount / flyerWeight
      //                                  ("฿ paid per kg actually flown")
      // category_rate_breakdown         → per-category kg uses
      //                                  getFlyerWeightKg(it)
      // piece_rate_breakdown            → per-piece count uses
      //                                  getFlyerPieceCount(it)
      // amount_thb                      → unchanged (assignment.payoutAmount
      //                                  was written at submit with both
      //                                  per-kg + per-piece contributions
      //                                  on FLYER quantities)
      //
      // Effective-rate divide-by-zero guard: piece-only assignments
      // have flyerWeight=0 → blank instead of Inf/NaN. Also blank when
      // categoryRates is absent (legacy single-rate column carries the
      // rate directly).
      const hasCategoryRates = !!a.categoryRates && a.categoryRates.length > 0;
      const flyerWeightKg = a.flyerWeightKg ?? a.weightKg;
      const effectiveRate =
        hasCategoryRates && flyerWeightKg > 0
          ? +(a.payoutAmount / flyerWeightKg).toFixed(2)
          : null;
      const categoryBreakdown = hasCategoryRates
        ? a.categoryRates!
            .map((cr) => {
              const kg = o.items
                .filter((it) => it.categoryId === cr.categoryId && it.pricingMode !== 'per_piece')
                .reduce((s, it) => s + getFlyerWeightKg(it), 0);
              const name =
                o.items.find((it) => it.categoryId === cr.categoryId)?.categoryName ?? cr.categoryId;
              return `${name}:${kg}kg@${cr.ratePerKg}`;
            })
            .join(MULTI_SEP)
        : '';
      const pieceBreakdown = o.items
        .filter((it) => it.pricingMode === 'per_piece')
        .map((it) => {
          const name = it.description || it.categoryName;
          return `${name}:${getFlyerPieceCount(it)}pcs@${it.flyerRatePerPiece ?? 0}`;
        })
        .join(MULTI_SEP);
      rows.push({
        payout_id: `${o.id}:${a.flyerId}`,
        flyer_id: a.flyerId,
        flyer_name: a.flyerName,
        flyer_phone: flyer?.phone ?? '',
        flyer_route: flyer?.route ?? '',
        order_id: o.id,
        order_number: o.orderNumber,
        order_status: o.status,
        order_created_at: fmtIso(o.createdAt),
        weight_kg: fmtNum(flyerWeightKg),
        payout_rate_per_kg: hasCategoryRates ? '' : fmtNum(a.payoutRatePerKg ?? null),
        payout_rate_per_kg_effective: effectiveRate == null ? '' : fmtNum(effectiveRate),
        category_rate_breakdown: categoryBreakdown,
        piece_rate_breakdown: pieceBreakdown,
        amount_thb: fmtNum(a.payoutAmount),
        paid_at: fmtIso(a.paidOutAt),
        status: a.paidOutAt ? 'paid' : 'owed',
      });
    }
  }

  return BOM + Papa.unparse(rows, { newline: '\r\n' });
}

// ─── DOWNLOAD HELPERS ───────────────────────────────────────────────────

/** Trigger a browser download of a string-as-file via Blob URL. */
export function downloadCsv(csv: string, filename: string): void {
  // text/csv; charset=utf-8 + the BOM together = Excel reads Thai/Burmese
  // glyphs correctly on double-click. Without either Excel sometimes
  // mojibakes the text.
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick before revoking; some Safari builds otherwise
  // revoke before the download stream actually begins.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Date stamp for filenames, e.g. "2026-05-29". */
export function todayStamp(): string {
  return dayjs().format('YYYY-MM-DD');
}
