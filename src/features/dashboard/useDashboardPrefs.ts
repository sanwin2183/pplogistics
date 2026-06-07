import { create } from 'zustand';
import { DASHBOARD_KEYS, DEFAULT_VISIBILITY, type DashboardKey } from './dashboardKeys';
import {
  DEFAULT_RANGE,
  type DateRangeMode,
  type SelectedRange,
} from './dashboardRange';

/**
 * Persistent + ephemeral state for the dashboard.
 *
 * v1 (Phase 1): `{ version: 1, visibility }`. Persists only the
 *   show/hide map. Customize button toggles `editMode` in memory.
 *
 * v2 (Phase 2): `{ version: 2, visibility, selectedRange }`. Adds the
 *   time-range selector's persisted state. Migration is non-destructive
 *   — a v1 doc reads as { visibility (kept), range = DEFAULT_RANGE }
 *   and gets rewritten as v2 on the next toggle.
 *
 * editMode (transient — not persisted): a customize session is a task
 *   you finish, not a preference. Reloading the page exits edit mode.
 *
 * Reconciliation rule on read:
 *   - For each known visibility key, prefer stored value if it's a
 *     boolean, else fall back to DEFAULT_VISIBILITY.
 *   - For selectedRange, validate the mode against the union; require
 *     the right string shape for pickMonth / customFrom / customTo;
 *     anything malformed falls back to DEFAULT_RANGE.
 *
 * Failure modes are graceful (private mode, quota, malformed JSON,
 * unknown future version) — read returns full defaults, writes are
 * swallowed. The in-memory state still updates this session so the
 * UI feels responsive even when persistence is broken.
 */

const STORAGE_KEY = 'pp-dashboard-prefs';
const STORAGE_VERSION = 2;

type StoredV1 = {
  version: 1;
  visibility: Partial<Record<DashboardKey, boolean>>;
};

type StoredV2 = {
  version: 2;
  visibility: Partial<Record<DashboardKey, boolean>>;
  selectedRange: SelectedRange;
};

type StoredShape = StoredV1 | StoredV2;

const VALID_MODES: readonly DateRangeMode[] = [
  'lifetime',
  'this_month',
  'pick_month',
  'custom',
];

function isKnownKey(k: string): k is DashboardKey {
  return (DASHBOARD_KEYS as readonly string[]).includes(k);
}

function isValidMode(m: unknown): m is DateRangeMode {
  return typeof m === 'string' && (VALID_MODES as readonly string[]).includes(m);
}

function isYearMonthString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
}

function isIsoDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseRange(raw: unknown): SelectedRange {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RANGE };
  const r = raw as Record<string, unknown>;
  if (!isValidMode(r.mode)) return { ...DEFAULT_RANGE };
  const out: SelectedRange = { mode: r.mode };
  // Preserve every valid sub-field regardless of mode so the user's
  // typed-but-not-active values survive mode flips.
  if (isYearMonthString(r.pickMonth)) out.pickMonth = r.pickMonth;
  if (isIsoDateString(r.customFrom)) out.customFrom = r.customFrom;
  if (isIsoDateString(r.customTo)) out.customTo = r.customTo;
  return out;
}

interface ReadResult {
  visibility: Record<DashboardKey, boolean>;
  selectedRange: SelectedRange;
}

function readPrefs(): ReadResult {
  const fallback: ReadResult = {
    visibility: { ...DEFAULT_VISIBILITY },
    selectedRange: { ...DEFAULT_RANGE },
  };
  if (typeof window === 'undefined') return fallback;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;
  const p = parsed as StoredShape & Record<string, unknown>;
  // v1 and v2 are both accepted. Unknown future versions fall back to
  // defaults (safer than guessing schema).
  if (p.version !== 1 && p.version !== 2) return fallback;
  if (typeof p.visibility !== 'object' || p.visibility === null) return fallback;

  const visibility: Record<DashboardKey, boolean> = { ...DEFAULT_VISIBILITY };
  for (const [k, v] of Object.entries(p.visibility)) {
    if (isKnownKey(k) && typeof v === 'boolean') visibility[k] = v;
  }
  const selectedRange =
    p.version === 2 ? parseRange((p as StoredV2).selectedRange) : { ...DEFAULT_RANGE };
  return { visibility, selectedRange };
}

function writePrefs(visibility: Record<DashboardKey, boolean>, selectedRange: SelectedRange) {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredV2 = {
      version: STORAGE_VERSION,
      visibility,
      selectedRange,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage failure — swallow; in-memory state still reflects.
  }
}

interface DashboardPrefsStore {
  visible: Record<DashboardKey, boolean>;
  selectedRange: SelectedRange;
  editMode: boolean;
  isVisible: (k: DashboardKey) => boolean;
  toggle: (k: DashboardKey) => void;
  resetDefaults: () => void;
  setEditMode: (v: boolean) => void;
  setRange: (next: SelectedRange | ((prev: SelectedRange) => SelectedRange)) => void;
}

export const useDashboardPrefs = create<DashboardPrefsStore>((set, get) => {
  const initial = readPrefs();
  return {
    visible: initial.visibility,
    selectedRange: initial.selectedRange,
    editMode: false,
    isVisible: (k) => get().visible[k] ?? DEFAULT_VISIBILITY[k] ?? true,
    toggle: (k) =>
      set((state) => {
        const next = { ...state.visible, [k]: !state.visible[k] };
        writePrefs(next, state.selectedRange);
        return { visible: next };
      }),
    resetDefaults: () => {
      const next = { ...DEFAULT_VISIBILITY };
      writePrefs(next, get().selectedRange);
      set({ visible: next });
    },
    setEditMode: (v) => set({ editMode: v }),
    setRange: (next) =>
      set((state) => {
        const resolved =
          typeof next === 'function' ? next(state.selectedRange) : next;
        writePrefs(state.visible, resolved);
        return { selectedRange: resolved };
      }),
  };
});
