import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { fetchCol, orderBy } from '../../lib/queries';
import type { Category } from '../../types';

const KEY = ['categories'] as const;

export function useCategories() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<Category>('categories', orderBy('name', 'asc')),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Category, 'id'>) => {
      const ref = await addDoc(collection(db, 'categories'), input);
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...rest }: Category) => {
      await updateDoc(doc(db, 'categories', id), rest);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'categories', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
