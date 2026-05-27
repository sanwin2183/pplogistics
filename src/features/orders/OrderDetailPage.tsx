import { useRef, useState } from 'react';
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
import { nextOrderActionLabel, nextOrderStatus } from '../../lib/status';
import { useOrder, useUpdateOrderStatus, useAddOrderPhoto, useDeleteOrder, useRejectPaymentProof } from './useOrders';
import { useSettings } from '../settings/useSettings';
import { OrderStatusTimeline } from './OrderStatusTimeline';
import type { Order } from '../../types';

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: order, isLoading } = useOrder(id);
  const { data: settings } = useSettings();
  const advance = useUpdateOrderStatus();
  const reject = useRejectPaymentProof();
  const del = useDeleteOrder();
  const addPhoto = useAddOrderPhoto();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
    await advance.mutateAsync({ order, next: targetStatus });
    toast.success(`Marked ${targetStatus.replace('_', ' ')}`);
  }

  async function approvePayment() {
    if (!order) return;
    await advance.mutateAsync({ order, next: 'paid', note: 'Payment approved' });
    toast.success('Payment approved');
  }

  async function rejectPayment() {
    if (!order || !rejectNote.trim()) return;
    await reject.mutateAsync({ order, note: rejectNote.trim() });
    setRejectOpen(false);
    setRejectNote('');
    toast.success('Payment proof rejected');
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
              onClick={() => {
                if (!confirm('Delete this order? This cannot be undone.')) return;
                del.mutate(order.id, {
                  onSuccess: () => {
                    toast.success('Order deleted');
                    navigate('/orders');
                  },
                });
              }}
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

        {/* Payment review section */}
        {order.status === 'awaiting_payment' && (
          <div className="mt-5 space-y-3 rounded-lg border border-dashed border-status-awaiting-fg/30 bg-status-awaiting/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-status-awaiting-fg">
              <AlertCircle className="h-4 w-4" /> Awaiting payment
            </div>
            {order.paymentProof ? (
              <>
                <a
                  href={order.paymentProof.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-border"
                >
                  <img src={order.paymentProof.imageUrl} alt="Payment proof" className="max-h-72 w-full object-contain bg-white" />
                </a>
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
                Customer hasn't uploaded a payment screenshot yet. Send them the tracking link.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <section>
        <h2 className="mb-3 h-eyebrow">Timeline</h2>
        <div className="card-soft p-5">
          <OrderStatusTimeline status={order.status} history={order.statusHistory} />
        </div>
      </section>

      {/* Items */}
      <section>
        <h2 className="mb-3 h-eyebrow">Items</h2>
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {order.items.map((it, i) => (
              <div key={i} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{it.description}</div>
                  <div className="text-xs text-muted-foreground">{it.categoryName} · {fmtKg(it.weightKg)} · {fmtMoney(it.ratePerKg)}/kg</div>
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
              order.flyerAssignments.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 p-4">
                  <Link to={`/flyers/${a.flyerId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                    <Plane className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.flyerName}</div>
                      <div className="text-xs text-muted-foreground">{fmtKg(a.weightKg)} · {fmtMoney(a.payoutRatePerKg)}/kg</div>
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
              ))
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
