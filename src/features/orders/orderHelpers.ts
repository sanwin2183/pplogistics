import type { Order, OrderItem, FlyerAssignment, ItemPricingMode } from '../../types';

/**
 * The effective pricing mode for an item. Legacy items pre-dating the
 * per-piece rollout have no `pricingMode` field — they read as 'per_kg'.
 * Every mode-aware code path goes through this helper so the default is
 * applied in exactly one place.
 */
export function getItemPricingMode(item: OrderItem): ItemPricingMode {
  return item.pricingMode === 'per_piece' ? 'per_piece' : 'per_kg';
}

export function isPerPieceItem(item: OrderItem): boolean {
  return getItemPricingMode(item) === 'per_piece';
}

export function isPerKgItem(item: OrderItem): boolean {
  return getItemPricingMode(item) === 'per_kg';
}

/**
 * Customer-side subtotal for one item. Per-kg: weightKg × ratePerKg.
 * Per-piece: pieceCount × ratePerPiece. Used by the form at edit time
 * to keep the live subtotal in sync with input changes; storage uses
 * the canonical stored `subtotal` set on submit.
 */
export function calcItemSubtotal(item: OrderItem): number {
  if (isPerPieceItem(item)) {
    return (item.pieceCount ?? 0) * (item.ratePerPiece ?? 0);
  }
  return (item.weightKg ?? 0) * (item.ratePerKg ?? 0);
}

/** Sum item subtotals — trusts the stored value (canonical accounting). */
export function calcTotalAmount(items: OrderItem[]): number {
  return items.reduce((s, it) => s + (it.subtotal || 0), 0);
}

/**
 * Sum item CUSTOMER weights. Per-piece items contribute 0 (weightKg
 * is 0 on those by design). NOTE: this is the customer-side total
 * used for billing / receipts. For flyer capacity (flyer.kgUsed) use
 * calcTotalFlyerWeight() instead — the two values may differ when
 * an item's flyerWeightKg overrides its customer weight.
 */
export function calcTotalWeight(items: OrderItem[]): number {
  return items.reduce((s, it) => s + (it.weightKg || 0), 0);
}

// ---------------- Flyer-quantity helpers (added 2026-06-07) ----------------
//
// Each item carries TWO quantities post-split: the customer-side
// (`weightKg` or `pieceCount`, what the customer was billed for) and
// the flyer-side (`flyerWeightKg` or `flyerPieceCount`, what the flyer
// actually carries and is paid on). The latter is OPTIONAL with a
// fallback to the former — blank means "same as customer", so most
// orders carry no override.
//
// IMPORTANT: per-piece items always contribute 0 to flyer-kg
// regardless of any (mis-)set flyerWeightKg — capacity tracking
// excludes per-piece items by design. The mode guard inside
// getFlyerWeightKg enforces this defensively. Same idea on the piece
// side: getFlyerPieceCount returns 0 for per-kg items.

/**
 * Effective flyer-side weight for one item. Used for:
 *   - flyer.kgUsed deltas (via assignment.flyerWeightKg denorm)
 *   - per-kg payout math (category kg × ratePerKg)
 *   - the form's capacity-left hint
 *
 * For per-piece items returns 0 — they don't consume capacity.
 */
export function getFlyerWeightKg(item: OrderItem): number {
  if (isPerPieceItem(item)) return 0;
  return item.flyerWeightKg ?? item.weightKg ?? 0;
}

/**
 * Effective flyer-side piece count for one item. Used for per-piece
 * payout math (pieceCount × flyerRatePerPiece). For per-kg items
 * returns 0 — they have no piece concept.
 */
export function getFlyerPieceCount(item: OrderItem): number {
  if (!isPerPieceItem(item)) return 0;
  return item.flyerPieceCount ?? item.pieceCount ?? 0;
}

/** Σ flyer-side kg across all items. Capacity-tracking equivalent of
 *  calcTotalWeight; per-piece items naturally contribute 0. */
export function calcTotalFlyerWeight(items: OrderItem[]): number {
  return items.reduce((s, it) => s + getFlyerWeightKg(it), 0);
}

/**
 * Group an order's PER-KG items by category using the CUSTOMER weight.
 * Per-piece items have no category-level kg-rate concept (the flyer
 * rate lives on the item itself), so they're excluded from this
 * grouping. Per-category subtotal is `kg × ratePerKg`, which is the
 * customer-side category breakdown — used by customer-facing displays
 * (Invoice/Receipt don't currently call this directly; the form's
 * items section / OrderDetail customer-side renderers do).
 *
 * DO NOT use this for flyer payout math. The 2026-06-07 flyer-qty
 * split adds groupItemsByCategoryFlyerKg below for that — pointing the
 * wrong consumer at this function silently bills the flyer on customer
 * weight again.
 */
export function groupItemsByCategory(
  items: OrderItem[],
): Array<{ categoryId: string; categoryName: string; weightKg: number }> {
  const byId = new Map<string, { categoryId: string; categoryName: string; weightKg: number }>();
  for (const it of items) {
    if (!it.categoryId) continue;
    if (isPerPieceItem(it)) continue; // per-piece items don't participate in category rates
    const existing = byId.get(it.categoryId);
    if (existing) {
      existing.weightKg += it.weightKg || 0;
    } else {
      byId.set(it.categoryId, {
        categoryId: it.categoryId,
        categoryName: it.categoryName,
        weightKg: it.weightKg || 0,
      });
    }
  }
  return Array.from(byId.values());
}

/**
 * Parallel to groupItemsByCategory but sums FLYER-side kg per category
 * (via getFlyerWeightKg). This is the function flyer-payout math + the
 * flyer-facing per-category breakdown displays should read — never
 * groupItemsByCategory.
 *
 * Same exclusion rules: items without a categoryId or in per-piece
 * mode are skipped. The two helpers stay byte-for-byte parallel except
 * for the kg source so they're easy to keep in sync.
 */
export function groupItemsByCategoryFlyerKg(
  items: OrderItem[],
): Array<{ categoryId: string; categoryName: string; weightKg: number }> {
  const byId = new Map<string, { categoryId: string; categoryName: string; weightKg: number }>();
  for (const it of items) {
    if (!it.categoryId) continue;
    if (isPerPieceItem(it)) continue;
    const kg = getFlyerWeightKg(it);
    const existing = byId.get(it.categoryId);
    if (existing) {
      existing.weightKg += kg;
    } else {
      byId.set(it.categoryId, {
        categoryId: it.categoryId,
        categoryName: it.categoryName,
        weightKg: kg,
      });
    }
  }
  return Array.from(byId.values());
}

/**
 * Compute the payout for one assignment given the order's items.
 *
 * Per-kg side (one of):
 *   New: sum over (assignment.categoryRates) of
 *     (sum of per-kg items' weightKg for that categoryId) × rate.
 *   Legacy: assignment.weightKg × assignment.payoutRatePerKg.
 *
 * Per-piece side (new, added 2026-05-29):
 *   sum over (per-piece items) of pieceCount × flyerRatePerPiece.
 *   Each per-piece item carries its OWN flyer rate
 *   (`item.flyerRatePerPiece`) — not the assignment's. Multi-flyer
 *   orders share one rate per item across assignments by design;
 *   accept the same single-flyer-optimised trade-off the kg side
 *   already has for splits.
 *
 * Returns the stored `payoutAmount` ONLY when neither per-kg shape
 * resolves AND no per-piece items exist. Defensive against future
 * schema drift; doesn't trigger in practice for currently-creatable
 * orders.
 */
export function calcAssignmentPayout(
  assignment: FlyerAssignment,
  items: OrderItem[],
): number {
  let total = 0;

  // Per-kg side — categoryRates × FLYER kg per category.
  // 2026-06-07 split: switched from groupItemsByCategory (customer kg)
  // to groupItemsByCategoryFlyerKg (flyer kg) so payout reflects what
  // the flyer actually flew. Orders with no flyerWeightKg overrides
  // fall through to customer weight (via getFlyerWeightKg).
  if (assignment.categoryRates && assignment.categoryRates.length > 0) {
    const groups = groupItemsByCategoryFlyerKg(items);
    const kgByCategoryId = new Map(groups.map((g) => [g.categoryId, g.weightKg]));
    total += assignment.categoryRates.reduce(
      (s, cr) => s + (kgByCategoryId.get(cr.categoryId) ?? 0) * (cr.ratePerKg || 0),
      0,
    );
  } else if (typeof assignment.payoutRatePerKg === 'number') {
    // Legacy path — pre-2026-05-29 orders had a single flat rate and
    // no per-item flyer-weight concept. Leave the math on
    // assignment.weightKg (customer total) for these; they predate
    // the split and never get the new field.
    total += (assignment.weightKg || 0) * assignment.payoutRatePerKg;
  }

  // Per-piece side — accrue every per-piece item's flyer payout, on
  // FLYER pieces (via getFlyerPieceCount, falls back to pieceCount).
  for (const it of items) {
    if (isPerPieceItem(it)) {
      total += getFlyerPieceCount(it) * (it.flyerRatePerPiece ?? 0);
    }
  }

  // Fallback to stored amount only when neither side contributed AND
  // the order has truly no recoverable signal. Legacy orders with
  // only kg items + only categoryRates pre-this-rollout hit total=0
  // here ONLY if the assignment's rates are zero, which is a valid
  // result (zero is zero), not a fallback condition. The stored
  // payoutAmount fallback only matters for assignments with neither
  // shape — vanishingly rare.
  if (total === 0 && !assignment.categoryRates?.length && assignment.payoutRatePerKg == null) {
    return assignment.payoutAmount || 0;
  }
  return total;
}

/** Sum flyer payout amounts. Reads the stored `payoutAmount` per assignment —
 *  always written by the form on save so this is the canonical accounting
 *  number, regardless of legacy/new shape. */
export function calcTotalPayout(assignments: FlyerAssignment[]): number {
  return assignments.reduce((s, a) => s + (a.payoutAmount || 0), 0);
}

/** Profit = revenue − payout. */
export function calcProfit(items: OrderItem[], assignments: FlyerAssignment[]): number {
  return calcTotalAmount(items) - calcTotalPayout(assignments);
}

/** Margin as a 0–1 fraction. Returns 0 if no revenue. */
export function calcMargin(items: OrderItem[], assignments: FlyerAssignment[]): number {
  const rev = calcTotalAmount(items);
  if (rev <= 0) return 0;
  return calcProfit(items, assignments) / rev;
}

/** Whether an order is "active" (not yet delivered or cancelled). */
export function isActiveOrder(o: Order): boolean {
  return !['paid', 'delivered'].includes(o.status);
}

/** Format a status as a friendly URL-safe slug. */
export function formatStatusLabel(s: string): string {
  return s.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
