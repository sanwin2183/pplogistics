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
 * Image decode wait — why decodeAllImages(node) runs before toBlob:
 *   iOS Safari's <foreignObject> snapshot serialises each <img> by its
 *   currently-decoded pixel state. An <img> that has loaded its src
 *   (img.complete === true) but hasn't finished its decode tick yet
 *   serialises as BLANK — the surrounding text and layout capture fine,
 *   but the img slot is empty. This bit us on the payment-method QR
 *   specifically: a ~10-50 KB base64-decoded PNG takes one event-loop
 *   tick to fully decode after React renders, and toBlob was firing
 *   inside that window. Calling HTMLImageElement.decode() returns a
 *   promise that resolves once the browser has the image ready for
 *   canvas/foreignObject — we await it on every <img> in the subtree
 *   first. Print/PDF (window.print) wasn't affected because the print
 *   pipeline waits for image decode itself.
 */
/**
 * Wait for every <img> in the capture subtree to finish decoding.
 *
 * HTMLImageElement.decode() returns a promise that resolves when the
 * browser has the image ready to draw to a canvas (or foreignObject).
 * We call it unconditionally — even when img.complete is already true,
 * because `complete` means "the resource has been loaded" not "the
 * pixels are decoded and ready". On iOS Safari those two states are
 * not the same: a freshly-rendered <img src="data:image/...">
 * frequently reports complete=true on the next animation frame but
 * isn't fully decoded for another tick or two, and html-to-image's
 * <foreignObject> serialise — which doesn't wait for decode itself —
 * would capture it as blank.
 *
 * Each decode is wrapped with a timeout race so a stuck or rejected
 * decode (cross-origin, malformed image) can't hang the save
 * indefinitely. The per-<img> failure is swallowed: html-to-image
 * will still attempt to capture whatever the browser has; the worst
 * case is one blank slot in the saved JPG, which is no worse than the
 * status quo without this wait.
 */
async function decodeAllImages(root: HTMLElement, perImageTimeoutMs = 2000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        await Promise.race([
          img.decode(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('image decode timeout')), perImageTimeoutMs),
          ),
        ]);
      } catch {
        /* graceful — let html-to-image render whatever this <img> can */
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
        // Force a full decode of every <img> in the capture subtree
        // BEFORE html-to-image takes its snapshot. iOS Safari serialises
        // not-yet-decoded <img>s as blank inside <foreignObject>; the
        // payment QR was the canonical victim because the base64 data
        // URI is large enough that decode took one event-loop tick
        // beyond React's render. Print already waited for decode
        // internally, which is why Print/PDF worked while Save did not.
        await decodeAllImages(node);

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
