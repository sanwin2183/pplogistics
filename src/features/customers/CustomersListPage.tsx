import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, Search, Phone, MessageCircle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { fmtMoney } from '../../lib/formatters';
import { useCustomers } from './useCustomers';
import { CustomerFormSheet } from './CustomerFormSheet';
import type { Customer } from '../../types';

export function CustomersListPage() {
  const { data: customers, isLoading } = useCustomers();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.telegram?.toLowerCase().includes(q),
    );
  }, [customers, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle={`${customers?.length ?? 0} contacts`}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add
          </Button>
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, telegram…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !filtered.length ? (
        customers?.length ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>
        ) : (
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="Add your first customer — usually an online shop owner."
            action={{ label: 'Add customer', onClick: () => setCreating(true) }}
          />
        )
      ) : (
        <div className="card-soft divide-y divide-border">
          {filtered.map((c) => (
            <CustomerRow key={c.id} customer={c} />
          ))}
        </div>
      )}

      <CustomerFormSheet open={creating} customer={null} onClose={() => setCreating(false)} />
    </div>
  );
}

function CustomerRow({ customer }: { customer: Customer }) {
  return (
    <Link
      to={`/customers/${customer.id}`}
      className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground uppercase">
          {customer.name.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{customer.name}</span>
            <span className="status-pill bg-muted text-muted-foreground capitalize">{customer.type}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{customer.phone}</span>
            {customer.telegram && (
              <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{customer.telegram}</span>
            )}
          </div>
        </div>
      </div>
      <div className="text-right tabular-nums">
        <div className="text-sm font-medium">{fmtMoney(customer.totalSpent)}</div>
        <div className="text-xs text-muted-foreground">{customer.totalOrders} orders</div>
        {customer.outstandingBalance > 0 && (
          <div className="text-xs text-status-awaiting-fg">{fmtMoney(customer.outstandingBalance)} due</div>
        )}
      </div>
    </Link>
  );
}
