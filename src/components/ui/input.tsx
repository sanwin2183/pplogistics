import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        // 16px text on mobile (text-base) prevents iOS Safari/PWA auto-zoom on focus;
        // step down to 14px (text-sm) on desktop (lg breakpoint per §7).
        'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base lg:text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-base lg:file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
