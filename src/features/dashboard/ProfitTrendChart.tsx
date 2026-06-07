import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent } from '../../components/ui/card';
import { fmtMoney, fmtMoneyCompact } from '../../lib/formatters';
import { useTheme, chartTokens } from '../../lib/theme';
import type { ProfitPoint } from './aggregations';

/**
 * Single-series profit line chart, range-scoped via Phase 2's
 * dashboardRange helpers. Same shape as the previous inline chart on
 * DashboardPage; extracted so the bucket-granularity / axis-interval
 * logic can be shared with the rest of the time-series charts.
 *
 * Header doubles as the period total — useful when the chart's y-axis
 * is compact (฿1.2K) but the user wants the exact figure at a glance.
 */
export function ProfitTrendChart({
  data,
  title = 'Profit trend',
}: {
  data: ProfitPoint[];
  title?: string;
}) {
  const resolved = useTheme((s) => s.resolved);
  const ct = chartTokens(resolved);
  const total = data.reduce((s, p) => s + p.profit, 0);

  // Match the RCP chart's interval logic so the two charts share the
  // same X-axis density when both are visible.
  const xAxisInterval =
    data.length <= 12 ? 0 : Math.max(1, Math.floor(data.length / 10));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <div>
            <div className="h-eyebrow">{title}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{fmtMoney(total)}</div>
          </div>
        </div>
        {data.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No data in this range.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
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
                  cursor={{ stroke: ct.primary, strokeOpacity: 0.2 }}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    background: ct.tooltipBg,
                    color: ct.tooltipText,
                    border: `1px solid ${ct.tooltipBorder}`,
                  }}
                  formatter={(v: number) => [fmtMoney(v), 'Profit']}
                />
                <Line type="monotone" dataKey="profit" stroke={ct.primary} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
