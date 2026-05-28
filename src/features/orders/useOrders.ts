import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  arrayUnion,
  deleteDoc,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '../../lib/firebase';
import { fetchCol, fetchDoc, orderBy, where } from '../../lib/queries';
import type {
  Order,
  OrderStatus,
  StatusHistoryEntry,
  PaymentProof,
  FlyerAssignment,
} from '../../types';
import { logActivity } from '../../lib/activity';
import { newOrderNumber, newTrackingSlug } from '../../lib/tracking';

const KEY = ['orders'] as const;

export function useOrders() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<Order>('orders', orderBy('createdAt', 'desc')),
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => fetchDoc<Order>('orders', id!),
    enabled: !!id,
  });
}

export function useOrdersByCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'byCustomer', customerId],
    queryFn: () =>
      fetchCol<Order>(
        'orders',
        where('customerId', '==', customerId),
        orderBy('createdAt', 'desc'),
      ),
    enabled: !!customerId,
  });
}

export function useOrdersByFlyer(flyerId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'byFlyer', flyerId],
    // Firestore can't query nested array-of-object fields by inner key efficiently
    // without an index hack, so we filter client-side. Volume here is low.
    queryFn: async () => {
      const all = await fetchCol<Order>('orders', orderBy('createdAt', 'desc'));
      return all.filter((o) => o.flyerAssignments.some((a) => a.flyerId === flyerId));
    },
    enabled: !!flyerId,
  });
}

type CreateOrderInput = Omit<
  Order,
  'id' | 'orderNumber' | 'trackingSlug' | 'status' | 'statusHistory' | 'photos' | 'createdAt' | 'updatedAt'
>;

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      const orderNumber = newOrderNumber();
      const trackingSlug = newTrackingSlug();
      const now = Timestamp.now();
      const firstHistory: StatusHistoryEntry = { status: 'pending', timestamp: now, note: 'Order created' };

      const ref = await addDoc(collection(db, 'orders'), {
        ...input,
        orderNumber,
        trackingSlug,
        status: 'pending' as OrderStatus,
        statusHistory: [firstHistory],
        photos: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Update flyer.kgUsed for each assignment + customer rollups in a transaction.
      await runTransaction(db, async (tx) => {
        for (const a of input.flyerAssignments) {
          const fRef = doc(db, 'flyers', a.flyerId);
          const fSnap = await tx.get(fRef);
          if (fSnap.exists()) {
            const prev = (fSnap.data().kgUsed as number | undefined) ?? 0;
            tx.update(fRef, { kgUsed: prev + a.weightKg, updatedAt: serverTimestamp() });
          }
        }
        const cRef = doc(db, 'customers', input.customerId);
        const cSnap = await tx.get(cRef);
        if (cSnap.exists()) {
          const d = cSnap.data();
          tx.update(cRef, {
            totalOrders: (d.totalOrders ?? 0) + 1,
            outstandingBalance: (d.outstandingBalance ?? 0) + input.totalAmount,
          });
        }
      });

      logActivity({
        type: 'order_created',
        orderId: ref.id,
        orderNumber,
        customerName: input.customerName,
        message: `Order #${orderNumber} created for ${input.customerName}`,
      });

      return { id: ref.id, trackingSlug };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['flyers'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ order, next, note }: { order: Order; next: OrderStatus; note?: string }) => {
      const ref = doc(db, 'orders', order.id);
      // Build the history entry so `note` is OMITTED when undefined — Firestore
      // SDK v11 rejects `note: undefined` inside arrayUnion() before any network
      // call, which was silently failing every "Mark Received / Hand to flyer /
      // Flight departed / Mark delivered / Request payment" tap (none of those
      // pass a note). Approve-payment worked because it passes a string note.
      const entry: StatusHistoryEntry = {
        status: next,
        timestamp: Timestamp.now(),
        ...(note != null ? { note } : {}),
      };

      // Side effects on certain transitions:
      const extras: Record<string, unknown> = {};
      if (next === 'paid') {
        extras.paymentApprovedAt = serverTimestamp();
        // Reduce customer outstanding by totalAmount.
        const cRef = doc(db, 'customers', order.customerId);
        await runTransaction(db, async (tx) => {
          const cSnap = await tx.get(cRef);
          if (cSnap.exists()) {
            const d = cSnap.data();
            tx.update(cRef, {
              totalSpent: (d.totalSpent ?? 0) + order.totalAmount,
              outstandingBalance: Math.max(0, (d.outstandingBalance ?? 0) - order.totalAmount),
            });
          }
        });
      }

      await updateDoc(ref, {
        status: next,
        statusHistory: arrayUnion(entry),
        updatedAt: serverTimestamp(),
        ...extras,
      });

      logActivity({
        type: 'order_status',
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        message: `#${order.orderNumber} → ${next.replace('_', ' ')}`,
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: [...KEY, vars.order.id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    // Surface any failure as a toast so a tap is never silent. Callers may
    // additionally try/catch around mutateAsync for context-specific UX.
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update order status');
    },
  });
}

export function useAddOrderPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, url }: { orderId: string; url: string }) => {
      await updateDoc(doc(db, 'orders', orderId), {
        photos: arrayUnion(url),
        updatedAt: serverTimestamp(),
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [...KEY, vars.orderId] });
    },
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'orders', id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useApprovePaymentProof() {
  return useUpdateOrderStatus();
}

export function useRejectPaymentProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ order, note }: { order: Order; note: string }) => {
      const ref = doc(db, 'orders', order.id);
      // Roll back to awaiting_payment and record the rejection in history; clear paymentProof.
      const entry: StatusHistoryEntry = {
        status: 'awaiting_payment',
        timestamp: Timestamp.now(),
        note: `Payment rejected: ${note}`,
      };
      await updateDoc(ref, {
        status: 'awaiting_payment',
        paymentProof: null,
        statusHistory: arrayUnion(entry),
        updatedAt: serverTimestamp(),
      });
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: [...KEY, vars.order.id] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to reject payment proof');
    },
  });
}

/** Replace one assignment with another (used by flyer payout toggle). Exposed as helper. */
export type { FlyerAssignment, PaymentProof };
