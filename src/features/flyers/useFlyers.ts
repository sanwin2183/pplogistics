import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { fetchCol, fetchDoc, orderBy, where } from '../../lib/queries';
import type { Flyer, FlyerStatus } from '../../types';

const KEY = ['flyers'] as const;

export function useFlyers() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<Flyer>('flyers', orderBy('flightDate', 'asc')),
  });
}

export function useUpcomingFlyers() {
  return useQuery({
    queryKey: [...KEY, 'upcoming'],
    queryFn: () =>
      fetchCol<Flyer>(
        'flyers',
        where('status', 'in', ['upcoming', 'in-transit'] satisfies FlyerStatus[]),
        orderBy('status', 'asc'),
        orderBy('flightDate', 'asc'),
      ),
  });
}

export function useFlyer(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => fetchDoc<Flyer>('flyers', id!),
    enabled: !!id,
  });
}

type FlyerInput = Omit<Flyer, 'id' | 'kgUsed' | 'createdAt' | 'updatedAt' | 'flightDate'> & {
  flightDate: Date;
};

export function useCreateFlyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FlyerInput) => {
      const ref = await addDoc(collection(db, 'flyers'), {
        ...input,
        flightDate: Timestamp.fromDate(input.flightDate),
        kgUsed: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateFlyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, flightDate, ...rest }: Omit<Flyer, 'flightDate'> & { flightDate: Date }) => {
      await updateDoc(doc(db, 'flyers', id), {
        ...rest,
        flightDate: Timestamp.fromDate(flightDate),
        updatedAt: serverTimestamp(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteFlyer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'flyers', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
