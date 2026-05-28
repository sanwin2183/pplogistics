import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
  Package,
  Plane,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { functions } from '../../lib/firebase';
import { fmtDate } from '../../lib/formatters';
import { ROUTE_LABELS } from '../../lib/status';
import { Spinner } from '../../components/Spinner';
import { OrderStatusTimeline } from '../orders/OrderStatusTimeline';
import { Invoice } from './Invoice';
import { PaymentSection } from './PaymentSection';
import { Receipt } from './Receipt';
import type { PublicOrder } from '../../types';

export function TrackingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    const fn = httpsCallable<{ slug: string }, PublicOrder>(functions, 'getTrackingOrder');
    fn({ slug })
      .then((res) => {
        if (!cancelled) setOrder(res.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Not found');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="card-soft max-w-sm p-8 text-center">
          <AlertCircle className="mx-auto mb-4 h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <h1 className="text-base font-semibold">Tracking link not found</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The link may have expired, or the order may have been removed. Please check with the sender.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto max-w-[480px]">
        {/* Hero — only place a gradient lives. pt-safe clears the Dynamic Island
            when this page is viewed in standalone PWA mode. */}
        <header className="tracking-hero px-6 pb-6 text-center pt-[calc(2.5rem+var(--sa-top))]">
          {order.business.logoUrl ? (
            <img src={order.business.logoUrl} alt={order.business.name} className="mx-auto mb-3 h-12 object-contain" />
          ) : (
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Package className="h-5 w-5" />
            </div>
          )}
          <h1 className="text-lg font-semibold tracking-tight">{order.business.name}</h1>
          {order.business.tagline && (
            <p className="mt-0.5 text-xs text-muted-foreground">{order.business.tagline}</p>
          )}
        </header>

        <main className="px-4 pb-12 space-y-4">
          {/* Order summary — identifies the order; amount/items live in Invoice/Receipt. */}
          <section className="card-soft p-6 text-center">
            <div className="h-eyebrow">Order</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">#{order.orderNumber}</div>
            <p className="mt-1 text-sm text-muted-foreground">Hi {order.customerFirstName} 👋</p>
          </section>

          {/* Invoice (unpaid) — amount due billboard + line items with subtotals.
              Visible from the moment the link is opened, never says "paid". */}
          {order.status !== 'paid' && <Invoice order={order} />}

          {/* Payment methods (unpaid) — bank/PromptPay details + QR + upload CTA.
              Visible from status='pending' onward, copy adapts at awaiting_payment. */}
          {order.status !== 'paid' && (
            <PaymentSection
              order={order}
              slug={slug!}
              onUploaded={() => {
                // Optimistic local state: mark proof uploaded so the UI shifts immediately.
                setOrder((prev) => prev ? { ...prev, paymentProof: { uploadedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as never, note: 'Awaiting admin review' } } : prev);
              }}
            />
          )}

          {/* Timeline */}
          <section className="card-soft p-6">
            <h2 className="mb-4 text-sm font-semibold">Status</h2>
            <OrderStatusTimeline status={order.status} history={order.statusHistory} pulse />
          </section>

          {/* Flyer info */}
          {order.flyer && (
            <section className="card-soft flex items-center gap-3 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Plane className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">Carried by {order.flyer.firstName}</div>
                <div className="text-xs text-muted-foreground">
                  {ROUTE_LABELS[order.flyer.route]} · {fmtDate(order.flyer.flightDate)}
                </div>
              </div>
            </section>
          )}

          {/* Receipt (paid) — replaces Invoice + PaymentSection once status='paid'. */}
          {order.status === 'paid' && <Receipt order={order} />}

          <footer className="pt-4 pb-[calc(1rem+var(--sa-bottom))] text-center text-xs text-muted-foreground space-y-1">
            {order.business.contactPhone && <div>📞 {order.business.contactPhone}</div>}
            {order.business.contactTelegram && <div>{order.business.contactTelegram}</div>}
            <div className="pt-2 flex items-center justify-center gap-1 opacity-60">
              <Sparkles className="h-3 w-3" /> Powered by {order.business.name}
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
