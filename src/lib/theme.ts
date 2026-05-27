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
  return {
    primary: resolved === 'dark' ? 'hsl(173 65% 50%)' : 'hsl(173 80% 26%)',
    grid: resolved === 'dark' ? 'hsl(220 13% 20%)' : 'hsl(220 13% 91%)',
    axisText: resolved === 'dark' ? 'hsl(220 9% 65%)' : 'hsl(220 9% 46%)',
    tooltipBg: resolved === 'dark' ? 'hsl(220 14% 13%)' : 'hsl(0 0% 100%)',
    tooltipBorder: resolved === 'dark' ? 'hsl(220 13% 22%)' : 'hsl(220 13% 91%)',
    tooltipText: resolved === 'dark' ? 'hsl(220 13% 90%)' : 'hsl(220 14% 11%)',
  };
}
