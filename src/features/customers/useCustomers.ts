import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import { fetchCol, fetchDoc, orderBy } from '../../lib/queries';
import type { Customer } from '../../types';

const KEY = ['customers'] as const;

export function useCustomers() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<Customer>('customers', orderBy('name', 'asc')),
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => fetchDoc<Customer>('customers', id!),
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Customer, 'id' | 'createdAt' | 'totalOrders' | 'totalSpent' | 'outstandingBalance'>) => {
      const ref = await addDoc(collection(db, 'customers'), {
        ...input,
        totalOrders: 0,
        totalSpent: 0,
        outstandingBalance: 0,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create customer');
    },
  });
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...rest }: Customer) => {
      await updateDoc(doc(db, 'customers', id), rest);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update customer');
    },
  });
}
