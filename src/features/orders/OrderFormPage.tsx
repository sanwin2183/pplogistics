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
import {
  calcTotalFlyerWeight,
  getFlyerPieceCount,
  groupItemsByCategory,
  groupItemsByCategoryFlyerKg,
} from './orderHelpers';
import { CustomerFormSheet } from '../customers/CustomerFormSheet';
import { firstFieldError, type FieldErrorHit } from '../../lib/forms';
import type { OrderItem } from '../../types';
import dayjs from 'dayjs';

/** Drop keys whose value is `undefined`. Firebase SDK v11 rejects
 *  writes that contain literal `undefined` field values (CLAUDE.md
 *  §10), and optional schema fields (pieceCount, ratePerPiece,
 *  flyerWeightKg, flyerPieceCount, flyerRatePerPiece) all land as
 *  undefined when not applicable to the current item. */
function omitUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// Field-named validation messages.
//
// Before: bare 'Required' strings produced a toast that said only "Required"
// with no field name, and per-row inline errors joined to "Required · ..."
// equally anonymous. The schema is now the single source of truth for what
// the failing field is called, so both the toast and the inline error stay
// in sync — and any walker (see firstFieldError in lib/forms) can surface
// them verbatim.
// Items have two pricing modes. Per-kg requires weight ≥ 0.01 + rate ≥ 0.
// Per-piece requires pieceCount ≥ 1 + ratePerPiece ≥ 0 + flyerRatePerPiece
// ≥ 0 (the flyer rate is typed by the owner — no prefill from flyer.
// ratePerKg, since there's no per-piece equivalent on the flyer doc).
// Validation is mode-aware via superRefine so an item only has to satisfy
// the constraints of its current mode.
// Optional flyer-qty preprocessor: empty string / null / undefined →
// undefined (so the schema's .optional() accepts it cleanly and the
// field is OMITTED on save). Any numeric input is coerced to a number.
// Blank means "same as customer qty" — see getFlyerWeightKg /
// getFlyerPieceCount in orderHelpers.ts.
const optionalNonNegNumber = z.preprocess(
  (v) => (v === '' || v == null ? undefined : Number(v)),
  z.number().min(0).optional(),
);

const itemSchema = z
  .object({
    description: z.string().min(1, 'Description is required'),
    categoryId: z.string().min(1, 'Category is required'),
    categoryName: z.string(),
    pricingMode: z.enum(['per_kg', 'per_piece']).default('per_kg'),
    weightKg: z.coerce.number().min(0, 'Weight must be at least 0'),
    ratePerKg: z.coerce.number().min(0, 'Rate must be at least 0'),
    pieceCount: z.coerce.number().min(0, 'Pieces must be at least 0').optional(),
    ratePerPiece: z.coerce.number().min(0, 'Rate must be at least 0').optional(),
    flyerRatePerPiece: z.coerce.number().min(0, 'Flyer rate must be at least 0').optional(),
    // 2026-06-07 flyer-qty split. Optional with blank=undefined (=
    // "same as customer qty"). Per-piece items ignore flyerWeightKg
    // and per-kg items ignore flyerPieceCount at READ time (see
    // getFlyerWeightKg / getFlyerPieceCount), but we still let the
    // form persist whichever the user typed so flipping mode doesn't
    // lose the input.
    flyerWeightKg: optionalNonNegNumber,
    flyerPieceCount: optionalNonNegNumber,
    subtotal: z.coerce.number(),
  })
  .superRefine((it, ctx) => {
    if (it.pricingMode === 'per_piece') {
      if ((it.pieceCount ?? 0) < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pieceCount'], message: 'Pieces must be at least 1' });
      }
    } else {
      if ((it.weightKg ?? 0) < 0.01) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weightKg'], message: 'Weight must be at least 0.01 kg' });
      }
    }
  });

// Per-category flyer rate row. categoryId references one of the order's
// items' categories. ratePerKg is editable per row.
const categoryRateSchema = z.object({
  categoryId: z.string().min(1, 'Category is required'),
  ratePerKg: z.coerce.number().min(0, 'Rate must be at least 0'),
});

// New assignment shape — single weight (auto-derived from order total)
// + array of per-category rates. The single payoutRatePerKg input is GONE,
// replaced by the per-category rate rows.
//
// `weightKg` minimum is 0 (NOT 0.01) — a per-piece-only order has
// totalWeight = 0 and so assignment.weightKg = 0; rejecting that would
// block flyer assignment on any piece-only order. The form computes
// per-piece payout from item.flyerRatePerPiece (Option A), so an
// assignment with weightKg=0 + a non-zero piece-side payoutAmount is
// legitimate, not a malformed row.
const assignmentSchema = z.object({
  flyerId: z.string().min(1, 'Flyer is required'),
  flyerName: z.string(),
  /** Customer-side denormalised total — stays unchanged at the split. */
  weightKg: z.coerce.number().min(0, 'Weight must be at least 0'),
  /** Flyer-side denormalised total, set at submit by the form. Drives
   *  flyer.kgUsed deltas in the create/delete transactions. Optional
   *  so legacy assignment rows (no flyer-side data) read cleanly. */
  flyerWeightKg: optionalNonNegNumber,
  categoryRates: z.array(categoryRateSchema),
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
  // FLYER-side total kg. Drives capacity checks + assignment.flyerWeightKg
  // denorm at submit. For an order with no flyer overrides this equals
  // totalWeight (via the fallback in getFlyerWeightKg); for an order with
  // any flyer override this can differ.
  const totalFlyerWeight = calcTotalFlyerWeight(watchedItems as OrderItem[]);
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
        // Recompute each assignment's payoutAmount + weightKg + flyerWeightKg
        // from the final item set at submit time. Live state could be stale
        // if the user edited items AFTER setting rates.
        //
        // Two parallel groupings on submit:
        //   finalGroups        — CUSTOMER kg per category. Used for the
        //                        validCategoryIds set (pruning rates with
        //                        no matching item category). Also still
        //                        the canonical customer-side group source.
        //   finalFlyerGroups   — FLYER kg per category. Drives the per-kg
        //                        payout calculation post-2026-06-07 split.
        // The kgByCategoryId Map below uses FLYER kg → category rate × this
        // is what the flyer is paid on.
        const finalGroups = groupItemsByCategory(data.items as OrderItem[]);
        const validCategoryIds = new Set(finalGroups.map((g) => g.categoryId));
        const finalFlyerGroups = groupItemsByCategoryFlyerKg(data.items as OrderItem[]);
        const flyerKgByCategoryId = new Map(
          finalFlyerGroups.map((g) => [g.categoryId, g.weightKg]),
        );
        // Per-piece flyer payout uses FLYER pieces (getFlyerPieceCount,
        // falls back to pieceCount when no override). Each assignment
        // counts the full per-piece payout — single-flyer-optimised,
        // same trade-off as the per-kg side.
        const finalPiecePayout = (data.items as OrderItem[]).reduce((s, it) => {
          if (it.pricingMode !== 'per_piece') return s;
          return s + getFlyerPieceCount(it) * (Number(it.flyerRatePerPiece) || 0);
        }, 0);
        // Per-assignment flyer-side total = Σ flyer kg across per-kg
        // items. Per-piece items contribute 0 (getFlyerWeightKg guards
        // mode). Stored so the create/delete transactions can update
        // flyer.kgUsed without walking items[].
        const finalFlyerWeight = calcTotalFlyerWeight(data.items as OrderItem[]);
        const finalAssignments = data.flyerAssignments.map((a) => {
          const pruned = (a.categoryRates ?? []).filter((cr) => validCategoryIds.has(cr.categoryId));
          const kgPayout = pruned.reduce(
            (s, cr) => s + (flyerKgByCategoryId.get(cr.categoryId) ?? 0) * (cr.ratePerKg || 0),
            0,
          );
          return {
            ...a,
            categoryRates: pruned,
            // weightKg stays the CUSTOMER total (denormalized, what was
            // billed). flyerWeightKg is the FLYER total — feeds kgUsed.
            // Both written at submit; the two values are equal when no
            // overrides exist on any item.
            weightKg: totalWeight,
            flyerWeightKg: finalFlyerWeight,
            payoutAmount: +(kgPayout + finalPiecePayout).toFixed(2),
          };
        });
        const recomputedTotalPayout = finalAssignments.reduce((s, a) => s + a.payoutAmount, 0);
        const recomputedProfit = totalAmount - recomputedTotalPayout;

        // Strip undefined optional fields per item/assignment before
        // write — Firebase SDK v11 rejects literal undefined values
        // (CLAUDE.md §10). Per-kg items legitimately have no
        // pieceCount/ratePerPiece/flyerPieceCount; per-piece items
        // have no flyerWeightKg; orders without overrides have neither
        // flyer override. omitUndefined preserves the "absent ⇒
        // fallback" semantics getFlyerWeightKg / getFlyerPieceCount
        // depend on.
        const cleanedItems = (data.items as OrderItem[]).map((it) => omitUndefined(it));
        const cleanedAssignments = finalAssignments.map((a) => omitUndefined(a));

        const payload = {
          customerId: data.customerId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          items: cleanedItems,
          totalWeightKg: totalWeight,
          totalAmount,
          flyerAssignments: cleanedAssignments,
          totalPayout: recomputedTotalPayout,
          profit: recomputedProfit,
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
    // New items default to per-kg mode (the original model). Owner can
    // flip to per-piece via the row toggle.
    items.append({
      description: '',
      categoryId: defaultCategory?.id ?? '',
      categoryName: defaultCategory?.name ?? '',
      pricingMode: 'per_kg',
      weightKg: 0,
      ratePerKg: defaultCategory?.defaultRatePerKg ?? 0,
      subtotal: 0,
    });
  }

  function addAssignment() {
    // weightKg = customer total (denorm, unchanged). flyerWeightKg =
    // FLYER total (drives capacity). categoryRates seeded one zero-rate
    // row per distinct category currently in the order; the user picks
    // a flyer (prefills to flat ratePerKg) or types rates per row.
    // payoutAmount is 0 until rates are filled in.
    const groups = groupItemsByCategory(watchedItems as OrderItem[]);
    assignments.append({
      flyerId: '',
      flyerName: '',
      weightKg: totalWeight,
      flyerWeightKg: totalFlyerWeight,
      categoryRates: groups.map((g) => ({ categoryId: g.categoryId, ratePerKg: 0 })),
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
                  {/*
                    Mode toggle + the mode-specific input pair. Per-kg mode
                    keeps the original weight + rate layout. Per-piece mode
                    swaps to a piece count + rate-per-piece layout. The
                    subtotal recomputes off whichever mode is active.

                    Toggling mode RESETS the inactive-mode fields to 0 so
                    they don't carry stale data into storage. The flyer-side
                    per-piece rate (`flyerRatePerPiece`) is typed in the
                    flyer assignment section, not here — same place all
                    other flyer rates live.
                  */}
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
                                f.onChange(cat.id);
                                setValue(`items.${i}.categoryId`, cat.id);
                                setValue(`items.${i}.categoryName`, cat.name);
                                // Only prefill the per-kg rate; per-piece
                                // categories don't have a default piece rate
                                // (we don't model that).
                                if (item?.pricingMode !== 'per_piece') {
                                  setValue(`items.${i}.ratePerKg`, cat.defaultRatePerKg);
                                  const w = Number(watch(`items.${i}.weightKg`)) || 0;
                                  setValue(`items.${i}.subtotal`, +(cat.defaultRatePerKg * w).toFixed(2));
                                }
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
                    {/* Mode toggle — kg / pieces. Spans both unit columns on
                        the 4-col grid by stacking above the mode-specific
                        inputs below. */}
                    <div className="col-span-2 sm:col-span-2 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Charge</span>
                      <Controller
                        control={control}
                        name={`items.${i}.pricingMode`}
                        render={({ field: f }) => (
                          <Select
                            value={f.value ?? 'per_kg'}
                            onValueChange={(v) => {
                              const next = v as 'per_kg' | 'per_piece';
                              f.onChange(next);
                              if (next === 'per_piece') {
                                // Switching INTO per_piece: zero out kg-side
                                // fields so kgUsed rollups & summing readers
                                // exclude this item. Also clear the
                                // flyerWeightKg override (stale data from
                                // the previous mode).
                                setValue(`items.${i}.weightKg`, 0);
                                setValue(`items.${i}.ratePerKg`, 0);
                                setValue(`items.${i}.flyerWeightKg`, undefined);
                                setValue(`items.${i}.pieceCount`, 1);
                                setValue(`items.${i}.ratePerPiece`, 0);
                                setValue(`items.${i}.flyerRatePerPiece`, 0);
                                setValue(`items.${i}.flyerPieceCount`, undefined);
                                setValue(`items.${i}.subtotal`, 0);
                              } else {
                                // Switching INTO per_kg: clear per-piece-
                                // only fields (including flyerPieceCount)
                                // and restore the category's default rate
                                // so the row passes validation.
                                const cat = categories.find((c) => c.id === item?.categoryId);
                                setValue(`items.${i}.pieceCount`, 0);
                                setValue(`items.${i}.ratePerPiece`, 0);
                                setValue(`items.${i}.flyerRatePerPiece`, 0);
                                setValue(`items.${i}.flyerPieceCount`, undefined);
                                setValue(`items.${i}.weightKg`, 0);
                                setValue(`items.${i}.ratePerKg`, cat?.defaultRatePerKg ?? 0);
                                setValue(`items.${i}.flyerWeightKg`, undefined);
                                setValue(`items.${i}.subtotal`, 0);
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 w-[8.5rem] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="per_kg">per kg</SelectItem>
                              <SelectItem value="per_piece">per piece</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    {item?.pricingMode === 'per_piece' ? (
                      <>
                        <Input
                          type="number"
                          step="1"
                          min={1}
                          inputMode="numeric"
                          placeholder="pieces"
                          aria-invalid={!!itemError?.pieceCount || undefined}
                          className={cn(
                            itemError?.pieceCount && 'border-destructive focus:border-destructive',
                          )}
                          {...register(`items.${i}.pieceCount`, {
                            onChange: (e) => {
                              const p = Number(e.target.value) || 0;
                              const r = Number(watch(`items.${i}.ratePerPiece`)) || 0;
                              setValue(`items.${i}.subtotal`, +(p * r).toFixed(2));
                            },
                          })}
                        />
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          inputMode="decimal"
                          placeholder="THB/piece"
                          aria-invalid={!!itemError?.ratePerPiece || undefined}
                          className={cn(
                            itemError?.ratePerPiece && 'border-destructive focus:border-destructive',
                          )}
                          {...register(`items.${i}.ratePerPiece`, {
                            onChange: (e) => {
                              const r = Number(e.target.value) || 0;
                              const p = Number(watch(`items.${i}.pieceCount`)) || 0;
                              setValue(`items.${i}.subtotal`, +(p * r).toFixed(2));
                            },
                          })}
                        />
                        {/* Flyer-pieces override (2026-06-07 split).
                            Blank = same as customer pieces (placeholder
                            shows the fallback value). Doesn't affect
                            customer subtotal — only flyer payout math. */}
                        <div className="col-span-2 sm:col-span-2 space-y-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Flyer pcs (optional)
                          </span>
                          <Input
                            type="number"
                            step="1"
                            min={0}
                            inputMode="numeric"
                            placeholder={`Same as customer (${Number(item?.pieceCount) || 0})`}
                            {...register(`items.${i}.flyerPieceCount`, {
                              // Blank → undefined so getFlyerPieceCount
                              // falls back to customer pieceCount. Any
                              // typed digit becomes a Number.
                              setValueAs: (v) =>
                                v === '' || v == null ? undefined : Number(v),
                            })}
                          />
                        </div>
                      </>
                    ) : (
                      <>
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
                        {/* Flyer-kg override (2026-06-07 split). Blank =
                            same as customer kg (placeholder shows the
                            fallback). Doesn't affect customer subtotal —
                            only flyer payout math + capacity (kgUsed). */}
                        <div className="col-span-2 sm:col-span-2 space-y-0.5">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Flyer kg (optional)
                          </span>
                          <Input
                            type="number"
                            step="any"
                            min={0}
                            inputMode="decimal"
                            placeholder={`Same as customer (${Number(item?.weightKg) || 0})`}
                            {...register(`items.${i}.flyerWeightKg`, {
                              // Blank → undefined so getFlyerWeightKg
                              // falls back to customer weightKg.
                              setValueAs: (v) =>
                                v === '' || v == null ? undefined : Number(v),
                            })}
                          />
                        </div>
                      </>
                    )}
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
                      itemError.pieceCount?.message,
                      itemError.ratePerPiece?.message,
                      itemError.flyerRatePerPiece?.message,
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
              // Gate on item PRESENCE, not on order weight. A per-piece-
              // only order has totalWeight === 0 by design (per-piece
              // items carry no kg) but is still validly assignable —
              // we just pay per piece instead of per kg. The button stays
              // disabled when there are no flyers AT ALL or no items yet
              // to assign; otherwise it's enabled regardless of unit mix.
              disabled={!flyers.length || items.fields.length === 0}
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
              const flyerInvalid =
                !!assignmentError && !Array.isArray(assignmentError) && !!assignmentError.flyerId;

              // Per-kg category rows — drives the flyer payout breakdown
              // displayed in this block AND the live payout calc. Uses
              // groupItemsByCategoryFlyerKg (FLYER kg, post 2026-06-07
              // split). The customer-kg view of categories is irrelevant
              // here — this section is the flyer's payment math.
              const rows = groupItemsByCategoryFlyerKg(watchedItems as OrderItem[]);
              const rates = a?.categoryRates ?? [];
              const rateByCategoryId = new Map(rates.map((cr) => [cr.categoryId, cr.ratePerKg]));

              // Per-piece item rows. One row per per-piece item in the
              // order, regardless of category. Indexed by item position
              // so setValue can write back to items[idx].flyerRatePerPiece.
              const perPieceRows = watchedItems
                .map((it, idx) => ({ it, idx }))
                .filter(({ it }) => it.pricingMode === 'per_piece');

              // Helper — sum every per-piece item's flyer payout for the
              // current items[] state, using FLYER piece counts via
              // getFlyerPieceCount (falls back to pieceCount when no
              // override). Shared between livePayout, setRowRate, and
              // setPieceRate so the formula lives in one place.
              const piecePayout = () =>
                (watchedItems as OrderItem[]).reduce((s, it) => {
                  if (it.pricingMode !== 'per_piece') return s;
                  return s + getFlyerPieceCount(it) * (Number(it.flyerRatePerPiece) || 0);
                }, 0);

              // Live payout = Σ (flyer kg per category × rate) + Σ
              // (flyer pieces × flyer rate). Same formula as the
              // submit-time calc; row.weightKg here is FLYER kg.
              const livePayout =
                rows.reduce(
                  (s, row) => s + (row.weightKg || 0) * (rateByCategoryId.get(row.categoryId) || 0),
                  0,
                ) + piecePayout();

              /** Upsert one category's rate into the assignment's
                  categoryRates array, then recompute payoutAmount +
                  flyerWeightKg via setValue. payoutAmount includes the
                  per-piece contribution. */
              const setRowRate = (categoryId: string, ratePerKg: number) => {
                const next = [...(a?.categoryRates ?? [])];
                const idx = next.findIndex((cr) => cr.categoryId === categoryId);
                if (idx >= 0) next[idx] = { categoryId, ratePerKg };
                else next.push({ categoryId, ratePerKg });
                setValue(`flyerAssignments.${i}.categoryRates`, next, { shouldDirty: true });
                const lookup = new Map(next.map((cr) => [cr.categoryId, cr.ratePerKg]));
                const kgPayout = rows.reduce(
                  (s, row) => s + (row.weightKg || 0) * (lookup.get(row.categoryId) || 0),
                  0,
                );
                setValue(`flyerAssignments.${i}.payoutAmount`, +(kgPayout + piecePayout()).toFixed(2));
                // Both denormalised totals — customer (unchanged) and
                // flyer (new) — refreshed on every rate edit.
                setValue(`flyerAssignments.${i}.weightKg`, totalWeight);
                setValue(`flyerAssignments.${i}.flyerWeightKg`, totalFlyerWeight);
              };

              /** Write a per-piece flyer rate to the corresponding item
                  AND refresh this assignment's payoutAmount. Per-piece
                  flyer rates live on the item (Option A) — write goes
                  to items[itemIdx].flyerRatePerPiece. */
              const setPieceRate = (itemIdx: number, ratePerPiece: number) => {
                setValue(`items.${itemIdx}.flyerRatePerPiece`, ratePerPiece, { shouldDirty: true });
                // Manually recompute piecePayout using the new rate —
                // the closure captured `watchedItems` at render time so
                // the helper can't see the just-set value yet. Uses
                // FLYER piece counts via getFlyerPieceCount.
                const newPiecePayout = (watchedItems as OrderItem[]).reduce((s, it, idx) => {
                  if (it.pricingMode !== 'per_piece') return s;
                  const r = idx === itemIdx ? ratePerPiece : (Number(it.flyerRatePerPiece) || 0);
                  return s + getFlyerPieceCount(it) * r;
                }, 0);
                const lookup = new Map(rates.map((cr) => [cr.categoryId, cr.ratePerKg]));
                const kgPayout = rows.reduce(
                  (s, row) => s + (row.weightKg || 0) * (lookup.get(row.categoryId) || 0),
                  0,
                );
                setValue(`flyerAssignments.${i}.payoutAmount`, +(kgPayout + newPiecePayout).toFixed(2));
                setValue(`flyerAssignments.${i}.weightKg`, totalWeight);
                setValue(`flyerAssignments.${i}.flyerWeightKg`, totalFlyerWeight);
              };

              return (
                <div
                  key={field.id}
                  ref={(el) => {
                    flyerRowRefs.current[i] = el;
                  }}
                  className="space-y-3 rounded-lg border border-border p-3"
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
                              if (!fl) return;
                              f.onChange(fl.id);
                              setValue(`flyerAssignments.${i}.flyerId`, fl.id);
                              setValue(`flyerAssignments.${i}.flyerName`, fl.name);
                              setValue(`flyerAssignments.${i}.weightKg`, totalWeight);
                              setValue(`flyerAssignments.${i}.flyerWeightKg`, totalFlyerWeight);
                              // Prefill every PER-KG category row with the
                              // flyer's flat ratePerKg as a starting point.
                              // Per-piece items get no prefill — owner
                              // types the flyer-piece rate fresh.
                              const seeded = rows.map((row) => ({
                                categoryId: row.categoryId,
                                ratePerKg: fl.ratePerKg,
                              }));
                              setValue(`flyerAssignments.${i}.categoryRates`, seeded);
                              // kgPayout uses FLYER kg (row.weightKg here
                              // is groupItemsByCategoryFlyerKg output).
                              const kgPayout = rows.reduce(
                                (s, row) => s + (row.weightKg || 0) * fl.ratePerKg,
                                0,
                              );
                              setValue(
                                `flyerAssignments.${i}.payoutAmount`,
                                +(kgPayout + piecePayout()).toFixed(2),
                              );
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

                  {/* Capacity-left hint. Compares FLYER total weight
                      (post 2026-06-07 split — what's about to feed
                      kgUsed) against flyer.kgAvailable - kgUsed. Single-
                      flyer-optimised; splits see the trade-off note on
                      FlyerAssignment.weightKg / flyerWeightKg. When the
                      flyer total differs from customer total (i.e. any
                      item has a flyerWeightKg override), the parenthetic
                      reminds the owner the check is on the FLOWN kg. */}
                  {flyer && (
                    <p
                      className={cn(
                        'text-xs',
                        totalFlyerWeight > flyerRemaining ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      Capacity left: {flyerRemaining.toFixed(1)} kg
                      {Math.abs(totalFlyerWeight - totalWeight) > 0.005 && (
                        <span className="text-muted-foreground">
                          {' '}· flyer {totalFlyerWeight.toFixed(1)} kg
                        </span>
                      )}
                    </p>
                  )}

                  {/* Per-category rate rows. One row per unique category
                      in the order's PER-KG items (per-piece items are
                      excluded — they get their own block below). Rate
                      input is editable; kg is the category's total in the
                      order (read-only); subtotal = kg × rate. */}
                  {rows.length === 0 && perPieceRows.length === 0 ? (
                    <p className="rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
                      Add items above to set rates for this flyer.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {rows.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-1 text-xs text-muted-foreground">
                            <span>Category</span>
                            <span className="text-right">฿/kg</span>
                            <span className="text-right">Subtotal</span>
                          </div>
                          {rows.map((row) => {
                            const rate = rateByCategoryId.get(row.categoryId) ?? 0;
                            const subtotal = row.weightKg * rate;
                            return (
                              <div
                                key={row.categoryId}
                                className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{row.categoryName}</div>
                                  <div className="text-xs text-muted-foreground">{fmtKg(row.weightKg)}</div>
                                </div>
                                <Input
                                  type="number"
                                  step="any"
                                  min={0}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="h-9 text-right tabular-nums"
                                  value={rate || ''}
                                  onChange={(e) => setRowRate(row.categoryId, Number(e.target.value) || 0)}
                                />
                                <span className="text-right text-sm tabular-nums">{fmtMoney(subtotal)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Per-piece item rows. One row per per-piece item
                          in the order — flyer rate is typed FRESH (no
                          prefill). Input writes to items[idx].
                          flyerRatePerPiece. The displayed count is the
                          FLYER piece count via getFlyerPieceCount
                          (fallback to customer pieceCount). Subtotal =
                          flyer pieces × flyer rate. */}
                      {perPieceRows.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-1 text-xs text-muted-foreground">
                            <span>Per-piece item</span>
                            <span className="text-right">฿/piece</span>
                            <span className="text-right">Subtotal</span>
                          </div>
                          {perPieceRows.map(({ it, idx }) => {
                            const rate = Number(it.flyerRatePerPiece) || 0;
                            const flyerCount = getFlyerPieceCount(it as OrderItem);
                            const subtotal = flyerCount * rate;
                            return (
                              <div
                                key={`piece-${idx}`}
                                className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">
                                    {it.description || '(unnamed)'}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {flyerCount} {flyerCount === 1 ? 'piece' : 'pieces'} flown
                                  </div>
                                </div>
                                <Input
                                  type="number"
                                  step="any"
                                  min={0}
                                  inputMode="decimal"
                                  placeholder="0"
                                  className="h-9 text-right tabular-nums"
                                  value={rate || ''}
                                  onChange={(e) => setPieceRate(idx, Number(e.target.value) || 0)}
                                />
                                <span className="text-right text-sm tabular-nums">{fmtMoney(subtotal)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <Separator />
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Payout</span>
                    <span className="font-medium tabular-nums">{fmtMoney(livePayout)}</span>
                  </div>

                  {/* Validation errors — only flyerId stays as a top-level
                      assignment field (weight + rates are derived, not
                      user-typed at the assignment level). */}
                  {assignmentError && !Array.isArray(assignmentError) && assignmentError.flyerId?.message && (
                    <p className="text-xs text-destructive">{assignmentError.flyerId.message}</p>
                  )}
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
