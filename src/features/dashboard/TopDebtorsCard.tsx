import { Link } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/card';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import type { DebtorRow } from './aggregations';

/**
 * Customers ranked by outstandingBalance — the "who owes you the most
 * right now" list, useful for collections triage.
 *
 * Reads the customer.outstandingBalance stored rollup directly (kept in
 * sync transactionally by useCreateOrder / useUpdateOrderStatus / useDeleteOrder).
 * That's intentional: the rollup is the canonical balance and matches
 * the per-customer detail page exactly. Re-deriving from orders would
 * duplicate logic and risk drift.
 *
 * Empty state when nobody owes anything — same convention as Top
 * customers.
 */
export function TopDebtorsCard({ data }: { data: DebtorRow[] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="h-eyebrow mb-3">Top debtors · current balance</div>
        {data.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No outstanding balances 🎉</p>
        ) : (
          <ul className="space-y-2.5">
            {data.map((d, i) => (
              <li key={d.id} className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-status-awaiting text-xs font-semibold text-status-awaiting-fg">
                  {i + 1}
                </div>
                <Link
                  to={`/customers/${d.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {d.name}
                </Link>
                <MoneyDisplay amount={d.outstanding} className="text-sm tabular-nums text-status-awaiting-fg" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
