import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import {
  Package,
  Plane,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react';
import { functions } from '../../lib/firebase';
import { fmtDate } from '../../lib/formatters';
import { ROUTE_LABELS, publicTimelineOverrides } from '../../lib/status';
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
  // Index (not URL) so swiping forward/back inside the lightbox is a 1-liner
  // if we add it later. `null` means closed.
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // ESC closes the lightbox — basic accessibility for desktop / external
  // keyboard users. Touch users tap the backdrop or close button.
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx]);

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
    // print-reset on both wrappers: @media print strips their padding /
    // max-width so the .print-doc child (Invoice or Receipt) can fill the page
    // instead of staying inside the 480 px mobile column.
    <div className="min-h-svh bg-background print-reset">
      <div className="mx-auto max-w-[480px] print-reset">
        {/* Hero — only place a gradient lives. pt-safe clears the Dynamic Island
            when this page is viewed in standalone PWA mode. Excluded from print
            output (the saved/printed document should be ONLY the invoice or
            receipt card, not the page chrome). */}
        <header className="tracking-hero px-6 pb-6 text-center pt-[calc(2.5rem+var(--sa-top))] no-print">
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
          {/* Order summary — identifies the order on screen; amount/items live in
              Invoice/Receipt (which is the print/save target). */}
          <section className="card-soft p-6 text-center no-print">
            <div className="h-eyebrow">Order</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">#{order.orderNumber}</div>
            <p className="mt-1 text-sm text-muted-foreground">Hi {order.customerFirstName} 👋</p>
          </section>

          {/* Invoice (unpaid) — amount due billboard + line items with subtotals.
              Visible from the moment the link is opened, never says "paid".
              This IS the print/save document for unpaid orders. */}
          {order.status !== 'paid' && <Invoice order={order} />}

          {/* Payment methods (unpaid) — bank/PromptPay details + QR + upload CTA.
              Visible from status='pending' onward, copy adapts at awaiting_payment.
              Excluded from print: the document shouldn't include the upload UI. */}
          {order.status !== 'paid' && (
            <div className="no-print">
              <PaymentSection
                order={order}
                slug={slug!}
                onUploaded={() => {
                  // Optimistic local state: mark proof uploaded so the UI shifts immediately.
                  setOrder((prev) => prev ? { ...prev, paymentProof: { uploadedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as never, note: 'Awaiting admin review' } } : prev);
                }}
              />
            </div>
          )}

          {/* Timeline — on-screen narrative. Not part of the document.
              The publicTimelineOverrides helper rewrites the in_transit
              step from the generic "In Transit" to "Arrived at <City>" so
              the customer sees the real-world meaning rather than the
              in-air state name from the schema. Routes through
              order.flyer?.route — falls back to the default copy when no
              flyer is assigned yet (handled inside the helper). */}
          {(() => {
            const overrides = publicTimelineOverrides(order.flyer?.route);
            return (
              <section className="card-soft p-6 no-print">
                <h2 className="mb-4 text-sm font-semibold">Status</h2>
                <OrderStatusTimeline
                  status={order.status}
                  history={order.statusHistory}
                  pulse
                  labelOverride={overrides.labels}
                  descriptionOverride={overrides.descriptions}
                />
              </section>
            );
          })()}

          {/*
            Photos gallery — admin-uploaded warehouse / status photos. Hidden
            entirely when there are no photos (zero-state would be more chrome
            than content). Horizontal-scroll thumbnails with snap-x so the
            customer can flick through; tap any thumb to open the fullscreen
            lightbox below. The thumb row uses the same scroll-+-snap pattern
            as the Settings tab strip: hidden scrollbar, [scrollbar-width:none]
            for Firefox + ::-webkit-scrollbar:hidden for WebKit.

            Section is excluded from print/save-as-image (no-print) because
            the document target is just the invoice/receipt card.
          */}
          {order.photos.length > 0 && (
            <section className="card-soft p-6 no-print">
              <h2 className="mb-4 text-sm font-semibold">Photos</h2>
              <div
                className="
                  -mx-2 flex gap-2 overflow-x-auto px-2 snap-x snap-mandatory
                  [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                "
              >
                {order.photos.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setLightboxIdx(i)}
                    className="
                      shrink-0 snap-start overflow-hidden rounded-md
                      ring-1 ring-border/60 transition-transform
                      active:scale-[0.97]
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                    "
                    aria-label={`Open photo ${i + 1} of ${order.photos.length}`}
                  >
                    <img
                      src={url}
                      alt={`Order photo ${i + 1}`}
                      className="h-24 w-24 object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Flyer info */}
          {order.flyer && (
            <section className="card-soft flex items-center gap-3 p-5 no-print">
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

          {/* Receipt (paid) — replaces Invoice + PaymentSection once status='paid'.
              This IS the print/save document for paid orders. */}
          {order.status === 'paid' && <Receipt order={order} />}

          <footer className="pt-4 pb-[calc(1rem+var(--sa-bottom))] text-center text-xs text-muted-foreground space-y-1 no-print">
            {order.business.contactPhone && <div>📞 {order.business.contactPhone}</div>}
            {order.business.contactTelegram && <div>{order.business.contactTelegram}</div>}
            <div className="pt-2 flex items-center justify-center gap-1 opacity-60">
              <Sparkles className="h-3 w-3" /> Powered by {order.business.name}
            </div>
          </footer>
        </main>
      </div>

      {/*
        Lightbox — fullscreen photo preview. Lives outside the max-width
        column wrapper so it actually covers the full viewport (the column
        wrapper has `max-w-[480px]` which would clip a centered lightbox on
        desktop / tablet). Renders only when an index is selected.

        UX:
          - Tap backdrop OR the X button to close.
          - Stopping click propagation on the <img> itself prevents an
            accidental dismissal when the customer taps the photo to pinch-
            zoom on iOS.
          - Inert px-safe / pt-safe / pb-safe via padding so the X button
            doesn't end up under the iOS Dynamic Island in standalone PWA.
          - no-print so it can't leak into a saved/printed document if the
            customer hits Save while the lightbox is open.
      */}
      {lightboxIdx !== null && order.photos[lightboxIdx] && (
        <div
          className="
            no-print fixed inset-0 z-50 flex items-center justify-center
            bg-black/90 p-4 pt-[calc(1rem+var(--sa-top))]
            pb-[calc(1rem+var(--sa-bottom))]
          "
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxIdx(null)}
            aria-label="Close photo preview"
            className="
              absolute right-4 z-10
              top-[calc(1rem+var(--sa-top))]
              flex h-10 w-10 items-center justify-center rounded-full
              bg-white/10 text-white backdrop-blur
              transition-colors hover:bg-white/20
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60
            "
          >
            <X className="h-5 w-5" />
          </button>
          <div className="absolute left-4 top-[calc(1rem+var(--sa-top))] text-xs text-white/70">
            {lightboxIdx + 1} / {order.photos.length}
          </div>
          <img
            src={order.photos[lightboxIdx]}
            alt={`Order photo ${lightboxIdx + 1}`}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
