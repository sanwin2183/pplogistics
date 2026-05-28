import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Optional right-aligned action — usually a primary Button. */
  action?: ReactNode;
}

/**
 * Shared title region for every main tab page. Standardizes layout so the
 * shell app bar and the page title land at the same Y across all routes,
 * regardless of whether the page has an action button or a subtitle.
 *
 * Always uses flex + items-end so the h1 baseline is identical on pages
 * that have an action and pages that don't.
 */
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
