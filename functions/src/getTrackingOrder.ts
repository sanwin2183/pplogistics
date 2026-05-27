import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';

// Primary database is named `default` (not `(default)`) — see src/lib/firebase.ts.
const DB_ID = 'default';

/**
 * Public callable — returns a SANITIZED view of an order keyed by trackingSlug.
 *
 * Sanitization rules (per spec):
 *   - Strip flyerAssignments[].payoutRatePerKg, payoutAmount, paidOutAt
 *   - Strip totalPayout, profit
 *   - Customer: first name only
 *   - Flyer: first name + flight date + route only (no phone, no last name)
 *   - paymentMethods: include only enabled (per order.paymentInstructions.enabledMethodIds)
 *   - statusHistory: pass through (it's narrative)
 *
 * No auth required — anyone with the slug can read.
 */
export const getTrackingOrder = onCall(
  // `invoker: 'public'` grants the Cloud Run service `allUsers` -> roles/run.invoker
  // so unauthenticated tracking-page visitors can call this. Without it, Cloud Run
  // returns 403 before the callable wire format ever runs.
  { region: 'asia-southeast1', cors: true, invoker: 'public', maxInstances: 10 },
  async (req) => {
    const slug = String(req.data?.slug ?? '').trim();
    if (!slug || slug.length < 6) {
      throw new HttpsError('invalid-argument', 'Invalid tracking slug');
    }

    const db = getFirestore(getApp(), DB_ID);
    const qs = await db.collection('orders').where('trackingSlug', '==', slug).limit(1).get();
    if (qs.empty) {
      throw new HttpsError('not-found', 'Tracking link not found');
    }

    const orderDoc = qs.docs[0];
    const order = orderDoc.data() as Record<string, unknown>;

    // --- Look up business / payment settings ---
    const settingsSnap = await db.collection('settings').doc('app').get();
    const settings = (settingsSnap.data() ?? {}) as {
      business?: Record<string, unknown>;
      payment?: { methods?: Array<Record<string, unknown>> };
    };
    const enabledIds: string[] = ((order.paymentInstructions as { enabledMethodIds?: string[] } | undefined)?.enabledMethodIds) ?? [];
    const paymentMethods = (settings.payment?.methods ?? []).filter((m) =>
      enabledIds.includes(String(m.id)),
    );

    // --- Look up the first assigned flyer for display (single carrier shown) ---
    const assignments = (order.flyerAssignments as Array<Record<string, unknown>> | undefined) ?? [];
    let flyer: { firstName: string; flightDate: unknown; route: string } | undefined;
    if (assignments.length > 0) {
      const flyerId = String(assignments[0].flyerId);
      const fSnap = await db.collection('flyers').doc(flyerId).get();
      if (fSnap.exists) {
        const f = fSnap.data() as Record<string, unknown>;
        const fullName = String(f.name ?? '').trim();
        flyer = {
          firstName: fullName.split(' ')[0] || fullName,
          flightDate: f.flightDate,
          route: String(f.route ?? ''),
        };
      }
    }

    // --- Customer first name only ---
    const customerName = String(order.customerName ?? '').trim();
    const customerFirstName = customerName.split(' ')[0] || customerName;

    // --- Items: keep only display fields ---
    const items = (order.items as Array<Record<string, unknown>> | undefined ?? []).map((it) => ({
      description: String(it.description ?? ''),
      categoryName: String(it.categoryName ?? ''),
      weightKg: Number(it.weightKg ?? 0),
    }));

    // --- Payment proof: don't leak the image URL to non-uploaders ---
    // Spec keeps imageUrl off the public surface (it's reviewed by admin only).
    const rawProof = order.paymentProof as { uploadedAt?: unknown; note?: string } | undefined;
    const paymentProof = rawProof ? { uploadedAt: rawProof.uploadedAt, note: rawProof.note } : undefined;

    return {
      orderNumber: String(order.orderNumber ?? ''),
      trackingSlug: slug,
      customerFirstName,
      items,
      totalWeightKg: Number(order.totalWeightKg ?? 0),
      totalAmount: Number(order.totalAmount ?? 0),
      status: order.status,
      statusHistory: order.statusHistory ?? [],
      flyer,
      paymentMethods,
      paymentProof,
      paymentApprovedAt: order.paymentApprovedAt ?? null,
      paidAt: order.paymentApprovedAt ?? null,
      business: {
        name: String(settings.business?.name ?? 'PP Logistics'),
        tagline: settings.business?.tagline ?? undefined,
        logoUrl: settings.business?.logoUrl ?? undefined,
        contactPhone: settings.business?.contactPhone ?? undefined,
        contactEmail: settings.business?.contactEmail ?? undefined,
        contactTelegram: settings.business?.contactTelegram ?? undefined,
      },
    };
  },
);
