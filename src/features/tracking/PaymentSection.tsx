import { useRef, useState } from 'react';
import { Copy, Check, Upload, CheckCircle2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Spinner } from '../../components/Spinner';
import { fmtDateTime } from '../../lib/formatters';
import { storage, functions } from '../../lib/firebase';
import type { PublicOrder } from '../../types';

const TYPE_LABEL: Record<string, string> = {
  promptpay: 'PromptPay',
  bank_transfer: 'Bank',
  kbz_pay: 'KBZ Pay',
  wave_pay: 'Wave Pay',
};

/**
 * Renders bank/PromptPay/etc. details + an upload-proof CTA for any unpaid
 * order. Caller should only mount this when status !== 'paid'. Amount due is
 * NOT shown here (lives in <Invoice />) — this is purely "how to pay".
 *
 * Heading copy adapts to status: informational ("How to pay") for early
 * statuses, action ("Pay now") once status === 'awaiting_payment'.
 *
 * Customers can pay EARLY: the submitPaymentProof callable accepts proofs
 * at any non-paid status (the only rejection is `status === 'paid'`). The
 * uploaded proof never changes the order's status — it just records that
 * a customer has submitted a screenshot for admin review. The admin
 * approves separately via the OrderDetailPage; only that approval moves
 * outstandingBalance → totalSpent (see useUpdateOrderStatus's 'paid'
 * branch, the only money-moving transaction).
 */
export function PaymentSection({
  order,
  slug,
  onUploaded,
}: {
  order: PublicOrder;
  slug: string;
  onUploaded: () => void;
}) {
  const methods = order.paymentMethods.filter((m) => m.isActive);
  const isAwaitingPayment = order.status === 'awaiting_payment';
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Proof already attached — waiting on admin approval. Same UI for both
  // "uploaded just now" and "uploaded earlier, still pending".
  if (order.paymentProof) {
    return (
      <section className="card-soft p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <h2 className="text-sm font-semibold">Payment received</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Awaiting confirmation. Uploaded {fmtDateTime(order.paymentProof.uploadedAt)}.
        </p>
      </section>
    );
  }

  // Empty-state — admin hasn't configured any payment methods, or the order
  // wasn't created with any enabled. Friendlier than rendering an empty tab
  // strip.
  if (methods.length === 0) {
    return (
      <section className="card-soft p-6 text-center space-y-2">
        <h2 className="text-sm font-semibold">How to pay</h2>
        <p className="text-xs text-muted-foreground">
          Contact the sender for payment details.
        </p>
      </section>
    );
  }

  async function submitProof() {
    if (!file) {
      toast.error('Add a screenshot first');
      return;
    }
    setSubmitting(true);
    try {
      // 1. Upload to Storage. Storage rule allows non-admin CREATE on
      //    payment-proofs/{slug}/* with isImage + under5MB validation
      //    (see storage.rules).
      const path = `payment-proofs/${slug}/${nanoid(10)}-${file.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);

      // 2. NO getDownloadURL here — that's a READ, and the same rule says
      //    `allow read: if isAdmin()` per §11 (proof images are admin-only).
      //    The customer can't read back their own upload, so calling
      //    getDownloadURL would throw storage/unauthorized AFTER the
      //    successful upload. Instead we send just the storage PATH to the
      //    function and the admin client resolves it to a URL via
      //    getDownloadURL (admin has read access) when rendering the
      //    review panel.
      const fn = httpsCallable<{ slug: string; imagePath: string; note?: string }, { ok: true }>(functions, 'submitPaymentProof');
      await fn({ slug, imagePath: path, note: note.trim() || undefined });
      toast.success('Payment proof submitted — thanks!');
      onUploaded();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card-soft p-6 space-y-5">
      <div className="text-center">
        <h2 className="text-sm font-semibold">{isAwaitingPayment ? 'Pay now' : 'How to pay'}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isAwaitingPayment
            ? 'Transfer the amount above, then upload your proof.'
            : 'You can transfer any time. Upload proof when you\'re ready.'}
        </p>
      </div>

      <Tabs defaultValue={methods[0].id}>
        <TabsList className={`grid w-full grid-cols-${Math.min(methods.length, 4)}`}>
          {methods.map((m) => (
            <TabsTrigger key={m.id} value={m.id} className="text-xs">{TYPE_LABEL[m.type] ?? m.label}</TabsTrigger>
          ))}
        </TabsList>
        {methods.map((m) => (
          <TabsContent key={m.id} value={m.id} className="space-y-3">
            {m.qrUrl && (
              <div className="rounded-xl border border-border bg-white p-4 flex justify-center">
                <img src={m.qrUrl} alt="Payment QR" className="h-56 w-56 object-contain" />
              </div>
            )}
            <div className="rounded-lg border border-border p-3 text-sm">
              <DetailRow label="Account name" value={m.accountName} />
              <DetailRow label={m.type === 'bank_transfer' ? 'Account number' : 'Number'} value={m.accountNumber} copyable />
              {m.bank && <DetailRow label="Bank" value={m.bank} />}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {!open ? (
        <Button className="w-full" onClick={() => setOpen(true)}>
          I've paid · Upload proof
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-4 animate-fade-in">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-sm transition-colors ${file ? 'border-primary bg-accent/40' : 'border-border bg-secondary/30 hover:bg-secondary'}`}
          >
            {file ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span className="text-foreground">{file.name}</span>
                <span className="text-xs text-muted-foreground">Tap to change</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span>Tap to upload screenshot</span>
              </>
            )}
          </button>
          <Textarea
            rows={2}
            placeholder="Optional note (e.g. transaction time)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setOpen(false); setFile(null); setNote(''); }}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={submitProof} disabled={!file || submitting}>
              {submitting ? <Spinner className="text-primary-foreground" /> : null}
              {submitting ? 'Sending…' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function DetailRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm tabular-nums">{value}</span>
        {copyable && (
          <button
            type="button"
            className="text-muted-foreground hover:text-primary"
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            aria-label={`Copy ${label}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
