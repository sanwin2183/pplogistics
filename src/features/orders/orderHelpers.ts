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

// ----------- Flyer-quantity helpers (per-item per-flyer splits) -----------
//
// Each item's flyer-side quantity is allocated PER FLYER via
// `item.flyerSplits` (added 2026-06-09). A flyer's portion of an item is
// `flyerSplits.find(flyerId)?.weightKg` (or pieceCount). The customer
// quantity (top-level `weightKg` / `pieceCount`) is independent — splits
// do NOT have to sum to it.
//
// LEGACY FALLBACK (the single most important invariant here): when
// `flyerSplits` is ABSENT, the accessor returns the SAME number
// regardless of `flyerId` — it reads the deprecated single
// `flyerWeightKg` / `flyerPieceCount`, then the customer quantity. This
// preserves the pre-2026-06-09 whole-order behaviour for legacy data:
//   - single-flyer legacy order → correct (one flyer, one quantity)
//   - multi-flyer legacy order  → retains its documented over-count
//     (each flyer reads the full order quantity). Frozen historical
//     data; deliberately NOT auto-migrated.
//
// IMPORTANT: per-piece items always contribute 0 to flyer-kg, and per-kg
// items contribute 0 to flyer-pieces — enforced by the mode guards below
// regardless of any (mis-)set split value.

/**
 * This flyer's flyer-side weight for one item. Used for:
 *   - flyer.kgUsed deltas (via assignment.flyerWeightKg denorm)
 *   - per-kg payout math (category kg × ratePerKg)
 *   - the form's per-flyer capacity-left hint
 *
 * For per-piece items returns 0 — they don't consume capacity.
 */
export function getFlyerWeightKg(item: OrderItem, flyerId: string): number {
  if (isPerPieceItem(item)) return 0;
  if (item.flyerSplits) {
    return Number(item.flyerSplits.find((s) => s.flyerId === flyerId)?.weightKg) || 0;
  }
  // LEGACY fallback — same number for every flyerId (see header note).
  return Number(item.flyerWeightKg ?? item.weightKg) || 0;
}

/**
 * This flyer's flyer-side piece count for one item. Used for per-piece
 * payout math (pieceCount × flyerRatePerPiece). For per-kg items
 * returns 0 — they have no piece concept.
 */
export function getFlyerPieceCount(item: OrderItem, flyerId: string): number {
  if (!isPerPieceItem(item)) return 0;
  if (item.flyerSplits) {
    return Number(item.flyerSplits.find((s) => s.flyerId === flyerId)?.pieceCount) || 0;
  }
  // LEGACY fallback — same number for every flyerId (see header note).
  return Number(item.flyerPieceCount ?? item.pieceCount) || 0;
}

/**
 * This flyer's per-piece flyer rate (฿/piece) for one item — the
 * per-flyer analog of assignment.categoryRates on the per-kg side, so
 * flyer A and flyer B can be paid different rates for the same item.
 * Used for per-piece payout math (pieceCount × ratePerPiece).
 *
 * Single fallback chokepoint: the matching flyerSplits entry's
 * `ratePerPiece` wins; absent (legacy / single-flyer orders, or a split
 * entry that predates the per-flyer rate) ⇒ the deprecated order-global
 * `item.flyerRatePerPiece`. For per-kg items returns 0 (no piece rate).
 * Number(...) || 0 guards the raw-string values RHF holds while editing.
 */
export function getFlyerPieceRate(item: OrderItem, flyerId: string): number {
  if (!isPerPieceItem(item)) return 0;
  if (item.flyerSplits) {
    const s = item.flyerSplits.find((s) => s.flyerId === flyerId);
    // Per-flyer rate wins; fall back to the legacy item-level rate.
    return Number(s?.ratePerPiece ?? item.flyerRatePerPiece) || 0;
  }
  return Number(item.flyerRatePerPiece) || 0;
}

/** Σ a single flyer's flyer-side kg across all items. Capacity-tracking
 *  equivalent of calcTotalWeight scoped to one flyer; per-piece items
 *  naturally contribute 0. */
export function calcTotalFlyerWeight(items: OrderItem[], flyerId: string): number {
  return items.reduce((s, it) => s + getFlyerWeightKg(it, flyerId), 0);
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
 * Parallel to groupItemsByCategory but sums ONE FLYER'S flyer-side kg
 * per category (via getFlyerWeightKg(it, flyerId)). This is the function
 * flyer-payout math + the flyer-facing per-category breakdown displays
 * should read — never groupItemsByCategory. Pass the assignment's
 * flyerId so each flyer's breakdown reflects only their own portion.
 *
 * Same exclusion rules: items without a categoryId or in per-piece
 * mode are skipped. The two helpers stay byte-for-byte parallel except
 * for the kg source so they're easy to keep in sync.
 */
export function groupItemsByCategoryFlyerKg(
  items: OrderItem[],
  flyerId: string,
): Array<{ categoryId: string; categoryName: string; weightKg: number }> {
  const byId = new Map<string, { categoryId: string; categoryName: string; weightKg: number }>();
  for (const it of items) {
    if (!it.categoryId) continue;
    if (isPerPieceItem(it)) continue;
    const kg = getFlyerWeightKg(it, flyerId);
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
 * Per-piece side:
 *   sum over (per-piece items) of THIS FLYER'S pieceCount × THIS
 *   FLYER'S ฿/piece — getFlyerPieceCount × getFlyerPieceRate, both
 *   scoped to assignment.flyerId (per-flyer rate added 2026-06-10 on
 *   flyerSplits[].ratePerPiece; legacy / single-flyer orders fall back
 *   to the order-global item.flyerRatePerPiece inside getFlyerPieceRate).
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

  // Per-kg side — categoryRates × THIS FLYER'S kg per category. Scoped
  // to assignment.flyerId via groupItemsByCategoryFlyerKg so each flyer
  // is paid only on their own split portion (per-item per-flyer split,
  // 2026-06-09). Orders with no flyerSplits fall through to the legacy
  // single-quantity fallback inside getFlyerWeightKg. The caller
  // signature is unchanged — flyerId comes from the assignment itself.
  if (assignment.categoryRates && assignment.categoryRates.length > 0) {
    const groups = groupItemsByCategoryFlyerKg(items, assignment.flyerId);
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
  // THIS FLYER'S pieces × THIS FLYER'S rate
  // (getFlyerPieceCount / getFlyerPieceRate, both scoped to
  // assignment.flyerId; each falls back to the legacy item-level value).
  for (const it of items) {
    if (isPerPieceItem(it)) {
      total += getFlyerPieceCount(it, assignment.flyerId) * getFlyerPieceRate(it, assignment.flyerId);
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
