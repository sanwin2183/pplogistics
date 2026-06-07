import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';

const DB_ID = 'default';

/**
 * Hardcoded owner UID — mirrors the firestore.rules + storage.rules
 * allowlist. Lets the function unblock if the admin custom claim hasn't
 * propagated to the caller's ID token. Same defence-in-depth as the rules.
 * Keep in sync if the owner UID rotates.
 */
const OWNER_UID = 'XmGs95p7sSb5L4zZVO9nxHThe6B3';

function isAdmin(req: CallableRequest): boolean {
  if (!req.auth) return false;
  // role is a custom claim — DecodedIdToken accepts arbitrary keys but
  // typing them requires the index-signature dance below.
  const role = (req.auth.token as Record<string, unknown> | undefined)?.role;
  if (role === 'admin') return true;
  if (req.auth.uid === OWNER_UID) return true;
  return false;
}

interface MarkTripPaidInput {
  flyerId: string;
  orderIds: string[];
  action: 'pay' | 'unpay';
}

interface MarkTripPaidResult {
  ok: true;
  /** Order ids whose matching assignment had paidOutAt mutated this call. */
  affected: string[];
  /** Order ids that were idempotently skipped (already in the desired state). */
  skipped: string[];
}

/**
 * Mark every order in a trip paid (or unmark) atomically.
 *
 * Input:
 *   flyerId  — the flyer the trip belongs to
 *   orderIds — every order whose assignment for this flyer should be touched
 *   action   — 'pay' sets paidOutAt = serverTimestamp; 'unpay' clears it
 *
 * Atomicity: all writes go through one Firestore WriteBatch — either every
 * order's assignment is updated or none is. Reads happen before writes (the
 * function reads each order doc to splice the matching assignment, then
 * batches the writes), so the call is functionally a "read all, validate,
 * write all" transaction without the transaction-retry tax. For an admin
 * action with no concurrent contention this is the right shape.
 *
 * Validation:
 *   - caller is admin (custom claim OR owner UID — same as rules);
 *   - every orderId resolves to an existing order;
 *   - every order has exactly ONE assignment matching `flyerId` (multi-flyer
 *     orders are fine — we just need to know which assignment to splice);
 *   - the order's status is eligible (with_flyer / in_transit / delivered /
 *     awaiting_payment / paid). Upcoming orders (pending / received) are
 *     rejected outright — payouts only flow once the flyer has the cargo
 *     in hand (with_flyer marks that handover).
 *
 * Idempotence:
 *   - 'pay' on an already-paid assignment: skipped (counted in `skipped`).
 *   - 'unpay' on an already-unpaid assignment: skipped.
 *   - Neither case throws; both report the skip cleanly so the client can
 *     report "X orders newly paid, Y already paid" if it wants to.
 *
 * Why a function, not a client batch:
 *   - One source of truth for the validation rules (server-side, can't be
 *     bypassed by a client with the right Firestore role).
 *   - Server-side serverTimestamp() gives a single coherent timestamp
 *     across the batch — a client batch would write Timestamp.now() at
 *     send time, which can drift between clients.
 *   - Keeps payout audit cleanly auditable via Cloud Logging.
 *
 * `invoker: 'public'` is required so Cloud Run admits the request to the
 * function code at all — without it Cloud Run returns 403 BEFORE Firebase
 * Functions can check `request.auth`. The function then checks isAdmin()
 * internally; non-admin callers get permission-denied.
 */
export const markTripPaid = onCall(
  { region: 'asia-southeast1', cors: true, invoker: 'public', maxInstances: 10 },
  async (req): Promise<MarkTripPaidResult> => {
    if (!isAdmin(req)) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }

    const input = req.data as Partial<MarkTripPaidInput> | undefined;
    const flyerId = String(input?.flyerId ?? '').trim();
    const action = input?.action;
    const orderIds = Array.isArray(input?.orderIds) ? input!.orderIds.map(String) : [];

    if (!flyerId) throw new HttpsError('invalid-argument', 'flyerId is required');
    if (action !== 'pay' && action !== 'unpay') {
      throw new HttpsError('invalid-argument', "action must be 'pay' or 'unpay'");
    }
    if (orderIds.length === 0) {
      throw new HttpsError('invalid-argument', 'orderIds must be a non-empty list');
    }
    // Sanity cap — a single trip with this many orders means something's
    // wrong; well below Firestore's 500-op batch limit.
    if (orderIds.length > 400) {
      throw new HttpsError('invalid-argument', 'orderIds list too large for one trip');
    }
    // Reject duplicates so the affected/skipped counts are unambiguous.
    if (new Set(orderIds).size !== orderIds.length) {
      throw new HttpsError('invalid-argument', 'orderIds must not contain duplicates');
    }

    const db = getFirestore(getApp(), DB_ID);

    // --- Read phase: fetch every order doc in parallel ---
    const snaps = await Promise.all(
      orderIds.map((id) => db.collection('orders').doc(id).get()),
    );

    // --- Validate phase ---
    // PAYABLE_STATUSES must stay in sync with TRIP_PAYABLE_STATUSES on the
    // client (src/features/flyers/tripHelpers.ts). `with_flyer` is INCLUDED
    // (corrected 2026-05-29) — the flyer earns the fee on handover, not on
    // takeoff. If this Set drifts out of sync, the client will let the
    // owner tap "Mark trip paid" on a with_flyer order and this function
    // will reject the whole batch with failed-precondition.
    const PAYABLE_STATUSES = new Set([
      'with_flyer',
      'in_transit',
      'delivered',
      'awaiting_payment',
      'paid',
    ]);
    interface PreparedUpdate {
      orderId: string;
      ref: FirebaseFirestore.DocumentReference;
      newAssignments: Array<Record<string, unknown>>;
      alreadyInDesiredState: boolean;
    }
    const prepared: PreparedUpdate[] = [];

    for (const snap of snaps) {
      if (!snap.exists) {
        throw new HttpsError('not-found', `Order ${snap.id} does not exist`);
      }
      const data = snap.data() as Record<string, unknown>;
      const assignments = (data.flyerAssignments as Array<Record<string, unknown>> | undefined) ?? [];
      // ALL assignments matching this flyer. An order CAN have more than one
      // (legacy per-category-rate workaround: same flyer, same order, two
      // rows at different rates for different category subsets of the items).
      // The previous version of this function threw `failed-precondition` on
      // multi-match — that prevented the owner from paying out any legacy
      // multi-assignment order via the trip flow. Now we splice ALL matching
      // assignments together: a single client `markTripPaid` call settles
      // (or unsettles) every line item on every order.
      const matchedIndexes = assignments
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) => a.flyerId === flyerId)
        .map(({ idx }) => idx);
      if (matchedIndexes.length === 0) {
        throw new HttpsError(
          'failed-precondition',
          `Order ${snap.id} has no assignment for flyer ${flyerId}`,
        );
      }
      const status = data.status as string;
      if (!PAYABLE_STATUSES.has(status)) {
        throw new HttpsError(
          'failed-precondition',
          `Order ${snap.id} is in status '${status}' — not eligible for payout (must be with_flyer, in_transit, delivered, awaiting_payment, or paid)`,
        );
      }

      const wantPaid = action === 'pay';

      // Per-assignment paid state. The order is "already in desired state"
      // ONLY when EVERY matching assignment is in the target state — if
      // any one needs flipping, we write the order. This is the idempotent
      // skip path; a mid-state order (1 paid + 1 unpaid + action='pay')
      // gets a partial flip where only the unpaid assignment becomes
      // paid, the already-paid one is left alone.
      const matchedSet = new Set(matchedIndexes);
      const allInDesiredState = matchedIndexes.every((idx) => {
        const currentlyPaid = !!(assignments[idx] as { paidOutAt?: unknown }).paidOutAt;
        return currentlyPaid === wantPaid;
      });

      if (allInDesiredState) {
        // Idempotent skip — record so the caller can report it.
        prepared.push({
          orderId: snap.id,
          ref: snap.ref,
          newAssignments: assignments,
          alreadyInDesiredState: true,
        });
        continue;
      }

      // Splice EACH matching assignment that's not already in the target
      // state. We use Timestamp.now() instead of FieldValue.serverTimestamp()
      // because serverTimestamp sentinels are NOT allowed inside array
      // elements — the batch write would reject. Timestamp.now() gives
      // server-clock-ish accuracy (this code runs in the function, on
      // Google infra), close enough for payout audit timestamps.
      const now = Timestamp.now();
      const newAssignments = assignments.map((a, idx) => {
        if (!matchedSet.has(idx)) return a;
        const currentlyPaid = !!(a as { paidOutAt?: unknown }).paidOutAt;
        if (currentlyPaid === wantPaid) return a; // assignment-level idempotence
        return { ...a, paidOutAt: wantPaid ? now : null };
      });
      prepared.push({
        orderId: snap.id,
        ref: snap.ref,
        newAssignments,
        alreadyInDesiredState: false,
      });
    }

    // --- Write phase: one atomic batch ---
    const toWrite = prepared.filter((p) => !p.alreadyInDesiredState);
    if (toWrite.length > 0) {
      const batch = db.batch();
      for (const p of toWrite) {
        batch.update(p.ref, {
          flyerAssignments: p.newAssignments,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    const affected = toWrite.map((p) => p.orderId);
    const skipped = prepared.filter((p) => p.alreadyInDesiredState).map((p) => p.orderId);
    return { ok: true, affected, skipped };
  },
);
