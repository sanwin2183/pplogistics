import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '../../components/ui/sheet';
import { ROUTES, ROUTE_LABELS, FLYER_STATUSES, FLYER_STATUS_LABELS } from '../../lib/status';
import { toDate } from '../../lib/formatters';
import { firstErrorMessage } from '../../lib/forms';
import type { Flyer, FlyerStatus, Route } from '../../types';
import { useCreateFlyer, useUpdateFlyer } from './useFlyers';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  phone: z.string().min(4, 'Required'),
  route: z.enum(['BKK→YGN', 'BKK→MDL', 'YGN→BKK', 'MDL→BKK']),
  flightDate: z.string().min(1, 'Required'),
  flightNumber: z.string().optional(),
  kgAvailable: z.coerce.number().min(0.1, 'At least 0.1 kg'),
  ratePerKg: z.coerce.number().min(0),
  prohibitedItems: z.string().optional(),
  status: z.enum(['upcoming', 'in-transit', 'completed', 'cancelled']),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export function FlyerFormSheet({
  open,
  flyer,
  onClose,
}: {
  open: boolean;
  flyer: Flyer | null;
  onClose: () => void;
}) {
  const create = useCreateFlyer();
  const update = useUpdateFlyer();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      phone: '',
      route: 'BKK→YGN',
      flightDate: dayjs().add(1, 'day').format('YYYY-MM-DDTHH:mm'),
      flightNumber: '',
      kgAvailable: 10,
      ratePerKg: 200,
      prohibitedItems: '',
      status: 'upcoming',
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: flyer?.name ?? '',
        phone: flyer?.phone ?? '',
        route: flyer?.route ?? 'BKK→YGN',
        flightDate: flyer?.flightDate
          ? dayjs(toDate(flyer.flightDate)).format('YYYY-MM-DDTHH:mm')
          : dayjs().add(1, 'day').format('YYYY-MM-DDTHH:mm'),
        flightNumber: flyer?.flightNumber ?? '',
        kgAvailable: flyer?.kgAvailable ?? 10,
        ratePerKg: flyer?.ratePerKg ?? 200,
        prohibitedItems: flyer?.prohibitedItems?.join(', ') ?? '',
        status: flyer?.status ?? 'upcoming',
        notes: flyer?.notes ?? '',
      });
    }
  }, [open, flyer, reset]);

  const onSubmit = handleSubmit(
    async (data) => {
      const trimmedFlightNumber = data.flightNumber?.trim();
      const trimmedNotes = data.notes?.trim();
      // Conditionally INCLUDE optional keys only when they have a value, so
      // we never pass `undefined` (Firestore SDK v11 rejects it at the SDK
      // boundary) and we don't write empty-string noise into the doc either.
      const payload = {
        name: data.name,
        phone: data.phone,
        route: data.route as Route,
        flightDate: dayjs(data.flightDate).toDate(),
        kgAvailable: data.kgAvailable,
        ratePerKg: data.ratePerKg,
        prohibitedItems: data.prohibitedItems
          ? data.prohibitedItems.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        status: data.status as FlyerStatus,
        ...(trimmedFlightNumber ? { flightNumber: trimmedFlightNumber } : {}),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      };
      try {
        if (flyer) {
          await update.mutateAsync({ ...flyer, ...payload, kgUsed: flyer.kgUsed });
          toast.success('Flyer updated');
        } else {
          await create.mutateAsync(payload);
          toast.success('Flyer added');
        }
        onClose();
      } catch {
        // mutation.onError already toasted the failure.
      }
    },
    // Validation-failure handler — without this the form was silent whenever
    // any field other than name/phone failed validation (route, flightDate,
    // kgAvailable, ratePerKg, status had no inline error rendering).
    (errs) => {
      toast.error(firstErrorMessage(errs) ?? 'Please fix the highlighted fields');
      console.warn('[FlyerFormSheet] invalid:', errs);
    },
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="sm:max-w-md sm:mx-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 max-h-[92svh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{flyer ? 'Edit flyer' : 'Add flyer'}</SheetTitle>
        </SheetHeader>
        <form onSubmit={onSubmit} className="space-y-4 p-6 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoFocus {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" inputMode="tel" {...register('phone')} />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Route</Label>
              <Select value={watch('route')} onValueChange={(v) => setValue('route', v as Route)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUTES.map((r) => (
                    <SelectItem key={r} value={r}>{ROUTE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.route && <p className="text-xs text-destructive">{errors.route.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={watch('status')} onValueChange={(v) => setValue('status', v as FlyerStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FLYER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{FLYER_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.status && <p className="text-xs text-destructive">{errors.status.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="flightDate">Flight date</Label>
              <Input id="flightDate" type="datetime-local" {...register('flightDate')} />
              {errors.flightDate && <p className="text-xs text-destructive">{errors.flightDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flightNumber">Flight no.</Label>
              <Input id="flightNumber" placeholder="TG303" {...register('flightNumber')} />
              {errors.flightNumber && <p className="text-xs text-destructive">{errors.flightNumber.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="kgAvailable">Capacity (kg)</Label>
              <Input id="kgAvailable" type="number" step="any" min={0} inputMode="decimal" {...register('kgAvailable')} />
              {errors.kgAvailable && <p className="text-xs text-destructive">{errors.kgAvailable.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ratePerKg">Pay rate (THB/kg)</Label>
              <Input id="ratePerKg" type="number" step="any" min={0} inputMode="decimal" {...register('ratePerKg')} />
              {errors.ratePerKg && <p className="text-xs text-destructive">{errors.ratePerKg.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prohibitedItems">Prohibited items (comma-separated)</Label>
            <Input id="prohibitedItems" placeholder="liquids, batteries" {...register('prohibitedItems')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} {...register('notes')} />
          </div>
          <SheetFooter className="p-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
