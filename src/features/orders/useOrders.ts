import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import { ref as storageRef, listAll, deleteObject } from 'firebase/storage';
import { toast } from 'sonner';
import { db, storage } from '../../lib/firebase';
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

/**
 * Atomically delete an order AND reverse every rollup it contributed to.
 *
 * Mirrors useCreateOrder's reads-before-writes transaction shape so the
 * SDK's "Firestore transactions require all reads to be executed before
 * all writes" hard rule is respected even across multi-flyer orders. The
 * status-aware reversal of customer monetary rollups (outstandingBalance
 * vs totalSpent) keeps the books symmetric: whichever bucket gained
 * order.totalAmount on create / `paid` loses it back on delete.
 *
 *   Phase 1 — READS (parallel):
 *     tx.get(customer) + tx.get(each UNIQUE flyer in flyerAssignments[])
 *
 *   Phase 2 — COMPUTE (plain JS):
 *     customer.totalOrders        : max(0, prev − 1)
 *     if order.status === 'paid':
 *       customer.totalSpent        : max(0, prev − order.totalAmount)
 *       customer.outstandingBalance: unchanged
 *     else:
 *       customer.outstandingBalance: max(0, prev − order.totalAmount)
 *       customer.totalSpent        : unchanged
 *     kgByFlyer = Σ assignments[].weightKg per unique flyerId
 *     each flyer.kgUsed            : max(0, prev − Σ kg for this flyer)
 *
 *   Phase 3 — WRITES (after every read):
 *     tx.update(customer), tx.update(each flyer), tx.delete(orderRef)
 *
 * AFTER the tx commits (best-effort, NOT atomic with the rollup):
 *   - Storage cleanup of payment-proofs/{trackingSlug}/* (admin-allowed
 *     per §11). Captures the slug before delete so the path is still
 *     reachable. Failures log a console.warn + soft toast — they do NOT
 *     fail the delete (the rollup + doc removal already succeeded).
 *   - logActivity('order_deleted') — fire-and-forget audit trail.
 */
export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (order: Order) => {
      const orderRef = doc(db, 'orders', order.id);

      await runTransaction(db, async (tx) => {
        // ---- Phase 1: reads (parallel) ----
        const cRef = doc(db, 'customers', order.customerId);
        // Dedupe — Firestore rejects two tx.get() calls on the same ref
        // within one transaction, which would fire if the same flyer
        // appeared in multiple assignment rows (allowed per §19 partial
        // assignment).
        const flyerIds = Array.from(new Set(order.flyerAssignments.map((a) => a.flyerId)));
        const flyerRefs = new Map(flyerIds.map((id) => [id, doc(db, 'flyers', id)] as const));

        const [cSnap, ...flyerSnaps] = await Promise.all([
          tx.get(cRef),
          ...flyerIds.map((id) => tx.get(flyerRefs.get(id)!)),
        ]);

        // ---- Phase 2: compute ----
        // Sum kg per unique flyer — collapses the same-flyer-in-multiple-
        // rows case into one delta per flyer (matches the create math).
        const kgByFlyer = new Map<string, number>();
        for (const a of order.flyerAssignments) {
          kgByFlyer.set(a.flyerId, (kgByFlyer.get(a.flyerId) ?? 0) + a.weightKg);
        }

        // ---- Phase 3: writes ----
        // 3a. Customer rollups (status-aware).
        if (cSnap.exists()) {
          const d = cSnap.data();
          // totalOrders always −1. Clamped at 0 so stale data from a
          // direct DB edit or a prior bug can't introduce negatives.
          const customerUpdate: Record<string, unknown> = {
            totalOrders: Math.max(0, (d.totalOrders ?? 0) - 1),
          };
          if (order.status === 'paid') {
            // Paid orders' totalAmount lives in totalSpent (moved there
            // by the 'paid' transition in useUpdateOrderStatus); reverse
            // from there, leave outstandingBalance untouched.
            customerUpdate.totalSpent = Math.max(0, (d.totalSpent ?? 0) - order.totalAmount);
          } else {
            // Unpaid orders' totalAmount still sits in outstandingBalance
            // (added at create); reverse from there.
            customerUpdate.outstandingBalance = Math.max(
              0,
              (d.outstandingBalance ?? 0) - order.totalAmount,
            );
          }
          tx.update(cRef, customerUpdate);
        }

        // 3b. Flyer kgUsed — one update per unique flyer.
        for (let i = 0; i < flyerIds.length; i++) {
          const fSnap = flyerSnaps[i];
          if (!fSnap.exists()) continue;
          const id = flyerIds[i];
          const prev = (fSnap.data().kgUsed as number | undefined) ?? 0;
          const delta = kgByFlyer.get(id) ?? 0;
          tx.update(flyerRefs.get(id)!, {
            kgUsed: Math.max(0, prev - delta),
            updatedAt: serverTimestamp(),
          });
        }

        // 3c. Delete the order doc itself — last write so the rollup
        //     reversals share atomicity with the removal.
        tx.delete(orderRef);
      });

      // ---- Post-tx best-effort cleanup (NOT atomic) ----
      // Failures here must NOT throw — the order has already been deleted
      // and rollups already reversed; surfacing a hard error would imply
      // the whole operation failed when it didn't.

      // Storage proof cleanup. Lists the payment-proofs/{slug}/ folder
      // and deletes each object. Handles the multi-upload case (customer
      // uploads → admin rejects → customer re-uploads → admin rejects)
      // where orphan files would otherwise accumulate in Storage. Admin
      // is authed (route-level ProtectedRoute) so the Storage rule
      // `payment-proofs/{slug}/*: admin-only delete` (§11) permits it.
      try {
        const folderRef = storageRef(storage, `payment-proofs/${order.trackingSlug}`);
        const list = await listAll(folderRef);
        if (list.items.length > 0) {
          // Promise.allSettled so one failure doesn't stop the others.
          await Promise.allSettled(list.items.map((item) => deleteObject(item)));
        }
      } catch (err) {
        console.warn('[useDeleteOrder] proof cleanup failed', err);
        toast.warning('Order deleted, but a payment-proof file may remain in storage.');
      }

      // Activity audit trail — fire-and-forget per logActivity's contract.
      logActivity({
        type: 'order_deleted',
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        message: `Order #${order.orderNumber} deleted (${order.customerName}, ${order.status})`,
      });
    },
    onSuccess: () => {
      // Both customer rollups and flyer.kgUsed changed in the transaction
      // — invalidate their caches alongside the orders list so the
      // dashboard, flyer page, and customer page all refresh.
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['flyers'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete order');
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
      // Clear the proof and record the rejection in history. Status is NOT
      // changed — this is the simple rule that handles both the canonical
      // case (proof rejected while at awaiting_payment → stays at
      // awaiting_payment, customer re-uploads) and the early-payment case
      // (proof rejected while still at pending/received/with_flyer/
      // in_transit/delivered → stays at that logistics state, doesn't
      // skip the flow back to awaiting_payment). The previous code
      // hard-coded a write to status:'awaiting_payment' which broke the
      // early-payment case by yanking in-flight orders back to a state
      // they had not actually reached.
      //
      // The statusHistory entry's `status` label mirrors the order's
      // CURRENT status so the audit trail reads correctly — same pattern
      // submitPaymentProof now uses for its "proof uploaded" entry.
      const entry: StatusHistoryEntry = {
        status: order.status,
        timestamp: Timestamp.now(),
        note: `Payment rejected: ${note}`,
      };
      await updateDoc(ref, {
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
