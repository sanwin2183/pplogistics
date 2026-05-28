import { useState } from 'react';
import { Plus, Tags, Pencil, Trash2, Ban } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/ui/skeleton';
import { fmtMoney } from '../../lib/formatters';
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory } from './useCategories';
import type { Category } from '../../types';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  defaultRatePerKg: z.coerce.number().min(0, 'Must be ≥ 0'),
  isProhibited: z.boolean(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export function CategoriesPage() {
  const { data: categories, isLoading } = useCategories();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        subtitle="Default rates for the items you carry."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !categories?.length ? (
        <EmptyState
          icon={Tags}
          title="No categories yet"
          description="Add a category like ‘Clothes’ or ‘Cosmetics’ — its rate per kg pre-fills when adding order items."
          action={{ label: 'Create your first category', onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="card-soft divide-y divide-border">
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} onEdit={() => setEditing(c)} />
          ))}
        </div>
      )}

      <CategoryDialog
        open={creating || !!editing}
        category={editing}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </div>
  );
}

function CategoryRow({ category, onEdit }: { category: Category; onEdit: () => void }) {
  const del = useDeleteCategory();
  return (
    <div className="flex items-center justify-between p-4 gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{category.name}</span>
          {category.isProhibited && (
            <span className="status-pill bg-destructive/10 text-destructive">
              <Ban className="h-3 w-3" /> Prohibited
            </span>
          )}
        </div>
        {category.notes && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{category.notes}</p>}
      </div>
      <div className="text-right tabular-nums text-sm font-medium">{fmtMoney(category.defaultRatePerKg)}<span className="text-muted-foreground font-normal">/kg</span></div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit">
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete"
          onClick={() => {
            if (!confirm(`Delete category "${category.name}"?`)) return;
            del.mutate(category.id, { onSuccess: () => toast.success('Category deleted') });
          }}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function CategoryDialog({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: Category | null;
  onClose: () => void;
}) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const isEdit = !!category;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: category
      ? {
          name: category.name,
          defaultRatePerKg: category.defaultRatePerKg,
          isProhibited: category.isProhibited,
          notes: category.notes ?? '',
        }
      : { name: '', defaultRatePerKg: 0, isProhibited: false, notes: '' },
  });

  // Re-seed form when switching between edit and create modes.
  const formKey = category?.id ?? 'new';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  formKey;

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (isEdit && category) {
        await update.mutateAsync({ ...category, ...data });
        toast.success('Category updated');
      } else {
        await create.mutateAsync(data);
        toast.success('Category created');
      }
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'New category'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoFocus {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defaultRatePerKg">Default rate per kg (THB)</Label>
            <Input
              id="defaultRatePerKg"
              type="number"
              step="any"
              min={0}
              inputMode="decimal"
              {...register('defaultRatePerKg')}
            />
            {errors.defaultRatePerKg && <p className="text-xs text-destructive">{errors.defaultRatePerKg.message}</p>}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="isProhibited" className="cursor-pointer">Prohibited items</Label>
              <p className="text-xs text-muted-foreground">Flag this category so it's blocked from new orders.</p>
            </div>
            <Switch
              id="isProhibited"
              checked={watch('isProhibited')}
              onCheckedChange={(v) => setValue('isProhibited', v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" rows={2} {...register('notes')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
