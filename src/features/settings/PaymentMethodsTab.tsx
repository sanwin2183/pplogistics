import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { Plus, Pencil, Trash2, QrCode, Banknote, Smartphone, CreditCard, Image as ImageIcon } from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { EmptyState } from '../../components/EmptyState';
import { storage } from '../../lib/firebase';
import { firstErrorMessage } from '../../lib/forms';
import type { PaymentMethod, PaymentMethodType } from '../../types';
import { useUpdatePaymentMethods } from './useSettings';

const schema = z.object({
  type: z.enum(['bank_transfer', 'promptpay', 'kbz_pay', 'wave_pay']),
  label: z.string().min(1),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  bank: z.string().optional(),
  qrUrl: z.string().optional(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
type FormData = z.infer<typeof schema>;

const TYPE_LABELS: Record<PaymentMethodType, string> = {
  bank_transfer: 'Bank Transfer',
  promptpay: 'PromptPay',
  kbz_pay: 'KBZ Pay',
  wave_pay: 'Wave Pay',
};

const TYPE_ICONS: Record<PaymentMethodType, typeof Banknote> = {
  bank_transfer: Banknote,
  promptpay: QrCode,
  kbz_pay: Smartphone,
  wave_pay: CreditCard,
};

export function PaymentMethodsTab({ methods }: { methods: PaymentMethod[] }) {
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [creating, setCreating] = useState(false);
  const update = useUpdatePaymentMethods();

  // save() throws on failure so the MethodDialog can keep itself open for
  // retry. useUpdatePaymentMethods.onError surfaces the actual error toast;
  // we just re-throw here so the caller can branch on success vs failure.
  const save = async (m: PaymentMethod) => {
    const wasEditing = !!editing;
    const next = wasEditing ? methods.map((x) => (x.id === m.id ? m : x)) : [...methods, m];
    // If this one is default, un-default others of the same type.
    const cleaned = next.map((x) =>
      m.isDefault && x.id !== m.id && x.type === m.type ? { ...x, isDefault: false } : x,
    );
    await update.mutateAsync(cleaned);
    toast.success(wasEditing ? 'Payment method updated' : 'Payment method added');
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this payment method?')) return;
    try {
      await update.mutateAsync(methods.filter((m) => m.id !== id));
      toast.success('Payment method deleted');
    } catch {
      // mutation.onError already toasted.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}><Plus /> Add method</Button>
      </div>
      {!methods.length ? (
        <EmptyState
          icon={CreditCard}
          title="No payment methods"
          description="Add a bank account, PromptPay QR, KBZPay, or Wave Pay so customers can pay you via the tracking page."
          action={{ label: 'Add your first method', onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="space-y-2">
          {methods.map((m) => {
            const Icon = TYPE_ICONS[m.type];
            return (
              <div key={m.id} className="card-soft flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    {m.isDefault && <span className="status-pill bg-accent text-accent-foreground">Default</span>}
                    {!m.isActive && <span className="status-pill bg-muted text-muted-foreground">Inactive</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {TYPE_LABELS[m.type]} · {m.accountName} · {m.accountNumber}
                    {m.bank && ` · ${m.bank}`}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(m)} aria-label="Edit">
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => remove(m.id)} aria-label="Delete">
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <MethodDialog
        open={creating || !!editing}
        method={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSave={save}
      />
    </div>
  );
}

function MethodDialog({
  open,
  method,
  onClose,
  onSave,
}: {
  open: boolean;
  method: PaymentMethod | null;
  onClose: () => void;
  onSave: (m: PaymentMethod) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
      type: 'promptpay',
      label: '',
      accountName: '',
      accountNumber: '',
      bank: '',
      qrUrl: '',
      isDefault: false,
      isActive: true,
    },
    values: method
      ? {
          type: method.type,
          label: method.label,
          accountName: method.accountName,
          accountNumber: method.accountNumber,
          bank: method.bank ?? '',
          qrUrl: method.qrUrl ?? '',
          isDefault: method.isDefault,
          isActive: method.isActive,
        }
      : undefined,
  });

  const type = watch('type');
  const qrUrl = watch('qrUrl');
  const showQrUpload = type === 'promptpay' || type === 'kbz_pay' || type === 'wave_pay';
  const showBank = type === 'bank_transfer';

  const onPickFile = async (file: File) => {
    setUploading(true);
    try {
      const path = `qrcodes/${nanoid(8)}-${file.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      setValue('qrUrl', url, { shouldDirty: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = handleSubmit(
    async (data) => {
      // Conditionally INCLUDE optional keys only when non-empty so we never
      // put `bank: undefined` / `qrUrl: undefined` into the nested
      // payment.methods[] array — Firebase SDK v11 rejects undefined inside
      // nested objects, which was silently failing every Save here. With a
      // hidden bank field for PromptPay/KBZ/Wave, this hit on every type.
      const next: PaymentMethod = {
        id: method?.id ?? nanoid(8),
        type: data.type,
        label: data.label,
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        isDefault: data.isDefault,
        isActive: data.isActive,
        ...(data.bank ? { bank: data.bank } : {}),
        ...(data.qrUrl ? { qrUrl: data.qrUrl } : {}),
      };
      try {
        await onSave(next);
        reset();
        onClose();
      } catch {
        // mutation.onError already toasted; keep the dialog open so the
        // owner can edit/retry instead of losing context.
      }
    },
    (errs) => {
      toast.error(firstErrorMessage(errs) ?? 'Please fix the highlighted fields');
    },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{method ? 'Edit method' : 'Add payment method'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setValue('type', v as PaymentMethodType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['promptpay', 'bank_transfer', 'kbz_pay', 'wave_pay'] as const).map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label">Display label</Label>
            <Input id="label" placeholder="e.g. SCB Personal" autoFocus {...register('label')} />
            {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="accountName">Account name</Label>
              <Input id="accountName" {...register('accountName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="accountNumber">Account / number</Label>
              <Input id="accountNumber" {...register('accountNumber')} />
            </div>
          </div>
          {showBank && (
            <div className="space-y-1.5">
              <Label htmlFor="bank">Bank</Label>
              <Input id="bank" placeholder="SCB / KBank / Krungsri…" {...register('bank')} />
            </div>
          )}
          {showQrUpload && (
            <div className="space-y-1.5">
              <Label>QR code image (optional)</Label>
              <div className="flex items-center gap-3">
                {qrUrl ? (
                  <img src={qrUrl} alt="QR" className="h-20 w-20 rounded-md border border-border object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? 'Uploading…' : qrUrl ? 'Replace' : 'Upload'}
                  </Button>
                  {qrUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setValue('qrUrl', '')}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="isDefault" className="cursor-pointer">Default for this type</Label>
            <Switch id="isDefault" checked={watch('isDefault')} onCheckedChange={(v) => setValue('isDefault', v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="isActive" className="cursor-pointer">Active (offer to customers)</Label>
            <Switch id="isActive" checked={watch('isActive')} onCheckedChange={(v) => setValue('isActive', v)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
