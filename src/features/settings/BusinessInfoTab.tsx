import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Image as ImageIcon } from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { nanoid } from 'nanoid';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { storage } from '../../lib/firebase';
import type { BusinessInfo } from '../../types';
import { useUpdateBusinessInfo } from './useSettings';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  tagline: z.string().optional(),
  logoUrl: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  contactTelegram: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export function BusinessInfoTab({ business }: { business: BusinessInfo }) {
  const update = useUpdateBusinessInfo();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: business });

  const logoUrl = watch('logoUrl');

  const onPickFile = async (file: File) => {
    setUploading(true);
    try {
      const ref = storageRef(storage, `branding/logo-${nanoid(8)}-${file.name}`);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      setValue('logoUrl', url, { shouldDirty: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = handleSubmit(async (data) => {
    await update.mutateAsync(data);
    toast.success('Business info saved');
  });

  return (
    <form onSubmit={onSubmit} className="card-soft space-y-4 p-6">
      <div className="space-y-1.5">
        <Label>Logo (optional)</Label>
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-16 w-16 rounded-md border border-border object-contain p-1" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPickFile(e.target.files[0])} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
          {logoUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setValue('logoUrl', '', { shouldDirty: true })}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="name">Business name</Label>
        <Input id="name" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tagline">Tagline</Label>
        <Input id="tagline" placeholder="Hand-carry between Bangkok ↔ Myanmar" {...register('tagline')} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="contactPhone">Phone</Label>
          <Input id="contactPhone" inputMode="tel" {...register('contactPhone')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contactEmail">Email</Label>
          <Input id="contactEmail" type="email" {...register('contactEmail')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contactTelegram">Telegram</Label>
          <Input id="contactTelegram" placeholder="@username" {...register('contactTelegram')} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || isSubmitting}>Save</Button>
      </div>
    </form>
  );
}
