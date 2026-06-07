import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent } from '../../components/ui/card';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtMoney } from '../../lib/formatters';
import { useTheme, chartTokens } from '../../lib/theme';
import type { RouteRevenueSlice } from './aggregations';

/**
 * Donut of revenue by route (BKK→YGN / BKK→MDL / etc) for the period.
 *
 * The order → flyer → route join is done in aggregations.revenueByRoute
 * (mirrors the known-correct logic in ReportsPage byRoute, NOT the
 * broken dashboard kg-by-status chart that this card replaces).
 */
export function RevenueByRouteChart({
  data,
  title = 'Revenue by route · this month',
}: {
  data: RouteRevenueSlice[];
  title?: string;
}) {
  const resolved = useTheme((s) => s.resolved);
  const ct = chartTokens(resolved);
  const total = data.reduce((s, d) => s + d.revenue, 0);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="h-eyebrow">{title}</div>
            <MoneyDisplay amount={total} className="mt-1 text-lg font-semibold" />
          </div>
        </div>
        {data.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No paid orders this month yet.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="revenue"
                  nameKey="label"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={ct.palette[i % ct.palette.length]} />
                  ))}
                </Pie>
                <Tooltip
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
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
