import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getApp } from 'firebase-admin/app';

// Primary database is named `default` (not `(default)`) — see src/lib/firebase.ts.
const DB_ID = 'default';

// ───────────────────────────── Telegram alert config ────────────────────────────
//
// Owner gets a Telegram ping whenever a customer submits a payment proof.
// Bot token is a Secret Manager secret — bound to the function via the
// `secrets:` array in the onCall options. The chat ID is hardcoded
// because by itself it can do nothing; only the bot token unlocks
// sending. The send is best-effort — see notifyTelegram().
//
// Deploy notes (one-time setup):
//   1. firebase functions:secrets:set TELEGRAM_BOT_TOKEN --project pp-logistics
//      (paste the token at the prompt)
//   2. firebase deploy --only functions --project pp-logistics
//      (the deploy binds the secret to the function instance)
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');

/**
 * Chat IDs to ping when a customer submits a payment proof.
 *
 * NOT sensitive — chat IDs alone can't send anything. Only the bot
 * token in Secret Manager can. They live in source so they're easy
 * to audit / add to.
 *
 * Positive numbers are individual users (owner's personal chat);
 * negative numbers are groups / channels. Group IDs are negative
 * by Telegram's convention.
 */
const TELEGRAM_CHAT_IDS: readonly number[] = [
  6928694676,    // owner's personal chat
  -5250847582,   // "PP Logistics Notification" group
];

// Base URL for the deep-link in the Telegram alert. Points at the
// canonical Firebase Hosting URL (stable regardless of custom-domain
// status). The owner taps the link to land on /orders/:id for review.
const ADMIN_BASE_URL = 'https://pp-logistics.web.app';

/**
 * Send a Telegram message — best-effort, NEVER throws.
 *
 * 5-second AbortController timeout so a wedged Telegram response can't
 * block the function for the Cloud Run idle timeout. Any failure
 * (token missing, chat invalid, network, timeout) logs to console.warn
 * and returns normally. Callers can `await` this without risk: the
 * proof has already been recorded by the time we get here, and a
 * Telegram failure must NEVER propagate to the customer.
 */
async function notifyTelegram(
  token: string,
  chatId: number,
  htmlText: string,
  timeoutMs = 5000,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '<no body>');
        // eslint-disable-next-line no-console
        console.warn(`[telegram] sendMessage to ${chatId}: HTTP ${res.status}: ${errBody}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[telegram] notify to ${chatId} failed`, err);
  }
}

/** Escape user-supplied strings before inserting into HTML parse-mode text. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
  // input + only rejects when the order is already paid. The `secrets:`
  // array binds TELEGRAM_BOT_TOKEN from Secret Manager at deploy time so
  // we can ping the owner when a proof comes in.
  {
    region: 'asia-southeast1',
    cors: true,
    invoker: 'public',
    maxInstances: 10,
    secrets: [TELEGRAM_BOT_TOKEN],
  },
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

    // ─── Telegram alert (fan-out) ──────────────────────────────────
    // Best-effort. Layered failure isolation so a Telegram problem
    // can NEVER fail the proof submission:
    //   - OUTER try/catch: covers synchronous failures (message-
    //     builder throwing, TELEGRAM_BOT_TOKEN.value() throwing).
    //   - PER-CHAT try/catch (inside the Promise.allSettled): a
    //     failure to ONE chat (bot removed from the group, chat
    //     deleted, that chat's rate limit hit, etc.) is logged with
    //     its chat_id and can't block the other chats.
    //   - notifyTelegram ITSELF: already swallows network/HTTP/
    //     timeout failures internally. Triple-redundant.
    // Promise.allSettled means we wait for every chat send to settle
    // (success or swallowed failure) before returning to the
    // customer, but a single chat hanging on the 5s timeout can't
    // delay another chat's send because they run in parallel.
    try {
      const orderNumber = String(order.orderNumber ?? '');
      const customerName = String(order.customerName ?? '').trim();
      const customerFirstName = customerName.split(' ')[0] || customerName;
      const statusLabel = String(order.status ?? 'pending').replace(/_/g, ' ');
      // THB formatted as integer with thousands separator. The order's
      // totalAmount is stored as a plain number; rounding here matches
      // how the client renders fmtMoney for whole-baht amounts.
      const amountThb = Math.round(Number(order.totalAmount ?? 0)).toLocaleString('en-US');
      const adminUrl = `${ADMIN_BASE_URL}/orders/${doc.id}`;
      const message =
        `💰 <b>Payment proof submitted</b>\n\n` +
        `Order <b>#${escapeHtml(orderNumber)}</b>\n` +
        `Customer: ${escapeHtml(customerFirstName)}\n` +
        `Amount: ฿${amountThb}\n` +
        `Status: ${escapeHtml(statusLabel)}\n\n` +
        `<a href="${adminUrl}">Review &amp; approve →</a>`;
      // Read the secret ONCE outside the per-chat loop — value() returns
      // synchronously from process.env; reading per-chat would be the
      // same string each time anyway.
      const token = TELEGRAM_BOT_TOKEN.value();
      await Promise.allSettled(
        TELEGRAM_CHAT_IDS.map(async (chatId) => {
          try {
            await notifyTelegram(token, chatId, message);
          } catch (err) {
            // notifyTelegram never throws, so this catch is purely
            // defensive against future changes that might let
            // something escape. The chat_id tag makes the log
            // entry self-explanatory.
            // eslint-disable-next-line no-console
            console.warn(`[telegram] per-chat send to ${chatId} failed`, err);
          }
        }),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[telegram] alert path failed', err);
    }

    return { ok: true };
  },
);
