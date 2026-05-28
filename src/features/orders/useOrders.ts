import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
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

      // Pre-generate a doc ref so the order create itself runs INSIDE the
      // transaction (tx.set), not as a separate addDoc before it. This makes
      // order + rollups truly atomic: a transaction failure can't leave an
      // orphan order with stale customer/flyer rollups.
      const orderRef = doc(collection(db, 'orders'));

      // Firestore transactions REQUIRE all reads before any writes (the
      // "Firestore transactions require all reads to be executed before all
      // writes" error was firing on every order create here). The previous
      // shape read flyer → wrote flyer → looped → then read the customer
      // AFTER the flyer write, breaking the rule.
      //
      // New shape — three explicit phases:
      //
      //   Phase 1 — READS:
      //     - the customer doc once,
      //     - each UNIQUE flyer id from flyerAssignments[] once
      //       (Firestore rejects two tx.get() calls on the same ref within a
      //       single transaction, so we deduplicate even if the same flyer
      //       appears in multiple assignment rows — partial assignment per
      //       §19 is allowed but the SDK still wouldn't accept duplicate
      //       reads).
      //     All reads kicked off in parallel via Promise.all so the
      //     transaction's read latency is one round-trip total, not N.
      //
      //   Phase 2 — COMPUTE:
      //     Plain-JS reduction of the snapshots:
      //       * customer.totalOrders + 1
      //       * customer.outstandingBalance + totalAmount (math unchanged
      //         — keeps the §5/§11 invariant that the later 'paid'
      //         transition decrements outstandingBalance by the same
      //         totalAmount, see useUpdateOrderStatus 'paid' branch).
      //       * For each flyer: previous kgUsed + sum of all weightKg
      //         assigned to that flyer in this order (handles the
      //         same-flyer-in-multiple-rows case).
      //
      //   Phase 3 — WRITES (all after every read has resolved):
      //     1. tx.set(orderRef, …)  — create the order doc
      //     2. tx.update(customerRef, …)  — bump rollups
      //     3. tx.update(flyerRef, …)  for each unique flyer
      await runTransaction(db, async (tx) => {
        // ---- Phase 1: reads ----
        const cRef = doc(db, 'customers', input.customerId);
        const flyerIds = Array.from(new Set(input.flyerAssignments.map((a) => a.flyerId)));
        const flyerRefs = new Map(flyerIds.map((id) => [id, doc(db, 'flyers', id)] as const));

        const [cSnap, ...flyerSnaps] = await Promise.all([
          tx.get(cRef),
          ...flyerIds.map((id) => tx.get(flyerRefs.get(id)!)),
        ]);

        // ---- Phase 2: compute ----
        // Sum the kg assigned to each flyer in this order (collapses the
        // multi-row-same-flyer case into one delta per flyer).
        const kgByFlyer = new Map<string, number>();
        for (const a of input.flyerAssignments) {
          kgByFlyer.set(a.flyerId, (kgByFlyer.get(a.flyerId) ?? 0) + a.weightKg);
        }

        // ---- Phase 3: writes ----
        // 3a. Create the order doc inside the transaction.
        tx.set(orderRef, {
          ...input,
          orderNumber,
          trackingSlug,
          status: 'pending' as OrderStatus,
          statusHistory: [firstHistory],
          photos: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        // 3b. Customer rollups.
        if (cSnap.exists()) {
          const d = cSnap.data();
          tx.update(cRef, {
            totalOrders: (d.totalOrders ?? 0) + 1,
            outstandingBalance: (d.outstandingBalance ?? 0) + input.totalAmount,
          });
        }

        // 3c. Flyer kgUsed rollup — one update per unique flyer.
        for (let i = 0; i < flyerIds.length; i++) {
          const fSnap = flyerSnaps[i];
          if (!fSnap.exists()) continue;
          const id = flyerIds[i];
          const prev = (fSnap.data().kgUsed as number | undefined) ?? 0;
          const delta = kgByFlyer.get(id) ?? 0;
          tx.update(flyerRefs.get(id)!, {
            kgUsed: prev + delta,
            updatedAt: serverTimestamp(),
          });
        }
      });

      logActivity({
        type: 'order_created',
        orderId: orderRef.id,
        orderNumber,
        customerName: input.customerName,
        message: `Order #${orderNumber} created for ${input.customerName}`,
      });

      return { id: orderRef.id, trackingSlug };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['flyers'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    // Surface any transaction failure as a toast so a tap never looks silent
    // — matches the defensive pattern used by useUpdateOrderStatus + the
    // mark-as-paid / reject-payment mutations. Callers may additionally
    // try/catch around mutateAsync for context-specific UX.
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create order');
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      next,
      note,
      paidVia,
    }: {
      order: Order;
      next: OrderStatus;
      note?: string;
      /** Set when transitioning to 'paid' — distinguishes proof-approval from a
       *  manually-marked external payment. Omit for any other transition. */
      paidVia?: 'proof' | 'external';
    }) => {
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
        // Spread conditionally so undefined never reaches updateDoc.
        if (paidVia) extras.paidVia = paidVia;
        // Customer-rollup transaction — only run when transitioning to paid for
        // the first time. The OrderDetailPage hides the "Approve payment" /
        // "Mark as paid" actions once status==='paid', but this defensive gate
        // prevents accidental double-counting of totalSpent / outstandingBalance
        // if the mutation is ever invoked twice for an already-paid order.
        if (order.status !== 'paid') {
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
