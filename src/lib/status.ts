import type { OrderStatus, FlyerStatus, Route } from '../types';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'received',
  'with_flyer',
  'in_transit',
  'delivered',
  'awaiting_payment',
  'paid',
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  received: 'Received',
  with_flyer: 'With Flyer',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  awaiting_payment: 'Awaiting Payment',
  paid: 'Paid',
};

/** Description shown on the public tracking timeline for each step. */
export const ORDER_STATUS_DESCRIPTIONS: Record<OrderStatus, string> = {
  pending: 'Your order has been created and is being prepared for pickup.',
  received: 'Your items have been received at our warehouse.',
  with_flyer: 'A carrier has been assigned to your order.',
  in_transit: 'Your order is in flight and en route to its destination.',
  delivered: 'Your order has been delivered.',
  awaiting_payment: 'Please complete payment using one of the methods below.',
  paid: 'Payment received. Thank you!',
};

/** Public-facing timeline steps (deduped — 'awaiting_payment' folds under 'Delivered'). */
export const PUBLIC_TIMELINE_STEPS: OrderStatus[] = [
  'pending',
  'received',
  'with_flyer',
  'in_transit',
  'delivered',
  'paid',
];

/** Status pill colour classes (soft tinted backgrounds + matching foreground). */
export const ORDER_STATUS_CLASSES: Record<OrderStatus, string> = {
  pending: 'bg-status-pending text-status-pending-fg',
  received: 'bg-status-received text-status-received-fg',
  with_flyer: 'bg-status-flyer text-status-flyer-fg',
  in_transit: 'bg-status-transit text-status-transit-fg',
  delivered: 'bg-status-delivered text-status-delivered-fg',
  awaiting_payment: 'bg-status-awaiting text-status-awaiting-fg',
  paid: 'bg-status-paid text-status-paid-fg',
};

export const FLYER_STATUSES: FlyerStatus[] = ['upcoming', 'in-transit', 'completed', 'cancelled'];

export const FLYER_STATUS_LABELS: Record<FlyerStatus, string> = {
  upcoming: 'Upcoming',
  'in-transit': 'In Transit',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const FLYER_STATUS_CLASSES: Record<FlyerStatus, string> = {
  upcoming: 'bg-status-pending text-status-pending-fg',
  'in-transit': 'bg-status-transit text-status-transit-fg',
  completed: 'bg-status-paid text-status-paid-fg',
  cancelled: 'bg-status-cancelled text-status-cancelled-fg',
};

export const ROUTES: Route[] = ['BKK→YGN', 'BKK→MDL', 'YGN→BKK', 'MDL→BKK'];

export const ROUTE_LABELS: Record<Route, string> = {
  'BKK→YGN': 'Bangkok → Yangon',
  'BKK→MDL': 'Bangkok → Mandalay',
  'YGN→BKK': 'Yangon → Bangkok',
  'MDL→BKK': 'Mandalay → Bangkok',
};

/**
 * Destination city name extracted from a route. Used by the customer
 * tracking page's timeline to render an arrival-style in_transit label
 * (e.g. "Arrived at Yangon") instead of the generic "In Transit".
 *
 * The route string is shape-fixed by the `Route` type union, so the
 * three-letter destination code on the right side of `→` always maps to
 * one of these three cities. The function still takes `Route | undefined`
 * to cover the public-side case where `order.flyer` (and thus the route)
 * is absent — returns null for the caller to gracefully fall back to the
 * generic copy.
 *
 * Translation note (TODO i18n): when a locale layer arrives, this is the
 * natural place to map city codes to localised names (e.g. Burmese
 * ရန်ကုန် for Yangon). Keeping the mapping centralised here means the
 * tracking-page render path stays unchanged.
 */
export function routeDestinationCity(route: Route | undefined): string | null {
  if (!route) return null;
  const code = route.split('→')[1]?.trim();
  switch (code) {
    case 'YGN':
      return 'Yangon';
    case 'MDL':
      return 'Mandalay';
    case 'BKK':
      return 'Bangkok';
    default:
      return null;
  }
}

/**
 * Customer-facing override copy for the tracking page timeline. Only the
 * in_transit step changes today: instead of "In Transit / Your order is in
 * flight…", we surface "Arrived at <City> / Your order has arrived in
 * <City> and is ready for handoff." — this matches the real-world meaning
 * customers care about (the cargo has landed and the flyer can hand it
 * over) rather than the in-air state name from the schema.
 *
 * Returns null when no route is known (e.g. order has no flyer yet). The
 * timeline component falls back to its default label/description maps in
 * that case.
 *
 * The schema status name `in_transit` is UNCHANGED — this is purely a
 * customer-facing display rewrite. Admin views, the Cloud Functions, the
 * Firestore rules, and the status flow all continue to use `in_transit`.
 */
export function publicTimelineOverrides(route: Route | undefined): {
  labels: Partial<Record<OrderStatus, string>>;
  descriptions: Partial<Record<OrderStatus, string>>;
} {
  const city = routeDestinationCity(route);
  if (!city) return { labels: {}, descriptions: {} };
  return {
    labels: { in_transit: `Arrived at ${city}` },
    descriptions: {
      in_transit: `Your order has arrived in ${city} and is ready for handoff.`,
    },
  };
}

/** Next valid status from the current one (for the "advance" button). */
export function nextOrderStatus(status: OrderStatus): OrderStatus | null {
  const map: Partial<Record<OrderStatus, OrderStatus>> = {
    pending: 'received',
    received: 'with_flyer',
    with_flyer: 'in_transit',
    in_transit: 'delivered',
    delivered: 'awaiting_payment',
  };
  return map[status] ?? null;
}

/** Label for the action button that advances status. */
export function nextOrderActionLabel(status: OrderStatus): string | null {
  const map: Partial<Record<OrderStatus, string>> = {
    pending: 'Mark Received',
    received: 'Hand to Flyer',
    with_flyer: 'Flight Departed',
    in_transit: 'Mark Delivered',
    delivered: 'Request Payment',
  };
  return map[status] ?? null;
}
