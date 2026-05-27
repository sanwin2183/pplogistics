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
