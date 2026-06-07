import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent } from '../../components/ui/card';
import { fmtMoney, fmtMoneyCompact } from '../../lib/formatters';
import { useTheme, chartTokens } from '../../lib/theme';
import type { RcpPoint } from './aggregations';

/**
 * Grouped bar chart of per-bucket revenue / cost / profit.
 *
 * Phase 2: range-scoped. Bucket granularity (day vs month) is
 * determined upstream by pickGranularity(bounds) — this component just
 * paints whatever array it's handed. The X-axis label tick interval
 * adapts to the bucket count so we don't crush 90 day-labels onto a
 * phone-width chart, nor over-thin 12 monthly labels.
 *
 * - Revenue: brand teal — what came in
 * - Cost:    warm tone — flyer payouts (totalPayout)
 * - Profit:  green — revenue − cost (already pre-computed on the order)
 */
export function RevenueCostProfitChart({
  data,
  title = 'Revenue vs cost vs profit',
}: {
  data: RcpPoint[];
  title?: string;
}) {
  const resolved = useTheme((s) => s.resolved);
  const ct = chartTokens(resolved);

  // Show ~6–10 labels on the X axis regardless of total bucket count.
  // Recharts' `interval` is "skip N between each shown tick", so a
  // 60-bucket chart with target=10 → interval = 5 (show every 6th).
  const xAxisInterval =
    data.length <= 12 ? 0 : Math.max(1, Math.floor(data.length / 10));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <div className="h-eyebrow">{title}</div>
        </div>
        {data.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No data in this range.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: ct.axisText }}
                  interval={xAxisInterval}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: ct.axisText }}
                  tickFormatter={(v) => fmtMoneyCompact(v)}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  cursor={{ fill: ct.grid, fillOpacity: 0.2 }}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    background: ct.tooltipBg,
                    color: ct.tooltipText,
                    border: `1px solid ${ct.tooltipBorder}`,
                  }}
                  formatter={(v: number, name: string) => [fmtMoney(v), name]}
                />
                <Legend
                  verticalAlign="top"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
                />
                <Bar dataKey="revenue" name="Revenue" fill={ct.primary} radius={[3, 3, 0, 0]} />
                <Bar dataKey="cost" name="Cost" fill={ct.cost} radius={[3, 3, 0, 0]} />
                <Bar dataKey="profit" name="Profit" fill={ct.profit} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
