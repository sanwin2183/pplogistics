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

export interface OrderItem {
  description: string;
  categoryId: string;
  categoryName: string;
  weightKg: number;
  ratePerKg: number;
  subtotal: number;
}

export interface FlyerAssignment {
  flyerId: string;
  flyerName: string;
  weightKg: number;
  payoutRatePerKg: number;
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
  items: Array<Pick<OrderItem, 'description' | 'categoryName' | 'weightKg' | 'ratePerKg' | 'subtotal'>>;
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
}
