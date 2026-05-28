import { useCallback, useState } from 'react';
import { toBlob } from 'html-to-image';
import { toast } from 'sonner';

/**
 * Render a DOM subtree (the Invoice or Receipt card) to a JPG blob and hand
 * it to the user via the most reliable platform-specific path.
 *
 * Why html-to-image (not html2canvas):
 *   On iOS Safari html-to-image is generally more faithful with CSS
 *   variables, web fonts, and SVG icons because it uses a serialized
 *   <foreignObject> SVG snapshot decoded by the browser's own renderer,
 *   instead of html2canvas's hand-rolled canvas re-painter (which drops
 *   backdrop-filter, struggles with system fonts, and is finicky with
 *   cross-origin <img>).
 *
 * iOS download notes:
 *   - Direct `<a download>` clicks are unreliable in mobile Safari, and the
 *     downloaded file lands in Files (not Photos). We try `navigator.share`
 *     with a File first — that opens the iOS share sheet, which gives the
 *     customer a one-tap "Save Image" -> Photos path. We only fall back to
 *     the anchor click on platforms without Share or where the share is
 *     declined / cancelled, then to opening the blob URL in a new tab for
 *     long-press-save as a last resort.
 *
 * Cross-origin images (Firebase Storage logo + payment QR):
 *   The bytes are pre-fetched server-side by the getTrackingOrder
 *   Cloud Function (which has no browser CORS restrictions) and returned
 *   in the response as base64 data: URIs on business.logoDataUri and
 *   paymentMethods[].qrDataUri. The A4 capture target renders <img>
 *   from those data URIs, so the cloned subtree html-to-image serialises
 *   contains NO remote image references — every pixel is already inline.
 *   The canvas can't taint and toBlob can't fail on a cross-origin
 *   image. (We previously tried crossOrigin="anonymous" + cacheBust,
 *   then a client-side fetch->dataURI hook; both failed because Firebase
 *   Storage's default CORS config doesn't include ACAO so the browser
 *   couldn't read the bytes via fetch.)
 *
 * Theme during capture:
 *   The capture target is always the off-screen `.doc-page-a4` element
 *   (see src/index.css), which hard-codes light-theme CSS variables on
 *   its own subtree. The cloned content therefore renders in light theme
 *   regardless of the user's preferred theme — no global <html>.dark
 *   toggle needed (which would briefly flicker the on-screen card during
 *   capture).
 *
 * Canvas re-encode pass — why reencodeImagesViaCanvas(node) runs before toBlob:
 *   The <foreignObject> serialise pipeline used by html-to-image
 *   silently drops SOME <img> elements even when the src is a valid
 *   data: URI — the surrounding text and layout serialise fine, but
 *   the img slot is blank. Reproduces in BOTH Chromium and WebKit, so
 *   it's NOT a decode-timing issue (we previously added img.decode()
 *   waits with no effect). The most plausible cause is encoding traits
 *   the SVG image decoder doesn't tolerate the way a normal <img>
 *   paint does — progressive JPEGs, embedded ICC profile, non-trivial
 *   EXIF orientation, unusual JFIF chunks. The payment QR is the
 *   canonical victim because it's typically a phone-camera screenshot
 *   of a bank-app QR, which is full of those traits.
 *
 *   Fix: for every <img> in the capture subtree, draw it onto an
 *   offscreen canvas at natural dimensions and toDataURL('image/png')
 *   to get a vanilla browser-emitted PNG, then assign that as the
 *   <img>.src. Vanilla PNGs round-trip through foreignObject reliably
 *   because nothing in them comes from outside the browser's encoder.
 *
 *   Print/PDF (window.print) wasn't affected by the original bug
 *   because the print pipeline takes a different code path —
 *   rasterising the layout tree directly, not via foreignObject —
 *   which is why we keep Print path untouched and only patch the
 *   html-to-image capture path.
 */
/**
 * For each <img> in the capture subtree: draw it onto an offscreen
 * canvas, take that canvas's PNG data URI, and assign it BACK as the
 * <img>.src. Then await the new src's decode.
 *
 * Why this isn't optional:
 *   html-to-image's <foreignObject> rasterise pipeline silently drops
 *   some <img> elements even when the src is a perfectly valid data:
 *   URI — the surrounding text and layout render fine but the <img>
 *   slot serialises blank. This reproduces in BOTH Chromium and
 *   WebKit, so it's not a decode-timing issue (we previously tried
 *   img.decode() — no effect). The most plausible cause is encoding
 *   traits the SVG image decoder doesn't tolerate the way a normal
 *   <img> paint does: progressive-scan JPEG, embedded ICC profile,
 *   non-trivial EXIF orientation, unusual JFIF chunks. The payment-
 *   method QR is the canonical victim (it's a JPEG uploaded by the
 *   owner; phone-camera screenshots of bank-app QRs are full of those
 *   traits).
 *
 *   Canvas drawImage(img, ...) re-rasterises the decoded pixels and
 *   toDataURL('image/png') re-encodes them as a vanilla browser-emitted
 *   PNG. Vanilla PNGs round-trip through foreignObject reliably
 *   because nothing in them comes from outside the browser's own
 *   encoder. Print/PDF was unaffected by the original bug because
 *   the print pipeline takes a different code path (rasterises the
 *   layout tree directly, not through foreignObject).
 *
 * Decode race + timeout so a stuck image can't hang Save indefinitely;
 * per-<img> failures are swallowed (the <img> keeps its original src,
 * the saved JPG is no worse than the status quo).
 *
 * Idempotent: re-running on an already-re-encoded subtree does another
 * round-trip but doesn't break anything. The `saving` state in
 * useSaveDocAsImage already prevents concurrent re-entry.
 *
 * Source DOM mutation: we change <img>.src on the live A4 doc, which
 * is mounted on screen as position:fixed; opacity:0; pointer-events:
 * none — invisible, so the user can't see the swap. The on-screen
 * card uses a DIFFERENT <img> (with src=qrUrl) and is untouched.
 */
async function reencodeImagesViaCanvas(
  root: HTMLElement,
  perImageTimeoutMs = 2000,
): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        // 1. Ensure the source <img> is fully decoded before we draw
        //    it — drawImage of a half-decoded source produces a partial
        //    or zero-pixel canvas.
        await Promise.race([
          img.decode(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('decode timeout')), perImageTimeoutMs),
          ),
        ]);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return; // 0-sized — nothing to draw

        // 2. Draw onto an offscreen canvas at natural pixel dimensions.
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);

        // 3. Re-encode as a plain browser-emitted PNG.
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl || dataUrl === 'data:,') return; // toDataURL bailed

        // 4. Swap the <img> over to the re-encoded src and wait for it
        //    to decode so toBlob sees a ready image.
        img.src = dataUrl;
        await Promise.race([
          img.decode(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('redecode timeout')), perImageTimeoutMs),
          ),
        ]);
      } catch {
        /* graceful — leave the <img> with its original src; the saved
           JPG will have the same blank-slot symptom we already had. */
      }
    }),
  );
}

export function useSaveDocAsImage(filenameBase: string) {
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (node: HTMLElement | null) => {
      if (!node) return;
      if (saving) return;
      setSaving(true);

      try {
        // Round-trip every <img> through a canvas so the source bytes
        // become a vanilla browser-emitted PNG before html-to-image
        // serialises the subtree. <foreignObject> drops some <img>s
        // (notably the payment-method QR JPEG) in both Chromium and
        // WebKit — see reencodeImagesViaCanvas for the rationale. The
        // re-encode also decodes the result, so toBlob sees ready
        // images and we don't need a separate decode-only pass.
        await reencodeImagesViaCanvas(node);

        const blob = await toBlob(node, {
          pixelRatio: 2,
          backgroundColor: '#ffffff',
          // JPEG via the type hint; quality applies on encoders that honour it.
          // We deliberately keep type=image/jpeg because Photos on iOS treats
          // JPG as a first-class camera-roll citizen; PNG often imports as
          // "screenshot" and is heavier.
          type: 'image/jpeg',
          quality: 0.95,
          // Override styles on the cloned root before rendering. The
          // off-screen .doc-page-a4 element is opacity:0 / pointer-events:
          // none / position:fixed on screen so the user never sees it; we
          // need to neutralise those so the foreignObject's clone renders
          // visibly inside the SVG snapshot. (Without `opacity: '1'` here
          // the saved JPG is blank-white — canvas.fillStyle=#fff then
          // drawImage of a fully transparent clone.) `position: static`
          // also lets the clone sit at the foreignObject's natural origin
          // instead of inheriting fixed positioning that would push it
          // outside the visible box.
          style: {
            opacity: '1',
            position: 'static',
            left: 'auto',
            top: 'auto',
            pointerEvents: 'auto',
          },
          // cacheBust:true tells html-to-image to append a query string
          // when it fetches embedded resources. For our <img>s — every
          // src is a data: URI and html-to-image's image-embed pass
          // skips data URIs (isDataUrl check) — this is a no-op in the
          // current setup. Kept on as belt-and-suspenders so any future
          // remote <img> that sneaks into the doc would still capture
          // fresh bytes rather than a stale cached blob.
          cacheBust: true,
          // Universal opt-out — any DOM node marked data-capture-skip is
          // excluded from the cloned subtree before serialization. Lets us
          // put on-screen action UI (Save / Print buttons) physically
          // INSIDE the print-doc card so they're visually anchored to the
          // invoice/receipt, without those buttons showing up in the saved
          // image. Returning false from filter skips the node + descendants.
          filter: (node) =>
            !(node instanceof HTMLElement && node.dataset.captureSkip === 'true'),
        });
        if (!blob) throw new Error('Failed to render image');

        const filename = `${filenameBase}.jpg`;
        const file = new File([blob], filename, { type: 'image/jpeg' });

        // 1. iOS / Android modern share sheet — best UX, lands in Photos via
        //    "Save Image". `canShare` with files is the gate iOS requires.
        const nav = navigator as Navigator & {
          canShare?: (data: { files?: File[] }) => boolean;
        };
        if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            return;
          } catch (e) {
            // User cancelled the share sheet — that's not an error to toast.
            if (e instanceof Error && e.name === 'AbortError') return;
            // Fall through to the download fallback if share itself failed.
          }
        }

        // 2. Desktop / Android browsers without file-share — anchor download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Give Safari a tick before revoking; some builds revoke before the
        // download stream actually starts otherwise.
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save image');
      } finally {
        setSaving(false);
      }
    },
    [filenameBase, saving],
  );

  return { save, saving };
}
