import { useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '../../components/ui/sheet';
import { firstFieldError, type FieldErrorHit } from '../../lib/forms';
import { cn } from '../../lib/utils';
import { useExpenseCategories } from './useExpenseCategories';
import { useCreateExpense, useUpdateExpense, type ExpenseInput } from './useExpenses';
import type { Expense } from '../../types';
import dayjs from 'dayjs';

/**
 * Bottom-sheet form for adding / editing an expense.
 *
 * Mirrors the OrderFormPage's defensive form pattern:
 *   - Field-named zod messages (not bare 'Required')
 *   - onInvalid surfaces the first field error as a toast naming the field
 *   - Red border + aria-invalid on the field that failed
 *   - The Select trigger picks up the same red treatment on
 *     `errors.categoryId`
 *   - Scroll-to-field on submit failure so an offscreen inline error
 *     doesn't leave the owner staring at a "does nothing" button
 *
 * If expenseCategories is empty, the dropdown is replaced by an inline
 * notice pointing at Settings → Expense categories (same UX as the
 * order form's empty-categories case).
 */

const schema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  // <input type="date"> binds to a YYYY-MM-DD string. We coerce + validate
  // shape rather than z.date() because the native input never produces a
  // Date instance — zod's z.date() would fail on every submit.
  date: z.string().min(1, 'Date is required'),
  categoryId: z.string().min(1, 'Category is required'),
  note: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  expense: Expense | null;
  onClose: () => void;
}

export function ExpenseFormSheet({ open, expense, onClose }: Props) {
  const { data: categories } = useExpenseCategories();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const isEdit = !!expense;

  // Refs for the field rows so onInvalid can scrollIntoView the
  // offending one on a tall form.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: 0,
      date: dayjs().format('YYYY-MM-DD'),
      categoryId: '',
      note: '',
    },
  });

  useEffect(() => {
    if (open) {
      if (expense) {
        // Edit: preload from existing doc. The date field stored as
        // Timestamp; convert to YYYY-MM-DD string for the native input.
        const d = expense.date && 'toDate' in expense.date ? expense.date.toDate() : null;
        reset({
          amount: expense.amount,
          date: d ? dayjs(d).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
          categoryId: expense.categoryId,
          note: expense.note ?? '',
        });
      } else {
        // Fresh form. Default the category to the first available so
        // an owner who taps Save without touching the dropdown still
        // passes validation (same backstop pattern the order form uses).
        const first = categories?.[0];
        reset({
          amount: 0,
          date: dayjs().format('YYYY-MM-DD'),
          categoryId: first?.id ?? '',
          note: '',
        });
      }
    }
  }, [open, expense, categories, reset]);

  function labelForError(hit: FieldErrorHit): string {
    const k = hit.path[0];
    if (k === 'amount') return `Amount: ${hit.message}`;
    if (k === 'date') return `Date: ${hit.message}`;
    if (k === 'categoryId') return `Category: ${hit.message}`;
    if (k === 'note') return `Note: ${hit.message}`;
    return hit.message;
  }

  function scrollToError(hit: FieldErrorHit) {
    const fieldName = String(hit.path[0] ?? '');
    const row = rowRefs.current[fieldName];
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      // setFocus throws on non-registered fields (e.g. Controller-wrapped
      // categoryId) — non-fatal, the scroll already happened.
      setFocus(fieldName as keyof FormData);
    } catch {
      /* non-registered field */
    }
  }

  const onSubmit = handleSubmit(
    async (data) => {
      try {
        const cat = categories?.find((c) => c.id === data.categoryId);
        const payload: ExpenseInput = {
          amount: data.amount,
          date: dayjs(data.date).toDate(),
          categoryId: data.categoryId,
          categoryName: cat?.name ?? '',
          // Trimmed-empty notes drop in the hook via conditional spread.
          note: data.note ?? '',
        };
        if (isEdit && expense) {
          await update.mutateAsync({ id: expense.id, ...payload });
          toast.success('Expense updated');
        } else {
          await create.mutateAsync(payload);
          toast.success('Expense added');
        }
        onClose();
      } catch {
        // mutation.onError already toasted.
      }
    },
    (errs) => {
      const hit = firstFieldError(errs);
      if (hit) {
        toast.error(labelForError(hit));
        scrollToError(hit);
      } else {
        toast.error('Please fix the highlighted fields');
      }
    },
  );

  const noCategories = categories !== undefined && categories.length === 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="sm:max-w-md sm:mx-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 max-h-[92svh] overflow-y-auto rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit expense' : 'Add expense'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={onSubmit} className="space-y-4 p-6 pt-2">
          {noCategories && (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              No expense categories yet — add them in{' '}
              <Link to="/settings" className="font-medium text-primary underline-offset-2 hover:underline">
                Settings → Expense categories
              </Link>{' '}
              before adding an expense.
            </div>
          )}

          <div
            ref={(el) => {
              rowRefs.current.amount = el;
            }}
            className="space-y-1.5"
          >
            <Label htmlFor="amount">Amount (THB)</Label>
            <Input
              id="amount"
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              autoFocus
              aria-invalid={!!errors.amount || undefined}
              className={cn(errors.amount && 'border-destructive focus:border-destructive')}
              {...register('amount')}
            />
            {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
          </div>

          <div
            ref={(el) => {
              rowRefs.current.date = el;
            }}
            className="space-y-1.5"
          >
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              aria-invalid={!!errors.date || undefined}
              className={cn(errors.date && 'border-destructive focus:border-destructive')}
              {...register('date')}
            />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>

          <div
            ref={(el) => {
              rowRefs.current.categoryId = el;
            }}
            className="space-y-1.5"
          >
            <Label>Category</Label>
            <Controller
              control={control}
              name="categoryId"
              render={({ field: f }) => (
                <Select
                  value={f.value}
                  onValueChange={(v) => {
                    f.onChange(v);
                    setValue('categoryId', v);
                  }}
                  disabled={noCategories}
                >
                  <SelectTrigger
                    aria-invalid={!!errors.categoryId || undefined}
                    className={cn(
                      errors.categoryId &&
                        'border-destructive ring-2 ring-destructive/20 focus:border-destructive',
                    )}
                  >
                    <SelectValue placeholder={noCategories ? 'No categories' : 'Pick a category'} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.categoryId && (
              <p className="text-xs text-destructive">{errors.categoryId.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" rows={2} {...register('note')} />
          </div>

          <SheetFooter className="p-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || noCategories}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
