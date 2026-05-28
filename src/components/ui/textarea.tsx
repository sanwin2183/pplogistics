import * as React from 'react';
import { cn } from '../../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      // 16px text on mobile (text-base) prevents iOS Safari/PWA auto-zoom on focus;
      // step down to 14px (text-sm) on desktop (lg breakpoint per §7).
      'flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base lg:text-sm shadow-sm',
      'placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:border-primary',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
