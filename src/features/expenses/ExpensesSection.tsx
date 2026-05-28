import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react';
import dayjs from 'dayjs';
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
import { useExpensesByMonth, useDeleteExpense } from './useExpenses';
import { ExpenseFormSheet } from './ExpenseFormSheet';
import type { Expense } from '../../types';

/**
 * Expenses card for the Dashboard. Shows this-month total + recent
 * entries + Add/Edit/Delete affordances. Time-scoping defaults to the
 * CURRENT month so the figure matches the Dashboard's existing gross-
 * profit-this-month card (Dashboard relabels the existing card as
 * "gross" and reads this section's total to compute net).
 *
 * Net profit is computed in DashboardPage (not here) because it needs
 * both this card's total AND the orders data. The two cards share the
 * SAME month window via the same dayjs().startOf('month') call shape,
 * so the gross / expenses / net trio is internally consistent.
 */
export function ExpensesSection({
  monthStart,
  monthEnd,
}: {
  monthStart: Date;
  monthEnd: Date;
}) {
  const { data: expenses, isLoading } = useExpensesByMonth(monthStart, monthEnd);
  const del = useDeleteExpense();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Expense | null>(null);

  const total = useMemo(
    () => (expenses ?? []).reduce((s, e) => s + e.amount, 0),
    [expenses],
  );

  const RECENT_LIMIT = 8;
  const recent = (expenses ?? []).slice(0, RECENT_LIMIT);
  const moreCount = (expenses?.length ?? 0) - recent.length;

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
              <Receipt className="h-3.5 w-3.5" /> Expenses · this month
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
            No expenses recorded for {dayjs(monthStart).format('MMMM YYYY')} yet.
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
            +{moreCount} more this month
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
              month's net profit.
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
