import { useCallback, useState } from 'react';
import html2canvas from 'html2canvas';
import { toast } from 'sonner';

/**
 * Render a DOM subtree (the off-screen .doc-page-a4 element) to a JPG
 * blob and hand it to the user via the most reliable platform-specific
 * path.
 *
 * Capture mechanism — html2canvas (NOT html-to-image)
 *   html-to-image serialises the cloned subtree into an <svg>
 *   <foreignObject> and rasterises that. Both Chromium and WebKit's
 *   foreignObject image decoder silently drop SOME <img> elements
 *   even when the src is a valid data: URI — the surrounding text and
 *   layout serialise fine but the <img> slot is blank. This bit us on
 *   the payment-method QR (a JPEG uploaded by the owner, typically a
 *   phone-camera screenshot of a bank-app QR, so full of progressive
 *   scans / ICC profile / EXIF orientation chunks). We previously
 *   tried, in order, (a) crossOrigin="anonymous" + cacheBust,
 *   (b) client-side fetch->dataURI, (c) function-side fetch ->
 *   qrDataUri in PublicOrder, (d) img.decode() await, (e) canvas
 *   round-trip to a vanilla browser PNG before toBlob — every fix
 *   except the data delivery (c) still hit the foreignObject drop.
 *
 *   html2canvas takes a completely different approach: it walks the
 *   layout tree directly and paints into a real canvas via standard
 *   drawImage. No SVG serialise, no foreignObject. Normal <img>
 *   drawImage works for the QR JPEG just like it does for the on-
 *   screen card.
 *
 * Canvas re-encode pass — still here as belt and braces
 *   reencodeImagesViaCanvas runs before html2canvas. Even though the
 *   foreignObject bug doesn't apply to html2canvas, drawing through
 *   a canvas first removes any encoding traits that the browser's
 *   own drawImage might still struggle with (rare, but doesn't
 *   hurt). Per-image timeouts + try/catch keep failures graceful.
 *
 * iOS download notes:
 *   - Direct <a download> clicks are unreliable in mobile Safari and
 *     land the file in Files (not Photos). We try `navigator.share`
 *     with a File first — opens the iOS share sheet, which gives the
 *     customer a one-tap "Save Image" -> Photos path. Falls back to
 *     the anchor click on platforms without Share or where share is
 *     declined.
 *
 * Cross-origin images: a previous phase added paymentMethods[].qrDataUri
 * + business.logoDataUri on the function response (server-side fetch
 * + base64 inline) so the A4 doc's <img> srcs are all data: URIs.
 * No cross-origin fetches happen at capture time.
 *
 * Theme during capture: .doc-page-a4 hard-codes light-theme CSS vars
 * on its own subtree (see src/index.css). Cloned content always
 * renders in light theme regardless of <html>.dark.
 *
 * Style overrides during capture: .doc-page-a4 is opacity:0 /
 * position:fixed off-screen / pointer-events:none on screen — invisible
 * to the user. html2canvas's `onclone` callback lets us mutate the
 * cloned root's inline styles before render: we set opacity:1,
 * position:static, etc. so the renderer actually draws something at
 * full opacity. The live source on screen stays opacity:0 — the user
 * never sees the swap.
 */

/**
 * For each <img> in the capture subtree: draw it onto an offscreen
 * canvas, get the canvas's PNG data URI, and assign THAT back as the
 * <img>.src. Removes any encoder quirks the JPEG bytes might carry.
 *
 * Diagnostic console logging is enabled below (TEMPORARY) so we can
 * see whether each step succeeds. To disable later, set DEBUG_CAPTURE
 * to false.
 */
const DEBUG_CAPTURE = true;
const dlog = (...args: unknown[]): void => {
  if (DEBUG_CAPTURE) console.log('[capture]', ...args);
};
const dwarn = (...args: unknown[]): void => {
  if (DEBUG_CAPTURE) console.warn('[capture]', ...args);
};
const derr = (...args: unknown[]): void => {
  if (DEBUG_CAPTURE) console.error('[capture]', ...args);
};

async function reencodeImagesViaCanvas(
  root: HTMLElement,
  perImageTimeoutMs = 2000,
): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
  dlog('found', imgs.length, 'image(s) in capture subtree');

  await Promise.all(
    imgs.map(async (img, idx) => {
      const tag = `img#${idx}`;
      const before = (img.src ?? '').slice(0, 30);
      const alt = img.alt || '(no alt)';
      // QR images carry "QR code" in alt — detect them so we can pad
      // the canvas to a true square before re-encoding, defending
      // against html2canvas's imperfect object-fit handling that was
      // squeezing the cells of non-square QR sources.
      const isQr = /qr code/i.test(alt);
      dlog(tag, alt, 'src prefix:', before, isQr ? '(QR — will pad to square)' : '');

      try {
        // 1. Wait for the source <img> to decode fully.
        await Promise.race([
          img.decode(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('decode timeout')), perImageTimeoutMs),
          ),
        ]);
        dlog(tag, alt, 'decoded:', 'w=', img.naturalWidth, 'h=', img.naturalHeight, 'complete=', img.complete);

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          dwarn(tag, alt, 'zero natural dimensions — skipping re-encode');
          return;
        }

        // 2. Compute output dimensions. For QR images we ALWAYS write
        //    a square canvas (max of w,h on both axes) so the source
        //    delivered to html2canvas has a square aspect ratio — then
        //    whatever object-fit / box-sizing html2canvas chooses to
        //    apply, the QR cells stay square.
        const outW = isQr ? Math.max(w, h) : w;
        const outH = isQr ? Math.max(w, h) : h;
        const drawX = isQr ? Math.floor((outW - w) / 2) : 0;
        const drawY = isQr ? Math.floor((outH - h) / 2) : 0;

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          dwarn(tag, alt, 'could not get 2d context — skipping re-encode');
          return;
        }
        // Paint the padding-area white for QR images so the canvas isn't
        // transparent on edges that don't get covered by drawImage.
        if (isQr) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, outW, outH);
        }
        ctx.drawImage(img, drawX, drawY, w, h);

        // 3. Re-encode as a vanilla browser-emitted PNG.
        //    toDataURL throws a SecurityError if the canvas was tainted
        //    by a cross-origin draw — that'd show up in the logs.
        let dataUrl: string;
        try {
          dataUrl = canvas.toDataURL('image/png');
        } catch (e) {
          derr(tag, alt, 'toDataURL threw (likely tainted-canvas SecurityError):', e);
          return;
        }
        if (!dataUrl || dataUrl === 'data:,') {
          dwarn(tag, alt, 'toDataURL returned empty');
          return;
        }
        dlog(tag, alt, 'new src prefix:', dataUrl.slice(0, 30), 'len:', dataUrl.length, 'outDims:', outW, 'x', outH);

        // 4. Swap src and await decode of the canvas-derived PNG.
        img.src = dataUrl;
        await Promise.race([
          img.decode(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('redecode timeout')), perImageTimeoutMs),
          ),
        ]);
        dlog(tag, alt, 'final:', 'w=', img.naturalWidth, 'h=', img.naturalHeight, isQr && img.naturalWidth === img.naturalHeight ? '(square OK)' : '');
      } catch (e) {
        derr(tag, alt, 'failure during re-encode:', e);
        /* graceful — keep original src */
      }
    }),
  );
  dlog('re-encode pass done');
}

export function useSaveDocAsImage(filenameBase: string) {
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (node: HTMLElement | null) => {
      if (!node) return;
      if (saving) return;
      setSaving(true);

      try {
        dlog('save start; capture node tag=', node.tagName, 'class=', node.className);

        // 1. Round-trip every <img> through a real canvas so the bytes
        //    become a vanilla browser-emitted PNG before the snapshot.
        //    Diagnostic logs cover whether each image is found,
        //    decoded, re-encoded, or silently dropped in try/catch.
        await reencodeImagesViaCanvas(node);

        // 2. html2canvas — direct DOM-walk into a real <canvas>. NO
        //    foreignObject. The QR's drawImage path is the same as
        //    the on-screen card uses, which is known to work.
        //
        //    A4 portrait at 96 DPI is 794 × 1123 px. We always pass at
        //    LEAST that to windowWidth/Height so html2canvas's iframe
        //    viewport doesn't shrink to the live phone viewport (~414
        //    px) and re-flow the doc through narrow-column layout.
        //    We also measure the live node's bounding rect (opacity:0
        //    elements still have layout) so a doc taller than A4 (many
        //    items / methods) gets enough vertical room.
        const A4_W = 794;
        const A4_H = 1123;
        const rect = node.getBoundingClientRect();
        const windowWidth = Math.max(Math.ceil(rect.width), A4_W);
        const windowHeight = Math.max(Math.ceil(rect.height), A4_H);
        dlog('html2canvas window:', windowWidth, 'x', windowHeight, '(node rect:', Math.ceil(rect.width), 'x', Math.ceil(rect.height), ')');

        const renderCanvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: '#ffffff',
          // html2canvas's own console output is verbose; rely on our
          // dlog tags instead.
          logging: false,
          // Data URIs have no origin so neither flag has an effect
          // for our payload, but useCORS:true is harmless and
          // useful if a remote <img> ever sneaks into the doc.
          useCORS: true,
          allowTaint: false,
          // Tell html2canvas's hidden iframe the viewport size to
          // simulate. Without this it defaults to the live window's
          // clientWidth which on phones is narrower than the A4 doc;
          // the doc would lay out compressed and text height would
          // miscount, producing clipped descenders.
          windowWidth,
          windowHeight,
          // Skip the on-screen Save/Print toolbar — equivalent to the
          // old html-to-image `filter` option. The .doc-page-a4 itself
          // contains no toolbar (toolbar lives in the on-screen card,
          // not the capture target), but the predicate is correct for
          // any future relocation.
          ignoreElements: (el: Element) =>
            el instanceof HTMLElement && el.dataset.captureSkip === 'true',
          // Mutate the cloned root before render so the renderer sees
          // a visible doc at its real A4 dimensions (the live source
          // is opacity:0 / position:fixed off-screen). Mutations here
          // affect only the clone in html2canvas's hidden iframe, NOT
          // the live DOM, so the user never sees the A4 doc flash on
          // screen.
          onclone: (_clonedDoc: Document, clonedNode: HTMLElement) => {
            try {
              clonedNode.style.opacity = '1';
              clonedNode.style.position = 'static';
              clonedNode.style.left = 'auto';
              clonedNode.style.top = 'auto';
              clonedNode.style.right = 'auto';
              clonedNode.style.bottom = 'auto';
              clonedNode.style.transform = 'none';
              clonedNode.style.pointerEvents = 'auto';
              // Pin the clone to A4 portrait dimensions so html2canvas
              // can't decide the box is narrower than intended and
              // collapse the layout. Width MUST match the source's
              // `width: 210mm` (= 794 px at 96 DPI) so the inner grid
              // / flex containers expand the way they do at full
              // width — the same way the print path sees them.
              clonedNode.style.width = '210mm';
              clonedNode.style.minHeight = '297mm';
              clonedNode.style.maxWidth = 'none';
              dlog('onclone: cloned root style overridden (width 210mm)');
            } catch (e) {
              derr('onclone failure:', e);
            }
          },
        });
        dlog(
          'html2canvas done; canvas size=',
          renderCanvas.width,
          'x',
          renderCanvas.height,
        );

        // 3. Real <canvas> → JPEG blob via canvas.toBlob.
        const blob = await new Promise<Blob | null>((resolve) =>
          renderCanvas.toBlob(resolve, 'image/jpeg', 0.95),
        );
        if (!blob) {
          derr('canvas.toBlob returned null');
          throw new Error('Failed to render image');
        }
        dlog('blob ready; size=', blob.size, 'bytes');

        const filename = `${filenameBase}.jpg`;
        const file = new File([blob], filename, { type: 'image/jpeg' });

        // 4. iOS / Android modern share sheet — best UX. `canShare`
        //    with files is the gate iOS requires.
        const nav = navigator as Navigator & {
          canShare?: (data: { files?: File[] }) => boolean;
        };
        if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            return;
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') return;
            dwarn('share failed, falling back to anchor download:', e);
          }
        }

        // 5. Desktop / Android browsers without file-share — anchor download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) {
        derr('save failed:', e);
        toast.error(e instanceof Error ? e.message : 'Could not save image');
      } finally {
        setSaving(false);
      }
    },
    [filenameBase, saving],
  );

  return { save, saving };
}
