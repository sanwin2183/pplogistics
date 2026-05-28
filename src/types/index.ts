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

export interface PaymentProof {
  uploadedAt: FsTs;
  imageUrl: string;
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

// ---------- Activity feed ----------

export interface ActivityEntry {
  id: string;
  type: 'order_status' | 'order_created' | 'payment_proof' | 'payout';
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  message: string;
  timestamp: FsTs;
}

// ---------- Public tracking (sanitized) ----------

/** Shape returned by the getTrackingOrder Cloud Function — no payouts/profit/PII. */
export interface PublicOrder {
  orderNumber: string;
  trackingSlug: string;
  customerFirstName: string;
  items: Array<Pick<OrderItem, 'description' | 'categoryName' | 'weightKg' | 'subtotal'>>;
  totalWeightKg: number;
  totalAmount: number;
  status: OrderStatus;
  statusHistory: StatusHistoryEntry[];
  flyer?: { firstName: string; flightDate: FsTs; route: Route };
  paymentMethods: PaymentMethod[];
  paymentProof?: { uploadedAt: FsTs; note?: string };
  paymentApprovedAt?: FsTs;
  business: BusinessInfo;
  paidAt?: FsTs;
}
