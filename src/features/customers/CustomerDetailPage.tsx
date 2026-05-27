import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Phone, MessageCircle, Package } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { FullPageSpinner } from '../../components/Spinner';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { fmtDate, fmtMoney } from '../../lib/formatters';
import { CustomerFormSheet } from './CustomerFormSheet';
import { useCustomer } from './useCustomers';
import { useOrdersByCustomer } from '../orders/useOrders';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: customer, isLoading } = useCustomer(id);
  const { data: orders } = useOrdersByCustomer(id);
  const [editing, setEditing] = useState(false);

  if (isLoading) return <FullPageSpinner />;
  if (!customer) return <p className="text-sm text-muted-foreground">Customer not found.</p>;

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
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
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
