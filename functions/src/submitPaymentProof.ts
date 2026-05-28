import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';

// Primary database is named `default` (not `(default)`) — see src/lib/firebase.ts.
const DB_ID = 'default';

/**
 * Public callable — attach a payment proof to the order identified by trackingSlug.
 *
 * The image upload itself happens client-side directly to Storage (validated by
 * storage.rules). This function records the URL + note on the Firestore order,
 * appends a status-history entry, and writes an activity row for the admin feed.
 *
 * Status guard:
 *   Customers are allowed to pay EARLY — from any non-paid status (pending,
 *   received, with_flyer, in_transit, delivered, awaiting_payment). The only
 *   rejection here is `status === 'paid'`, to prevent a double-submit on a
 *   settled order. The order's `status` field is NOT changed by this function
 *   under any circumstance — only paymentProof / paymentReceivedAt /
 *   statusHistory[append] / updatedAt are written. Rollups (customer.
 *   outstandingBalance, totalSpent; flyer.kgUsed) are NEVER touched here.
 *
 * Money movement happens ONLY when the admin approves via the detail page,
 * which calls useUpdateOrderStatus with next:'paid' — that one transaction
 * is the canonical (and double-count-guarded) place where outstandingBalance
 * decreases and totalSpent increases.
 *
 * Idempotency:
 *   paymentProof is a single object field (NOT an array). A second submit
 *   replaces the previous proof in place — useful when a customer's first
 *   screenshot was unreadable or was rejected by the admin. statusHistory
 *   accumulates one entry per submit as a deliberate audit trail.
 */
export const submitPaymentProof = onCall(
  // `invoker: 'public'` grants public Cloud Run access so customers can upload
  // payment proofs without authenticating. The function itself still validates
  // input + only rejects when the order is already paid.
  { region: 'asia-southeast1', cors: true, invoker: 'public', maxInstances: 10 },
  async (req) => {
    const slug = String(req.data?.slug ?? '').trim();
    const imageUrl = String(req.data?.imageUrl ?? '').trim();
    const note = req.data?.note != null ? String(req.data.note).slice(0, 500) : undefined;

    if (!slug || slug.length < 6) throw new HttpsError('invalid-argument', 'Bad slug');
    if (!imageUrl.startsWith('https://')) throw new HttpsError('invalid-argument', 'Bad image URL');

    const db = getFirestore(getApp(), DB_ID);
    const qs = await db.collection('orders').where('trackingSlug', '==', slug).limit(1).get();
    if (qs.empty) throw new HttpsError('not-found', 'Order not found');

    const doc = qs.docs[0];
    const order = doc.data() as Record<string, unknown>;

    // Only rejection: order is already paid. Prevents double-submit on a
    // settled order. Customers can pay EARLY from any other status.
    if (order.status === 'paid') {
      throw new HttpsError('failed-precondition', 'This order is already paid');
    }

    const now = Timestamp.now();
    await doc.ref.update({
      // Replace any existing proof in place — idempotent re-submit.
      paymentProof: { uploadedAt: now, imageUrl, note: note ?? null },
      paymentReceivedAt: now,
      // statusHistory entry uses the order's CURRENT status as the label
      // (not a hard-coded 'awaiting_payment') so an early-paid pending
      // order's audit trail accurately records what state it was in
      // when the customer submitted.
      statusHistory: FieldValue.arrayUnion({
        status: order.status ?? 'pending',
        timestamp: now,
        note: 'Customer uploaded payment proof',
      }),
      updatedAt: now,
    });

    await db.collection('activity').add({
      type: 'payment_proof',
      orderId: doc.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      message: `Payment proof received for #${order.orderNumber}`,
      timestamp: now,
    });

    return { ok: true };
  },
);
