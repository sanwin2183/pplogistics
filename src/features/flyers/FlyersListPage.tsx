import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Plane, Filter } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Progress } from '../../components/ui/progress';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { FlyerStatusBadge } from '../../components/StatusBadge';
import { PageHeader } from '../../components/PageHeader';
import { fmtDate, fmtKg, fmtMoney } from '../../lib/formatters';
import { ROUTES, ROUTE_LABELS, FLYER_STATUSES, FLYER_STATUS_LABELS } from '../../lib/status';
import { useFlyers } from './useFlyers';
import { FlyerFormSheet } from './FlyerFormSheet';
import type { Flyer, FlyerStatus, Route } from '../../types';

export function FlyersListPage() {
  const { data: flyers, isLoading } = useFlyers();
  const [routeFilter, setRouteFilter] = useState<Route | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<FlyerStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    if (!flyers) return [];
    return flyers.filter(
      (f) =>
        (routeFilter === 'all' || f.route === routeFilter) &&
        (statusFilter === 'all' || f.status === statusFilter),
    );
  }, [flyers, routeFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flyers"
        subtitle="Travelers carrying kg between BKK ↔ MM"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add
          </Button>
        }
      />

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select value={routeFilter} onValueChange={(v) => setRouteFilter(v as Route | 'all')}>
          <SelectTrigger className="h-9 w-auto min-w-[10rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All routes</SelectItem>
            {ROUTES.map((r) => <SelectItem key={r} value={r}>{ROUTE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as FlyerStatus | 'all')}>
          <SelectTrigger className="h-9 w-auto min-w-[8rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {FLYER_STATUSES.map((s) => <SelectItem key={s} value={s}>{FLYER_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !filtered.length ? (
        flyers?.length ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No flyers match these filters.</p>
        ) : (
          <EmptyState
            icon={Plane}
            title="No flyers yet"
            description="Add a traveler with capacity to carry — you'll assign them to orders next."
            action={{ label: 'Add your first flyer', onClick: () => setCreating(true) }}
          />
        )
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => <FlyerCard key={f.id} flyer={f} />)}
        </div>
      )}

      <FlyerFormSheet open={creating} flyer={null} onClose={() => setCreating(false)} />
    </div>
  );
}

function FlyerCard({ flyer }: { flyer: Flyer }) {
  const usedPct = flyer.kgAvailable > 0 ? Math.min(100, (flyer.kgUsed / flyer.kgAvailable) * 100) : 0;
  return (
    <Link
      to={`/flyers/${flyer.id}`}
      className="block card-soft p-4 transition-colors hover:bg-secondary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium">{flyer.name}</div>
            <FlyerStatusBadge status={flyer.status} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {ROUTE_LABELS[flyer.route]} · {fmtDate(flyer.flightDate)}
            {flyer.flightNumber && <> · {flyer.flightNumber}</>}
          </div>
        </div>
        <div className="text-right tabular-nums">
          <div className="text-sm font-medium">{fmtMoney(flyer.ratePerKg)}<span className="text-muted-foreground font-normal">/kg</span></div>
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{fmtKg(flyer.kgUsed)} of {fmtKg(flyer.kgAvailable)} used</span>
          <span className="font-medium tabular-nums">{usedPct.toFixed(0)}%</span>
        </div>
        <Progress value={usedPct} className="h-1.5" />
      </div>
    </Link>
  );
}
