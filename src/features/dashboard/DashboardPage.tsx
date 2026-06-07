import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  TrendingUp,
  AlertCircle,
  Wallet,
  Package,
  ArrowUpRight,
  Activity,
  Receipt,
  Coins,
  Boxes,
  Sliders,
  Check,
  RotateCcw,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { PageHeader } from '../../components/PageHeader';
import { cn } from '../../lib/utils';
import { fmtMoney, fmtMoneyCompact, fmtRelative, fmtKg } from '../../lib/formatters';
import { fetchCol, orderBy, limit } from '../../lib/queries';
import { useOrders } from '../orders/useOrders';
import { useCustomers } from '../customers/useCustomers';
import { useFlyers } from '../flyers/useFlyers';
import { useExpenses } from '../expenses/useExpenses';
import { ExpensesSection } from '../expenses/ExpensesSection';
import type { ActivityEntry } from '../../types';
import { DashboardCard } from './DashboardCard';
import { useDashboardPrefs } from './useDashboardPrefs';
import { DASHBOARD_KEYS, DEFAULT_VISIBILITY, DASHBOARD_LABELS } from './dashboardKeys';
import { DateRangeControl } from './DateRangeControl';
import { RevenueByCategoryChart } from './RevenueByCategoryChart';
import { RevenueByRouteChart } from './RevenueByRouteChart';
import { RevenueCostProfitChart } from './RevenueCostProfitChart';
import { ProfitTrendChart } from './ProfitTrendChart';
import { TopDebtorsCard } from './TopDebtorsCard';
import {
  filterExpensesByRange,
  filterOrdersByRange,
  getRangeBounds,
  rangeShortLabel,
} from './dashboardRange';
import {
  chartWindowFromBoundsAndOrders,
  profitSeries,
  revenueByCategory,
  revenueByRoute,
  revenueCostProfitSeries,
  sumOrdersSummary,
  sumPaidProfit,
  sumPaidRevenue,
  topDebtors,
} from './aggregations';

/**
 * Dashboard — Phase 2 (time-range selector layered on top of Phase 1).
 *
 * Flow:
 *   1. Pull selectedRange from useDashboardPrefs (localStorage-backed).
 *   2. Resolve to RangeBounds once per render via getRangeBounds().
 *   3. Filter orders + expenses against bounds ONCE.
 *   4. Pass the filtered subsets to Phase 1's aggregations (they no
 *      longer take a windowStart — the filter step happens here).
 *   5. Compute chart series via the range-derived [start, end] +
 *      granularity from chartWindowFromBoundsAndOrders().
 *
 * What re-scopes with the range (period metrics):
 *   Revenue / Gross profit / Net profit / Expenses, Orders summary
 *   (count / kg / pieces), Profit trend chart, Revenue/Cost/Profit
 *   chart, Revenue by category, Revenue by route, Top customers.
 *
 * What stays point-in-time (current state, regardless of range):
 *   Net position, Outstanding receivables, Owed to flyers, Active
 *   orders, Recent activity. Each of the hero cards carries an "as of
 *   now" sublabel so the owner can't misread them as range-scoped.
 *
 * Money math is untouched — only WHICH orders feed the existing sums
 * has changed. Per-order numbers (totalAmount, profit, payoutAmount,
 * subtotal, outstandingBalance) are read straight off the doc as in
 * Phase 1.
 */

export function DashboardPage() {
  const { data: orders, isLoading } = useOrders();
  const { data: customers } = useCustomers();
  const { data: flyers } = useFlyers();
  const { data: expensesAll } = useExpenses();
  const { data: activity } = useQuery({
    queryKey: ['activity', 'recent'],
    queryFn: () => fetchCol<ActivityEntry>('activity', orderBy('timestamp', 'desc'), limit(10)),
  });

  // ---------- Range resolution ----------
  // selectedRange is persisted; bounds + label are derived per render.
  const selectedRange = useDashboardPrefs((s) => s.selectedRange);
  const bounds = useMemo(() => getRangeBounds(selectedRange), [selectedRange]);
  const shortLabel = useMemo(
    () => rangeShortLabel(selectedRange, bounds),
    [selectedRange, bounds],
  );

  // Edit mode + visibility for the customize/hide system (Phase 1).
  const editMode = useDashboardPrefs((s) => s.editMode);
  const setEditMode = useDashboardPrefs((s) => s.setEditMode);
  const resetDefaults = useDashboardPrefs((s) => s.resetDefaults);
  const visibleMap = useDashboardPrefs((s) => s.visible);
  const hiddenCount = useMemo(
    () => DASHBOARD_KEYS.filter((k) => !visibleMap[k]).length,
    [visibleMap],
  );

  // ---------- Single-pass filtering ----------
  // One filter for orders, one for expenses. Every period-scoped
  // helper consumes one of these arrays — never the unfiltered
  // versions — so the dashboard can never accidentally mix windows.
  const periodOrders = useMemo(
    () => (orders ? filterOrdersByRange(orders, bounds) : []),
    [orders, bounds],
  );
  const periodExpenses = useMemo(
    () => (expensesAll ? filterExpensesByRange(expensesAll, bounds) : []),
    [expensesAll, bounds],
  );

  // ---------- Point-in-time (range-AGNOSTIC) stats ----------
  // These read the FULL orders array, NOT periodOrders. They show
  // current business state regardless of the range filter.
  const ptStats = useMemo(() => {
    if (!orders) return null;
    let receivables = 0;
    let payables = 0;
    let active = 0;
    for (const o of orders) {
      if (['delivered', 'awaiting_payment'].includes(o.status)) receivables += o.totalAmount;
      if (o.status === 'paid') {
        payables += o.flyerAssignments
          .filter((a) => !a.paidOutAt)
          .reduce((s, a) => s + a.payoutAmount, 0);
      }
      if (o.status !== 'paid') active += 1;
    }
    return { receivables, payables, active, netPosition: receivables - payables };
  }, [orders]);

  // ---------- Period stats (RANGE-scoped) ----------
  const periodRevenue = useMemo(() => sumPaidRevenue(periodOrders), [periodOrders]);
  const periodGrossProfit = useMemo(() => sumPaidProfit(periodOrders), [periodOrders]);
  const periodExpensesTotal = useMemo(
    () => periodExpenses.reduce((s, e) => s + e.amount, 0),
    [periodExpenses],
  );
  const periodNetProfit = periodGrossProfit - periodExpensesTotal;
  const ordersSummary = useMemo(
    () => sumOrdersSummary(periodOrders, { paidOnly: true }),
    [periodOrders],
  );

  // ---------- Charts (RANGE-scoped, granularity-adaptive) ----------
  const chartWindow = useMemo(
    () => chartWindowFromBoundsAndOrders(bounds, periodOrders),
    [bounds, periodOrders],
  );

  const rcpData = useMemo(() => {
    if (!chartWindow) return [];
    return revenueCostProfitSeries(
      periodOrders,
      chartWindow.start,
      chartWindow.end,
      chartWindow.granularity,
    );
  }, [periodOrders, chartWindow]);

  const profitData = useMemo(() => {
    if (!chartWindow) return [];
    return profitSeries(
      periodOrders,
      chartWindow.start,
      chartWindow.end,
      chartWindow.granularity,
    );
  }, [periodOrders, chartWindow]);

  const categorySlices = useMemo(() => revenueByCategory(periodOrders), [periodOrders]);
  const routeSlices = useMemo(
    () => (flyers ? revenueByRoute(periodOrders, flyers) : []),
    [periodOrders, flyers],
  );

  // ---------- Lists ----------
  const topCustomers = useMemo(() => {
    if (!customers) return [];
    const totals = new Map<string, number>();
    for (const o of periodOrders) {
      if (o.status !== 'paid') continue;
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
  }, [periodOrders, customers]);

  const debtorRows = useMemo(
    () => (customers ? topDebtors(customers, 5) : []),
    [customers],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={
          editMode ? (
            <span className="flex items-center gap-1.5">
              <span>Customize mode — tap each card to show or hide.</span>
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums uppercase tracking-wider">
                {hiddenCount} hidden
              </span>
            </span>
          ) : (
            dayjs().format('dddd, D MMMM YYYY')
          )
        }
        action={
          editMode ? (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetDefaults()}
                title="Restore default visibility"
              >
                <RotateCcw /> Reset
              </Button>
              <Button size="sm" onClick={() => setEditMode(false)}>
                <Check /> Done
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
              <Sliders /> Customize
            </Button>
          )
        }
      />

      {/* TIME RANGE — sits above the cards, controls every period-scoped
          element below. NOT wrapped in DashboardCard — the range
          selector is always visible (not customizable away). */}
      <DateRangeControl />

      {/* HERO STATS — point-in-time, RANGE-AGNOSTIC. 2-col mobile, 4-col lg. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading || !ptStats ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <DashboardCard k="net_position">
              <Stat
                label="Net position"
                sublabel="as of now"
                value={fmtMoneyCompact(ptStats.netPosition)}
                icon={Coins}
                tone={ptStats.netPosition < 0 ? 'warn' : 'accent'}
              />
            </DashboardCard>
            <DashboardCard k="outstanding_receivables">
              <Stat
                label="Outstanding receivables"
                sublabel="as of now"
                value={fmtMoneyCompact(ptStats.receivables)}
                icon={AlertCircle}
                tone={ptStats.receivables > 0 ? 'warn' : undefined}
              />
            </DashboardCard>
            <DashboardCard k="owed_to_flyers">
              <Stat
                label="Owed to flyers"
                sublabel="as of now"
                value={fmtMoneyCompact(ptStats.payables)}
                icon={Wallet}
                tone={ptStats.payables > 0 ? 'warn' : undefined}
              />
            </DashboardCard>
            <DashboardCard k="active_orders">
              <Stat
                label="Active orders"
                sublabel="as of now"
                value={String(ptStats.active)}
                icon={Package}
              />
            </DashboardCard>
          </>
        )}
      </div>

      {/* PERIOD STATS — RANGE-scoped. Sublabel = the range label so the
          owner can never confuse what window they're looking at. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <DashboardCard k="revenue">
              <Stat
                label={`Revenue · ${shortLabel}`}
                sublabel="paid orders"
                value={fmtMoney(periodRevenue)}
                icon={Receipt}
                tone="accent"
              />
            </DashboardCard>
            <DashboardCard k="gross_profit">
              <Stat
                label={`Gross profit · ${shortLabel}`}
                sublabel="before expenses"
                value={fmtMoney(periodGrossProfit)}
                icon={TrendingUp}
                tone="accent"
              />
            </DashboardCard>
            <DashboardCard k="net_profit">
              <Stat
                label={`Net profit · ${shortLabel}`}
                sublabel="after expenses"
                value={fmtMoney(periodNetProfit)}
                icon={TrendingUp}
                tone={periodNetProfit < 0 ? 'warn' : 'accent'}
              />
            </DashboardCard>
            <DashboardCard k="orders_summary">
              <OrdersSummaryStat
                rangeLabel={shortLabel}
                count={ordersSummary.count}
                kg={ordersSummary.kg}
                pieces={ordersSummary.pieces}
              />
            </DashboardCard>
          </>
        )}
      </div>

      {/* EXPENSES — full-width card, RANGE-scoped via bounds. */}
      <DashboardCard k="expenses_section">
        <ExpensesSection bounds={bounds} rangeLabel={shortLabel} />
      </DashboardCard>

      {/* CHARTS — 1-col mobile, 2-col lg. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard k="profit_trend">
          <ProfitTrendChart data={profitData} title={`Profit trend · ${shortLabel}`} />
        </DashboardCard>

        <DashboardCard k="category_pie">
          <RevenueByCategoryChart data={categorySlices} title={`Revenue by category · ${shortLabel}`} />
        </DashboardCard>

        <DashboardCard k="revenue_cost_profit">
          <RevenueCostProfitChart data={rcpData} title={`Revenue vs cost vs profit · ${shortLabel}`} />
        </DashboardCard>

        <DashboardCard k="route_pie">
          <RevenueByRouteChart data={routeSlices} title={`Revenue by route · ${shortLabel}`} />
        </DashboardCard>
      </div>

      {/* LISTS — 1-col mobile, 3-col lg. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DashboardCard k="top_customers">
          <Card>
            <CardContent className="p-5">
              <div className="h-eyebrow mb-3">Top customers · {shortLabel}</div>
              {topCustomers.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No paid orders in this range.</p>
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
        </DashboardCard>

        <DashboardCard k="top_debtors">
          <TopDebtorsCard data={debtorRows} />
        </DashboardCard>

        <DashboardCard k="activity">
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
        </DashboardCard>
      </div>

      {editMode && <CustomizeLegend />}
    </div>
  );
}

// ---------- Stat tile ----------

function Stat({
  label,
  sublabel,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  sublabel?: string;
  value: string;
  icon: typeof TrendingUp;
  tone?: 'warn' | 'accent';
}) {
  return (
    <div className="card-soft h-full p-4">
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
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            tone === 'accent'
              ? 'bg-accent text-accent-foreground'
              : tone === 'warn'
                ? 'bg-status-awaiting text-status-awaiting-fg'
                : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className={cn('mt-2 text-xl font-semibold tabular-nums', tone === 'warn' && 'text-status-awaiting-fg')}>
        {value}
      </div>
    </div>
  );
}

function OrdersSummaryStat({
  rangeLabel,
  count,
  kg,
  pieces,
}: {
  rangeLabel: string;
  count: number;
  kg: number;
  pieces: number;
}) {
  return (
    <div className="card-soft h-full p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="h-eyebrow truncate">Orders · {rangeLabel}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
            paid orders
          </div>
        </div>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Boxes className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
        <SummaryCell value={String(count)} label="orders" />
        <SummaryCell value={fmtKg(kg)} label="weight" />
        <SummaryCell value={String(pieces)} label="pieces" />
      </div>
    </div>
  );
}

function SummaryCell({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-base font-semibold tabular-nums leading-tight">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function CustomizeLegend() {
  const visible = useDashboardPrefs((s) => s.visible);
  const toggle = useDashboardPrefs((s) => s.toggle);
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="h-eyebrow">All dashboard cards</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            tap to toggle
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {DASHBOARD_KEYS.map((k) => {
            const isVisible = visible[k];
            const isDefault = DEFAULT_VISIBILITY[k];
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => toggle(k)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    isVisible ? 'bg-accent/50 text-foreground' : 'bg-muted/30 text-muted-foreground',
                    'hover:bg-accent/70',
                  )}
                >
                  <span className="truncate">{DASHBOARD_LABELS[k]}</span>
                  <span className="flex items-center gap-1.5">
                    {!isDefault && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        niche
                      </span>
                    )}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                        isVisible
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground ring-1 ring-border',
                      )}
                    >
                      {isVisible ? 'On' : 'Off'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
