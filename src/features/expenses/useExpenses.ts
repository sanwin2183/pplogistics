import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import { fetchCol, orderBy, where } from '../../lib/queries';
import type { Expense } from '../../types';

/**
 * TanStack-Query hooks for the flat-root /expenses collection.
 *
 * Defensive payload construction — Firebase SDK v11 rejects writes that
 * contain a literal `undefined` field value (this repo hit it on Mark
 * Received and Settings save before; commits fd1d449 + a7f2cef). Optional
 * fields (note) are spread conditionally so we NEVER pass undefined to
 * addDoc/updateDoc.
 *
 * Expenses do NOT touch any rollup — they're independent of order /
 * customer / flyer state. So no transactions here; plain doc writes.
 */
const KEY = ['expenses'] as const;

/** Input shape — what callers supply; we add createdAt + denormalised
 *  categoryName. Date is a JS Date at the boundary, stored as Timestamp. */
export interface ExpenseInput {
  amount: number;
  date: Date;
  categoryId: string;
  categoryName: string;
  note?: string;
}

/** Fetch all expenses, newest date first. */
export function useExpenses() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<Expense>('expenses', orderBy('date', 'desc')),
  });
}

/**
 * Fetch a month's expenses (range filter on `date`). Pass start (inclusive)
 * and end (exclusive) — typically dayjs().startOf('month').toDate() and
 * dayjs().add(1,'month').startOf('month').toDate().
 *
 * Indexing note: this is a single-field range filter + same-field orderBy,
 * which Firestore handles via the automatic single-field index — no
 * composite index entry needed in firestore.indexes.json.
 */
export function useExpensesByMonth(monthStart: Date, monthEnd: Date) {
  // Stable key uses the start instant — month boundaries are unambiguous.
  return useQuery({
    queryKey: [...KEY, 'month', monthStart.getTime()],
    queryFn: () =>
      fetchCol<Expense>(
        'expenses',
        where('date', '>=', Timestamp.fromDate(monthStart)),
        where('date', '<', Timestamp.fromDate(monthEnd)),
        orderBy('date', 'desc'),
      ),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExpenseInput) => {
      // Conditional spread on `note` — never pass `undefined` to addDoc.
      const note = input.note?.trim();
      const ref = await addDoc(collection(db, 'expenses'), {
        amount: input.amount,
        date: Timestamp.fromDate(input.date),
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        ...(note ? { note } : {}),
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create expense');
    },
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ExpenseInput & { id: string }) => {
      const note = input.note?.trim();
      // updateDoc with a payload that omits `note` when empty so we don't
      // overwrite an existing valid note with undefined / clear it
      // unintentionally. To EXPLICITLY clear a note the caller can pass
      // note: null at a higher level — currently the form doesn't expose
      // that, so empty-string-on-edit just leaves the previous note.
      // (Matches the conditional-payload pattern used elsewhere.)
      await updateDoc(doc(db, 'expenses', id), {
        amount: input.amount,
        date: Timestamp.fromDate(input.date),
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        ...(note ? { note } : {}),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update expense');
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'expenses', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete expense');
    },
  });
}
