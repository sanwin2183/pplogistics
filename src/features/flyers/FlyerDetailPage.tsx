import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  Phone,
  Plane,
  Trash2,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';
import { Skeleton } from '../../components/ui/skeleton';
import { FullPageSpinner } from '../../components/Spinner';
import { FlyerStatusBadge, OrderStatusBadge } from '../../components/StatusBadge';
import { Card, CardContent } from '../../components/ui/card';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import { FlyerFormSheet } from './FlyerFormSheet';
import { useFlyer, useDeleteFlyer } from './useFlyers';
import { useOrdersByFlyer } from '../orders/useOrders';
import {
  categorizeTrip,
  groupOrdersIntoTrips,
  type CategorizedTrip,
} from './tripHelpers';
import { TripCard } from './TripCard';

/**
 * Flyer detail page — redesigned around trips.
 *
 * Section layout:
 *   1. Flyer profile (name, route, flight, capacity used)
 *   2. Upcoming trips — trips where every order is still pending /
 *      received (not yet handed to the flyer). No payout total, no actions.
 *   3. Payable trips — at least one eligible order, not all paid.
 *      Expanded by default, with Save / Mark trip paid.
 *   4. Paid trips — all eligible orders paidOutAt. Collapsed by default,
 *      with Save receipt / Unmark.
 *
 * In the current schema each flyer doc IS a trip (route + flightDate are
 * on the flyer record, not the assignment), so a flyer page will show at
 * most ONE trip card across the three sections — the trip lands in
 * exactly one section based on aggregate state. The section layout still
 * makes sense for that one trip and scales cleanly if a future
 * "trips overview" page is added.
 *
 * Capacity rollup at the top stays as-is — that's per-flyer-doc kg used
 * vs available and isn't affected by the trip grouping.
 */
export function FlyerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: flyer, isLoading } = useFlyer(id);
  const { data: orders } = useOrdersByFlyer(id);
  const [editing, setEditing] = useState(false);
  const del = useDeleteFlyer();

  // Group + categorise the orders into trips. flyerLookup is a one-element
  // map for the current flyer doc. If `orders` is undefined (still loading)
  // we render nothing trip-related; the profile + skeleton handle that.
  const categorized: CategorizedTrip[] = useMemo(() => {
    if (!flyer || !orders) return [];
    const lookup = new Map([[flyer.id, flyer]]);
    return groupOrdersIntoTrips(orders, lookup).map(categorizeTrip);
  }, [flyer, orders]);

  const upcomingTrips = categorized.filter((c) => c.section === 'upcoming');
  const payableTrips = categorized.filter((c) => c.section === 'payable');
  const paidTrips = categorized.filter((c) => c.section === 'paid');

  if (isLoading) return <FullPageSpinner />;
  if (!flyer) return <p className="text-sm text-muted-foreground">Flyer not found.</p>;

  const usedPct = flyer.kgAvailable > 0
    ? Math.min(100, (flyer.kgUsed / flyer.kgAvailable) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/flyers"><ArrowLeft /> All flyers</Link>
      </Button>

      {/* Flyer profile */}
      <div className="card-soft p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Plane className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">{flyer.name}</h1>
                <FlyerStatusBadge status={flyer.status} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{ROUTE_LABELS[flyer.route]}</span>
                <span>{fmtDateTime(flyer.flightDate)}</span>
                {flyer.flightNumber && <span>{flyer.flightNumber}</span>}
                <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{flyer.phone}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete"
              onClick={() => {
                if (!confirm('Delete this flyer? Order assignments will remain but the flyer record is gone.')) return;
                del.mutate(flyer.id, { onSuccess: () => toast.success('Flyer deleted') });
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{fmtKg(flyer.kgUsed)} of {fmtKg(flyer.kgAvailable)} used</span>
            <span className="font-medium tabular-nums">{usedPct.toFixed(0)}%</span>
          </div>
          <Progress value={usedPct} className="h-2" />
        </div>

        {flyer.notes && (
          <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{flyer.notes}</p>
        )}
      </div>

      {/* Trips — three sections, each conditional on having trips in it */}
      {orders === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : categorized.length === 0 ? (
        <div className="card-soft py-8 text-center text-sm text-muted-foreground">
          No assigned orders yet.
        </div>
      ) : (
        <>
          {/* Upcoming */}
          {upcomingTrips.length > 0 && (
            <section className="space-y-3">
              <h2 className="h-eyebrow">Upcoming</h2>
              {upcomingTrips.map((c) => (
                <UpcomingTripCard key={c.trip.key} categorized={c} />
              ))}
            </section>
          )}

          {/* Payable */}
          {payableTrips.length > 0 && (
            <section className="space-y-3">
              <h2 className="h-eyebrow">Payable</h2>
              {payableTrips.map((c) => (
                <TripCard key={c.trip.key} categorized={c} mode="payable" />
              ))}
            </section>
          )}

          {/* Paid */}
          {paidTrips.length > 0 && (
            <section className="space-y-3">
              <h2 className="h-eyebrow">Paid</h2>
              {paidTrips.map((c) => (
                <TripCard key={c.trip.key} categorized={c} mode="paid" />
              ))}
            </section>
          )}
        </>
      )}

      <FlyerFormSheet open={editing} flyer={flyer} onClose={() => setEditing(false)} />
    </div>
  );
}

/**
 * Minimal card for the Upcoming section — no payout total, no actions.
 * Lists the upcoming orders so the owner can see what's queued. Once an
 * order's status advances to with_flyer (or later) the trip re-categorises
 * to Payable on next render — handover is the trigger, not takeoff.
 */
function UpcomingTripCard({ categorized }: { categorized: CategorizedTrip }) {
  const { trip, upcomingOrders } = categorized;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{ROUTE_LABELS[trip.route]}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(trip.flightDate)}</div>
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            {upcomingOrders.length} order{upcomingOrders.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="divide-y divide-border">
          {upcomingOrders.map((o) => (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="flex items-center gap-3 p-3 hover:bg-muted/40"
            >
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">#{o.orderNumber}</span>
                  <OrderStatusBadge status={o.status} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtKg(o.totalWeightKg)} · {fmtDate(o.createdAt)} · {fmtMoney(o.totalAmount)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
