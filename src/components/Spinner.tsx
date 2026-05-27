import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />;
}

export function FullPageSpinner() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
