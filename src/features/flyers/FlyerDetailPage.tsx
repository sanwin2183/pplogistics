import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  Phone,
  Plane,
  Check,
  Trash2,
  Package,
} from 'lucide-react';
import { doc, serverTimestamp, Timestamp, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';
import { Skeleton } from '../../components/ui/skeleton';
import { FullPageSpinner } from '../../components/Spinner';
import { FlyerStatusBadge, OrderStatusBadge } from '../../components/StatusBadge';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import { db } from '../../lib/firebase';
import { FlyerFormSheet } from './FlyerFormSheet';
import { useFlyer, useDeleteFlyer } from './useFlyers';
import { useOrdersByFlyer } from '../orders/useOrders';
import type { FlyerAssignment } from '../../types';

export function FlyerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: flyer, isLoading } = useFlyer(id);
  const { data: orders } = useOrdersByFlyer(id);
  const [editing, setEditing] = useState(false);
  const del = useDeleteFlyer();
  const qc = useQueryClient();

  if (isLoading) return <FullPageSpinner />;
  if (!flyer) return <p className="text-sm text-muted-foreground">Flyer not found.</p>;

  const usedPct = flyer.kgAvailable > 0 ? Math.min(100, (flyer.kgUsed / flyer.kgAvailable) * 100) : 0;

  // Compute payout owed (orders paid by customer but not yet paid out).
  let owed = 0;
  let paidOut = 0;
  orders?.forEach((o) => {
    o.flyerAssignments
      .filter((a) => a.flyerId === flyer.id)
      .forEach((a) => {
        if (a.paidOutAt) paidOut += a.payoutAmount;
        else if (o.status === 'paid') owed += a.payoutAmount;
      });
  });

  async function togglePayout(orderId: string, assignment: FlyerAssignment) {
    if (!flyer) return;
    try {
      const ref = doc(db, 'orders', orderId);
      // Replace the matching assignment with one having paidOutAt set (or unset).
      const updated: FlyerAssignment = { ...assignment, paidOutAt: assignment.paidOutAt ? undefined : Timestamp.now() };
      // Remove the old one and add the new — arrayUnion/Remove rely on deep equality, which works for plain objects.
      await updateDoc(ref, {
        flyerAssignments: arrayRemove(assignment),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(ref, {
        flyerAssignments: arrayUnion(updated),
        updatedAt: serverTimestamp(),
      });
      toast.success(assignment.paidOutAt ? 'Payout reversed' : 'Marked paid out');
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/flyers"><ArrowLeft /> All flyers</Link>
      </Button>

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

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Pay rate" value={`${fmtMoney(flyer.ratePerKg)}/kg`} />
        <Stat label="Owed to flyer" value={fmtMoney(owed)} tone={owed > 0 ? 'warn' : undefined} />
        <Stat label="Paid out" value={fmtMoney(paidOut)} />
      </div>

      <div>
        <h2 className="mb-3 h-eyebrow">Assigned orders</h2>
        {orders === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : !orders.length ? (
          <div className="card-soft py-8 text-center text-sm text-muted-foreground">No assigned orders yet.</div>
        ) : (
          <div className="card-soft divide-y divide-border">
            {orders.map((o) => {
              const assignments = o.flyerAssignments.filter((a) => a.flyerId === flyer.id);
              return assignments.map((a) => (
                <div key={`${o.id}-${a.weightKg}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <Link to={`/orders/${o.id}`} className="flex items-center gap-3 min-w-0">
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium">#{o.orderNumber}</div>
                        <OrderStatusBadge status={o.status} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmtKg(a.weightKg)} · {fmtMoney(a.payoutRatePerKg)}/kg · {fmtDate(o.createdAt)}
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <MoneyDisplay amount={a.payoutAmount} className="text-sm font-medium" />
                    {a.paidOutAt ? (
                      <span className="status-pill bg-status-paid text-status-paid-fg">
                        <Check className="h-3 w-3" /> Paid out
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={o.status !== 'paid'}
                        onClick={() => togglePayout(o.id, a)}
                      >
                        Mark paid out
                      </Button>
                    )}
                  </div>
                </div>
              ));
            })}
          </div>
        )}
      </div>

      <FlyerFormSheet open={editing} flyer={flyer} onClose={() => setEditing(false)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="card-soft p-4">
      <div className="h-eyebrow">{label}</div>
      <div className={`mt-1.5 text-lg font-semibold tabular-nums ${tone === 'warn' ? 'text-status-awaiting-fg' : ''}`}>
        {value}
      </div>
    </div>
  );
}
