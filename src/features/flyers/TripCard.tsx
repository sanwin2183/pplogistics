import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Check, Image as ImageIcon, Package, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { Spinner } from '../../components/Spinner';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import { getFlyerPieceCount, getFlyerPieceRate, groupItemsByCategoryFlyerKg } from '../orders/orderHelpers';
import { useSaveDocAsImage } from '../tracking/useSaveDocAsImage';
import { useSettings } from '../settings/useSettings';
import { findAssignmentsForFlyer } from './tripHelpers';
import { useMarkTripPaid } from './useMarkTripPaid';
import { TripPayoutSummary } from './TripPayoutSummary';
import type { CategorizedTrip } from './tripHelpers';
import type { Order } from '../../types';

/**
 * Trip card — renders one trip in either Payable or Paid mode.
 *
 * Modes are derived from the parent's section assignment:
 *   - section='payable' → mode='payable' here. Header shows the payable
 *     total (sum of unpaid eligible assignments) + a "Mark trip paid"
 *     button + a Save (Payout Confirmation) button. Expanding the card
 *     reveals every eligible order with per-category breakdown.
 *   - section='paid' → mode='paid'. Header shows the paid total + date
 *     paid + a Save (Payout Receipt) button + an Unmark button. Collapsed
 *     by default per the spec.
 *
 * Save mechanism: same as Invoice/Receipt — render an off-screen
 * .doc-page-a4 (TripPayoutSummary), pass its ref to useSaveDocAsImage's
 * `save(node)`. The .truncate neutralisation in useSaveDocAsImage's
 * onclone covers this DOM tree too — same hook, same capture path.
 */
interface TripCardProps {
  categorized: CategorizedTrip;
  mode: 'payable' | 'paid';
}

export function TripCard({ categorized, mode }: TripCardProps) {
  const { trip, eligibleOrders, unpaidEligibleOrders, paidEligibleOrders, payableTotal, paidTotal, lastPaidAt } = categorized;
  const { data: settings } = useSettings();
  const docRef = useRef<HTMLDivElement | null>(null);

  // Paid trips collapsed by default per spec.
  const [expanded, setExpanded] = useState(mode === 'payable');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Filename: `payout-confirmation-{flyer}-{route}-{date}.jpg` or
  // `payout-receipt-…`. Keep it filesystem-safe — strip spaces and slashes
  // from route, dash-join.
  const safeRouteSlug = trip.route.replace(/[^A-Za-z]+/g, '');
  const dateForFilename = (lastPaidAt ?? null)
    ? fmtDate(lastPaidAt!).replace(/\s+/g, '-')
    : 'unpaid';
  const filenameBase =
    mode === 'paid'
      ? `payout-receipt-${trip.flyerName.replace(/\s+/g, '-')}-${safeRouteSlug}-${dateForFilename}`
      : `payout-confirmation-${trip.flyerName.replace(/\s+/g, '-')}-${safeRouteSlug}`;
  const { save, saving } = useSaveDocAsImage(filenameBase);

  const mark = useMarkTripPaid();

  // Orders to show in the captured doc differ by mode:
  //   payable mode → unpaid eligible orders (what we're about to pay for)
  //   paid mode    → paid eligible orders (the receipt)
  const docOrders = mode === 'paid' ? paidEligibleOrders : unpaidEligibleOrders;
  const docTotal = mode === 'paid' ? paidTotal : payableTotal;

  async function onConfirmAction() {
    const action = mode === 'paid' ? 'unpay' : 'pay';
    const targetOrders = mode === 'paid' ? paidEligibleOrders : unpaidEligibleOrders;
    try {
      const res = await mark.mutateAsync({
        flyerId: trip.flyerId,
        orderIds: targetOrders.map((o) => o.id),
        action,
      });
      const verb = action === 'pay' ? 'paid' : 'unpaid';
      const parts = [`${res.affected.length} ${verb}`];
      if (res.skipped.length > 0) parts.push(`${res.skipped.length} skipped`);
      toast.success(`Trip updated — ${parts.join(', ')}`);
      setConfirmOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update trip');
    }
  }

  const orderCountForAction = mode === 'paid' ? paidEligibleOrders.length : unpaidEligibleOrders.length;
  const totalForConfirm = docTotal;
  const verbForConfirm = mode === 'paid' ? 'Unmark' : 'Mark';

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {/* Header (always visible) */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{ROUTE_LABELS[trip.route]}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtDateTime(trip.flightDate)}
                {mode === 'paid' && lastPaidAt && (
                  <>
                    {' · '}
                    <span>Paid {fmtDate(lastPaidAt)}</span>
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <MoneyDisplay amount={docTotal} className="text-base font-semibold" />
              <div className="text-xs text-muted-foreground">
                {docOrders.length} order{docOrders.length === 1 ? '' : 's'}
              </div>
            </div>
          </button>

          {expanded && (
            <>
              {/* Order list */}
              <div className="divide-y divide-border border-t border-border">
                {(mode === 'paid' ? paidEligibleOrders : eligibleOrders).map((o) => (
                  <OrderRow key={o.id} order={o} flyerId={trip.flyerId} />
                ))}
              </div>

              {/* Action row */}
              <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => save(docRef.current)}
                  disabled={saving}
                >
                  {saving ? <Spinner className="text-primary" /> : <ImageIcon />}
                  {saving ? 'Saving…' : mode === 'paid' ? 'Save receipt' : 'Save summary'}
                </Button>
                {mode === 'paid' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmOpen(true)}
                    disabled={paidEligibleOrders.length === 0 || mark.isPending}
                  >
                    <Undo2 /> Unmark
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setConfirmOpen(true)}
                    disabled={unpaidEligibleOrders.length === 0 || mark.isPending}
                  >
                    <Check /> Mark trip paid
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Off-screen capture target — always rendered so the ref is wired
          even when the card is collapsed. The .doc-page-a4 styles keep
          it invisible to the user. */}
      {settings?.business && (
        <TripPayoutSummary
          ref={docRef}
          business={settings.business}
          flyerName={trip.flyerName}
          route={trip.route}
          flightDate={trip.flightDate}
          orders={docOrders}
          flyerId={trip.flyerId}
          totalAmount={docTotal}
          mode={mode === 'paid' ? 'paid' : 'unpaid'}
          paidAt={lastPaidAt}
        />
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={(v) => !mark.isPending && setConfirmOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {verbForConfirm} trip {mode === 'paid' ? 'as unpaid' : 'as paid'}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {verbForConfirm} {orderCountForAction} order
            {orderCountForAction === 1 ? '' : 's'} as {mode === 'paid' ? 'unpaid' : 'paid'} for{' '}
            <span className="font-medium text-foreground">{trip.flyerName}</span>'s{' '}
            {ROUTE_LABELS[trip.route]} trip on{' '}
            <span className="font-medium text-foreground">{fmtDate(trip.flightDate)}</span>?{' '}
            Total <span className="font-medium text-foreground">{fmtMoney(totalForConfirm)}</span>.
            {' '}This cannot be easily undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={mark.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={mode === 'paid' ? 'destructive' : 'default'}
              onClick={onConfirmAction}
              disabled={mark.isPending}
            >
              {mark.isPending ? <Spinner /> : null}
              {mark.isPending ? 'Working…' : `${verbForConfirm} as ${mode === 'paid' ? 'unpaid' : 'paid'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Inline order row inside an expanded TripCard. Mirrors the per-category
 * breakdown rendered on the order detail page so the owner sees the same
 * math the customer + flyer already agreed.
 */
function OrderRow({ order, flyerId }: { order: Order; flyerId: string }) {
  const assignmentList = findAssignmentsForFlyer(order, flyerId);
  if (assignmentList.length === 0) return null;
  // THIS FLYER'S per-category breakdown — this view is the flyer's
  // payment math, never the customer's billed math. Scoped to flyerId
  // so a split order shows only this flyer's portion (per-item per-flyer
  // split, 2026-06-09). Legacy orders (no flyerSplits) fall back to the
  // single quantity, so they look unchanged.
  const groups = groupItemsByCategoryFlyerKg(order.items, flyerId);

  // Order header weight — FLYER-side total. Falls back to a.weightKg
  // for legacy assignments via a.flyerWeightKg ?? a.weightKg.
  const orderWeightKg = assignmentList.reduce(
    (s, a) => s + (a.flyerWeightKg ?? a.weightKg ?? 0),
    0,
  );
  const orderPayoutTotal = assignmentList.reduce((s, a) => s + (a.payoutAmount || 0), 0);
  const allAssignmentsPaid = assignmentList.every((a) => !!a.paidOutAt);
  const perPieceItems = order.items.filter((it) => it.pricingMode === 'per_piece');

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <Link to={`/orders/${order.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">#{order.orderNumber}</span>
              <OrderStatusBadge status={order.status} />
              {allAssignmentsPaid && (
                <span className="status-pill bg-status-paid text-status-paid-fg">
                  <Check className="h-3 w-3" /> Paid out
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {orderWeightKg > 0 ? `${fmtKg(orderWeightKg)} · ` : ''}
              {fmtDate(order.createdAt)}
            </div>
          </div>
        </Link>
        <MoneyDisplay amount={orderPayoutTotal} className="text-sm font-medium" />
      </div>

      <div className="space-y-1.5">
        {assignmentList.map((a, ai) => {
          const hasCategoryRates = !!a.categoryRates && a.categoryRates.length > 0;
          if (hasCategoryRates) {
            return (
              <div
                key={`${order.id}-asgn-${ai}`}
                className="space-y-1 rounded-md bg-muted/30 px-3 py-2"
              >
                {a.categoryRates!.map((cr) => {
                  const g = groups.find((x) => x.categoryId === cr.categoryId);
                  const kg = g?.weightKg ?? 0;
                  const name = g?.categoryName ?? cr.categoryId;
                  const subtotal = kg * cr.ratePerKg;
                  return (
                    <div
                      key={`${order.id}-asgn-${ai}-cr-${cr.categoryId}`}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs"
                    >
                      <span className="truncate text-muted-foreground">{name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmtKg(kg)} · {fmtMoney(cr.ratePerKg)}/kg
                      </span>
                      <span className="tabular-nums font-medium">{fmtMoney(subtotal)}</span>
                    </div>
                  );
                })}
              </div>
            );
          }
          // Skip the legacy block when this assignment has no kg signal
          // — happens for piece-only orders (assignment created with
          // categoryRates=[], weightKg=0).
          if ((a.weightKg ?? 0) === 0 && a.payoutRatePerKg == null) {
            return null;
          }
          const subtotal = (a.weightKg || 0) * (a.payoutRatePerKg ?? 0);
          return (
            <div
              key={`${order.id}-asgn-${ai}`}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="flex items-center gap-1.5">
                (legacy rate)
                {a.paidOutAt && (
                  <span className="status-pill bg-status-paid text-status-paid-fg text-[10px]">
                    <Check className="h-3 w-3" /> paid
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {fmtKg(a.weightKg)} · {fmtMoney(a.payoutRatePerKg ?? 0)}/kg
              </span>
              <span className="tabular-nums font-medium text-foreground">{fmtMoney(subtotal)}</span>
            </div>
          );
        })}

        {/* Per-piece breakdown — one row per per-piece item.
            FLYER piece count via getFlyerPieceCount (falls back to
            customer pieceCount when no override). Rate from
            item.flyerRatePerPiece. Customer pieces are NEVER shown
            on the flyer's payout view per the §11-equivalent
            rule: flyer sees what they're paid on. */}
        {perPieceItems.length > 0 && (
          <div className="space-y-1 rounded-md bg-muted/30 px-3 py-2">
            {perPieceItems.map((it, pi) => {
              const count = getFlyerPieceCount(it, flyerId);
              const rate = getFlyerPieceRate(it, flyerId);
              const subtotal = count * rate;
              return (
                <div
                  key={`${order.id}-pp-${pi}`}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs"
                >
                  <span className="truncate text-muted-foreground">{it.description || it.categoryName}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {count} pcs · {fmtMoney(rate)}/pc
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
}
