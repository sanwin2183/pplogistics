import { useState } from 'react';
import dayjs from 'dayjs';
import JSZip from 'jszip';
import { Download, Package, FileSpreadsheet, Users, Receipt, Plane, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { useOrders } from '../orders/useOrders';
import { useCustomers } from '../customers/useCustomers';
import { useExpenses } from '../expenses/useExpenses';
import { useFlyers } from '../flyers/useFlyers';
import {
  ordersToCsv,
  customersToCsv,
  expensesToCsv,
  flyerPayoutsToCsv,
  downloadCsv,
  triggerDownload,
  todayStamp,
  type OrdersExportOptions,
  type ExpensesExportOptions,
} from './exporters';
import type { OrderStatus } from '../../types';

/**
 * Settings → Export tab.
 *
 * Client-side flattened CSV exports with per-export filter inputs +
 * an "Export everything" zip bundle. All data is fetched once via the
 * existing TanStack-Query hooks (already cached app-wide), so opening
 * the tab is free if you've used the dashboard / orders pages in the
 * same session.
 *
 * Volume guard: each collection's size is shown in the card header.
 * When any one tops the threshold (5000 docs) the user gets a banner
 * — that's the cutoff CLAUDE-style memory suggested for moving the
 * export to a Cloud Function. Below it the client is fine.
 */
const SIZE_WARN_THRESHOLD = 5000;

const ORDER_STATUSES: Array<OrderStatus> = [
  'pending',
  'received',
  'with_flyer',
  'in_transit',
  'delivered',
  'awaiting_payment',
  'paid',
];

export function ExportTab() {
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: customers, isLoading: customersLoading } = useCustomers();
  const { data: expenses, isLoading: expensesLoading } = useExpenses();
  const { data: flyers, isLoading: flyersLoading } = useFlyers();

  const allLoading =
    ordersLoading || customersLoading || expensesLoading || flyersLoading;
  const data = {
    orders: orders ?? [],
    customers: customers ?? [],
    expenses: expenses ?? [],
    flyers: flyers ?? [],
  };

  // Per-export filter state. Sensible defaults: orders + expenses default
  // to the current calendar year so the "Download" button does something
  // useful on first open without needing the owner to pick a range.
  const yearStart = dayjs().startOf('year').format('YYYY-MM-DD');
  const today = dayjs().format('YYYY-MM-DD');

  const [orderRange, setOrderRange] = useState<OrdersExportOptions>({
    startDate: yearStart,
    endDate: today,
    status: 'all',
  });
  const [expenseRange, setExpenseRange] = useState<ExpensesExportOptions>({
    startDate: yearStart,
    endDate: today,
  });

  // Track running state per button so we can disable + show a spinner
  // label while a (potentially slow) zip generation is happening.
  const [busy, setBusy] = useState<null | 'orders' | 'customers' | 'expenses' | 'payouts' | 'all'>(null);

  function withBusy<T>(
    key: NonNullable<typeof busy>,
    fn: () => T | Promise<T>,
  ): Promise<T | undefined> {
    if (busy) return Promise.resolve(undefined);
    setBusy(key);
    return Promise.resolve()
      .then(fn)
      .catch((err) => {
        console.error('[export]', key, 'failed', err);
        toast.error(err instanceof Error ? err.message : 'Export failed');
        return undefined;
      })
      .finally(() => setBusy(null));
  }

  function doExportOrders() {
    return withBusy('orders', () => {
      const csv = ordersToCsv(data.orders, data.customers, data.flyers, orderRange);
      downloadCsv(csv, `orders_${todayStamp()}.csv`);
      toast.success('Orders CSV downloaded');
    });
  }
  function doExportCustomers() {
    return withBusy('customers', () => {
      const csv = customersToCsv(data.customers, data.orders);
      downloadCsv(csv, `customers_${todayStamp()}.csv`);
      toast.success('Customers CSV downloaded');
    });
  }
  function doExportExpenses() {
    return withBusy('expenses', () => {
      const csv = expensesToCsv(data.expenses, expenseRange);
      downloadCsv(csv, `expenses_${todayStamp()}.csv`);
      toast.success('Expenses CSV downloaded');
    });
  }
  function doExportPayouts() {
    return withBusy('payouts', () => {
      const csv = flyerPayoutsToCsv(data.orders, data.flyers);
      downloadCsv(csv, `payouts_${todayStamp()}.csv`);
      toast.success('Payouts CSV downloaded');
    });
  }
  function doExportAll() {
    return withBusy('all', async () => {
      const zip = new JSZip();
      // "Export everything" intentionally exports the FULL dataset, not the
      // filtered subset showing in the UI — its purpose is a full backup.
      // For consistency with the per-export buttons we still apply the
      // "all statuses" + empty date range to ordersToCsv.
      zip.file(
        `orders_${todayStamp()}.csv`,
        ordersToCsv(data.orders, data.customers, data.flyers, {
          startDate: '',
          endDate: '',
          status: 'all',
        }),
      );
      zip.file(`customers_${todayStamp()}.csv`, customersToCsv(data.customers, data.orders));
      zip.file(
        `expenses_${todayStamp()}.csv`,
        expensesToCsv(data.expenses, { startDate: '', endDate: '' }),
      );
      zip.file(`payouts_${todayStamp()}.csv`, flyerPayoutsToCsv(data.orders, data.flyers));
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, `pplogistics_export_${todayStamp()}.zip`);
      toast.success('Full export zip downloaded');
    });
  }

  const oversize = [
    data.orders.length > SIZE_WARN_THRESHOLD ? `orders (${data.orders.length})` : null,
    data.customers.length > SIZE_WARN_THRESHOLD ? `customers (${data.customers.length})` : null,
    data.expenses.length > SIZE_WARN_THRESHOLD ? `expenses (${data.expenses.length})` : null,
    // Flyer-payout rows aren't 1:1 with flyers — they fan out across order
    // assignments. Approximate count = sum of assignments. Below threshold
    // unless the business explodes.
  ].filter((s): s is string => !!s);

  return (
    <div className="mt-4 space-y-4">
      {oversize.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-status-awaiting-fg/40 bg-status-awaiting/40 p-3 text-xs text-status-awaiting-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Some collections are large</p>
            <p className="mt-0.5">
              {oversize.join(', ')} exceeded {SIZE_WARN_THRESHOLD} docs. Exports
              still work but may use significant memory in the browser — flag
              this and we'll move generation to a Cloud Function.
            </p>
          </div>
        </div>
      )}

      {/* Export everything */}
      <section className="card-soft p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4" /> Export everything
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Download a zip containing all four CSVs (orders, customers,
              expenses, payouts) with no filters applied.
            </p>
          </div>
          <Button onClick={doExportAll} disabled={allLoading || !!busy}>
            <Download /> {busy === 'all' ? 'Building zip…' : 'Download zip'}
          </Button>
        </div>
      </section>

      {/* Orders */}
      <ExportCard
        icon={FileSpreadsheet}
        title="Orders"
        subtitle={
          allLoading
            ? undefined
            : `${data.orders.length} order(s) in this database`
        }
        loading={allLoading}
        busyLabel={busy === 'orders' ? 'Building…' : 'Download CSV'}
        disabled={allLoading || !!busy}
        onDownload={doExportOrders}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="orders-start">From</Label>
            <Input
              id="orders-start"
              type="date"
              value={orderRange.startDate}
              onChange={(e) =>
                setOrderRange((r) => ({ ...r, startDate: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="orders-end">To</Label>
            <Input
              id="orders-end"
              type="date"
              value={orderRange.endDate}
              onChange={(e) =>
                setOrderRange((r) => ({ ...r, endDate: e.target.value }))
              }
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={orderRange.status || 'all'}
            onValueChange={(v) =>
              setOrderRange((r) => ({ ...r, status: v as OrderStatus | 'all' }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ExportCard>

      {/* Customers */}
      <ExportCard
        icon={Users}
        title="Customers"
        subtitle={
          allLoading
            ? undefined
            : `${data.customers.length} customer(s); first/last order dates computed from the orders collection`
        }
        loading={allLoading}
        busyLabel={busy === 'customers' ? 'Building…' : 'Download CSV'}
        disabled={allLoading || !!busy}
        onDownload={doExportCustomers}
      >
        <p className="text-xs text-muted-foreground">No filters — customers export is always the full list.</p>
      </ExportCard>

      {/* Expenses */}
      <ExportCard
        icon={Receipt}
        title="Expenses"
        subtitle={
          allLoading ? undefined : `${data.expenses.length} expense(s) in this database`
        }
        loading={allLoading}
        busyLabel={busy === 'expenses' ? 'Building…' : 'Download CSV'}
        disabled={allLoading || !!busy}
        onDownload={doExportExpenses}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="expenses-start">From</Label>
            <Input
              id="expenses-start"
              type="date"
              value={expenseRange.startDate}
              onChange={(e) =>
                setExpenseRange((r) => ({ ...r, startDate: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expenses-end">To</Label>
            <Input
              id="expenses-end"
              type="date"
              value={expenseRange.endDate}
              onChange={(e) =>
                setExpenseRange((r) => ({ ...r, endDate: e.target.value }))
              }
            />
          </div>
        </div>
      </ExportCard>

      {/* Flyer payouts */}
      <ExportCard
        icon={Plane}
        title="Flyer payouts"
        subtitle={
          allLoading
            ? undefined
            : `${data.orders.reduce((s, o) => s + o.flyerAssignments.length, 0)} assignment(s) across ${data.orders.length} order(s)`
        }
        loading={allLoading}
        busyLabel={busy === 'payouts' ? 'Building…' : 'Download CSV'}
        disabled={allLoading || !!busy}
        onDownload={doExportPayouts}
      >
        <p className="text-xs text-muted-foreground">
          One row per flyerAssignment. Joins in flyer phone + route. No filters
          — every assignment is included with a "paid" / "owed" status flag.
        </p>
      </ExportCard>

      <p className="px-1 text-[11px] text-muted-foreground">
        CSVs are UTF-8 with a BOM so Excel opens Thai/Burmese text correctly.
        Dates are ISO 8601 (YYYY-MM-DD HH:mm). Numbers are plain — formatting
        belongs in Excel.
      </p>
    </div>
  );
}

/** Card wrapper shared by each export section to keep layout consistent. */
function ExportCard({
  icon: Icon,
  title,
  subtitle,
  loading,
  children,
  onDownload,
  busyLabel,
  disabled,
}: {
  icon: typeof FileSpreadsheet;
  title: string;
  subtitle?: string;
  loading: boolean;
  children: React.ReactNode;
  onDownload: () => void;
  busyLabel: string;
  disabled: boolean;
}) {
  return (
    <section className="card-soft p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4" /> {title}
          </h3>
          {loading ? (
            <Skeleton className="mt-1 h-3 w-40" />
          ) : (
            subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <Button variant="outline" onClick={onDownload} disabled={disabled}>
          <Download /> {busyLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}
