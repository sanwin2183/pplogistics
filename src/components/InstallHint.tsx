import { useEffect, useState } from 'react';
import { Share, Plus, X } from 'lucide-react';
import { useStandalone, isIOSSafari } from '../lib/platform';

const DISMISS_KEY = 'pp-install-hint-dismissed';

/**
 * Subtle "Add to Home Screen" hint for iOS Safari visitors (iOS doesn't fire
 * the standard `beforeinstallprompt` event, so we coach the user manually).
 *
 * Renders nothing if:
 *  - already installed (standalone mode)
 *  - not iOS Safari
 *  - the user has dismissed it before
 *
 * Designed to be unobtrusive — small banner at the bottom, above the bottom nav.
 */
export function InstallHint() {
  const standalone = useStandalone();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (standalone) return;
    if (!isIOSSafari()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    // Defer slightly so it doesn't compete with first paint.
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [standalone]);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(4rem+var(--sa-bottom)+0.75rem)] z-50 mx-auto max-w-md animate-fade-in lg:bottom-3">
      <div className="pointer-events-auto card-soft flex items-center gap-3 bg-background/95 p-3 backdrop-blur">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Plus className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium text-foreground">Install PP Logistics</div>
          <div className="text-muted-foreground">
            Tap <Share className="inline h-3 w-3 align-text-bottom" /> then <span className="font-medium">Add to Home Screen</span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
