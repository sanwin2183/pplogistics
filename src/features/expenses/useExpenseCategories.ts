import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import { fetchCol, orderBy } from '../../lib/queries';
import type { ExpenseCategory } from '../../types';

/**
 * TanStack-Query hooks for expenseCategories — the preset list that
 * pre-fills the expense form's category dropdown. Mirrors the existing
 * useCategories pattern (§8). Admin-only collection per §11.
 */
const KEY = ['expenseCategories'] as const;

export function useExpenseCategories() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<ExpenseCategory>('expenseCategories', orderBy('name', 'asc')),
  });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const ref = await addDoc(collection(db, 'expenseCategories'), {
        name: input.name,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create expense category');
    },
  });
}

export function useUpdateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await updateDoc(doc(db, 'expenseCategories', id), { name });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update expense category');
    },
  });
}

export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'expenseCategories', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete expense category');
    },
  });
}
