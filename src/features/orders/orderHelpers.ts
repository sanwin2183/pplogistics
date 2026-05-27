import type { Order, OrderItem, FlyerAssignment } from '../../types';

/** Sum item subtotals. */
export function calcTotalAmount(items: OrderItem[]): number {
  return items.reduce((s, it) => s + (it.subtotal || 0), 0);
}

/** Sum item weights. */
export function calcTotalWeight(items: OrderItem[]): number {
  return items.reduce((s, it) => s + (it.weightKg || 0), 0);
}

/** Sum flyer payout amounts. */
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
