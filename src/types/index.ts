import type { Timestamp } from 'firebase/firestore';

// ---------- Shared ----------

export type Route = 'BKK→YGN' | 'BKK→MDL' | 'YGN→BKK' | 'MDL→BKK';

/** Firestore-shaped timestamp on read, server sentinel on write. */
export type FsTs = Timestamp | null;

// ---------- Flyers ----------

export type FlyerStatus = 'upcoming' | 'in-transit' | 'completed' | 'cancelled';

export interface Flyer {
  id: string;
  name: string;
  phone: string;
  route: Route;
  flightDate: FsTs;
  flightNumber?: string;
  kgAvailable: number;
  /** Derived: sum of order.flyerAssignments.weightKg where flyerId == this.id. */
  kgUsed: number;
  /** What WE pay them per kg, THB. */
  ratePerKg: number;
  prohibitedItems: string[];
  notes?: string;
  status: FlyerStatus;
  createdAt: FsTs;
  updatedAt: FsTs;
}

// ---------- Customers ----------

export type CustomerType = 'shop' | 'individual';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  telegram?: string;
  type: CustomerType;
  /** Derived rollups — recomputed on order create/update. */
  totalOrders: number;
  totalSpent: number;
  outstandingBalance: number;
  notes?: string;
  createdAt: FsTs;
}

// ---------- Categories ----------

export interface Category {
  id: string;
  name: string;
  /** What WE charge customers per kg, THB. */
  defaultRatePerKg: number;
  isProhibited: boolean;
  notes?: string;
}

// ---------- Orders ----------

export type OrderStatus =
  | 'pending'
  | 'received'
  | 'with_flyer'
  | 'in_transit'
  | 'delivered'
  | 'awaiting_payment'
  | 'paid';

/**
 * Order item — supports two pricing modes:
 *
 *   per_kg (default, legacy): customer charged `weightKg × ratePerKg`,
 *     flyer paid via category-level kg rates on the assignment
 *     (categoryRates). This is the original model — all pre-2026-05-29
 *     orders have only this shape and the `pricingMode` field absent.
 *
 *   per_piece (added 2026-05-29): customer charged `pieceCount ×
 *     ratePerPiece`, flyer paid per piece. The flyer rate lives ON THE
 *     ITEM (`flyerRatePerPiece`) — co-located with the customer rate.
 *     Per-piece items have NO weight; they do NOT contribute to
 *     flyer.kgUsed. By design — a phone box still has physical weight
 *     but the business deliberately ignores it for capacity tracking.
 *
 * `pricingMode` is optional with a `per_kg` default — every legacy item
 * reads as per-kg without migration. Per-piece-specific fields are also
 * optional; per-piece items set them, per-kg items omit them.
 *
 * `subtotal` stays the canonical stored money number, computed at write
 * time from whichever mode applies. Readers trust the stored value and
 * never recompute — same pattern as today.
 *
 * `weightKg` for a per-piece item is 0 (or omitted treated as 0). The
 * form sets it to 0 explicitly so every kg-summing read path naturally
 * excludes per-piece items. DO NOT use undefined here — Firebase SDK
 * v11 rejects undefined values mid-document.
 *
 * §11 leak boundary for the public surface: `flyerRatePerPiece` is
 * INTERNAL — it is stripped by getTrackingOrder before the order reaches
 * the customer. The customer sees pieceCount + ratePerPiece + subtotal
 * (revenue side, already implied by the totals) but never the flyer-side
 * rate. Mirrors the existing rule that strips assignment.categoryRates /
 * payoutRatePerKg / payoutAmount.
 */
export type ItemPricingMode = 'per_kg' | 'per_piece';

export interface OrderItem {
  description: string;
  categoryId: string;
  categoryName: string;
  /** Default: 'per_kg' when absent (legacy items). */
  pricingMode?: ItemPricingMode;
  /** Per-kg side. Always present; per-piece items store 0. */
  weightKg: number;
  /** Per-kg side. 0 for per-piece items. */
  ratePerKg: number;
  /** Per-piece side. Required when pricingMode === 'per_piece'. */
  pieceCount?: number;
  /** Per-piece side. Required when pricingMode === 'per_piece'. */
  ratePerPiece?: number;
  /**
   * @deprecated Order-global per-piece flyer rate (one value shared by
   * every flyer). READ-ONLY legacy / single-flyer fallback — only
   * consulted when the matching `flyerSplits` entry has no `ratePerPiece`.
   * New multi-flyer orders carry the rate PER FLYER on
   * `flyerSplits[].ratePerPiece` instead, so flyer A and flyer B can be
   * paid different ฿/piece for the same item. INTERNAL (stripped by
   * getTrackingOrder per §11). Read it only through getFlyerPieceRate.
   */
  flyerRatePerPiece?: number;
  /**
   * NEW canonical flyer-side allocation (per-item per-flyer splits,
   * added 2026-06-09). One entry per flyer who carries some of this
   * item. INTERNAL — stripped from the public tracking surface per §11
   * (customer must never see what the flyer carried vs what they were
   * billed for).
   *
   * Per-kg items populate `weightKg` on each entry; per-piece items
   * populate `pieceCount`. A flyer not present in the list (or present
   * with a blank value) carries 0 of this item — see getFlyerWeightKg /
   * getFlyerPieceCount, where `flyerSplits present ⇒ entry?.value ?? 0`.
   *
   * Splits are INDEPENDENT of the customer quantity: Σ of every flyer's
   * portion does NOT have to equal top-level `weightKg` / `pieceCount`.
   * Each portion is purely what we pay that flyer. There is deliberately
   * no sum-to-customer validation.
   *
   * Absent ⇒ legacy order: readers fall through to the deprecated
   * `flyerWeightKg` / `flyerPieceCount` (then to the customer quantity),
   * which returns the SAME number regardless of flyerId. That preserves
   * today's whole-order behaviour for legacy data: single-flyer legacy
   * orders read correctly; multi-flyer legacy orders keep their
   * documented over-count (frozen historical data, not auto-migrated).
   */
  flyerSplits?: FlyerSplit[];
  /**
   * @deprecated Single order-global flyer-side weight (pre 2026-06-09).
   * READ-ONLY legacy fallback — only consulted when `flyerSplits` is
   * absent. New orders write `flyerSplits` instead and never set this.
   * INTERNAL (stripped by getTrackingOrder per §11). Per-piece items
   * ignore it on read (getFlyerWeightKg returns 0 for per-piece).
   */
  flyerWeightKg?: number;
  /**
   * @deprecated Single order-global flyer-side piece count (pre
   * 2026-06-09). READ-ONLY legacy fallback — only consulted when
   * `flyerSplits` is absent. New orders write `flyerSplits` instead.
   * INTERNAL (stripped by getTrackingOrder per §11).
   */
  flyerPieceCount?: number;
  /** Canonical stored money number — pre-computed at write time. */
  subtotal: number;
}

/**
 * One flyer's allocated portion of a single OrderItem (the per-item
 * per-flyer split added 2026-06-09). Lives in `OrderItem.flyerSplits`.
 *
 * `weightKg` is set for per-kg items; `pieceCount` + `ratePerPiece` for
 * per-piece items. All are optional so the shape stays minimal per mode
 * (Firebase SDK v11 rejects literal `undefined`, so the form writes only
 * the fields that apply and omits the rest). A missing field reads as 0.
 *
 * `ratePerPiece` (added 2026-06-10) is THIS FLYER'S ฿/piece for this
 * item — the per-piece analog of assignment.categoryRates, letting each
 * flyer be paid a different rate. Read it via getFlyerPieceRate, which
 * falls back to the deprecated order-global item.flyerRatePerPiece for
 * legacy / single-flyer orders.
 */
export interface FlyerSplit {
  flyerId: string;
  weightKg?: number;
  pieceCount?: number;
  ratePerPiece?: number;
}

/**
 * Per-category flyer rate. Mirrors how customer rates are stored on
 * `OrderItem` (each item has its own ratePerKg), but on the payout side
 * the rate is paid to the FLYER, not charged to the customer.
 *
 * `ratePerKg` is what we pay this flyer for one kg of THIS category in
 * THIS order. e.g. shoes might pay 350/kg, clothes 200/kg, for the same
 * flyer on the same order.
 */
export interface CategoryRate {
  categoryId: string;
  ratePerKg: number;
}

/**
 * Flyer assignment on an order.
 *
 * Two shapes coexist in the wild (legacy + new) so we don't have to
 * migrate old orders:
 *
 *   LEGACY (pre 2026-05-29): single flat rate per assignment.
 *     - `payoutRatePerKg` set
 *     - `categoryRates` absent
 *     - payout = weightKg × payoutRatePerKg
 *     - rendered with a "(legacy rate)" badge on the detail page
 *
 *   NEW (post 2026-05-29): per-category rate breakdown.
 *     - `categoryRates` set (one entry per distinct category in the order)
 *     - `payoutRatePerKg` absent (or 0 — don't read it for new assignments)
 *     - payout = sum over categoryRates of (order's category kg × rate)
 *     - rendered as per-category rows on the detail page
 *
 * `weightKg` stays per-assignment in both shapes — it's what's used for
 * the customer-side billed display + the dashboard's revenueByRoute
 * customer basis (NOT capacity; see flyerWeightKg).
 *
 * `payoutAmount` is the universal "what we owe this flyer for this
 * assignment" number — always written by the form on save, no client
 * computes it lazily from `categoryRates` later.
 */
export interface FlyerAssignment {
  flyerId: string;
  flyerName: string;
  /**
   * CUSTOMER-side denormalised total weight for this assignment — the
   * order's customer total, the SAME on every assignment of an order.
   * Used for the billed display and the dashboard revenueByRoute
   * fallback. NOT the capacity basis. Capacity (kgUsed) reads
   * `flyerWeightKg ?? weightKg`, so legacy assignments (no flyerWeightKg)
   * fall through to this value.
   */
  weightKg: number;
  /**
   * FLYER-side denormalised weight for this assignment — THIS FLYER'S
   * portion only, i.e. Σ over items of getFlyerWeightKg(item, flyerId)
   * (per-item per-flyer split, redefined 2026-06-09). Set by the form
   * at submit so the create/delete transactions + recomputeRollups can
   * update flyer.kgUsed without walking items[]. Two flyers on one order
   * now each carry only their own portion — no more over-count.
   *
   * Absent on legacy (pre 2026-06-07) assignments; every kgUsed reader
   * falls back to `weightKg` in that case, so an order created before
   * this change reverses on the same basis it was created on.
   */
  flyerWeightKg?: number;
  /** LEGACY — single flat rate. New assignments omit this; old ones keep it for display. */
  payoutRatePerKg?: number;
  /** NEW — per-category rate breakdown. Absent on legacy assignments. */
  categoryRates?: CategoryRate[];
  payoutAmount: number;
  paidOutAt?: FsTs;
}

export interface StatusHistoryEntry {
  status: OrderStatus;
  timestamp: FsTs;
  note?: string;
}

export type PaymentMethodType = 'bank_transfer' | 'promptpay' | 'kbz_pay' | 'wave_pay';

export interface PaymentInstructions {
  /** IDs of payment methods (from settings) enabled for this order. */
  enabledMethodIds: string[];
}

/**
 * Customer-uploaded payment proof attached to an order.
 *
 * Storage architecture (post May 29 2026):
 *   - imagePath: the path WITHIN the bucket (e.g.
 *       payment-proofs/<slug>/<nanoid>-<filename>). Set by
 *       submitPaymentProof. The admin client resolves this to a
 *       download URL via getDownloadURL when rendering the review panel.
 *   - imageUrl (legacy): older proofs (submitted before the customer-
 *       side getDownloadURL call was removed) stored a full https://
 *       URL here. Admin UI falls back to this when imagePath is absent.
 *
 * Why path-not-url: §11 says payment proofs are admin-only read. The
 * customer can WRITE (create) the file but can't READ it back —
 * getDownloadURL is a read call, so it failed with storage/unauthorized
 * AFTER the upload succeeded. Storing the path and resolving on the
 * admin side keeps customers off the read path entirely.
 */
export interface PaymentProof {
  uploadedAt: FsTs;
  imagePath?: string;
  /** @deprecated New proofs (post May 29 2026) use `imagePath` and the
   *  admin client resolves the URL via getDownloadURL. Old docs keep
   *  this populated so the admin UI still renders them. */
  imageUrl?: string;
  note?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  trackingSlug: string;

  customerId: string;
  customerName: string;
  customerPhone: string;

  items: OrderItem[];
  totalWeightKg: number;
  totalAmount: number;

  flyerAssignments: FlyerAssignment[];
  totalPayout: number;
  profit: number;

  status: OrderStatus;
  statusHistory: StatusHistoryEntry[];

  paymentInstructions: PaymentInstructions;
  paymentProof?: PaymentProof;
  paymentReceivedAt?: FsTs;
  paymentApprovedAt?: FsTs;
  /**
   * How the payment was confirmed:
   *  - 'proof'    — admin approved a customer-uploaded payment screenshot.
   *  - 'external' — admin marked the order paid for a payment received outside
   *    the app (cash, external bank transfer). Set by the OrderDetailPage
   *    "Mark as paid" action.
   * Absent on orders paid before this field was introduced.
   */
  paidVia?: 'proof' | 'external';

  photos: string[];
  notes?: string;

  createdAt: FsTs;
  updatedAt: FsTs;
}

// ---------- Settings ----------

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  label: string;
  accountName: string;
  accountNumber: string;
  bank?: string;
  qrUrl?: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface BusinessInfo {
  name: string;
  tagline?: string;
  logoUrl?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactTelegram?: string;
}

export interface MessageTemplates {
  th: string;
  my: string;
  en: string;
}

export interface AppSettings {
  payment: { methods: PaymentMethod[] };
  business: BusinessInfo;
  templates: MessageTemplates;
}

// ---------- Expenses ----------

/**
 * Preset expense category. Editable in Settings → Expense categories.
 * Mirrors the shape of Category but for general business overhead rather
 * than per-kg carry rates (no rate field needed). Default set seeded by
 * scripts/seedExpenseCategories.ts (Packaging, Wrapping, Check-in fee,
 * Transport, Other).
 */
export interface ExpenseCategory {
  id: string;
  name: string;
  createdAt: FsTs;
}

/**
 * General/daily business expense (NOT tied to orders). Surfaces on the
 * Dashboard's Expenses section and is subtracted from gross profit to
 * produce net profit. Stored flat at root per §5; admin-only per §11
 * (firestore.rules `match /expenses/{id}`).
 *
 * `note` omitted when empty (see useExpenses conditional-payload
 * pattern — Firebase SDK v11 rejects literal `undefined` field values).
 * `categoryName` denormalised onto the doc so the Dashboard expense
 * list doesn't need to join against expenseCategories on every render.
 */
export interface Expense {
  id: string;
  amount: number;
  date: FsTs;
  categoryId: string;
  categoryName: string;
  note?: string;
  createdAt: FsTs;
}

// ---------- Activity feed ----------

export interface ActivityEntry {
  id: string;
  type: 'order_status' | 'order_created' | 'order_deleted' | 'payment_proof' | 'payout';
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  message: string;
  timestamp: FsTs;
}

// ---------- Public tracking (sanitized) ----------

/**
 * Public-shape extensions over the admin types.
 *
 * The function inlines the QR + logo bytes as base64 data: URIs in the
 * response so the public tracking page's A4 capture document can render
 * them without a browser fetch() of Firebase Storage URLs (default
 * Storage CORS blocks fetch but not <img>). The fields here are
 * additive — qrUrl / logoUrl remain so the on-screen card can still
 * point a live <img> at the original URL.
 *
 * §11: qrUrl / logoUrl are ALREADY public on the response; qrDataUri /
 * logoDataUri carry the same bytes inline, so no exposure surface
 * grows. Either field can be null when the server-side fetch failed
 * (graceful: client renders a fallback).
 */
export type PublicPaymentMethod = PaymentMethod & {
  qrDataUri?: string | null;
};
export type PublicBusinessInfo = BusinessInfo & {
  logoDataUri?: string | null;
};

/** Shape returned by the getTrackingOrder Cloud Function — no payouts/profit/PII. */
export interface PublicOrder {
  orderNumber: string;
  trackingSlug: string;
  customerFirstName: string;
  /**
   * Customer-safe per-item shape. Includes pricingMode + the per-piece
   * customer-side fields (pieceCount, ratePerPiece) so the Invoice +
   * Receipt can render per-piece items, but explicitly EXCLUDES
   * `flyerRatePerPiece` per §11. The customer sees the price they paid;
   * the flyer-side rate stays internal.
   */
  items: Array<
    Pick<
      OrderItem,
      | 'description'
      | 'categoryName'
      | 'pricingMode'
      | 'weightKg'
      | 'ratePerKg'
      | 'pieceCount'
      | 'ratePerPiece'
      | 'subtotal'
    >
  >;
  totalWeightKg: number;
  totalAmount: number;
  status: OrderStatus;
  statusHistory: StatusHistoryEntry[];
  flyer?: { firstName: string; flightDate: FsTs; route: Route };
  paymentMethods: PublicPaymentMethod[];
  paymentProof?: { uploadedAt: FsTs; note?: string };
  paymentApprovedAt?: FsTs;
  business: PublicBusinessInfo;
  paidAt?: FsTs;
  /** Order creation date — used as the "Issued" date on the invoice/receipt. */
  createdAt?: FsTs;
  /**
   * Warehouse / status photos uploaded by admin (e.g. received-at-warehouse,
   * packed). Rendered as a tap-to-open thumbnail gallery on the tracking page.
   * Always an array — empty when the order has no photos. Storage URLs are
   * fine to expose because `/orders/{orderId}/photos/{file}` is `allow read: if
   * true` in storage.rules (the URL itself is the auth, same model as the
   * already-public `qrcodes/` + `branding/` paths).
   */
  photos: string[];
}
