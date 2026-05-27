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
 * The status is NOT changed here — admin must approve via the detail page,
 * which sets status='paid' and paymentApprovedAt.
 */
export const submitPaymentProof = onCall(
  { region: 'asia-southeast1', cors: true, maxInstances: 10 },
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

    // Only accept proofs when awaiting payment — silently ignore otherwise to avoid
    // leaking status info.
    if (order.status !== 'awaiting_payment') {
      throw new HttpsError('failed-precondition', 'Order is not awaiting payment');
    }

    const now = Timestamp.now();
    await doc.ref.update({
      paymentProof: { uploadedAt: now, imageUrl, note: note ?? null },
      paymentReceivedAt: now,
      statusHistory: FieldValue.arrayUnion({
        status: 'awaiting_payment',
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
