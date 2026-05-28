import { useMemo, useRef } from 'react';
import { Image as ImageIcon, Package, Printer } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/Spinner';
import { fmtDate, fmtKg, fmtMoney } from '../../lib/formatters';
import { ORDER_STATUS_LABELS } from '../../lib/status';
import { useSaveDocAsImage } from './useSaveDocAsImage';
import {
  useImageDataUris,
  allImagesSettled,
  type ImageDataUriResult,
} from './useImageDataUris';
import type { PaymentMethod, PublicOrder } from '../../types';

/**
 * Look up the inlined src for an image URL.
 *
 * On-screen callers don't pass a dataUriMap and get the original URL back
 * (no inlining needed — the live <img> renders just fine against Storage).
 *
 * A4-doc callers pass the dataUriMap from useImageDataUris. The lookup
 * yields:
 *   - The data: URI when fetch succeeded (status === 'ready').
 *   - { errored: true } when the fetch failed — caller renders a small
 *     fallback ("QR unavailable — use account details below") instead of
 *     a broken <img>. This is critical: the save must NOT hard-fail just
 *     because one image wouldn't fetch (§ user-spec point 4).
 *   - { src: null, errored: false } while still loading. The button gate
 *     means the user can't reach a capture in this state — only the A4
 *     doc renders nothing for the image until the URI arrives.
 */
function resolveImg(
  url: string | null | undefined,
  dataUriMap: Record<string, ImageDataUriResult> | undefined,
): { src: string | null; errored: boolean } {
  if (!url) return { src: null, errored: false };
  if (!dataUriMap) return { src: url, errored: false };
  const r = dataUriMap[url];
  if (r?.status === 'ready' && r.dataUri) return { src: r.dataUri, errored: false };
  if (r?.status === 'error') return { src: null, errored: true };
  return { src: null, errored: false };
}

/**
 * Invoice for unpaid orders (pending → awaiting_payment).
 *
 * Renders TWO copies of the document:
 *
 *   1. On-screen .card-soft card — responsive, sits in the 480 px mobile
 *      column, contains the [Save as image] [Print / PDF] action toolbar
 *      anchored at the bottom. Tagged .print-screen-hidden so @media print
 *      hides it.
 *
 *   2. Off-screen .doc-page-a4 element — full A4 portrait (210 × 297 mm)
 *      with payment block included (QR + bank/account info from
 *      order.paymentMethods). useSaveDocAsImage targets THIS element so the
 *      captured JPG is a proper full-page invoice with everything the
 *      customer needs (amount due + how to pay + QR) in one image. In
 *      @media print this element promotes from `position: fixed` to
 *      `position: static` so it flows into the printed page.
 *
 * The on-screen card omits the payment block to avoid duplicating
 * PaymentSection's interactive QR + upload UI sitting below it — the
 * static payment info is in the saved/printed document only.
 *
 * §11: this component reads only fields already on PublicOrder
 * (paymentMethods is the sanitized list — accountName/accountNumber/
 * bank/qrUrl/isActive — no payouts or profit; customerFirstName not
 * full PII). No leakage.
 */
export function Invoice({ order }: { order: PublicOrder }) {
  const docRef = useRef<HTMLDivElement | null>(null);
  const { save, saving } = useSaveDocAsImage(`invoice-${order.orderNumber}`);

  // Every remote image the A4 doc needs — logo + each active payment
  // method's QR. Pre-fetched as base64 data: URIs (see useImageDataUris)
  // so the capture (html-to-image) and print (window.print) paths render
  // images that have no cross-origin dependency and can't taint canvas.
  const imageUrls = useMemo(() => {
    const list: string[] = [];
    if (order.business.logoUrl) list.push(order.business.logoUrl);
    for (const m of order.paymentMethods) {
      if (m.isActive && m.qrUrl) list.push(m.qrUrl);
    }
    return list;
  }, [order.business.logoUrl, order.paymentMethods]);

  const dataUriMap = useImageDataUris(imageUrls);
  // All images settled = none in 'loading' state. 'error' is fine — the
  // doc renders a text fallback in place of the broken image.
  const ready = allImagesSettled(dataUriMap, imageUrls);

  return (
    <>
      {/* 1. ON-SCREEN card — interactive copy. */}
      <section className="card-soft print-screen-hidden p-6 space-y-5">
        <InvoiceBody order={order} includePayment={false} />

        {/* Save / print toolbar — captured-skip + no-print + at the bottom of
            the on-screen card so it's visually anchored to the document.
            Disabled until every remote image has been inlined as a data
            URI; without the gate, tapping Save before the QR was ready
            would capture an A4 doc with a broken-image placeholder. */}
        <div
          data-capture-skip="true"
          className="no-print grid grid-cols-2 gap-2 border-t border-border pt-4"
        >
          <Button
            variant="outline"
            onClick={() => save(docRef.current)}
            disabled={saving || !ready}
          >
            {(saving || !ready) ? <Spinner className="text-primary" /> : <ImageIcon />}
            {saving ? 'Saving…' : !ready ? 'Preparing…' : 'Save as image'}
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!ready}>
            <Printer /> {!ready ? 'Preparing…' : 'Print / PDF'}
          </Button>
        </div>
      </section>

      {/* 2. OFF-SCREEN A4 doc — capture + print target. Uses the data-URI
          versions of every image via dataUriMap. aria-hidden so screen
          readers ignore the duplicate content. */}
      <div ref={docRef} className="doc-page-a4 space-y-6" aria-hidden="true">
        <InvoiceBody order={order} includePayment={true} dataUriMap={dataUriMap} />
      </div>
    </>
  );
}

/**
 * Shared invoice body.
 *
 * - On-screen call: omit dataUriMap → images render against their original
 *   Firebase Storage URLs (works fine for live display).
 * - A4-doc call: pass dataUriMap → images render from inlined data: URIs
 *   so the capture + print paths don't depend on cross-origin fetches.
 */
function InvoiceBody({
  order,
  includePayment,
  dataUriMap,
}: {
  order: PublicOrder;
  includePayment: boolean;
  dataUriMap?: Record<string, ImageDataUriResult>;
}) {
  const logo = resolveImg(order.business.logoUrl, dataUriMap);

  return (
    <>
      {/* Header — title + logo */}
      <header className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">#{order.orderNumber}</p>
        </div>
        {logo.src ? (
          <img
            src={logo.src}
            alt={order.business.name}
            className="h-10 max-w-[7rem] object-contain"
          />
        ) : (
          // No logo URL OR (A4 doc & fetch failed) OR (A4 doc & still loading)
          // → fall back to the package icon. The Save / Print buttons are
          // gated until images settle, so "still loading" never reaches a
          // capture.
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
        )}
      </header>

      {/* From / Billed-to blocks */}
      <div className="grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <div className="h-eyebrow mb-1.5">From</div>
          <div className="truncate text-sm font-semibold">{order.business.name}</div>
          {order.business.tagline && (
            <div className="truncate text-xs text-muted-foreground">{order.business.tagline}</div>
          )}
          {order.business.contactPhone && (
            <div className="truncate text-xs text-muted-foreground tabular-nums">{order.business.contactPhone}</div>
          )}
          {order.business.contactEmail && (
            <div className="truncate text-xs text-muted-foreground">{order.business.contactEmail}</div>
          )}
        </div>
        <div className="min-w-0">
          <div className="h-eyebrow mb-1.5">Billed to</div>
          <div className="truncate text-sm font-semibold">{order.customerFirstName}</div>
        </div>
      </div>

      {/* Issued / Status meta */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="h-eyebrow mb-1.5">Issued</div>
          <div className="text-sm font-medium tabular-nums">{fmtDate(order.createdAt)}</div>
        </div>
        <div>
          <div className="h-eyebrow mb-1.5">Status</div>
          <div className="text-sm font-medium">{ORDER_STATUS_LABELS[order.status]}</div>
        </div>
      </div>

      {/* Line-items table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 bg-secondary px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Item</span>
          <span className="text-right">Weight</span>
          <span className="text-right">Rate</span>
          <span className="text-right">Total</span>
        </div>
        {order.items.map((it, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-t border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{it.description}</div>
              <div className="truncate text-xs text-muted-foreground">{it.categoryName}</div>
            </div>
            <span className="self-center text-right text-xs tabular-nums">{fmtKg(it.weightKg)}</span>
            <span className="self-center text-right text-xs tabular-nums">{fmtMoney(it.ratePerKg)}</span>
            <span className="self-center text-right text-sm font-medium tabular-nums">{fmtMoney(it.subtotal)}</span>
          </div>
        ))}
      </div>

      {/* Totals — small weight line above the prominent amount-due billboard */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Total weight</span>
          <span className="tabular-nums">{fmtKg(order.totalWeightKg)}</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-medium">Total amount due</span>
          <span className="text-2xl font-semibold tabular-nums">{fmtMoney(order.totalAmount)}</span>
        </div>
      </div>

      {/* Payment block — A4 doc only. Lists every active payment method with
          QR (when set) + account name / number / bank. So a customer who
          long-press-saves the JPG has everything they need to pay in one
          image, with no need to refer back to the tracking page. */}
      {includePayment && <PaymentMethodsForDoc order={order} dataUriMap={dataUriMap} />}
    </>
  );
}

/** Type label per method type — matches the on-screen PaymentSection. */
const TYPE_LABEL: Record<PaymentMethod['type'], string> = {
  promptpay: 'PromptPay',
  bank_transfer: 'Bank Transfer',
  kbz_pay: 'KBZ Pay',
  wave_pay: 'Wave Pay',
};

function PaymentMethodsForDoc({
  order,
  dataUriMap,
}: {
  order: PublicOrder;
  dataUriMap?: Record<string, ImageDataUriResult>;
}) {
  const methods = order.paymentMethods.filter((m) => m.isActive);
  if (methods.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-secondary/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold tracking-wider text-foreground">HOW TO PAY</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pay {fmtMoney(order.totalAmount)} using any of the methods below. Include order #{order.orderNumber} as the reference.
        </p>
      </div>
      <div className="space-y-4">
        {methods.map((m) => {
          // Resolve the QR's inlined src. With dataUriMap (A4 doc), this is
          // either the data: URI, null (still loading — gated, so unreachable
          // at capture time), or { errored: true } (fetch failed — render
          // text fallback instead of a broken <img> so the account
          // name/number are still front-and-centre).
          const qr = resolveImg(m.qrUrl, dataUriMap);
          return (
            <div key={m.id} className="flex items-start gap-4 rounded-md border border-border bg-card p-3">
              {qr.src ? (
                // White-backed box so dark QR pixels print cleanly. Fixed
                // dimensions so the captured JPG always gets a scannable
                // resolution.
                <div className="shrink-0 rounded-md border border-border bg-white p-1.5">
                  <img
                    src={qr.src}
                    alt={`${m.label} QR code`}
                    className="h-32 w-32 object-contain"
                  />
                </div>
              ) : qr.errored ? (
                // Graceful fallback per user-spec point 4: account
                // details below remain the primary identifier so the
                // customer can still pay; the save is NOT hard-failed.
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 p-2 text-center text-[11px] text-muted-foreground">
                  QR unavailable — use account details &rarr;
                </div>
              ) : null /* still loading — A4 doc only, unreachable at capture time */}
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="font-semibold">{TYPE_LABEL[m.type] ?? m.label}</div>
                <DocDetailRow label="Account name" value={m.accountName} />
                <DocDetailRow
                  label={m.type === 'bank_transfer' ? 'Account number' : 'Number'}
                  value={m.accountNumber}
                />
                {m.bank && <DocDetailRow label="Bank" value={m.bank} />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DocDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
