import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import type { MessageTemplates } from '../../types';
import { useUpdateTemplates } from './useSettings';

const PLACEHOLDERS = ['{customerName}', '{orderNumber}', '{totalAmount}', '{totalWeight}', '{trackingUrl}'];

export function MessageTemplatesTab({ templates }: { templates: MessageTemplates }) {
  const update = useUpdateTemplates();
  const {
    register,
    handleSubmit,
    formState: { isDirty, isSubmitting },
  } = useForm<MessageTemplates>({ defaultValues: templates });

  const onSubmit = handleSubmit(async (data) => {
    await update.mutateAsync(data);
    toast.success('Templates saved');
  });

  return (
    <form onSubmit={onSubmit} className="card-soft space-y-4 p-6">
      <p className="rounded-lg bg-accent/40 p-3 text-xs text-accent-foreground">
        Use these placeholders — they're replaced automatically when you copy the tracking link from an order:{' '}
        <code className="font-mono">{PLACEHOLDERS.join(' ')}</code>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="en">🇬🇧 English</Label>
        <Textarea id="en" rows={3} {...register('en')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="th">🇹🇭 Thai</Label>
        <Textarea id="th" rows={3} {...register('th')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="my">🇲🇲 Burmese</Label>
        <Textarea id="my" rows={3} {...register('my')} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || isSubmitting}>Save</Button>
      </div>
    </form>
  );
}
