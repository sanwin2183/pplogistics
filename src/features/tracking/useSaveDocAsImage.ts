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
 *   These are pre-converted to base64 data: URIs by useImageDataUris in
 *   the parent component (Invoice / Receipt), and the A4 capture target
 *   renders <img> from those data URIs. Result: the cloned subtree
 *   html-to-image serialises contains NO remote image references — every
 *   pixel is already inline. There is no cross-origin fetch at capture
 *   time, so the canvas can't taint and the toBlob can't fail on a
 *   cross-origin image. (We previously relied on crossOrigin="anonymous"
 *   + cacheBust:true to avoid the taint, but iOS Safari did not honour
 *   that reliably — toBlob threw "SecurityError" on tainted canvas.)
 *
 * Theme during capture:
 *   The capture target is always the off-screen `.doc-page-a4` element
 *   (see src/index.css), which hard-codes light-theme CSS variables on
 *   its own subtree. The cloned content therefore renders in light theme
 *   regardless of the user's preferred theme — no global <html>.dark
 *   toggle needed (which would briefly flicker the on-screen card during
 *   capture).
 */
export function useSaveDocAsImage(filenameBase: string) {
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (node: HTMLElement | null) => {
      if (!node) return;
      if (saving) return;
      setSaving(true);

      try {
        const blob = await toBlob(node, {
          pixelRatio: 2,
          backgroundColor: '#ffffff',
          // JPEG via the type hint; quality applies on encoders that honour it.
          // We deliberately keep type=image/jpeg because Photos on iOS treats
          // JPG as a first-class camera-roll citizen; PNG often imports as
          // "screenshot" and is heavier.
          type: 'image/jpeg',
          quality: 0.95,
          // Universal opt-out — any DOM node marked data-capture-skip is
          // excluded from the cloned subtree before serialization. Lets us
          // put on-screen action UI (Save / Print buttons) physically
          // INSIDE the print-doc card so they're visually anchored to the
          // invoice/receipt, without those buttons showing up in the saved
          // image. Returning false from filter skips the node + descendants.
          // (cacheBust:true was previously set to dodge cross-origin <img>
          // cache taint; with images pre-inlined as data: URIs the option
          // is now a no-op and was removed.)
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
