import { fmtMoney } from '../lib/formatters';
import { cn } from '../lib/utils';

interface MoneyDisplayProps {
  amount: number | null | undefined;
  className?: string;
  /** If true, negative amounts get a destructive-tone color. */
  signed?: boolean;
}

export function MoneyDisplay({ amount, className, signed }: MoneyDisplayProps) {
  const negative = signed && (amount ?? 0) < 0;
  return (
    <span className={cn('tabular-nums', negative && 'text-destructive', className)}>
      {fmtMoney(amount)}
    </span>
  );
}

/**
 * Render a THB amount as TWO spans — currency symbol + digits — with a small
 * em-based gap between them. Solves the "฿" symbol appearing visually crowded
 * against the leading digit; the th-TH locale's `Intl.NumberFormat` output
 * has no built-in space between symbol and number, and html2canvas renders
 * the kerning a touch tighter than the browser, so the gap is most
 * noticeable on the A4 invoice/receipt capture.
 *
 * Optional `unit` appends "/pc" or "/kg" without a leading space (matches the
 * existing "฿58/pc" pattern). `tabular-nums` on the outer span propagates to
 * the digits via inheritance so column alignment across rows is preserved.
 */
export function MoneyAmount({
  amount,
  unit,
  className,
}: {
  amount: number | null | undefined;
  unit?: 'pc' | 'kg';
  className?: string;
}) {
  const formatted = fmtMoney(amount);
  // Capture the leading non-numeric prefix (currency symbol, possibly with a
  // leading minus for negative amounts) and the numeric tail.
  const m = formatted.match(/^([^\d.,-]+)(.+)$/);
  if (!m) {
    return (
      <span className={cn('tabular-nums', className)}>
        {formatted}
        {unit ? `/${unit}` : ''}
      </span>
    );
  }
  return (
    <span className={cn('tabular-nums', className)}>
      <span>{m[1]}</span>
      <span className="ml-[0.15em]">{m[2]}</span>
      {unit && <span>/{unit}</span>}
    </span>
  );
}
