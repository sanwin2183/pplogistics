import { Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { DASHBOARD_LABELS, type DashboardKey } from './dashboardKeys';
import { useDashboardPrefs } from './useDashboardPrefs';

/**
 * Visibility-aware wrapper for any dashboard element.
 *
 * Three render states driven by (editMode × isVisible):
 *
 *   NORMAL (editMode=false, isVisible=true):
 *     Renders `children` unchanged. No wrapper styling added — child
 *     keeps its own .card-soft / <Card> shell intact. Zero visual cost.
 *
 *   NORMAL hidden (editMode=false, isVisible=false):
 *     Returns null. No DOM, no layout slot — the surrounding grid
 *     reflows cleanly with no gap.
 *
 *   EDIT (editMode=true, regardless of isVisible):
 *     Wraps children in a relative container so the visibility toggle
 *     can absolute-position in the top-right corner. Adds a thin
 *     primary-tinted ring so the user can see what's customizable.
 *     If isVisible=false, children render at 50% opacity behind a
 *     subtle dashed overlay so the user can see WHAT they'd be enabling.
 *
 * The toggle is a small icon button (Eye / EyeOff) — taps invert this
 * element's visibility via useDashboardPrefs.toggle(k) which persists
 * to localStorage immediately.
 *
 * The wrapper does NOT add padding / margin — children own their own
 * spacing so a Stat tile (.card-soft p-4) and a Recharts card
 * (<Card><CardContent className="p-5">) both wrap correctly without
 * the toggle visually intruding on the content.
 */

interface DashboardCardProps {
  k: DashboardKey;
  children: ReactNode;
  /** Optional className applied to the EDIT-mode wrapper div. Use to
   *  control grid-column-span behavior when the underlying child needs
   *  to span more than one cell (e.g. profit trend = lg:col-span-2). */
  className?: string;
}

export function DashboardCard({ k, children, className }: DashboardCardProps) {
  const editMode = useDashboardPrefs((s) => s.editMode);
  const isVisible = useDashboardPrefs((s) => s.visible[k]);
  const toggle = useDashboardPrefs((s) => s.toggle);

  // Normal view — hidden = nothing.
  if (!editMode) {
    if (!isVisible) return null;
    // Apply className even outside edit mode so grid spans (col-span-N) work.
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }

  // Edit mode — wrap with ring + toggle overlay.
  return (
    <div
      className={cn(
        'relative rounded-xl ring-2 ring-primary/30 ring-offset-2 ring-offset-background transition-opacity',
        !isVisible && 'opacity-60',
        className,
      )}
    >
      {/* Hidden badge — tiny tag in the bottom-left so the empty/greyed
          state is unambiguous (not just "looks faded"). */}
      {!isVisible && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Hidden
        </div>
      )}

      {/* Toggle pill — Eye / EyeOff + label. Tap target is 32px tall so
          it's comfortable on mobile without dominating the card. */}
      <button
        type="button"
        onClick={() => toggle(k)}
        className={cn(
          'absolute right-2 top-2 z-10 inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium shadow-sm transition-colors',
          isVisible
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-card text-foreground ring-1 ring-border hover:bg-muted',
        )}
        aria-label={`${isVisible ? 'Hide' : 'Show'} ${DASHBOARD_LABELS[k]}`}
      >
        {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{isVisible ? 'Visible' : 'Hidden'}</span>
      </button>

      {children}
    </div>
  );
}
