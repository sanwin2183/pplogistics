import dayjs from 'dayjs';
import { AlertCircle, CalendarRange } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useDashboardPrefs } from './useDashboardPrefs';
import {
  getRangeBounds,
  rangeLongLabel,
  type DateRangeMode,
} from './dashboardRange';

/**
 * Range-selector control sitting above the dashboard cards.
 *
 * Visual structure:
 *   ┌────────────────────────────────────────────────┐
 *   │ [Lifetime] [This Month] [Pick month] [Custom]  │  ← scrollable tab strip
 *   │ <conditional input(s) for pick_month / custom> │
 *   │ Showing: <range label>                         │  ← live label, prominent
 *   └────────────────────────────────────────────────┘
 *
 * The tab strip uses the same overflow-x-auto + snap pattern as
 * SettingsPage so it scrolls horizontally on phone widths without
 * dominating the layout. Each trigger has shrink-0 + snap-start so the
 * leading edge of the next tab snaps cleanly into view.
 *
 * Conditional input row appears only when the active mode needs one:
 *   pick_month → single <input type="month">
 *   custom     → <input type="date" From> + <input type="date" To>,
 *                stacking vertically on mobile, side-by-side on sm+
 *
 * Validation for Custom: getRangeBounds returns valid=false with a
 * reason string when From > To or one of the dates is blank. We
 * surface the reason inline (no toast — the dashboard cards already
 * render their empty states when bounds are invalid). The "Showing"
 * line switches to the warning style so the user sees that nothing's
 * being aggregated.
 */
export function DateRangeControl() {
  const selectedRange = useDashboardPrefs((s) => s.selectedRange);
  const setRange = useDashboardPrefs((s) => s.setRange);
  const bounds = getRangeBounds(selectedRange);

  const setMode = (mode: DateRangeMode) =>
    setRange((prev) => ({ ...prev, mode }));

  return (
    <section className="card-soft space-y-3 p-4">
      {/* Preset tab strip — scrollable on mobile, inline on desktop. */}
      <Tabs
        value={selectedRange.mode}
        onValueChange={(v) => setMode(v as DateRangeMode)}
      >
        <TabsList
          className="
            flex w-full overflow-x-auto snap-x snap-mandatory
            [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
            justify-start sm:w-auto sm:inline-flex sm:justify-center
          "
        >
          <TabsTrigger value="lifetime" className="shrink-0 snap-start">Lifetime</TabsTrigger>
          <TabsTrigger value="this_month" className="shrink-0 snap-start">This Month</TabsTrigger>
          <TabsTrigger value="pick_month" className="shrink-0 snap-start">Pick month</TabsTrigger>
          <TabsTrigger value="custom" className="shrink-0 snap-start">Custom range</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Conditional input row. Two `if`s rather than a switch so the
          components mount/unmount with mode changes — keeps the
          DOM small when the inputs aren't relevant. */}
      {selectedRange.mode === 'pick_month' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="dashboard-pickmonth" className="text-xs">Month</Label>
            <Input
              id="dashboard-pickmonth"
              type="month"
              value={selectedRange.pickMonth ?? ''}
              // Reasonable hint — disallow future months since lifetime
              // analytics on a not-yet-existed month would be empty.
              max={dayjs().format('YYYY-MM')}
              onChange={(e) =>
                setRange((prev) => ({ ...prev, pickMonth: e.target.value || undefined }))
              }
            />
          </div>
        </div>
      )}

      {selectedRange.mode === 'custom' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="dashboard-from" className="text-xs">From</Label>
            <Input
              id="dashboard-from"
              type="date"
              value={selectedRange.customFrom ?? ''}
              max={selectedRange.customTo || dayjs().format('YYYY-MM-DD')}
              onChange={(e) =>
                setRange((prev) => ({ ...prev, customFrom: e.target.value || undefined }))
              }
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="dashboard-to" className="text-xs">To</Label>
            <Input
              id="dashboard-to"
              type="date"
              value={selectedRange.customTo ?? ''}
              min={selectedRange.customFrom || undefined}
              max={dayjs().format('YYYY-MM-DD')}
              onChange={(e) =>
                setRange((prev) => ({ ...prev, customTo: e.target.value || undefined }))
              }
            />
          </div>
        </div>
      )}

      {/* "Showing: …" — anchored notice line so the active range is
          always visible. Uses the destructive tone when bounds.valid
          === false (Custom with bad inputs / Pick Month with no
          selection) so the user immediately knows nothing is being
          aggregated. */}
      <div
        className={
          bounds.valid
            ? 'flex items-center gap-2 text-xs'
            : 'flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive'
        }
      >
        {bounds.valid ? (
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5" />
        )}
        <span className="text-muted-foreground">Showing:</span>
        <span
          className={
            bounds.valid
              ? 'font-medium tabular-nums text-foreground'
              : 'font-medium tabular-nums'
          }
        >
          {rangeLongLabel(selectedRange, bounds)}
        </span>
      </div>
    </section>
  );
}
