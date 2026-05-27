import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Package, Search, Filter } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtDate, fmtKg } from '../../lib/formatters';
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from '../../lib/status';
import { useOrders } from './useOrders';
import type { OrderStatus } from '../../types';

export function OrdersListPage() {
  const { data: orders, isLoading } = useOrders();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');

  const filtered = useMemo(() => {
    if (!orders) return [];
    const q = search.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (status === 'all' || o.status === status) &&
        (!q ||
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerPhone.includes(q)),
    );
  }, [orders, search, status]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">{orders?.length ?? 0} total</p>
        </div>
        <Button asChild>
          <Link to="/orders/new"><Plus /> New order</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search order #, customer, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | 'all')}>
            <SelectTrigger className="h-10 w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !filtered.length ? (
        orders?.length ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No orders match.</p>
        ) : (
          <EmptyState
            icon={Package}
            title="No orders yet"
            description="Create your first order — pick a customer, list the items, assign a flyer."
            action={{ label: 'New order', onClick: () => { window.location.href = '/orders/new'; } }}
          />
        )
      ) : (
        <div className="card-soft divide-y divide-border">
          {filtered.map((o) => (
            <Link
              key={o.id}
              to={`/orders/${o.id}`}
              className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">#{o.orderNumber}</span>
                  <OrderStatusBadge status={o.status} />
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {o.customerName} · {fmtKg(o.totalWeightKg)} · {fmtDate(o.createdAt)}
                </div>
              </div>
              <MoneyDisplay amount={o.totalAmount} className="text-sm font-medium" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
