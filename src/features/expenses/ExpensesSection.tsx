import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtDate, fmtMoney, toDate } from '../../lib/formatters';
import { useExpenses, useDeleteExpense } from './useExpenses';
import { ExpenseFormSheet } from './ExpenseFormSheet';
import {
  filterExpensesByRange,
  type RangeBounds,
} from '../dashboard/dashboardRange';
import type { Expense } from '../../types';

/**
 * Expenses card for the Dashboard. Phase 2: range-scoped via the
 * shared RangeBounds shape (lifetime / this-month / pick-month /
 * custom). Internally pulls ALL expenses with useExpenses() and
 * filters client-side, then computes total + recent-list off the
 * filtered subset.
 *
 * Why fetch-all + client-filter (vs the previous server-side
 * useExpensesByMonth):
 *   - The selectable ranges are arbitrary (Custom can be any window),
 *     so a fixed monthly query doesn't fit anymore.
 *   - Expense volume is tiny — at this point a few dozen docs
 *     lifetime. Pulling all once and slicing in JS is cheaper and
 *     simpler than range-aware Firestore queries with composite
 *     indexes.
 *   - TanStack-Query dedupes the useExpenses() call — DashboardPage
 *     also reads it for the net-profit calculation, but only one
 *     network fetch fires per cache window.
 *
 * Net profit lives in DashboardPage (needs both this card's total AND
 * the orders profit). That parent filters by the SAME bounds, so
 * gross / expenses / net stay internally consistent.
 *
 * Add/Edit/Delete don't depend on the range — adding a new expense
 * creates it for today regardless of the dashboard's current view
 * window. If the new expense falls inside the active window, it
 * appears immediately via the TanStack invalidation; if it doesn't,
 * the card list won't show it but the underlying record is created
 * correctly.
 */
export function ExpensesSection({
  bounds,
  rangeLabel,
}: {
  /** Resolved bounds from getRangeBounds() in the parent. */
  bounds: RangeBounds;
  /** Human-readable label for the period (e.g. "this month",
   *  "March 2026", "all time"). Composed into the eyebrow + empty
   *  state copy by the parent so wording stays consistent
   *  across the dashboard. */
  rangeLabel: string;
}) {
  const { data: allExpenses, isLoading } = useExpenses();
  const del = useDeleteExpense();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Expense | null>(null);

  // Range-scoped subset. When bounds.valid === false (Custom with bad
  // dates) we render empty rather than crash — the dashboard's
  // DateRangeControl already surfaces the validation message.
  const expenses = useMemo(
    () => (allExpenses ? filterExpensesByRange(allExpenses, bounds) : []),
    [allExpenses, bounds],
  );

  const total = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses],
  );

  const RECENT_LIMIT = 8;
  // Sort the filtered list newest-date-first so the recent slice
  // shows the latest entries (useExpenses() already orders by date
  // desc, but client-side filter preserves that order — keeping the
  // explicit sort here is robust against future hook changes).
  const recent = useMemo(
    () =>
      [...expenses]
        .sort((a, b) => {
          const aT = toDate(a.date)?.getTime() ?? 0;
          const bT = toDate(b.date)?.getTime() ?? 0;
          return bT - aT;
        })
        .slice(0, RECENT_LIMIT),
    [expenses],
  );
  const moreCount = expenses.length - recent.length;

  async function confirmDelete() {
    if (!confirmingDelete) return;
    try {
      await del.mutateAsync(confirmingDelete.id);
      toast.success('Expense deleted');
      setConfirmingDelete(null);
    } catch {
      // mutation.onError already toasted.
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="h-eyebrow flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Expenses · {rangeLabel}
            </div>
            {isLoading ? (
              <Skeleton className="mt-1 h-7 w-32" />
            ) : (
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {fmtMoney(total)}
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add expense
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="rounded-lg bg-muted/40 p-4 text-center text-xs text-muted-foreground">
            No expenses recorded for {rangeLabel}.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{e.categoryName}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {fmtDate(toDate(e.date))}
                    </span>
                  </div>
                  {e.note && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.note}</p>
                  )}
                </div>
                <MoneyDisplay amount={e.amount} className="text-sm tabular-nums" />
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit expense"
                    onClick={() => setEditing(e)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete expense"
                    onClick={() => setConfirmingDelete(e)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {moreCount > 0 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            +{moreCount} more in this range
          </p>
        )}
      </CardContent>

      <ExpenseFormSheet
        open={creating || !!editing}
        expense={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <Dialog
        open={!!confirmingDelete}
        onOpenChange={(o) => !o && setConfirmingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Delete the{' '}
              <span className="font-medium tabular-nums">
                {confirmingDelete ? fmtMoney(confirmingDelete.amount) : ''}
              </span>{' '}
              <span className="font-medium">{confirmingDelete?.categoryName}</span>{' '}
              expense from{' '}
              <span className="font-medium tabular-nums">
                {confirmingDelete ? fmtDate(toDate(confirmingDelete.date)) : ''}
              </span>
              ?
            </p>
            <p className="text-xs text-muted-foreground">
              This cannot be undone. The expense is general overhead and doesn't
              touch any order or customer rollup — removing it just adjusts the
              net profit for the period it falls in.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={del.isPending}
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
