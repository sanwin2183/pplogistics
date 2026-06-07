import dayjs, { type Dayjs } from 'dayjs';
import { toDate } from '../../lib/formatters';
import type { Expense, Order } from '../../types';

/**
 * Phase 2 of the dashboard rebuild — date-range scoping.
 *
 * Pure helpers around the user's selected range. Everything here is
 * stateless; the range itself lives in useDashboardPrefs (localStorage-
 * persisted). The DashboardPage computes bounds via getRangeBounds()
 * ONCE per render and feeds the resulting [start, end) window into
 *
 *   filterOrdersByRange(orders, bounds)
 *   filterExpensesByRange(expenses, bounds)
 *
 * and then passes the FILTERED arrays into Phase 1's aggregations
 * (which no longer take a windowStart — see aggregations.ts). Money
 * math is untouched; this layer ONLY decides which orders/expenses
 * feed the existing sums.
 */

export type DateRangeMode = 'lifetime' | 'this_month' | 'pick_month' | 'custom';

/**
 * Persisted form of the selected range. Strings (ISO YYYY-MM-DD /
 * YYYY-MM) so the value is trivially JSON-serializable for
 * localStorage and unambiguous about timezone (we treat all dates as
 * local-day boundaries).
 *
 * pickMonth / customFrom / customTo are kept around when the user
 * switches modes — flipping to Lifetime and back to Custom preserves
 * the dates they had typed. Matches the natural UX expectation.
 */
export interface SelectedRange {
  mode: DateRangeMode;
  /** YYYY-MM. Only consulted when mode === 'pick_month'. */
  pickMonth?: string;
  /** YYYY-MM-DD. Only consulted when mode === 'custom'. */
  customFrom?: string;
  /** YYYY-MM-DD. Only consulted when mode === 'custom'. */
  customTo?: string;
}

export const DEFAULT_RANGE: SelectedRange = { mode: 'this_month' };

/**
 * Resolved bounds for an aggregation pass.
 *
 *   start === null → no lower bound (open-ended; lifetime).
 *   end   === null → no upper bound (open-ended; lifetime).
 *   valid === false → the user picked Custom but the dates are bad
 *     (From > To, or one of them is missing). Aggregations should
 *     treat the dataset as empty in this case (show 0s + empty charts);
 *     the control surfaces the validation message inline.
 *
 * "Today" for "This month" is dayjs() at render time — captured here
 * so the same instant is used for every aggregation in one frame.
 */
export interface RangeBounds {
  start: Dayjs | null;
  end: Dayjs | null;
  valid: boolean;
  /** Optional human-readable validation message when valid === false. */
  invalidReason?: string;
}

/**
 * Resolve a SelectedRange + "now" into concrete bounds.
 *
 * Boundary semantics (matches the spec):
 *   Lifetime:    [-∞, +∞)
 *   This month:  [startOfMonth(now), now]                ← end clipped to now
 *   Pick month:  [startOfMonth(m), endOfMonth(m)]        ← inclusive whole month
 *   Custom:      [from 00:00:00.000, to 23:59:59.999]    ← inclusive
 *
 * "This month" ends at `now` (not endOfMonth) so the displayed period
 * total reflects what's actually known, not a future-projected month.
 * filtering uses end-inclusive comparison so an order created in this
 * exact millisecond still counts.
 */
export function getRangeBounds(range: SelectedRange, now: Dayjs = dayjs()): RangeBounds {
  switch (range.mode) {
    case 'lifetime':
      return { start: null, end: null, valid: true };
    case 'this_month':
      return { start: now.startOf('month'), end: now, valid: true };
    case 'pick_month': {
      const m = range.pickMonth ? dayjs(range.pickMonth + '-01') : null;
      if (!m || !m.isValid()) {
        return {
          start: null,
          end: null,
          valid: false,
          invalidReason: 'Pick a month.',
        };
      }
      return { start: m.startOf('month'), end: m.endOf('month'), valid: true };
    }
    case 'custom': {
      const f = range.customFrom ? dayjs(range.customFrom) : null;
      const t = range.customTo ? dayjs(range.customTo) : null;
      if (!f || !f.isValid() || !t || !t.isValid()) {
        return {
          start: null,
          end: null,
          valid: false,
          invalidReason: 'Pick both a From and a To date.',
        };
      }
      if (f.isAfter(t)) {
        return {
          start: null,
          end: null,
          valid: false,
          invalidReason: 'From must be on or before To.',
        };
      }
      return { start: f.startOf('day'), end: t.endOf('day'), valid: true };
    }
  }
}

/** Inclusive-on-both-ends check against the bounds. Null bound = open. */
function withinBounds(when: Date | null, bounds: RangeBounds): boolean {
  if (!when) return false;
  const d = dayjs(when);
  if (bounds.start && d.isBefore(bounds.start)) return false;
  if (bounds.end && d.isAfter(bounds.end)) return false;
  return true;
}

/**
 * Filter orders by createdAt against the resolved bounds. Caller
 * SHOULD short-circuit on `!bounds.valid` (Custom with bad dates) and
 * pass an empty array to aggregations — this function would also
 * return [] in that case since no Date is within an invalid range,
 * but the explicit guard is clearer at the call site and avoids
 * needlessly walking the orders array.
 */
export function filterOrdersByRange(orders: Order[], bounds: RangeBounds): Order[] {
  if (!bounds.valid) return [];
  if (!bounds.start && !bounds.end) return orders; // lifetime — no filter
  return orders.filter((o) => withinBounds(toDate(o.createdAt), bounds));
}

/** Same shape as filterOrdersByRange, but against expense.date. */
export function filterExpensesByRange(expenses: Expense[], bounds: RangeBounds): Expense[] {
  if (!bounds.valid) return [];
  if (!bounds.start && !bounds.end) return expenses;
  return expenses.filter((e) => withinBounds(toDate(e.date), bounds));
}

// ---------- Labels ----------

/**
 * Short human label for the current range — used in card titles
 * ("Revenue · this month" / "Revenue · March 2026" / "Revenue · all
 * time") so the owner can never misread last-period numbers as
 * current-period numbers.
 *
 * Title-case-friendly: "this month" and "all time" are lowercase
 * because they appear after the · separator in card eyebrow strings
 * which use lowercase by convention; "March 2026" and the date range
 * keep their natural casing.
 */
export function rangeShortLabel(range: SelectedRange, bounds: RangeBounds): string {
  if (!bounds.valid) return '—';
  switch (range.mode) {
    case 'lifetime':
      return 'all time';
    case 'this_month':
      return 'this month';
    case 'pick_month':
      return bounds.start ? bounds.start.format('MMMM YYYY') : '—';
    case 'custom':
      return rangeShortDateSpan(bounds);
  }
}

/**
 * Long banner label for the prominent "Showing: …" header. Same
 * resolution as rangeShortLabel but capitalised / verbose so it reads
 * as a sentence fragment in a notice bar.
 */
export function rangeLongLabel(range: SelectedRange, bounds: RangeBounds): string {
  if (!bounds.valid) {
    return bounds.invalidReason ?? 'Invalid range.';
  }
  switch (range.mode) {
    case 'lifetime':
      return 'All time';
    case 'this_month':
      return `${dayjs().format('MMMM YYYY')} (this month, to date)`;
    case 'pick_month':
      return bounds.start ? bounds.start.format('MMMM YYYY') : '—';
    case 'custom':
      return rangeShortDateSpan(bounds);
  }
}

function rangeShortDateSpan(bounds: RangeBounds): string {
  if (!bounds.start || !bounds.end) return '—';
  // "1–15 Apr 2026" when same month; "28 Mar – 4 Apr 2026" when crossing
  // a month boundary; full "1 Jan 2025 – 31 Dec 2026" across years.
  const s = bounds.start;
  const e = bounds.end;
  if (s.isSame(e, 'day')) return s.format('D MMM YYYY');
  if (s.isSame(e, 'month')) return `${s.format('D')}–${e.format('D MMM YYYY')}`;
  if (s.isSame(e, 'year')) return `${s.format('D MMM')} – ${e.format('D MMM YYYY')}`;
  return `${s.format('D MMM YYYY')} – ${e.format('D MMM YYYY')}`;
}

// ---------- Chart bucketing ----------

export type Granularity = 'day' | 'month';

/**
 * Pick the right bucket size for a time-series chart given the span
 * implied by the resolved bounds.
 *
 *   ≤ 31 days  → 'day'   (one bar/point per day, readable up to ~Jul)
 *   > 31 days  → 'month' (one per month — daily would crowd into noise)
 *
 * For Lifetime (no upper bound, no lower bound), we fall back to
 * 'month' because the chart will plot months from the earliest order
 * to now.
 *
 * For invalid Custom we return 'day' (the empty array will render an
 * empty chart anyway).
 */
export function pickGranularity(bounds: RangeBounds): Granularity {
  if (!bounds.valid) return 'day';
  if (!bounds.start || !bounds.end) return 'month';
  const days = bounds.end.diff(bounds.start, 'day') + 1;
  return days <= 31 ? 'day' : 'month';
}

/**
 * Resolve the effective [chartStart, chartEnd] window for a time-
 * series chart. For Lifetime we derive the start from the earliest
 * data point so the chart isn't full of empty months from before any
 * orders existed; if there's no data, default to a sensible window
 * ending now.
 */
export function chartWindowForBounds(
  bounds: RangeBounds,
  granularity: Granularity,
  earliestDataDate: Date | null,
  now: Dayjs = dayjs(),
): { start: Dayjs; end: Dayjs } {
  if (bounds.start && bounds.end) {
    return { start: bounds.start, end: bounds.end };
  }
  // Lifetime — derive from data, or fall back to a 12-month window.
  const earliest = earliestDataDate ? dayjs(earliestDataDate) : now.subtract(12, 'month');
  const start =
    granularity === 'month' ? earliest.startOf('month') : earliest.startOf('day');
  return { start, end: now };
}

/** A single bucket descriptor — `key` matches what bucketKeyFor emits. */
export interface BucketDesc {
  key: string;
  label: string;
  /** The Dayjs anchor for this bucket (start-of-day or start-of-month). */
  date: Dayjs;
}

/**
 * Build the ordered bucket list for a chart spanning [start, end] at
 * the given granularity. Each bucket is one day or one month; the
 * label format matches the axis density (e.g. "5 Jun" vs "Jun 2026").
 */
export function buildBuckets(
  start: Dayjs,
  end: Dayjs,
  granularity: Granularity,
): BucketDesc[] {
  const out: BucketDesc[] = [];
  const unit: 'day' | 'month' = granularity;
  let cursor = start.startOf(unit);
  const stop = end.startOf(unit);
  // Cap at 400 buckets defensively — at 'day' that's >1y; at 'month'
  // that's >33y. Prevents a typo-ed custom range from hanging the UI.
  let safety = 0;
  while (!cursor.isAfter(stop) && safety < 400) {
    out.push({
      key: granularity === 'day' ? cursor.format('YYYY-MM-DD') : cursor.format('YYYY-MM'),
      label:
        granularity === 'day' ? cursor.format('D MMM') : cursor.format('MMM YYYY'),
      date: cursor,
    });
    cursor = cursor.add(1, unit);
    safety += 1;
  }
  return out;
}

/** Bucket key for a single Date — same shape as buildBuckets keys. */
export function bucketKeyFor(d: Date, granularity: Granularity): string {
  return granularity === 'day'
    ? dayjs(d).format('YYYY-MM-DD')
    : dayjs(d).format('YYYY-MM');
}
