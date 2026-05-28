import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Phone, MessageCircle, Package, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { FullPageSpinner } from '../../components/Spinner';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { fmtDate, fmtMoney } from '../../lib/formatters';
import { CustomerFormSheet } from './CustomerFormSheet';
import { useCustomer, useDeleteCustomer } from './useCustomers';
import { useOrdersByCustomer } from '../orders/useOrders';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: customer, isLoading } = useCustomer(id);
  const { data: orders } = useOrdersByCustomer(id);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const del = useDeleteCustomer();

  if (isLoading) return <FullPageSpinner />;
  if (!customer) return <p className="text-sm text-muted-foreground">Customer not found.</p>;

  // Option A — block deletion when orders exist so we don't orphan order
  // history.
  //
  // Self-correcting against rollup drift: we gate on the ACTUAL orders
  // query (useOrdersByCustomer above, already loaded for the history
  // list), not customer.totalOrders. The rollup can be stale on
  // customers whose orders were deleted BEFORE useDeleteOrder was
  // upgraded to reverse rollups in a transaction (the pre-fix
  // deleteDoc didn't decrement totalOrders, so a customer can have
  // totalOrders=1 but zero actual orders). Trusting the rollup would
  // permanently trap such customers — can't delete (block fires) and
  // can't reduce the count (no orders to remove). Trusting the query
  // unblocks them, and the deletion itself takes the stale rollup with
  // the doc. scripts/recomputeRollups.ts is the canonical repair for
  // any other drift; this guard fixes only the delete deadlock.
  function openDeleteDialog() {
    if (!customer) return;
    if (orders === undefined) {
      // The query is still loading — don't make a decision either way.
      // (Allowing the dialog here would risk deleting a customer whose
      // orders just hadn't arrived from the network yet.)
      toast.error('Still loading order history — please try again in a moment.');
      return;
    }
    if (orders.length > 0) {
      const n = orders.length;
      toast.error(
        `This customer has ${n} order${n === 1 ? '' : 's'} and can't be deleted. ` +
          'Delete those orders first, or edit the customer to mark them inactive.',
      );
      return;
    }
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!customer) return;
    try {
      await del.mutateAsync(customer.id);
      setDeleteOpen(false);
      toast.success('Customer deleted');
      navigate('/customers');
    } catch {
      // useDeleteCustomer.onError already toasted; dialog stays open for retry.
    }
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/customers"><ArrowLeft /> All customers</Link>
      </Button>

      <div className="card-soft p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-foreground uppercase">
              {customer.name.slice(0, 1)}
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{customer.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="capitalize">{customer.type}</span>
                <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{customer.phone}</span>
                {customer.telegram && (
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{customer.telegram}</span>
                )}
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
              aria-label="Delete customer"
              onClick={openDeleteDialog}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        {customer.notes && (
          <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{customer.notes}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Orders" value={String(customer.totalOrders)} />
        <StatCard label="Total spent" value={fmtMoney(customer.totalSpent)} />
        <StatCard label="Outstanding" value={fmtMoney(customer.outstandingBalance)} tone={customer.outstandingBalance > 0 ? 'warn' : undefined} />
      </div>

      <div>
        <h2 className="mb-3 h-eyebrow">Order history</h2>
        {orders === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : !orders.length ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No orders yet.</CardContent></Card>
        ) : (
          <div className="card-soft divide-y divide-border">
            {orders.map((o) => (
              <Link
                key={o.id}
                to={`/orders/${o.id}`}
                className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/50"
              >
                <div className="flex items-center gap-3">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">#{o.orderNumber}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(o.createdAt)} · {o.totalWeightKg} kg</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <MoneyDisplay amount={o.totalAmount} className="text-sm font-medium" />
                  <OrderStatusBadge status={o.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <CustomerFormSheet open={editing} customer={customer} onClose={() => setEditing(false)} />

      {/* Delete confirmation — only reachable when totalOrders === 0 (Option A). */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Delete <span className="font-medium text-foreground">{customer.name}</span>?
            </p>
            <p className="text-muted-foreground">
              This cannot be undone. They have no orders, so there's nothing else to clean up.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={del.isPending}>
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="card-soft p-4">
      <div className="h-eyebrow">{label}</div>
      <div className={`mt-1.5 text-lg font-semibold tabular-nums ${tone === 'warn' ? 'text-status-awaiting-fg' : ''}`}>
        {value}
      </div>
    </div>
  );
}
