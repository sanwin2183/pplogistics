import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '../../components/ui/sheet';
import type { Customer, CustomerType } from '../../types';
import { useCreateCustomer, useUpdateCustomer } from './useCustomers';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  phone: z.string().min(4, 'Required'),
  telegram: z.string().optional(),
  type: z.enum(['shop', 'individual']),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface Props {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onCreated?: (id: string, name: string) => void;
}

export function CustomerFormSheet({ open, customer, onClose, onCreated }: Props) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', phone: '', telegram: '', type: 'individual', notes: '' },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: customer?.name ?? '',
        phone: customer?.phone ?? '',
        telegram: customer?.telegram ?? '',
        type: customer?.type ?? 'individual',
        notes: customer?.notes ?? '',
      });
    }
  }, [open, customer, reset]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (customer) {
        await update.mutateAsync({ ...customer, ...data });
        toast.success('Customer updated');
      } else {
        const id = await create.mutateAsync(data);
        toast.success('Customer added');
        onCreated?.(id, data.name);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  });

  const type = watch('type') as CustomerType;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="sm:max-w-md sm:mx-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 max-h-[92svh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>{customer ? 'Edit customer' : 'Add customer'}</SheetTitle>
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
          <div className="space-y-1.5">
            <Label htmlFor="telegram">Telegram (optional)</Label>
            <Input id="telegram" placeholder="@username" {...register('telegram')} />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setValue('type', v as CustomerType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shop">Online shop</SelectItem>
                <SelectItem value="individual">Individual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
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
