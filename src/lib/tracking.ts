import { customAlphabet } from 'nanoid';

// 10-char URL-safe slug, no ambiguous chars (no 0/O/1/l/I).
const slugAlphabet = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const generateSlug = customAlphabet(slugAlphabet, 10);

export function newTrackingSlug(): string {
  return generateSlug();
}

/**
 * Build the absolute public URL for a tracking slug.
 * Honours VITE_PUBLIC_BASE_URL if set; otherwise uses the current origin.
 */
export function trackingUrl(slug: string): string {
  const base = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
  return `${base.replace(/\/$/, '')}/t/${slug}`;
}

/** Auto order number: "260528-XXX" where XXX is a 3-char suffix. */
export function newOrderNumber(date: Date = new Date()): string {
  const y = String(date.getFullYear() % 100).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const suffix = customAlphabet('0123456789', 3)();
  return `${y}${m}${d}-${suffix}`;
}
