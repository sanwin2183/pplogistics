import { forwardRef } from 'react';
import { Plane } from 'lucide-react';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import { getFlyerPieceCount, getFlyerPieceRate, getFlyerWeightKg, groupItemsByCategoryFlyerKg } from '../orders/orderHelpers';
import { findAssignmentsForFlyer } from './tripHelpers';
import type { BusinessInfo, Order, Route, FsTs } from '../../types';

/**
 * Off-screen .doc-page-a4 capture target for a trip's payout summary.
 *
 * Rendered into the DOM at opacity:0 / position:fixed off-screen (the
 * `.doc-page-a4` CSS class handles those defaults). useSaveDocAsImage
 * targets this node via ref. Same capture path as Invoice/Receipt — the
 * onclone callback neutralises `.truncate`, the canvas re-encode pass
 * normalises any <img>, html2canvas paints into a real canvas.
 *
 * Two states:
 *   UNPAID — title "Payout Confirmation" / subtitle "Please confirm before
 *     payment". This is what the owner shows the flyer at handover so both
 *     sides agree on the math before cash changes hands.
 *   PAID   — title "Payout Receipt" / subtitle "Paid on <date>". Same body,
 *     different header to acknowledge completion.
 *
 * Body (both states):
 *   - business branding (name + logo) top-left
 *   - flyer name + route + flight date
 *   - one ROW PER ORDER with per-category breakdown using the categoryRates
 *     shape shipped in the previous turn. Legacy (no categoryRates)
 *     assignments render the flat ratePerKg × weight line — same fallback
 *     as the order detail page.
 *   - grand total at the bottom (large)
 *   - generated-on footer
 */
interface TripPayoutSummaryProps {
  business: BusinessInfo;
  flyerName: string;
  route: Route;
  flightDate: FsTs;
  /** Orders to include in the summary — typically eligible orders for this
   *  trip; for paid receipt, the paid eligible orders; for unpaid
   *  confirmation, the unpaid eligible orders. The caller decides. */
  orders: Order[];
  /** Match-key for picking the assignment to summarise per order. */
  flyerId: string;
  /** Total ฿ shown big at the bottom. Caller passes the same number it
   *  uses elsewhere on the page so the image always matches the UI. */
  totalAmount: number;
  /** Header state. Drives title + subtitle. */
  mode: 'unpaid' | 'paid';
  /** Required when mode='paid': the date to render in the subtitle. */
  paidAt?: Date | null;
}

export const TripPayoutSummary = forwardRef<HTMLDivElement, TripPayoutSummaryProps>(
  function TripPayoutSummary(
    { business, flyerName, route, flightDate, orders, flyerId, totalAmount, mode, paidAt },
    ref,
  ) {
    const title = mode === 'paid' ? 'Payout Receipt' : 'Payout Confirmation';
    const subtitle =
      mode === 'paid'
        ? `Paid on ${paidAt ? fmtDate(paidAt) : '—'}`
        : 'Please confirm before payment';

    return (
      <div ref={ref} className="doc-page-a4 space-y-6" aria-hidden="true">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          {business.logoUrl ? (
            <img
              src={business.logoUrl}
              alt={business.name}
              crossOrigin="anonymous"
              className="h-10 max-w-[7rem] object-contain"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Plane className="h-5 w-5" />
            </div>
          )}
        </header>

        {/* Flyer / trip info */}
        <section className="grid grid-cols-2 gap-4">
          <div>
            <div className="h-eyebrow">Flyer</div>
            <div className="mt-1 text-sm font-medium">{flyerName}</div>
          </div>
          <div>
            <div className="h-eyebrow">Trip</div>
            <div className="mt-1 text-sm font-medium">{ROUTE_LABELS[route]}</div>
            <div className="text-xs text-muted-foreground">{fmtDateTime(flightDate)}</div>
          </div>
        </section>

        {/* Orders table */}
        <section>
          <div className="h-eyebrow mb-2">Orders</div>
          <div className="divide-y divide-border rounded-md border border-border">
            {orders.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No orders.</div>
            ) : (
              orders.map((o) => {
                const assignmentList = findAssignmentsForFlyer(o, flyerId);
                if (assignmentList.length === 0) return null;
                // THIS FLYER'S per-category breakdown (per-item per-flyer
                // split, 2026-06-09). This document is the flyer's payment
                // confirmation / receipt — it must NEVER show customer-side
                // weight, and on a split order it shows only this flyer's
                // portion (e.g. A's 20 kg, never B's 15 kg or the 35 kg
                // the customer was billed).
                const groups = groupItemsByCategoryFlyerKg(o.items, flyerId);

                // Combined order totals — FLYER kg for header + the
                // stored assignment.payoutAmount for money. Falls back
                // to a.weightKg for legacy assignments.
                const orderWeightKg = assignmentList.reduce(
                  (s, a) => s + (a.flyerWeightKg ?? a.weightKg ?? 0),
                  0,
                );
                const orderPayoutTotal = assignmentList.reduce(
                  (s, a) => s + (a.payoutAmount || 0),
                  0,
                );
                const perPieceItems = o.items.filter((it) => it.pricingMode === 'per_piece');
                return (
                  <div key={o.id} className="p-3 space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">#{o.orderNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {orderWeightKg > 0 ? `${fmtKg(orderWeightKg)} · ` : ''}
                          {fmtDate(o.createdAt)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums">{fmtMoney(orderPayoutTotal)}</div>
                    </div>

                    {/* Per-item list — what the flyer is carrying.
                        FLYER quantities only: per-kg shows
                        {getFlyerWeightKg(it)} kg; per-piece shows
                        {getFlyerPieceCount(it)} pcs. Customer-side
                        billed quantities are deliberately NOT shown —
                        this is the flyer's document. */}
                    {o.items.length > 0 && (
                      <ul className="space-y-0.5 pl-3 text-xs text-muted-foreground">
                        {o.items.map((it, idx) => {
                          const isPiece = it.pricingMode === 'per_piece';
                          return (
                            <li key={`${o.id}-item-${idx}`} className="list-disc list-inside">
                              <span className="tabular-nums">
                                {isPiece
                                  ? `${getFlyerPieceCount(it, flyerId)} pcs`
                                  : fmtKg(getFlyerWeightKg(it, flyerId))}
                              </span>
                              {' '}
                              <span>{it.categoryName}</span>
                              {it.description && (
                                <>
                                  {' '}
                                  <span className="italic">({it.description})</span>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Per-kg rate breakdown — one block per matching
                        assignment. Same as before. */}
                    <div className="space-y-1">
                      {assignmentList.map((a, ai) => {
                        const hasCategoryRates = !!a.categoryRates && a.categoryRates.length > 0;
                        if (hasCategoryRates) {
                          return (
                            <div
                              key={`${o.id}-asgn-${ai}`}
                              className="space-y-0.5 rounded-sm bg-muted/30 px-2 py-1.5"
                            >
                              {a.categoryRates!.map((cr) => {
                                const g = groups.find((x) => x.categoryId === cr.categoryId);
                                const kg = g?.weightKg ?? 0;
                                const name = g?.categoryName ?? cr.categoryId;
                                const subtotal = kg * cr.ratePerKg;
                                return (
                                  <div
                                    key={`${o.id}-asgn-${ai}-cr-${cr.categoryId}`}
                                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs"
                                  >
                                    <span className="text-muted-foreground">{name}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      {fmtKg(kg)} × {fmtMoney(cr.ratePerKg)}/kg
                                    </span>
                                    <span className="tabular-nums font-medium">{fmtMoney(subtotal)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        // Skip the legacy block entirely if the assignment
                        // has no per-kg rate signal AND no kg weight —
                        // happens when this order is piece-only and the
                        // assignment was created with categoryRates=[].
                        if ((a.weightKg ?? 0) === 0 && a.payoutRatePerKg == null) {
                          return null;
                        }
                        const subtotal = (a.weightKg || 0) * (a.payoutRatePerKg ?? 0);
                        return (
                          <div
                            key={`${o.id}-asgn-${ai}`}
                            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-sm bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground"
                          >
                            <span>(legacy rate)</span>
                            <span className="tabular-nums">
                              {fmtKg(a.weightKg)} × {fmtMoney(a.payoutRatePerKg ?? 0)}/kg
                            </span>
                            <span className="tabular-nums font-medium text-foreground">
                              {fmtMoney(subtotal)}
                            </span>
                          </div>
                        );
                      })}

                      {/* Per-piece breakdown — one row per per-piece
                          item. FLYER piece count × flyer rate. Customer
                          piece count is not surfaced here per the same
                          rule as the per-item bullet list above. */}
                      {perPieceItems.length > 0 && (
                        <div className="space-y-0.5 rounded-sm bg-muted/30 px-2 py-1.5">
                          {perPieceItems.map((it, pi) => {
                            const count = getFlyerPieceCount(it, flyerId);
                            const rate = getFlyerPieceRate(it, flyerId);
                            const subtotal = count * rate;
                            return (
                              <div
                                key={`${o.id}-pp-${pi}`}
                                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs"
                              >
                                <span className="text-muted-foreground">
                                  {it.description || it.categoryName}
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                  {count} pcs × {fmtMoney(rate)}/pc
                                </span>
                                <span className="tabular-nums font-medium">{fmtMoney(subtotal)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Grand total */}
        <section className="border-t border-border pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold uppercase tracking-wider">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{fmtMoney(totalAmount)}</span>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border pt-3 text-xs text-muted-foreground">
          {business.name} · Generated {fmtDate(new Date())}
        </footer>
      </div>
    );
  },
);
