import { useEffect, useMemo, useState } from 'react';

/**
 * Fetch remote images and expose them as base64 data: URIs, ready to be
 * dropped into an <img src> that the html-to-image capture + window.print
 * paths can render reliably.
 *
 * Why the dance:
 *   Firebase Storage URLs (the business logo + each payment method's QR)
 *   are cross-origin. We tried crossOrigin="anonymous" on the <img>, but
 *   on at least one iOS Safari version the html-to-image
 *   foreignObject->canvas pipeline still tainted the canvas and toBlob
 *   threw. A data: URI has NO origin — it's literally the bytes inline —
 *   so it cannot taint a canvas and cannot fail to load. By pre-converting
 *   every remote image the A4 capture document needs into data: URIs and
 *   rendering the doc's <img>s from those URIs, the capture + print paths
 *   become independent of CORS / iOS quirks.
 *
 * Cache:
 *   A module-level Map keyed by URL means the same image is only fetched
 *   once across the lifetime of the page — re-renders, component remounts,
 *   and even multiple components needing the same URL all share one
 *   in-flight promise. Rejected promises are evicted so a transient
 *   network failure can be retried by re-mounting the consumer.
 *
 * Fallback:
 *   Fetch failure (404, network drop, etc.) surfaces as
 *   status: 'error', dataUri: null on the result entry. The caller
 *   should render a small "image unavailable" message instead of a
 *   broken <img> — the save must NOT hard-fail just because one image
 *   wouldn't fetch.
 *
 * Gating:
 *   `allSettled(map, urls)` (helper exported below) tells callers when
 *   every URL has resolved one way or the other. Save / Print buttons
 *   should stay disabled until then so the captured / printed doc
 *   always has the inlined images ready.
 */

export type ImageDataUriStatus = 'loading' | 'ready' | 'error';

export interface ImageDataUriResult {
  status: ImageDataUriStatus;
  /** Populated when status === 'ready'. */
  dataUri: string | null;
}

/** Module-level cache. Keyed by absolute URL. Promise resolves to data URI. */
const cache = new Map<string, Promise<string>>();

async function fetchAsDataUri(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    // mode: 'cors' is the default for fetch() against another origin;
    // credentials: 'omit' avoids sending any cookies that would defeat
    // Firebase Storage's ACAO:* (which only applies to credential-less
    // requests).
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) throw new Error(`Image fetch ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  })();
  cache.set(url, promise);
  // Evict failed promises so the next mount can retry rather than
  // perpetually serving the same error.
  promise.catch(() => {
    if (cache.get(url) === promise) cache.delete(url);
  });
  return promise;
}

/**
 * React hook: given a list of remote image URLs, return a Record keyed by
 * URL describing each image's load state. Re-fetches when the URL list
 * changes (compared by content via newline-join — newlines are illegal
 * in URLs, so the join is collision-free).
 */
export function useImageDataUris(
  urls: ReadonlyArray<string | null | undefined>,
): Record<string, ImageDataUriResult> {
  // Stable key for effect dep + memo. Newline separator because newlines
  // are illegal in URLs (RFC 3986) — collision-free.
  const key = useMemo(() => urls.map((u) => u ?? '').join('\n'), [urls]);
  const [map, setMap] = useState<Record<string, ImageDataUriResult>>({});

  useEffect(() => {
    let cancelled = false;
    const list = key.split('\n').filter((u) => u.length > 0);

    // Initialise loading state for any URL we haven't yet seen.
    setMap((prev) => {
      let next = prev;
      for (const u of list) {
        if (next[u]) continue;
        if (next === prev) next = { ...prev };
        next[u] = { status: 'loading', dataUri: null };
      }
      return next;
    });

    for (const u of list) {
      fetchAsDataUri(u)
        .then((dataUri) => {
          if (cancelled) return;
          setMap((prev) => ({ ...prev, [u]: { status: 'ready', dataUri } }));
        })
        .catch((err) => {
          if (cancelled) return;
          // eslint-disable-next-line no-console
          console.warn('[useImageDataUris] fetch failed', u, err);
          setMap((prev) => ({ ...prev, [u]: { status: 'error', dataUri: null } }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}

/**
 * Helper for the gating predicate: every URL has resolved either to
 * `ready` or `error` (i.e. nothing is still `loading`). Missing URLs
 * (passed null/undefined) trivially count as settled.
 */
export function allImagesSettled(
  map: Record<string, ImageDataUriResult>,
  urls: ReadonlyArray<string | null | undefined>,
): boolean {
  return urls.every((u) => {
    if (!u) return true;
    const r = map[u];
    // Undefined (not yet in the map) counts as still-loading because the
    // effect hasn't run for this URL yet.
    return r !== undefined && r.status !== 'loading';
  });
}
