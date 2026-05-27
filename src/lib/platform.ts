import { useEffect, useState } from 'react';

/** Is the app running as an installed PWA (home-screen launch on iOS / Android)? */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState<boolean>(() => detect());

  useEffect(() => {
    const mql = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setStandalone(detect());
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return standalone;
}

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS: legacy non-standard property; Android+desktop: matchMedia
  // The cast is to a narrow shape — we don't want the whole Navigator surface here.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  const mqlStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return iosStandalone || mqlStandalone;
}

/** Detect iOS Safari (for "Add to Home Screen" hint). Heuristic but reliable enough. */
export function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}
