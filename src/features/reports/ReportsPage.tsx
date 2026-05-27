import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Download, Calendar } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Card, CardContent } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { FullPageSpinner } from '../../components/Spinner';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtKg, fmtMoney, toDate } from '../../lib/formatters';
import { useOrders } from '../orders/useOrders';
import { useFlyers } from '../flyers/useFlyers';
import { useCustomers } from '../customers/useCustomers';
import { ROUTE_LABELS } from '../../lib/status';
import { toCsv, downloadCsv } from './csvExport';
import type { Route, Order, Flyer } from '../../types';

export function ReportsPage() {
  const { data: orders } = useOrders();
  const { data: flyers } = useFlyers();
  const { data: customers } = useCustomers();
  const [from, setFrom] = useState(() => dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(() => dayjs().endOf('month').format('YYYY-MM-DD'));

  if (!orders || !flyers || !customers) return <FullPageSpinner />;

  const fromD = dayjs(from).startOf('day');
  const toD = dayjs(to).endOf('day');
  const inRange = orders.filter((o) => {
    const d = dayjs(toDate(o.createdAt));
    return d.isAfter(fromD.subtract(1, 'ms')) && d.isBefore(toD.add(1, 'ms'));
  });
  // Only paid orders count toward revenue/profit reports.
  const paid = inRange.filter((o) => o.status === 'paid');

  const totals = useMemo(() => {
    const revenue = paid.reduce((s, o) => s + o.totalAmount, 0);
    const payouts = paid.reduce((s, o) => s + o.totalPayout, 0);
    const profit = revenue - payouts;
    const margin = revenue ? profit / revenue : 0;
    const kg = paid.reduce((s, o) => s + o.totalWeightKg, 0);
    return { revenue, payouts, profit, margin, kg, count: paid.length };
  }, [paid]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { name: string; kg: number; revenue: number }>();
    paid.forEach((o) =>
      o.items.forEach((it) => {
        const prev = m.get(it.categoryId) ?? { name: it.categoryName, kg: 0, revenue: 0 };
        m.set(it.categoryId, { name: prev.name, kg: prev.kg + it.weightKg, revenue: prev.revenue + it.subtotal });
      }),
    );
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
  }, [paid]);

  const byRoute = useMemo(() => {
    const flyerMap = new Map(flyers.map((f) => [f.id, f]));
    const m: Record<Route, { kg: number; payout: number }> = {
      'BKK→YGN': { kg: 0, payout: 0 },
      'BKK→MDL': { kg: 0, payout: 0 },
      'YGN→BKK': { kg: 0, payout: 0 },
      'MDL→BKK': { kg: 0, payout: 0 },
    };
    paid.forEach((o) =>
      o.flyerAssignments.forEach((a) => {
        const flyer = flyerMap.get(a.flyerId);
        if (flyer) {
          m[flyer.route].kg += a.weightKg;
          m[flyer.route].payout += a.payoutAmount;
        }
      }),
    );
    return (Object.entries(m) as Array<[Route, { kg: number; payout: number }]>).map(([route, v]) => ({ route, ...v }));
  }, [paid, flyers]);

  const byFlyer = useMemo(() => {
    const m = new Map<string, { name: string; kg: number; payout: number; orders: number }>();
    paid.forEach((o) =>
      o.flyerAssignments.forEach((a) => {
        const prev = m.get(a.flyerId) ?? { name: a.flyerName, kg: 0, payout: 0, orders: 0 };
        m.set(a.flyerId, { name: prev.name, kg: prev.kg + a.weightKg, payout: prev.payout + a.payoutAmount, orders: prev.orders + 1 });
      }),
    );
    return Array.from(m.values()).sort((a, b) => b.payout - a.payout);
  }, [paid]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, { name: string; orders: number; revenue: number; profit: number }>();
    paid.forEach((o) => {
      const prev = m.get(o.customerId) ?? { name: o.customerName, orders: 0, revenue: 0, profit: 0 };
      m.set(o.customerId, {
        name: prev.name,
        orders: prev.orders + 1,
        revenue: prev.revenue + o.totalAmount,
        profit: prev.profit + o.profit,
      });
    });
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
  }, [paid]);

  function exportAll() {
    const csv = toCsv(
      paid.map((o) => ({
        OrderNumber: o.orderNumber,
        Date: dayjs(toDate(o.createdAt)).format('YYYY-MM-DD'),
        Customer: o.customerName,
        WeightKg: o.totalWeightKg,
        Revenue: o.totalAmount,
        Payout: o.totalPayout,
        Profit: o.profit,
        Status: o.status,
      })),
      ['OrderNumber', 'Date', 'Customer', 'WeightKg', 'Revenue', 'Payout', 'Profit', 'Status'],
    );
    downloadCsv(`pp-logistics-${from}-${to}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Paid orders in this date range.</p>
      </div>

      <div className="card-soft flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="from" className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> From</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button onClick={exportAll} variant="outline">
          <Download /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={fmtMoney(totals.revenue)} />
        <Stat label="Payouts" value={fmtMoney(totals.payouts)} />
        <Stat label="Profit" value={fmtMoney(totals.profit)} />
        <Stat label="Margin" value={`${(totals.margin * 100).toFixed(1)}%`} />
        <Stat label="Orders" value={String(totals.count)} />
        <Stat label="Total weight" value={fmtKg(totals.kg)} />
      </div>

      <Tabs defaultValue="category">
        <TabsList className="grid w-full grid-cols-4 sm:w-auto sm:inline-flex">
          <TabsTrigger value="category">Category</TabsTrigger>
          <TabsTrigger value="route">Route</TabsTrigger>
          <TabsTrigger value="flyer">Flyer</TabsTrigger>
          <TabsTrigger value="customer">Customer</TabsTrigger>
        </TabsList>

        <TabsContent value="category">
          <BreakdownTable
            cols={['Category', 'Weight', 'Revenue']}
            rows={byCategory.map((c) => [c.name, fmtKg(c.kg), <MoneyDisplay key={c.name} amount={c.revenue} />])}
          />
        </TabsContent>
        <TabsContent value="route">
          <BreakdownTable
            cols={['Route', 'Weight', 'Payout']}
            rows={byRoute.map((r) => [ROUTE_LABELS[r.route], fmtKg(r.kg), <MoneyDisplay key={r.route} amount={r.payout} />])}
          />
        </TabsContent>
        <TabsContent value="flyer">
          <BreakdownTable
            cols={['Flyer', 'Orders', 'Weight', 'Payout']}
            rows={byFlyer.map((f) => [f.name, String(f.orders), fmtKg(f.kg), <MoneyDisplay key={f.name} amount={f.payout} />])}
          />
        </TabsContent>
        <TabsContent value="customer">
          <BreakdownTable
            cols={['Customer', 'Orders', 'Revenue', 'Profit']}
            rows={byCustomer.map((c) => [c.name, String(c.orders), <MoneyDisplay key={c.name + '-r'} amount={c.revenue} />, <MoneyDisplay key={c.name + '-p'} amount={c.profit} />])}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-soft p-4">
      <div className="h-eyebrow">{label}</div>
      <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function BreakdownTable({ cols, rows }: { cols: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) {
    return (
      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No data in this range.</CardContent></Card>
    );
  }
  return (
    <div className="card-soft overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {cols.map((c, i) => (
              <th key={c} className={`px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground ${i > 0 ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-secondary/30">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-3 ${j > 0 ? 'text-right tabular-nums' : ''}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Help the bundler keep types alive.
export type { Order, Flyer };
