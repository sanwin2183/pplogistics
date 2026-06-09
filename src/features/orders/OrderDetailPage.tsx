import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Phone,
  Plane,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { Label } from '../../components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { FullPageSpinner } from '../../components/Spinner';
import { OrderStatusBadge } from '../../components/StatusBadge';
import { MoneyDisplay } from '../../components/MoneyDisplay';
import { fmtDate, fmtDateTime, fmtKg, fmtMoney } from '../../lib/formatters';
import { trackingUrl } from '../../lib/tracking';
import { storage } from '../../lib/firebase';
import { nextOrderActionLabel, nextOrderStatus, ORDER_STATUS_LABELS, publicTimelineOverrides } from '../../lib/status';
import { useOrder, useUpdateOrderStatus, useAddOrderPhoto, useDeleteOrder, useRejectPaymentProof } from './useOrders';
import { useFlyer } from '../flyers/useFlyers';
import { useSettings } from '../settings/useSettings';
import { OrderStatusTimeline } from './OrderStatusTimeline';
import { getFlyerPieceCount, getFlyerWeightKg } from './orderHelpers';
import type { Order, OrderItem, FlyerAssignment, PaymentProof } from '../../types';

/**
 * Resolve a stored PaymentProof to a renderable image URL.
 *
 * New proofs (post May 29 2026) carry `imagePath` — a storage path WITHIN
 * the bucket. The admin client calls getDownloadURL on it (admin has read
 * access on payment-proofs per §11) and renders the resulting URL.
 *
 * Legacy proofs carry `imageUrl` directly — submitted before the
 * customer-side getDownloadURL call was removed. We return it as-is.
 *
 * The query key includes both fields so a doc swapping from one to the
 * other (e.g. re-submission) refetches.
 *
 * Returns all three states (loading / error / ready) explicitly so the
 * caller can render an error fallback — the previous version collapsed
 * `error` and `loading` into the same "Loading proof…" branch, which left
 * a getDownloadURL failure looking like a permanent loading state. Errors
 * also log to console.warn with the path so a future failure tells you
 * which file broke.
 */
function useProofImageUrl(proof: PaymentProof | undefined): {
  url: string | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const path = proof?.imagePath;
  const legacy = proof?.imageUrl;
  const q = useQuery({
    queryKey: ['proofUrl', path, legacy],
    queryFn: async () => {
      if (path) {
        const url = await getDownloadURL(storageRef(storage, path));
        // eslint-disable-next-line no-console
        console.log('[proofUrl] resolved', path, '→', url.slice(0, 80) + '…');
        return url;
      }
      return legacy ?? null;
    },
    enabled: !!(path || legacy),
    staleTime: 60_000, // download URLs are stable; don't refetch on every render
    retry: 1,
  });
  if (q.error) {
    // eslint-disable-next-line no-console
    console.warn('[proofUrl] failed for path/legacy', path, legacy, q.error);
  }
  return {
    url: typeof q.data === 'string' ? q.data : undefined,
    isLoading: q.isLoading,
    error: (q.error as Error | null) ?? null,
  };
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading } = useOrder(id);
  // Look up the first-assigned flyer to derive the route — used to feed
  // publicTimelineOverrides so the admin timeline shows the same "Arrived
  // at <City>" copy customers see. Matches the precedent in
  // getTrackingOrder which also uses assignments[0].flyerId as the
  // canonical carrier for display. enabled gating in useFlyer keeps the
  // query off until we have an id.
  const firstFlyerId = order?.flyerAssignments[0]?.flyerId;
  const { data: firstFlyer } = useFlyer(firstFlyerId);
  const { data: settings } = useSettings();
  const advance = useUpdateOrderStatus();
  const reject = useRejectPaymentProof();
  const del = useDeleteOrder();
  const addPhoto = useAddOrderPhoto();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidNote, setMarkPaidNote] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Resolve paymentProof.imagePath -> download URL on the admin side. The
  // customer never reads from Storage; only the admin (who has read
  // permission) calls getDownloadURL. See useProofImageUrl above for the
  // legacy-fallback handling.
  const {
    url: proofUrl,
    isLoading: proofUrlLoading,
    error: proofUrlError,
  } = useProofImageUrl(order?.paymentProof);
  // Tracks whether the <img>'s own load failed (URL resolved but the
  // browser couldn't fetch the bytes). Reset whenever the URL or the
  // underlying proof changes so a previous failure can't poison a fresh
  // resolution (e.g. after a re-upload).
  const [proofImgFailed, setProofImgFailed] = useState(false);
  useEffect(() => {
    setProofImgFailed(false);
  }, [proofUrl, order?.paymentProof?.imagePath, order?.paymentProof?.imageUrl]);

  if (isLoading) return <FullPageSpinner />;
  if (!order) return <p className="text-sm text-muted-foreground">Order not found.</p>;

  const next = nextOrderStatus(order.status);
  const nextLabel = nextOrderActionLabel(order.status);

  async function copyTrackingMessage(lang: 'en' | 'th' | 'my') {
    if (!order) return;
    const url = trackingUrl(order.trackingSlug);
    const tmpl = settings?.templates[lang] ?? `Track here: ${url}`;
    const text = tmpl
      .replace('{customerName}', order.customerName)
      .replace('{orderNumber}', order.orderNumber)
      .replace('{totalAmount}', fmtMoney(order.totalAmount))
      .replace('{totalWeight}', fmtKg(order.totalWeightKg))
      .replace('{trackingUrl}', url);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Tracking message copied (${lang.toUpperCase()})`);
    } catch {
      toast.error('Couldn\'t copy — long-press the URL instead');
    }
  }

  async function copyUrl() {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(trackingUrl(order.trackingSlug));
      toast.success('Tracking URL copied');
    } catch {
      toast.error('Couldn\'t copy');
    }
  }

  async function onAdvance(targetStatus = next!) {
    if (!order) return;
    try {
      await advance.mutateAsync({ order, next: targetStatus });
      toast.success(`Marked ${targetStatus.replace('_', ' ')}`);
    } catch {
      // useUpdateOrderStatus.onError already surfaced the failure as a toast.
      // The catch is here to prevent the rejected mutateAsync promise from
      // becoming an unhandled rejection, which was the original silent-failure
      // mode that hid the underlying arrayUnion(undefined) bug.
    }
  }

  async function approvePayment() {
    if (!order) return;
    try {
      await advance.mutateAsync({ order, next: 'paid', note: 'Payment approved', paidVia: 'proof' });
      toast.success('Payment approved');
    } catch {
      // mutation.onError already toasted.
    }
  }

  async function markAsPaid() {
    if (!order) return;
    try {
      const note = markPaidNote.trim();
      await advance.mutateAsync({
        order,
        next: 'paid',
        paidVia: 'external',
        note: note ? `Marked paid (external): ${note}` : 'Marked paid (external)',
      });
      setMarkPaidOpen(false);
      setMarkPaidNote('');
      toast.success('Marked as paid');
    } catch {
      // mutation.onError already toasted.
    }
  }

  async function rejectPayment() {
    if (!order || !rejectNote.trim()) return;
    try {
      await reject.mutateAsync({ order, note: rejectNote.trim() });
      setRejectOpen(false);
      setRejectNote('');
      toast.success('Payment proof rejected');
    } catch {
      // mutation.onError already toasted.
    }
  }

  // Confirmation handler for the delete-order Dialog. Mirrors the pattern
  // used by the customer-delete + reject-payment flows: mutateAsync inside
  // try/catch, dialog stays open on failure (useDeleteOrder.onError already
  // toasts), navigate away on success. Passes the whole Order doc — the
  // hook needs status / customerId / flyerAssignments / totalAmount /
  // trackingSlug to compute the rollup reversals and the storage cleanup
  // path.
  async function confirmDeleteOrder() {
    if (!order) return;
    try {
      await del.mutateAsync(order);
      setDeleteOpen(false);
      toast.success('Order deleted');
      navigate('/orders');
    } catch {
      // useDeleteOrder.onError already surfaced the error message.
    }
  }

  async function onPickPhoto(file: File) {
    if (!order) return;
    setUploading(true);
    try {
      const path = `orders/${order.id}/photos/${nanoid(8)}-${file.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      await addPhoto.mutateAsync({ orderId: order.id, url });
      toast.success('Photo added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft /> Back
      </Button>

      {/* Header card */}
      <div className="card-soft p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">#{order.orderNumber}</h1>
              <OrderStatusBadge status={order.status} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Created {fmtDateTime(order.createdAt)}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyUrl}>
              <Copy /> Link
            </Button>
            <CopyMessageDropdown onCopy={copyTrackingMessage} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete order"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="h-eyebrow">Customer</div>
            <Link to={`/customers/${order.customerId}`} className="mt-1 block font-medium hover:underline">
              {order.customerName}
            </Link>
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Phone className="h-3 w-3" />{order.customerPhone}</div>
          </div>
          <div>
            <div className="h-eyebrow">Totals</div>
            <div className="mt-1 text-base font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{fmtKg(order.totalWeightKg)}</div>
          </div>
        </div>

        {/* Status advance button */}
        {next && nextLabel && (
          <Button className="mt-5 w-full" onClick={() => onAdvance()} disabled={advance.isPending}>
            {nextLabel} <ChevronRight />
          </Button>
        )}

        {/* Mark as paid — available from ANY non-paid status as a shortcut for
            payments received outside the app (cash, external bank transfer).
            Distinct from the proof-approval flow below: it skips proof entirely
            and jumps straight to 'paid', firing the same customer-rollup
            transaction (totalSpent + outstandingBalance) via useUpdateOrderStatus. */}
        {order.status !== 'paid' && (
          <Button
            variant="outline"
            className="mt-2 w-full"
            onClick={() => setMarkPaidOpen(true)}
            disabled={advance.isPending}
          >
            Mark as paid (external)
          </Button>
        )}

        {/*
          Payment review section.

          Visible when EITHER:
            - the customer has uploaded a proof and the order isn't paid yet
              (covers the "customer paid EARLY from pending/received/etc."
              case — that proof must still surface to the admin for review
              even though status is not 'awaiting_payment'); OR
            - the order is at 'awaiting_payment' and no proof exists yet
              (so the admin sees a "still waiting" prompt and the markup
              still appears at the canonical state).

          Heading text changes per case so the admin can tell at a glance
          whether they're reviewing a normal-flow submission or an early
          payment. Approve/Reject reuse the existing money-moving
          mutations unchanged — useUpdateOrderStatus 'paid' branch is
          the canonical transaction (with the prior double-count guard).
        */}
        {((order.paymentProof && order.status !== 'paid') || order.status === 'awaiting_payment') && (
          <div className="mt-5 space-y-3 rounded-lg border border-dashed border-status-awaiting-fg/30 bg-status-awaiting/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-status-awaiting-fg">
              <AlertCircle className="h-4 w-4" />
              {order.paymentProof && order.status !== 'awaiting_payment'
                ? 'Payment proof submitted'
                : 'Awaiting payment'}
            </div>
            {order.paymentProof ? (
              <>
                {proofUrlLoading ? (
                  // Resolving the download URL via getDownloadURL — admin's
                  // first paint of the proof. Subsequent visits use the
                  // query cache (staleTime: 60s) so this only flashes once
                  // per order/session.
                  <div className="flex h-48 items-center justify-center rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground">
                    Loading proof…
                  </div>
                ) : proofUrlError ? (
                  // getDownloadURL threw — typically storage/unauthorized
                  // (rule check) or storage/object-not-found (file missing
                  // from bucket). The error is logged to console with the
                  // path so you can dig into the actual cause.
                  <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs">
                    <p className="font-medium text-destructive">Couldn't load proof image</p>
                    <p className="text-destructive/90">{proofUrlError.message}</p>
                    {order.paymentProof.imagePath && (
                      <p className="font-mono text-[10px] text-muted-foreground break-all">
                        path: {order.paymentProof.imagePath}
                      </p>
                    )}
                  </div>
                ) : !proofUrl ? (
                  // Defensive: query is settled, no error, but no URL —
                  // means the proof doc has neither imagePath nor imageUrl.
                  // Shouldn't happen for new proofs (the function validates
                  // imagePath); could happen for a corrupted legacy doc.
                  <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-xs text-muted-foreground">
                    No image attached to this proof.
                  </div>
                ) : proofImgFailed ? (
                  // <img> resolved a URL but the browser couldn't fetch it —
                  // e.g. download token mismatch, expired, or a network/CORS
                  // issue. Show a link so the admin can still open the proof
                  // in a new tab where the same URL may work or surface a
                  // clearer error.
                  <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs">
                    <p className="font-medium text-destructive">
                      Image URL returned but the browser couldn't render it
                    </p>
                    <p className="text-destructive/90">
                      Check the DevTools console / Network tab for the failed request.
                    </p>
                    <a
                      href={proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block break-all font-mono text-[10px] text-primary underline-offset-2 hover:underline"
                    >
                      Open URL in new tab →
                    </a>
                  </div>
                ) : (
                  <a
                    href={proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-border"
                  >
                    <img
                      src={proofUrl}
                      alt="Payment proof"
                      className="max-h-72 w-full object-contain bg-white"
                      onError={(e) => {
                        // eslint-disable-next-line no-console
                        console.warn('[proof img] failed to load', proofUrl, e);
                        setProofImgFailed(true);
                      }}
                    />
                  </a>
                )}
                {order.paymentProof.note && (
                  <p className="text-xs text-muted-foreground">"{order.paymentProof.note}"</p>
                )}
                <p className="text-xs text-muted-foreground">Uploaded {fmtDateTime(order.paymentProof.uploadedAt)}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={approvePayment} className="flex-1"><Check /> Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)} className="flex-1">Reject</Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Customer hasn't uploaded a payment screenshot yet. Send them the tracking link, or use "Mark as paid (external)" above for cash / external transfer.
              </p>
            )}
          </div>
        )}

        {/* Paid badge — shows how the payment was confirmed (for orders paid
            after this field was introduced; older paid orders show no badge). */}
        {order.status === 'paid' && order.paidVia && (
          <div className="mt-5 rounded-lg border border-dashed border-status-paid-fg/30 bg-status-paid/40 p-4 text-center">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-status-paid-fg">
              <Check className="h-4 w-4" />
              {order.paidVia === 'external' ? 'Paid externally' : 'Paid via proof'}
            </div>
            {order.paymentApprovedAt && (
              <p className="mt-1 text-xs text-muted-foreground">{fmtDateTime(order.paymentApprovedAt)}</p>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <section>
        <h2 className="mb-3 h-eyebrow">Timeline</h2>
        <div className="card-soft p-5">
          {/* Same route-aware "Arrived at <City>" override the customer
              tracking page uses — keeps the two views in sync. Falls back
              to the default "In Transit" copy when no flyer is assigned
              (firstFlyer undefined) or the route is unrecognised. The
              underlying schema status stays in_transit; this is
              display-only. */}
          {(() => {
            const overrides = publicTimelineOverrides(firstFlyer?.route);
            return (
              <OrderStatusTimeline
                status={order.status}
                history={order.statusHistory}
                labelOverride={overrides.labels}
                descriptionOverride={overrides.descriptions}
              />
            );
          })()}
        </div>
      </section>

      {/* Items — hybrid customer/flyer display per 2026-06-07 split.
          When an item's flyer-side qty differs from customer-side, both
          numbers render ("21kg billed (20kg flown)"); when they match
          (the common case), the row collapses to a single value so the
          UI doesn't churn for orders without overrides. */}
      <section>
        <h2 className="mb-3 h-eyebrow">Items</h2>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {order.items.map((it, i) => (
              <div key={i} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{it.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {it.pricingMode === 'per_piece' ? (
                      <>
                        {it.categoryName} · <ItemFlyerQty
                          item={it}
                          assignments={order.flyerAssignments}
                          isPiece
                        /> · {fmtMoney(it.ratePerPiece ?? 0)}/piece
                      </>
                    ) : (
                      <>
                        {it.categoryName} · <ItemFlyerQty
                          item={it}
                          assignments={order.flyerAssignments}
                          isPiece={false}
                        /> · {fmtMoney(it.ratePerKg)}/kg
                      </>
                    )}
                  </div>
                </div>
                <MoneyDisplay amount={it.subtotal} className="text-sm font-medium" />
              </div>
            ))}
            <div className="flex items-center justify-between p-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Flyer assignments */}
      <section>
        <h2 className="mb-3 h-eyebrow">Flyer assignments</h2>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {order.flyerAssignments.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No flyers assigned.</div>
            ) : (
              order.flyerAssignments.map((a, i) => {
                const isLegacy = !a.categoryRates || a.categoryRates.length === 0;
                // Per-category rows use FLYER kg post 2026-06-07 split —
                // that's the basis the flyer is paid on. row.weightKg
                // here is `Σ getFlyerWeightKg(items in category)`.
                const categoryRows = !isLegacy
                  ? a.categoryRates!.map((cr) => {
                      const kg = order.items
                        .filter((it) => it.categoryId === cr.categoryId)
                        .reduce((s, it) => s + getFlyerWeightKg(it, a.flyerId), 0);
                      const categoryName =
                        order.items.find((it) => it.categoryId === cr.categoryId)?.categoryName ?? cr.categoryId;
                      return {
                        categoryId: cr.categoryId,
                        categoryName,
                        weightKg: kg,
                        ratePerKg: cr.ratePerKg,
                        subtotal: kg * cr.ratePerKg,
                      };
                    })
                  : [];
                // Assignment header weight — FLYER kg (a.flyerWeightKg
                // ?? a.weightKg). For legacy assignments this still
                // shows a.weightKg via the fallback.
                const flyerKg = a.flyerWeightKg ?? a.weightKg;
                const customerKg = a.weightKg;
                const showSplit = !isLegacy && Math.abs(flyerKg - customerKg) > 0.005;
                return (
                  <div key={i} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/flyers/${a.flyerId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                        <Plane className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{a.flyerName}</div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {showSplit ? (
                              <span>{fmtKg(flyerKg)} flown · {fmtKg(customerKg)} billed</span>
                            ) : (
                              <span>{fmtKg(flyerKg)}</span>
                            )}
                            {isLegacy && (
                              <>
                                <span>·</span>
                                <span>{fmtMoney(a.payoutRatePerKg ?? 0)}/kg</span>
                                <span className="rounded bg-muted px-1 py-px text-[10px] uppercase tracking-wider text-muted-foreground">
                                  legacy rate
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </Link>
                      <div className="flex items-center gap-2">
                        <MoneyDisplay amount={a.payoutAmount} className="text-sm font-medium" />
                        {a.paidOutAt && (
                          <span className="status-pill bg-status-paid text-status-paid-fg">
                            <Check className="h-3 w-3" /> Paid out
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Per-category breakdown — FLYER kg × rate. This
                        is the paid-amount basis, not the billed-amount
                        basis (the billed view is in the Items section
                        above). */}
                    {!isLegacy && categoryRows.length > 0 && (
                      <div className="space-y-1 rounded-md bg-muted/30 px-3 py-2">
                        {categoryRows.map((row) => (
                          <div
                            key={row.categoryId}
                            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs"
                          >
                            <span className="truncate text-muted-foreground">{row.categoryName}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {fmtKg(row.weightKg)} · {fmtMoney(row.ratePerKg)}/kg
                            </span>
                            <span className="tabular-nums font-medium">{fmtMoney(row.subtotal)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div className="flex items-center justify-between p-4">
              <span className="text-sm text-muted-foreground">Profit</span>
              <MoneyDisplay amount={order.profit} signed className="text-lg font-semibold" />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Photos */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h-eyebrow">Photos</h2>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onPickPhoto(e.target.files[0])}
          />
          <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={uploading}>
            <ImageIcon /> {uploading ? 'Uploading…' : 'Add'}
          </Button>
        </div>
        {order.photos.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-xs text-muted-foreground">No photos yet.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {order.photos.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border border-border">
                <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </section>

      {order.notes && (
        <section>
          <h2 className="mb-3 h-eyebrow">Notes</h2>
          <Card><CardContent className="py-4"><p className="text-sm text-muted-foreground">{order.notes}</p></CardContent></Card>
        </section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Tracking slug: <code className="rounded bg-muted px-1.5 py-0.5">{order.trackingSlug}</code>
        {' '} · Created {fmtDate(order.createdAt)}
      </p>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject payment proof</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejectNote">Reason</Label>
            <Textarea
              id="rejectNote"
              autoFocus
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="e.g. Screenshot doesn't show the amount"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={rejectPayment} disabled={!rejectNote.trim()}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as paid dialog */}
      <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark order as paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this for payments received outside the app (cash, external bank transfer).
              The customer's outstanding balance will be reduced by{' '}
              <span className="font-medium tabular-nums text-foreground">{fmtMoney(order.totalAmount)}</span>.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="markPaidNote">How was it paid? (optional)</Label>
              <Textarea
                id="markPaidNote"
                rows={2}
                value={markPaidNote}
                onChange={(e) => setMarkPaidNote(e.target.value)}
                placeholder="e.g. Cash received in person, SCB bank ref 12345"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidOpen(false)}>Cancel</Button>
            <Button onClick={markAsPaid} disabled={advance.isPending}>Mark as paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Delete-order confirmation.

        Policy (A): allow deleting any order, including paid ones. The
        underlying useDeleteOrder transaction reverses rollups in a
        status-aware way (totalSpent for paid, outstandingBalance
        otherwise; totalOrders and flyer.kgUsed always reverse).

        Dialog copy shows the customer, total, weight, status, and flyer
        assignments so the owner can sanity-check what they're about to
        roll back. For paid orders specifically the body adds a
        destructive-tinted warning naming the totalSpent reduction —
        friction without prohibition, since deletes of paid orders are
        legitimate use cases (duplicate, mis-marked, etc.).
      */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete order #{order.orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This cannot be undone. The order will be removed and these rollups will be reversed:
            </p>

            {/*
              "Weight" line stays CUSTOMER (the order's billed mass —
              what the customer paid for). The "Flyer" line + the
              "capacity returned" sentence below switch to FLYER kg
              (a.flyerWeightKg ?? a.weightKg) since that's what actually
              gets subtracted from flyer.kgUsed by the delete transaction.
            */}
            <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
              <DeleteRow label="Customer" value={order.customerName} />
              <DeleteRow label="Total" value={fmtMoney(order.totalAmount)} />
              <DeleteRow label="Weight" value={fmtKg(order.totalWeightKg)} />
              <DeleteRow label="Status" value={ORDER_STATUS_LABELS[order.status]} />
              {order.flyerAssignments.length > 0 && (
                <DeleteRow
                  label={order.flyerAssignments.length === 1 ? 'Flyer' : 'Flyers'}
                  value={order.flyerAssignments
                    .map((a) => `${a.flyerName} (${fmtKg(a.flyerWeightKg ?? a.weightKg)})`)
                    .join(', ')}
                />
              )}
            </dl>

            {/* "Capacity returned" message uses the SAME source as
                useDeleteOrder's kgUsed delta — flyerWeightKg ?? weightKg
                summed across assignments — so the message matches what
                actually happens to the rollup. */}
            {(() => {
              const flyerCapReturned = order.flyerAssignments.reduce(
                (s, a) => s + (a.flyerWeightKg ?? a.weightKg),
                0,
              );
              if (order.status === 'paid') {
                return (
                  <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                    <p className="font-medium text-destructive">This order is PAID.</p>
                    <p className="text-xs text-destructive/90">
                      Deleting it will reduce <span className="font-medium">{order.customerName}</span>
                      &apos;s total spent by{' '}
                      <span className="font-medium tabular-nums">{fmtMoney(order.totalAmount)}</span>
                      {order.flyerAssignments.length > 0 && (
                        <> and return {fmtKg(flyerCapReturned)} of flyer capacity</>
                      )}
                      . Confirm only if this was recorded in error.
                    </p>
                  </div>
                );
              }
              return (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{order.customerName}</span>&apos;s
                  outstanding balance will decrease by{' '}
                  <span className="font-medium tabular-nums text-foreground">{fmtMoney(order.totalAmount)}</span>
                  {order.flyerAssignments.length > 0 && (
                    <>, and {fmtKg(flyerCapReturned)} of flyer capacity will be returned</>
                  )}
                  .
                </p>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteOrder} disabled={del.isPending}>
              {del.isPending ? 'Deleting…' : 'Delete order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Customer-vs-flyer qty renderer for the Items section. Handles the full
 * per-item per-flyer split:
 *   - 0 flyers          → just the customer qty.
 *   - 1 flyer, equal    → single value (the common case, no override).
 *   - 1 flyer, differ   → "21 kg billed (20 kg flown)".
 *   - 2+ flyers         → "35 kg billed · flown: A 20 kg, B 15 kg".
 *
 * Reads each flyer's portion through getFlyerWeightKg / getFlyerPieceCount
 * (flyerId-scoped), so legacy orders (no flyerSplits) collapse to the
 * single-flyer billed/flown pattern automatically.
 *
 * Used only on the admin order detail page; customer-facing surfaces
 * (Invoice/Receipt) never show flyer-side data per §11.
 */
function ItemFlyerQty({
  item,
  assignments,
  isPiece,
}: {
  item: OrderItem;
  assignments: FlyerAssignment[];
  isPiece: boolean;
}) {
  const fmt = isPiece ? (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}` : fmtKg;
  const epsilon = isPiece ? 0.5 : 0.005;
  const customer = isPiece ? item.pieceCount ?? 0 : item.weightKg;
  const qtyFor = (flyerId: string) =>
    isPiece ? getFlyerPieceCount(item, flyerId) : getFlyerWeightKg(item, flyerId);

  // Distinct flyers on the order (a flyer can appear twice on legacy
  // per-category-rate orders; collapse to one column each).
  const flyers: FlyerAssignment[] = [];
  const seen = new Set<string>();
  for (const a of assignments) {
    if (a.flyerId && !seen.has(a.flyerId)) {
      seen.add(a.flyerId);
      flyers.push(a);
    }
  }

  if (flyers.length <= 1) {
    if (flyers.length === 0) return <>{fmt(customer)}</>;
    const flown = qtyFor(flyers[0].flyerId);
    if (Math.abs(customer - flown) < epsilon) return <>{fmt(customer)}</>;
    return (
      <>
        {fmt(customer)} billed <span className="text-muted-foreground">({fmt(flown)} flown)</span>
      </>
    );
  }

  return (
    <>
      {fmt(customer)} billed{' '}
      <span className="text-muted-foreground">
        · flown:{' '}
        {flyers
          .map((a) => `${a.flyerName.split(' ')[0]} ${fmt(qtyFor(a.flyerId))}`)
          .join(', ')}
      </span>
    </>
  );
}

/** Stacked label / value row for the delete-order Dialog's rollup summary. */
function DeleteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function CopyMessageDropdown({ onCopy }: { onCopy: (lang: 'en' | 'th' | 'my') => void }) {
  // Lightweight inline tab-style picker; clicking copies for that language.
  return (
    <Tabs defaultValue="en" onValueChange={(v) => onCopy(v as 'en' | 'th' | 'my')}>
      <TabsList className="h-10">
        <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
        <TabsTrigger value="th">🇹🇭 TH</TabsTrigger>
        <TabsTrigger value="my">🇲🇲 MY</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// Export the Order type re-export so the file's relative imports stay tidy.
export type { Order };
