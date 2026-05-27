import type { LucideIcon } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <div className="mb-4 rounded-full bg-accent p-4">
        <Icon className="h-6 w-6 text-accent-foreground" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Button onClick={action.onClick} className="mt-5">
          {action.label}
        </Button>
      )}
    </div>
  );
}
