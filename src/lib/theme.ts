import { create } from 'zustand';

export type ThemePref = 'light' | 'dark' | 'auto';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'pp-theme';

function readPref(): ThemePref {
  if (typeof window === 'undefined') return 'auto';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(p: ThemePref): Resolved {
  if (p === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return p;
}

function apply(r: Resolved) {
  const root = document.documentElement;
  root.classList.toggle('dark', r === 'dark');
  // Keep <meta name="theme-color"> in sync so the mobile browser chrome matches.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', r === 'dark' ? '#0b1216' : '#0F766E');
}

interface ThemeStore {
  pref: ThemePref;
  resolved: Resolved;
  setPref: (p: ThemePref) => void;
  /** Wire the matchMedia listener once at app start. Returns a teardown. */
  init: () => () => void;
}

export const useTheme = create<ThemeStore>((set, get) => {
  const initialPref = readPref();
  const initialResolved = resolve(initialPref);
  return {
    pref: initialPref,
    resolved: initialResolved,
    setPref: (p) => {
      localStorage.setItem(STORAGE_KEY, p);
      const r = resolve(p);
      apply(r);
      set({ pref: p, resolved: r });
    },
    init: () => {
      // Apply once on boot (the inline script in index.html already set the class,
      // but this keeps the store and the DOM in sync if the script was bypassed).
      apply(get().resolved);
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (get().pref !== 'auto') return;
        const r = mql.matches ? 'dark' : 'light';
        apply(r);
        set({ resolved: r });
      };
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
  };
});

/** Theme-aware colour tokens for Recharts (which can't consume CSS variables natively). */
export function chartTokens(resolved: Resolved) {
  const dark = resolved === 'dark';
  return {
    primary: dark ? 'hsl(173 65% 50%)' : 'hsl(173 80% 26%)',
    grid: dark ? 'hsl(220 13% 20%)' : 'hsl(220 13% 91%)',
    axisText: dark ? 'hsl(220 9% 65%)' : 'hsl(220 9% 46%)',
    tooltipBg: dark ? 'hsl(220 14% 13%)' : 'hsl(0 0% 100%)',
    tooltipBorder: dark ? 'hsl(220 13% 22%)' : 'hsl(220 13% 91%)',
    tooltipText: dark ? 'hsl(220 13% 90%)' : 'hsl(220 14% 11%)',
    /**
     * Multi-series palette for pies, stacked bars, etc. Anchored on the
     * brand emerald (--primary) with hue rotation around the wheel
     * picking complementary mid-saturation tones. Each pair uses the
     * SAME hue across light/dark so the slice for "Clothes" stays
     * recognisably teal in both modes; only L (and slightly S) shift
     * to maintain contrast. Order is deliberate — most-used slices get
     * the highest-contrast (primary-adjacent) hues; less-used slices
     * fall back to muted tones that still read on a small mobile pie.
     *
     * Recharts cycles colours from this array via index — callers should
     * use `palette[i % palette.length]` so we never crash on >palette.length
     * categories.
     */
    palette: dark
      ? [
          'hsl(173 65% 55%)', // teal — brand
          'hsl(43 85% 60%)',  // amber
          'hsl(220 70% 65%)', // sky
          'hsl(330 65% 65%)', // rose
          'hsl(265 60% 70%)', // violet
          'hsl(15 75% 65%)',  // orange
          'hsl(140 50% 55%)', // green
          'hsl(195 65% 60%)', // cyan
        ]
      : [
          'hsl(173 75% 32%)',
          'hsl(38 90% 48%)',
          'hsl(220 75% 50%)',
          'hsl(335 70% 50%)',
          'hsl(265 60% 55%)',
          'hsl(15 80% 50%)',
          'hsl(142 60% 38%)',
          'hsl(195 75% 42%)',
        ],
    // Secondary tones for the revenue/cost/profit grouped chart so
    // cost and profit don't visually clash with the primary line.
    cost: dark ? 'hsl(15 75% 60%)' : 'hsl(15 80% 50%)',
    profit: dark ? 'hsl(140 50% 55%)' : 'hsl(142 60% 38%)',
  };
}
