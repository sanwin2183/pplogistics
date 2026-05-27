import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { Timestamp } from 'firebase/firestore';

dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);

const thbFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const thbCompactFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const kgFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Format a THB amount. Returns "฿1,250" or "฿1,250.50". */
export function fmtMoney(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '฿0';
  return thbFormatter.format(amount);
}

/** Compact money — for stat cards. "฿1.2K", "฿42K". */
export function fmtMoneyCompact(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '฿0';
  return thbCompactFormatter.format(amount);
}

/** Format kilograms — "2.5 kg" / "12 kg". */
export function fmtKg(kg: number | null | undefined): string {
  if (kg == null || Number.isNaN(kg)) return '0 kg';
  return `${kgFormatter.format(kg)} kg`;
}

/** Accept Firestore Timestamp, JS Date, ISO string, or millis — return Date or null. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    // Plain object shape from Firestore REST or cached snapshot.
    const v = value as { seconds: number; nanoseconds?: number };
    return new Date(v.seconds * 1000 + (v.nanoseconds ?? 0) / 1e6);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Long form — "28 May 2026, 14:32". */
export function fmtDateTime(value: unknown): string {
  const d = toDate(value);
  return d ? dayjs(d).format('D MMM YYYY, HH:mm') : '—';
}

/** Date only — "28 May 2026". */
export function fmtDate(value: unknown): string {
  const d = toDate(value);
  return d ? dayjs(d).format('D MMM YYYY') : '—';
}

/** "2 hours ago" / "in 3 days". */
export function fmtRelative(value: unknown): string {
  const d = toDate(value);
  return d ? dayjs(d).fromNow() : '—';
}

/** Used in order numbers: "260528" for May 28 2026. */
export function fmtDateCompact(value: unknown): string {
  const d = toDate(value);
  return d ? dayjs(d).format('YYMMDD') : '';
}
