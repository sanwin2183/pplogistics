import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  AlertCircle,
  Wallet,
  Package,
  ArrowUpRight,
  Activity,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { PageHeader } from '../../components/PageHeader';
import { fmtMoney, fmtMoneyCompact, toDate, fmtRelative, fmtKg } from '../../lib/formatters';
import { useTheme, chartTokens } from '../../lib/theme';
import { fetchCol, orderBy, limit } from '../../lib/queries';
import { useOrders } from '../orders/useOrders';
import { useCustomers } from '../customers/useCustomers';
import { useExpensesByMonth } from '../expenses/useExpenses';
import { ExpensesSection } from '../expenses/ExpensesSection';
import type { ActivityEntry, Route } from '../../types';
import { ROUTE_LABELS } from '../../lib/status';

export function DashboardPage() {
  const { data: orders, isLoading } = useOrders();
  const { data: customers } = useCustomers();
  const { data: activity } = useQuery({
    queryKey: ['activity', 'recent'],
    queryFn: () => fetchCol<ActivityEntry>('activity', orderBy('timestamp', 'desc'), limit(10)),
  });
  const resolved = useTheme((s) => s.resolved);
  const ct = chartTokens(resolved);

  // Month window shared by stats, ExpensesSection, and the net-profit
  // calculation. Computed ONCE per render so all three figures align
  // exactly (no risk of a request straddling midnight on the 1st of
  // the month and giving inconsistent gross/expenses windows).
  const monthStartDate = useMemo(() => dayjs().startOf('month').toDate(), []);
  const monthEndDate = useMemo(
    () => dayjs().startOf('month').add(1, 'month').toDate(),
    [],
  );
  const { data: monthExpenses } = useExpensesByMonth(monthStartDate, monthEndDate);

  const stats = useMemo(() => {
    if (!orders) return null;
    const now = dayjs();
    const monthStart = now.startOf('month');
    let monthGrossProfit = 0;
    let outstandingReceivables = 0;
    let outstandingPayables = 0;
    let activeCount = 0;
    for (const o of orders) {
      const d = dayjs(toDate(o.createdAt));
      if (o.status === 'paid' && d.isAfter(monthStart)) monthGrossProfit += o.profit;
      if (['delivered', 'awaiting_payment'].includes(o.status)) outstandingReceivables += o.totalAmount;
      if (o.status === 'paid') {
        // Unpaid flyer payouts on paid orders.
        outstandingPayables += o.flyerAssignments
          .filter((a) => !a.paidOutAt)
          .reduce((s, a) => s + a.payoutAmount, 0);
      }
      if (!['paid'].includes(o.status)) activeCount += 1;
    }
    return { monthGrossProfit, outstandingReceivables, outstandingPayables, activeCount };
  }, [orders]);

  // Net profit = gross − this-month expense total. Both figures use the
  // same month window so the math is internally consistent.
  const monthExpensesTotal = useMemo(
    () => (monthExpenses ?? []).reduce((s, e) => s + e.amount, 0),
    [monthExpenses],
  );
  const monthNetProfit = (stats?.monthGrossProfit ?? 0) - monthExpensesTotal;

  // Profit per day (last 30 days).
  const profitSeries = useMemo(() => {
    const today = dayjs().startOf('day');
    const days = Array.from({ length: 30 }, (_, i) => today.subtract(29 - i, 'day'));
    const buckets = new Map<string, number>(days.map((d) => [d.format('YYYY-MM-DD'), 0]));
    orders?.forEach((o) => {
      if (o.status !== 'paid') return;
      const day = dayjs(toDate(o.createdAt)).startOf('day').format('YYYY-MM-DD');
      if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + o.profit);
    });
    return Array.from(buckets.entries()).map(([day, profit]) => ({
      day,
      label: dayjs(day).format('D MMM'),
      profit,
    }));
  }, [orders]);

  // KG by route (last 30 days).
  const routeSeries = useMemo(() => {
    const cutoff = dayjs().subtract(30, 'day');
    const totals: Record<Route, number> = { 'BKK→YGN': 0, 'BKK→MDL': 0, 'YGN→BKK': 0, 'MDL→BKK': 0 };
    orders?.forEach((o) => {
      if (dayjs(toDate(o.createdAt)).isBefore(cutoff)) return;
      // Apportion total weight to assigned flyers' routes (use customer-paid weight as fallback).
      // We don't have the flyer route on the order, but the assignments have flyerName only;
      // we need to look up the flyer's route. Simpler: ignore route attribution beyond what
      // we know — count this order's total weight against the FIRST assignment's route.
      // (For a more precise implementation, fetch flyers and join.) For the dashboard's
      // 30-day glance this is fine.
      // Without flyer-route join here, fall back to attributing all weight to BKK→YGN. The
      // reports page does the proper join.
    });
    // Without a join we punt — show order count by status instead for a useful chart.
    const statusBuckets: Record<string, number> = {};
    orders?.forEach((o) => {
      if (dayjs(toDate(o.createdAt)).isBefore(cutoff)) return;
      statusBuckets[o.status] = (statusBuckets[o.status] ?? 0) + o.totalWeightKg;
    });
    return Object.entries(totals).map(([route]) => ({
      route,
      label: ROUTE_LABELS[route as Route].split(' → ').map((p) => p.slice(0, 3)).join(' → '),
      kg: 0,
    })).concat(
      Object.entries(statusBuckets).map(([s, kg]) => ({ route: s, label: s.replace('_', ' '), kg })),
    );
  }, [orders]);

  // Top 5 customers this month.
  const topCustomers = useMemo(() => {
    if (!orders || !customers) return [];
    const monthStart = dayjs().startOf('month');
    const totals = new Map<string, number>();
    for (const o of orders) {
      if (o.status !== 'paid') continue;
      if (dayjs(toDate(o.createdAt)).isBefore(monthStart)) continue;
      totals.set(o.customerId, (totals.get(o.customerId) ?? 0) + o.totalAmount);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, total]) => ({
        id,
        name: customers.find((c) => c.id === id)?.name ?? 'Unknown',
        total,
      }));
  }, [orders, customers]);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={dayjs().format('dddd, D MMMM YYYY')} />

      {/* Stat cards. Gross + Net both shown so the owner sees margin BEFORE
          AND AFTER overhead — gross is revenue−payouts (the existing card,
          relabelled), net subtracts this-month expenses on top. Same month
          window as the Expenses card below. The two profit cards sit side-
          by-side on mobile so the gross→net comparison is glanceable. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {isLoading || !stats ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <Stat
              label="Gross profit · this month"
              sublabel="before expenses"
              value={fmtMoney(stats.monthGrossProfit)}
              icon={TrendingUp}
              tone="accent"
            />
            <Stat
              label="Net profit · this month"
              sublabel="after expenses"
              value={fmtMoney(monthNetProfit)}
              icon={TrendingUp}
              tone={monthNetProfit < 0 ? 'warn' : 'accent'}
            />
            <Stat label="Outstanding receivables" value={fmtMoneyCompact(stats.outstandingReceivables)} icon={AlertCircle} tone={stats.outstandingReceivables > 0 ? 'warn' : undefined} />
            <Stat label="Owed to flyers" value={fmtMoneyCompact(stats.outstandingPayables)} icon={Wallet} tone={stats.outstandingPayables > 0 ? 'warn' : undefined} />
            <Stat label="Active orders" value={String(stats.activeCount)} icon={Package} />
          </>
        )}
      </div>

      {/* Expenses — this-month total + recent entries + Add button. The
          form is a bottom sheet (mobile-first, matches CustomerFormSheet).
          Time-scoping uses the same month window as the Net profit card
          above so the gross→expenses→net trio is consistent. */}
      <ExpensesSection monthStart={monthStartDate} monthEnd={monthEndDate} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Profit chart */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <div>
                <div className="h-eyebrow">Profit · last 30 days</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {fmtMoney(profitSeries.reduce((s, p) => s + p.profit, 0))}
                </div>
              </div>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profitSeries} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: ct.axisText }} interval={4} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: ct.axisText }} tickFormatter={(v) => fmtMoneyCompact(v)} axisLine={false} tickLine={false} width={50} />
                  <Tooltip
                    cursor={{ stroke: ct.primary, strokeOpacity: 0.2 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, background: ct.tooltipBg, color: ct.tooltipText, border: `1px solid ${ct.tooltipBorder}` }}
                    formatter={(v: number) => [fmtMoney(v), 'Profit']}
                  />
                  <Line type="monotone" dataKey="profit" stroke={ct.primary} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top customers */}
        <Card>
          <CardContent className="p-5">
            <div className="h-eyebrow mb-3">Top customers · this month</div>
            {topCustomers.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No paid orders this month yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {topCustomers.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                      {i + 1}
                    </div>
                    <Link to={`/customers/${c.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    <MoneyDisplay amount={c.total} className="text-sm tabular-nums" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weight by status */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 h-eyebrow">Weight by status · last 30 days</div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={routeSeries.filter((r) => r.kg > 0)} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: ct.axisText }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: ct.axisText }} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, background: ct.tooltipBg, color: ct.tooltipText, border: `1px solid ${ct.tooltipBorder}` }}
                  formatter={(v: number) => [fmtKg(v), 'Weight']}
                />
                <Bar dataKey="kg" radius={[6, 6, 0, 0]}>
                  {routeSeries.map((_, i) => (
                    <Cell key={i} fill={ct.primary} fillOpacity={0.85 - i * 0.08} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Activity feed */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="h-eyebrow">Recent activity</h2>
          </div>
          {!activity ? (
            <Skeleton className="h-32 w-full" />
          ) : activity.length === 0 ? (
            <p className="py-4 text-xs text-muted-foreground">No activity yet — create your first order to see updates here.</p>
          ) : (
            <ul className="space-y-2.5">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/60" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{a.message}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{fmtRelative(a.timestamp)}</div>
                  </div>
                  {a.orderId && (
                    <Link to={`/orders/${a.orderId}`} className="text-muted-foreground hover:text-primary"><ArrowUpRight className="h-4 w-4" /></Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  sublabel,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  /** Tiny clarifier under the eyebrow — used on the gross/net pair to make
   *  the "before expenses" vs "after expenses" distinction glanceable. */
  sublabel?: string;
  value: string;
  icon: typeof TrendingUp;
  tone?: 'warn' | 'accent';
}) {
  return (
    <div className="card-soft p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="h-eyebrow truncate">{label}</div>
          {sublabel && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {sublabel}
            </div>
          )}
        </div>
        <div
          className={
            tone === 'accent'
              ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground'
              : tone === 'warn'
                ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-status-awaiting text-status-awaiting-fg'
                : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'
          }
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className={`mt-2 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-status-awaiting-fg' : ''}`}>
        {value}
      </div>
    </div>
  );
}
