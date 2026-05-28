import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';

// Primary database is named `default` (not `(default)`) — see src/lib/firebase.ts.
const DB_ID = 'default';

/**
 * Server-side fetch of a (presumably image) URL, returned as a base64
 * data: URI. Used to inline the business logo and each active payment
 * method's QR in the response so the public tracking page's A4 capture
 * document doesn't need a browser fetch() of Firebase Storage URLs (which
 * the default bucket CORS policy blocks — `<img>` displays fine but
 * fetch() rejects with TypeError: Failed to fetch).
 *
 * Returns null on any failure (404, network, indeterminable MIME). The
 * caller MUST NOT throw on null — the client renders a graceful "QR
 * unavailable - use account details" box in the document when qrDataUri
 * is missing, and the package icon when logoDataUri is missing. Never
 * fail the whole tracking response over one image.
 *
 * Node 20's global fetch + Buffer (engines.node = "20" in
 * functions/package.json) means no axios / node-fetch dependency.
 */
async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[getTrackingOrder] image fetch HTTP ${res.status}: ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Trust the response Content-Type header first; fall back to magic-byte
    // sniffing if the header is missing or not image/*. Firebase Storage
    // does set Content-Type on uploads but we shouldn't assume.
    let mime = res.headers.get('content-type')?.split(';')[0]?.trim() ?? null;
    if (!mime || !mime.startsWith('image/')) {
      mime = sniffImageMime(buf);
    }
    if (!mime) {
      // eslint-disable-next-line no-console
      console.warn(`[getTrackingOrder] could not determine image MIME for ${url}`);
      return null;
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[getTrackingOrder] image fetch threw: ${url}`, err);
    return null;
  }
}

/** Magic-byte image format detection — fallback when Content-Type isn't set. */
function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  // WebP: 'RIFF' .... 'WEBP'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

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

    // --- Items: keep only customer-facing fields ---
    // subtotal is the line price the customer paid; ratePerKg is the rate
    // charged on this order for this category — both are revenue-side and
    // already implied by the totals, so exposing them is informational not
    // §11-forbidden. Payouts (payoutRatePerKg / payoutAmount), totalPayout
    // and profit remain stripped.
    const items = (order.items as Array<Record<string, unknown>> | undefined ?? []).map((it) => ({
      description: String(it.description ?? ''),
      categoryName: String(it.categoryName ?? ''),
      weightKg: Number(it.weightKg ?? 0),
      ratePerKg: Number(it.ratePerKg ?? 0),
      subtotal: Number(it.subtotal ?? 0),
    }));

    // --- Payment proof: don't leak the image URL to non-uploaders ---
    // Spec keeps imageUrl off the public surface (it's reviewed by admin only).
    const rawProof = order.paymentProof as { uploadedAt?: unknown; note?: string } | undefined;
    const paymentProof = rawProof ? { uploadedAt: rawProof.uploadedAt, note: rawProof.note } : undefined;

    // --- Inline business logo + each active payment method's QR as base64
    //     data: URIs so the public tracking page's A4 capture document can
    //     render them without a browser fetch (Firebase Storage's default
    //     CORS config blocks fetch() against firebasestorage.googleapis.com
    //     URLs, even though <img> displays them fine). Server-side fetch
    //     bypasses browser CORS entirely.
    //
    //     §11 audit on the new fields:
    //       - business.logoDataUri: inlined bytes of business.logoUrl which
    //         is ALREADY returned (and already public). Adding the bytes
    //         doesn't expose anything that wasn't reachable via the URL.
    //       - paymentMethods[].qrDataUri: inlined bytes of paymentMethods
    //         [].qrUrl which is ALREADY returned. Same story.
    //     No payouts, profit, customer phone, flyer phone, or proof image
    //     URL is touched. Sanitizer is untouched.
    //
    //     Failures are graceful: a per-image null lets the client fall back
    //     to its "QR unavailable - use account details" box and the package
    //     icon respectively, without failing the whole tracking response.
    const businessLogoUrl =
      typeof settings.business?.logoUrl === 'string' ? settings.business.logoUrl : null;
    const [logoDataUri, ...qrDataUris] = await Promise.all([
      businessLogoUrl ? fetchImageAsDataUri(businessLogoUrl) : Promise.resolve(null),
      ...paymentMethods.map((m) => {
        const qrUrl = typeof m.qrUrl === 'string' ? m.qrUrl : null;
        return qrUrl ? fetchImageAsDataUri(qrUrl) : Promise.resolve(null);
      }),
    ]);

    const paymentMethodsWithDataUri = paymentMethods.map((m, i) => ({
      ...m,
      qrDataUri: qrDataUris[i] ?? null,
    }));

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
      paymentMethods: paymentMethodsWithDataUri,
      paymentProof,
      paymentApprovedAt: order.paymentApprovedAt ?? null,
      paidAt: order.paymentApprovedAt ?? null,
      // Order creation date — public, customers want to see when they placed it.
      createdAt: order.createdAt ?? null,
      business: {
        name: String(settings.business?.name ?? 'PP Logistics'),
        tagline: settings.business?.tagline ?? undefined,
        logoUrl: settings.business?.logoUrl ?? undefined,
        logoDataUri: logoDataUri ?? undefined,
        contactPhone: settings.business?.contactPhone ?? undefined,
        contactEmail: settings.business?.contactEmail ?? undefined,
        contactTelegram: settings.business?.contactTelegram ?? undefined,
      },
    };
  },
);
