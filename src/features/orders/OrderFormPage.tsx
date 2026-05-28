import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2, Check, User, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Checkbox } from '../../components/ui/checkbox';
import { Separator } from '../../components/ui/separator';
import { FullPageSpinner } from '../../components/Spinner';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtKg, fmtMoney, toDate } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import { useCustomers } from '../customers/useCustomers';
import { useCategories } from '../categories/useCategories';
import { useUpcomingFlyers } from '../flyers/useFlyers';
import { useSettings } from '../settings/useSettings';
import { useCreateOrder } from './useOrders';
import { CustomerFormSheet } from '../customers/CustomerFormSheet';
import { firstFieldError, type FieldErrorHit } from '../../lib/forms';
import dayjs from 'dayjs';

// Field-named validation messages.
//
// Before: bare 'Required' strings produced a toast that said only "Required"
// with no field name, and per-row inline errors joined to "Required · ..."
// equally anonymous. The schema is now the single source of truth for what
// the failing field is called, so both the toast and the inline error stay
// in sync — and any walker (see firstFieldError in lib/forms) can surface
// them verbatim.
const itemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  categoryId: z.string().min(1, 'Category is required'),
  categoryName: z.string(),
  weightKg: z.coerce.number().min(0.01, 'Weight must be at least 0.01 kg'),
  ratePerKg: z.coerce.number().min(0, 'Rate must be at least 0'),
  subtotal: z.coerce.number(),
});

const assignmentSchema = z.object({
  flyerId: z.string().min(1, 'Flyer is required'),
  flyerName: z.string(),
  weightKg: z.coerce.number().min(0.01, 'Weight must be at least 0.01 kg'),
  payoutRatePerKg: z.coerce.number().min(0, 'Payout rate must be at least 0'),
  payoutAmount: z.coerce.number(),
});

const schema = z
  .object({
    customerId: z.string().min(1, 'Pick a customer'),
    customerName: z.string(),
    customerPhone: z.string(),
    items: z.array(itemSchema).min(1, 'Add at least one item'),
    flyerAssignments: z.array(assignmentSchema),
    enabledMethodIds: z.array(z.string()),
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      const itemKg = data.items.reduce((s, it) => s + it.weightKg, 0);
      const flyerKg = data.flyerAssignments.reduce((s, a) => s + a.weightKg, 0);
      return flyerKg === 0 || flyerKg <= itemKg + 0.001;
    },
    { message: 'Flyer assignments exceed total weight', path: ['flyerAssignments'] },
  );

type FormData = z.infer<typeof schema>;

export function OrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const { data: customers } = useCustomers();
  const { data: categories } = useCategories();
  const { data: flyers } = useUpcomingFlyers();
  const { data: settings } = useSettings();
  const create = useCreateOrder();

  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // The default category we slot into new item rows. Prefer "Other" by name
  // (the seeded catch-all) and fall back to the first alphabetical category
  // if the owner renamed it. addItem() preloads this so a row that the owner
  // leaves alone still passes validation — kills the silent-trap where
  // description/weight/rate look filled but categoryId is empty.
  const defaultCategory = useMemo(
    () => categories?.find((c) => c.name === 'Other') ?? categories?.[0],
    [categories],
  );

  const defaultEnabledMethods = useMemo(() => settings?.payment.methods.filter((m) => m.isActive).map((m) => m.id) ?? [], [settings]);

  // Per-row scroll targets. Indexed by useFieldArray position; we rebuild
  // these every render so removed rows don't leave dangling refs. Used by
  // the onInvalid handler to scroll the first errored row into view —
  // critical on mobile where the offending row is often offscreen below
  // the sticky bottom Submit bar.
  const itemRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const flyerRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const customerSectionRef = useRef<HTMLElement | null>(null);

  // Track which item rows the owner has explicitly picked a category for, so
  // we only show the "still on Other (default)" nudge on rows that the owner
  // never touched. Keyed by stable useFieldArray field.id so adding/removing
  // rows doesn't reshuffle the set.
  const [touchedCategoryRows, setTouchedCategoryRows] = useState<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      customerId: '',
      customerName: '',
      customerPhone: '',
      items: [],
      flyerAssignments: [],
      enabledMethodIds: defaultEnabledMethods,
      notes: '',
    },
  });

  const items = useFieldArray({ control, name: 'items' });
  const assignments = useFieldArray({ control, name: 'flyerAssignments' });

  const watchedItems = watch('items');
  const watchedAssignments = watch('flyerAssignments');
  const totalAmount = watchedItems.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
  const totalWeight = watchedItems.reduce((s, it) => s + (Number(it.weightKg) || 0), 0);
  const totalPayout = watchedAssignments.reduce((s, a) => s + (Number(a.payoutAmount) || 0), 0);
  const profit = totalAmount - totalPayout;

  if (isEdit) {
    // Editing an existing order is intentionally out of scope (orders are mostly write-once
    // post-creation; status changes happen via the detail page actions).
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Editing an order isn't supported — cancel and re-create if needed.
      </div>
    );
  }

  if (!customers || !categories || !flyers || !settings) return <FullPageSpinner />;

  const onSubmit = handleSubmit(
    async (data) => {
      try {
        const payload = {
          customerId: data.customerId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          items: data.items,
          totalWeightKg: totalWeight,
          totalAmount,
          flyerAssignments: data.flyerAssignments,
          totalPayout,
          profit,
          paymentInstructions: { enabledMethodIds: data.enabledMethodIds },
          notes: data.notes,
        };
        const { id: newId } = await create.mutateAsync(payload);
        toast.success('Order created');
        navigate(`/orders/${newId}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed');
      }
    },
    // Validation-failure handler — surface the FIRST problem as a labeled
    // toast AND scroll the offending row into view. Before: bare "Required"
    // toast, no idea which field or row; on a long form the inline error
    // was often offscreen below the sticky submit bar.
    (errs) => {
      const hit = firstFieldError(errs);
      if (hit) {
        toast.error(labelForError(hit));
        scrollToError(hit);
      } else {
        toast.error('Please fix the highlighted fields');
      }
      // Helpful for diagnosing edge cases via remote debugging.
      console.warn('[OrderForm] invalid:', errs);
    },
  );

  /** Format a path-aware FieldErrorHit into a toast-ready label that names
   *  the row + field. e.g. ['items', 2, 'categoryId'] → "Item 3: Category is required". */
  function labelForError(hit: FieldErrorHit): string {
    const [k0, k1] = hit.path;
    if (k0 === 'items' && typeof k1 === 'number') return `Item ${k1 + 1}: ${hit.message}`;
    if (k0 === 'flyerAssignments' && typeof k1 === 'number') return `Flyer assignment ${k1 + 1}: ${hit.message}`;
    return hit.message;
  }

  /** Scroll the user to whatever needs fixing. block:'center' lands the row
   *  mid-screen above the sticky submit bar. Falls back to scrollTop(0) for
   *  top-level errors (e.g. customer not picked). */
  function scrollToError(hit: FieldErrorHit) {
    const [k0, k1] = hit.path;
    let el: HTMLElement | null = null;
    if (k0 === 'items' && typeof k1 === 'number') el = itemRowRefs.current[k1] ?? null;
    else if (k0 === 'flyerAssignments' && typeof k1 === 'number') el = flyerRowRefs.current[k1] ?? null;
    else if (k0 === 'customerId') el = customerSectionRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function addItem() {
    // Preload the default category so the row passes validation as-is.
    // ratePerKg comes from the category's defaultRatePerKg per §5; weight
    // starts at 0 so subtotal is also 0 until the owner types a weight.
    items.append({
      description: '',
      categoryId: defaultCategory?.id ?? '',
      categoryName: defaultCategory?.name ?? '',
      weightKg: 0,
      ratePerKg: defaultCategory?.defaultRatePerKg ?? 0,
      subtotal: 0,
    });
  }

  function addAssignment() {
    const remaining = totalWeight - watchedAssignments.reduce((s, a) => s + Number(a.weightKg || 0), 0);
    assignments.append({
      flyerId: '',
      flyerName: '',
      weightKg: Math.max(0, remaining),
      payoutRatePerKg: 0,
      payoutAmount: 0,
    });
  }

  return (
    <div className="space-y-5 pb-32">
      <div className="-ml-2 flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">New order</h1>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">Customer → items → assign flyers → save.</p>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* --- 1. Customer --- */}
        <section ref={customerSectionRef} className="card-soft p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Customer</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewCustomer(true)}>
              <Plus /> New
            </Button>
          </div>
          <CustomerPicker
            customers={customers}
            value={watch('customerId')}
            onSelect={(c) => {
              setValue('customerId', c.id);
              setValue('customerName', c.name);
              setValue('customerPhone', c.phone);
            }}
          />
          {errors.customerId && <p className="mt-1 text-xs text-destructive">{errors.customerId.message}</p>}
        </section>

        {/* --- 2. Items --- */}
        <section className="card-soft p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Items</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addItem}
              disabled={categories.length === 0}
            >
              <Plus /> Add item
            </Button>
          </div>

          {/* Empty-state — no categories seeded, dropdown would be unfillable.
              We hide Add buttons (disabled above + replaced empty-row CTA) and
              point the owner at /categories instead of letting them open an
              empty Select that can never satisfy the required rule. */}
          {categories.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              No categories yet — add them in{' '}
              <Link to="/categories" className="font-medium text-primary underline-offset-2 hover:underline">
                Settings → Categories
              </Link>{' '}
              before creating an order.
            </div>
          )}

          {!items.fields.length && categories.length > 0 && (
            <button
              type="button"
              onClick={addItem}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 py-6 text-sm text-muted-foreground transition-colors hover:bg-secondary"
            >
              <Plus className="h-4 w-4" /> Add first item
            </button>
          )}

          <div className="space-y-3">
            {items.fields.map((field, i) => {
              const item = watchedItems[i];
              const itemError = errors.items?.[i];
              const categoryInvalid = !!itemError?.categoryId;
              // Untouched-Other nudge: the row is still on its preloaded
              // default category (Other) AND the owner has never tapped the
              // dropdown. Not an error — soft hint so glancing down a
              // multi-row order surfaces "Other" rows for review.
              const isUntouchedOther =
                !!defaultCategory &&
                item?.categoryId === defaultCategory.id &&
                !touchedCategoryRows.has(field.id);
              return (
                <div
                  key={field.id}
                  ref={(el) => {
                    itemRowRefs.current[i] = el;
                  }}
                  className="space-y-2 rounded-lg border border-border p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder="Description (e.g. T-shirts)"
                        aria-invalid={!!itemError?.description || undefined}
                        className={cn(
                          itemError?.description && 'border-destructive focus:border-destructive',
                        )}
                        {...register(`items.${i}.description`)}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => items.remove(i)} aria-label="Remove">
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="col-span-2 sm:col-span-2">
                      <Controller
                        control={control}
                        name={`items.${i}.categoryId`}
                        render={({ field: f }) => (
                          <Select
                            value={f.value}
                            onValueChange={(v) => {
                              const cat = categories.find((c) => c.id === v);
                              if (cat) {
                                // f.onChange keeps the Controller's own dirty/
                                // touched bookkeeping in sync alongside the
                                // setValue calls that update the sibling
                                // categoryName/ratePerKg/subtotal fields.
                                f.onChange(cat.id);
                                setValue(`items.${i}.categoryId`, cat.id);
                                setValue(`items.${i}.categoryName`, cat.name);
                                setValue(`items.${i}.ratePerKg`, cat.defaultRatePerKg);
                                const w = Number(watch(`items.${i}.weightKg`)) || 0;
                                setValue(`items.${i}.subtotal`, +(cat.defaultRatePerKg * w).toFixed(2));
                                // Mark this row as user-curated so the
                                // untouched-Other nudge disappears.
                                setTouchedCategoryRows((prev) => {
                                  if (prev.has(field.id)) return prev;
                                  const next = new Set(prev);
                                  next.add(field.id);
                                  return next;
                                });
                              }
                            }}
                          >
                            <SelectTrigger
                              aria-invalid={categoryInvalid || undefined}
                              className={cn(
                                categoryInvalid &&
                                  'border-destructive ring-2 ring-destructive/20 focus:border-destructive',
                              )}
                            >
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name} <span className="ml-2 text-muted-foreground">{fmtMoney(c.defaultRatePerKg)}/kg</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                      {isUntouchedOther && (
                        <p className="mt-1 text-[11px] italic text-muted-foreground">
                          Default — change if a specific category fits
                        </p>
                      )}
                    </div>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      inputMode="decimal"
                      placeholder="kg"
                      aria-invalid={!!itemError?.weightKg || undefined}
                      className={cn(
                        itemError?.weightKg && 'border-destructive focus:border-destructive',
                      )}
                      {...register(`items.${i}.weightKg`, {
                        onChange: (e) => {
                          const w = Number(e.target.value) || 0;
                          const r = Number(watch(`items.${i}.ratePerKg`)) || 0;
                          setValue(`items.${i}.subtotal`, +(w * r).toFixed(2));
                        },
                      })}
                    />
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      inputMode="decimal"
                      placeholder="THB/kg"
                      aria-invalid={!!itemError?.ratePerKg || undefined}
                      className={cn(
                        itemError?.ratePerKg && 'border-destructive focus:border-destructive',
                      )}
                      {...register(`items.${i}.ratePerKg`, {
                        onChange: (e) => {
                          const r = Number(e.target.value) || 0;
                          const w = Number(watch(`items.${i}.weightKg`)) || 0;
                          setValue(`items.${i}.subtotal`, +(w * r).toFixed(2));
                        },
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium tabular-nums">{fmtMoney(item?.subtotal)}</span>
                  </div>
                  {/* Per-item validation errors. Messages now name the field
                      (e.g. "Category is required") so the joined output is
                      self-labeling — no manual prefix needed. */}
                  {itemError && (() => {
                    const msgs = [
                      itemError.description?.message,
                      itemError.categoryId?.message,
                      itemError.weightKg?.message,
                      itemError.ratePerKg?.message,
                    ].filter(Boolean);
                    return msgs.length ? (
                      <p className="text-xs text-destructive">{msgs.join(' · ')}</p>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>

          {/* Top-level items errors (e.g. "Add at least one item"). */}
          {errors.items && typeof (errors.items as { message?: unknown }).message === 'string' && (
            <p className="mt-2 text-xs text-destructive">
              {(errors.items as { message: string }).message}
            </p>
          )}

          {!!items.fields.length && (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Total {fmtKg(totalWeight)}</span>
              <span className="text-lg font-semibold tabular-nums">{fmtMoney(totalAmount)}</span>
            </div>
          )}
        </section>

        {/* --- 3. Flyers --- */}
        <section className="card-soft p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Assign flyers</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addAssignment}
              disabled={!flyers.length || totalWeight <= 0}
            >
              <Plus /> Add flyer
            </Button>
          </div>

          {!flyers.length && (
            <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              No upcoming flyers — add one from the Flyers page first.
            </p>
          )}

          <div className="space-y-3">
            {assignments.fields.map((field, i) => {
              const a = watchedAssignments[i];
              const flyer = flyers.find((f) => f.id === a?.flyerId);
              const flyerRemaining = flyer ? flyer.kgAvailable - flyer.kgUsed : 0;
              const assignmentError = errors.flyerAssignments?.[i];
              // The refine() error on the parent array can stringify to an
              // object-with-message at this index slot — guard with Array.isArray
              // for the (non-existent in practice but typed) array case.
              const flyerInvalid =
                !!assignmentError && !Array.isArray(assignmentError) && !!assignmentError.flyerId;
              const assignmentWeightInvalid =
                !!assignmentError && !Array.isArray(assignmentError) && !!assignmentError.weightKg;
              const assignmentRateInvalid =
                !!assignmentError && !Array.isArray(assignmentError) && !!assignmentError.payoutRatePerKg;
              return (
                <div
                  key={field.id}
                  ref={(el) => {
                    flyerRowRefs.current[i] = el;
                  }}
                  className="space-y-2 rounded-lg border border-border p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Controller
                        control={control}
                        name={`flyerAssignments.${i}.flyerId`}
                        render={({ field: f }) => (
                          <Select
                            value={f.value}
                            onValueChange={(v) => {
                              const fl = flyers.find((x) => x.id === v);
                              if (fl) {
                                // f.onChange keeps Controller dirty/touched
                                // state in sync (see Items dropdown above).
                                f.onChange(fl.id);
                                setValue(`flyerAssignments.${i}.flyerId`, fl.id);
                                setValue(`flyerAssignments.${i}.flyerName`, fl.name);
                                setValue(`flyerAssignments.${i}.payoutRatePerKg`, fl.ratePerKg);
                                const w = Number(watch(`flyerAssignments.${i}.weightKg`)) || 0;
                                setValue(`flyerAssignments.${i}.payoutAmount`, +(fl.ratePerKg * w).toFixed(2));
                              }
                            }}
                          >
                            <SelectTrigger
                              aria-invalid={flyerInvalid || undefined}
                              className={cn(
                                flyerInvalid &&
                                  'border-destructive ring-2 ring-destructive/20 focus:border-destructive',
                              )}
                            >
                              <SelectValue placeholder="Choose flyer" />
                            </SelectTrigger>
                            <SelectContent>
                              {flyers.map((fl) => (
                                <SelectItem key={fl.id} value={fl.id}>
                                  {fl.name} · {ROUTE_LABELS[fl.route]} · {dayjs(toDate(fl.flightDate)).format('D MMM')} · {(fl.kgAvailable - fl.kgUsed).toFixed(1)}kg left
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => assignments.remove(i)} aria-label="Remove">
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        inputMode="decimal"
                        placeholder="kg"
                        aria-invalid={assignmentWeightInvalid || undefined}
                        className={cn(
                          assignmentWeightInvalid && 'border-destructive focus:border-destructive',
                        )}
                        {...register(`flyerAssignments.${i}.weightKg`, {
                          onChange: (e) => {
                            const w = Number(e.target.value) || 0;
                            const r = Number(watch(`flyerAssignments.${i}.payoutRatePerKg`)) || 0;
                            setValue(`flyerAssignments.${i}.payoutAmount`, +(w * r).toFixed(2));
                          },
                        })}
                      />
                      {flyer && (
                        <p className={cn('mt-1 text-xs', (a?.weightKg ?? 0) > flyerRemaining ? 'text-destructive' : 'text-muted-foreground')}>
                          Capacity left: {flyerRemaining.toFixed(1)} kg
                        </p>
                      )}
                    </div>
                    <Input
                      type="number"
                      step="any"
                      min={0}
                      inputMode="decimal"
                      placeholder="Payout/kg"
                      aria-invalid={assignmentRateInvalid || undefined}
                      className={cn(
                        assignmentRateInvalid && 'border-destructive focus:border-destructive',
                      )}
                      {...register(`flyerAssignments.${i}.payoutRatePerKg`, {
                        onChange: (e) => {
                          const r = Number(e.target.value) || 0;
                          const w = Number(watch(`flyerAssignments.${i}.weightKg`)) || 0;
                          setValue(`flyerAssignments.${i}.payoutAmount`, +(r * w).toFixed(2));
                        },
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Payout</span>
                    <span className="font-medium tabular-nums">{fmtMoney(a?.payoutAmount)}</span>
                  </div>
                  {/* Per-assignment validation errors. Messages now name the
                      field (e.g. "Flyer is required") — joined output is
                      self-labeling. */}
                  {assignmentError && !Array.isArray(assignmentError) && (() => {
                    const msgs = [
                      assignmentError.flyerId?.message,
                      assignmentError.weightKg?.message,
                      assignmentError.payoutRatePerKg?.message,
                    ].filter(Boolean);
                    return msgs.length ? (
                      <p className="text-xs text-destructive">{msgs.join(' · ')}</p>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>

          {/* Top-level assignment errors (e.g. refine: weight exceeds items). */}
          {errors.flyerAssignments && typeof (errors.flyerAssignments as { message?: unknown }).message === 'string' && (
            <p className="mt-2 text-xs text-destructive">
              {(errors.flyerAssignments as { message: string }).message}
            </p>
          )}
        </section>

        {/* --- 4. Profit preview --- */}
        <section className="card-soft p-5">
          <h2 className="mb-3 text-sm font-semibold">Profit preview</h2>
          <dl className="space-y-1.5 text-sm">
            <Row label="Revenue" value={<MoneyDisplay amount={totalAmount} />} />
            <Row label="Payout" value={<MoneyDisplay amount={-totalPayout} signed />} />
            <Separator className="my-2" />
            <Row
              label="Profit"
              value={<MoneyDisplay amount={profit} signed className="text-base font-semibold" />}
              strong
            />
          </dl>
        </section>

        {/* --- 5. Payment methods --- */}
        <section className="card-soft p-5">
          <h2 className="mb-1 text-sm font-semibold">Payment methods shown to customer</h2>
          <p className="mb-3 text-xs text-muted-foreground">Toggle which methods appear on the tracking page.</p>
          <div className="space-y-2">
            {settings.payment.methods.length === 0 && (
              <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                No payment methods configured. Add some in Settings → Payment.
              </p>
            )}
            {settings.payment.methods.map((m) => {
              const enabled = (watch('enabledMethodIds') ?? []).includes(m.id);
              return (
                <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3">
                  <Checkbox
                    checked={enabled}
                    onCheckedChange={(v) => {
                      const cur = watch('enabledMethodIds') ?? [];
                      setValue(
                        'enabledMethodIds',
                        v ? [...cur, m.id] : cur.filter((x) => x !== m.id),
                      );
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.accountName} · {m.accountNumber}</div>
                  </div>
                  {!m.isActive && <span className="status-pill bg-muted text-muted-foreground">Inactive</span>}
                </label>
              );
            })}
          </div>
        </section>

        <section className="card-soft p-5">
          <h2 className="mb-3 text-sm font-semibold">Notes (optional)</h2>
          <Textarea rows={2} placeholder="Internal notes (not shown to customer)" {...register('notes')} />
        </section>

        {/*
          Sticky submit footer. On mobile it sits exactly above the bottom tab
          bar (h-16 + safe-area-inset-bottom). On desktop the tab bar is gone,
          so it pins to the very bottom.
        */}
        <div className="fixed inset-x-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur bottom-[calc(4rem+var(--sa-bottom))] lg:bottom-0 lg:left-60 lg:pl-8">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-1">
            <div className="text-xs text-muted-foreground">
              {fmtKg(totalWeight)} · <span className="font-semibold text-foreground">{fmtMoney(totalAmount)}</span>
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Create order'}
            </Button>
          </div>
        </div>
      </form>

      <CustomerFormSheet
        open={showNewCustomer}
        customer={null}
        onClose={() => setShowNewCustomer(false)}
        onCreated={(id, name) => {
          setValue('customerId', id);
          setValue('customerName', name);
          setShowNewCustomer(false);
        }}
      />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn('text-muted-foreground', strong && 'font-medium text-foreground')}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Customer combobox: search-as-you-type, popover-of-matches, keyboard navigable. */
function CustomerPicker({
  customers,
  value,
  onSelect,
}: {
  customers: { id: string; name: string; phone: string; type: string }[];
  value: string;
  onSelect: (c: { id: string; name: string; phone: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = customers.find((c) => c.id === value);
  const filtered = useMemo(() => {
    if (!search) return customers.slice(0, 20);
    const q = search.toLowerCase();
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 20);
  }, [customers, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-sm shadow-sm hover:bg-secondary/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            {selected ? (
              <span className="truncate"><span className="font-medium">{selected.name}</span> <span className="text-muted-foreground">· {selected.phone}</span></span>
            ) : (
              <span className="text-muted-foreground">Choose customer…</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches.</p>
          ) : (
            filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                  c.id === value && 'bg-accent text-accent-foreground',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.phone}</div>
                </div>
                {c.id === value && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
