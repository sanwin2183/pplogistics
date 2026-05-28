import { useState } from 'react';
import { Plus, Pencil, Trash2, Tags } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { Skeleton } from '../../components/ui/skeleton';
import { firstErrorMessage } from '../../lib/forms';
import {
  useExpenseCategories,
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  useDeleteExpenseCategory,
} from '../expenses/useExpenseCategories';
import type { ExpenseCategory } from '../../types';

/**
 * Expense-category CRUD list. Lives in Settings → Expense categories.
 * Mirrors the order-category CRUD pattern (src/features/categories/
 * CategoriesPage.tsx) but with the simpler schema — expense categories
 * only have `name`, no per-kg rate, no prohibited flag.
 *
 * Defensive UI:
 *   - onError toasts on every mutation (via the hooks).
 *   - onInvalid surfaces field-named errors via firstErrorMessage.
 *   - Delete behind a Radix Dialog confirm (matches the project's
 *     pattern; no browser confirm() — see customer-delete dialog).
 */

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
});
type FormData = z.infer<typeof schema>;

export function ExpenseCategoriesTab() {
  const { data, isLoading } = useExpenseCategories();
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<ExpenseCategory | null>(null);
  const del = useDeleteExpenseCategory();

  async function onConfirmDelete() {
    if (!confirmingDelete) return;
    try {
      await del.mutateAsync(confirmingDelete.id);
      toast.success('Expense category deleted');
      setConfirmingDelete(null);
    } catch {
      /* mutation.onError already toasted */
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Preset categories used by the Expenses card on the Dashboard.
        </p>
        <Button onClick={() => setCreating(true)}>
          <Plus /> New
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="card-soft p-8 text-center">
          <Tags className="mx-auto mb-3 h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm font-semibold">No expense categories yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add categories like "Packaging" or "Transport" to organise daily expenses.
          </p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            <Plus /> Create your first category
          </Button>
        </div>
      ) : (
        <div className="card-soft divide-y divide-border">
          {data.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1 text-sm font-medium">{c.name}</div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit"
                  onClick={() => setEditing(c)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete"
                  onClick={() => setConfirmingDelete(c)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ExpenseCategoryDialog
        open={creating || !!editing}
        category={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />

      <Dialog
        open={!!confirmingDelete}
        onOpenChange={(o) => !o && setConfirmingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete expense category</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Delete <span className="font-medium">{confirmingDelete?.name}</span>?
            </p>
            <p className="text-xs text-muted-foreground">
              Existing expenses recorded against this category keep their{' '}
              <code>categoryName</code> as a snapshot — they won't disappear from
              the Dashboard. New expenses just won't be able to pick this category
              from the dropdown.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={del.isPending}
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpenseCategoryDialog({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: ExpenseCategory | null;
  onClose: () => void;
}) {
  const create = useCreateExpenseCategory();
  const update = useUpdateExpenseCategory();
  const isEdit = !!category;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: category?.name ?? '' },
    values: { name: category?.name ?? '' },
  });

  const onSubmit = handleSubmit(
    async (data) => {
      try {
        if (isEdit && category) {
          await update.mutateAsync({ id: category.id, name: data.name });
          toast.success('Expense category updated');
        } else {
          await create.mutateAsync({ name: data.name });
          toast.success('Expense category created');
        }
        reset();
        onClose();
      } catch {
        /* mutation.onError already toasted */
      }
    },
    (errs) => {
      toast.error(firstErrorMessage(errs) ?? 'Please fix the highlighted fields');
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit expense category' : 'New expense category'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoFocus {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
