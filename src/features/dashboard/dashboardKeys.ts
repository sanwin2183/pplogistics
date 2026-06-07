/**
 * Stable string keys for every customizable element on the dashboard.
 *
 * One key = one toggle in customize mode = one entry in the localStorage
 * visibility map. Renaming a key BREAKS the persisted preference for
 * users who had toggled that element. Don't rename casually — the
 * useDashboardPrefs reconciliation step assumes new (= unknown) keys
 * fall back to the default, so a rename will silently reset a user's
 * choice for that element back to its default.
 *
 * Add a new element by:
 *   1. Adding the key to DASHBOARD_KEYS (and the union below).
 *   2. Adding a label + group in DASHBOARD_LABELS.
 *   3. Adding an entry to DEFAULT_VISIBILITY (true if visible by default,
 *      false if niche/opt-in).
 *   4. Rendering the element inside <DashboardCard k="..."> in DashboardPage.
 */

export const DASHBOARD_KEYS = [
  // --- Hero stats (point-in-time / current state) ---
  'net_position',
  'outstanding_receivables',
  'owed_to_flyers',
  'active_orders',
  // --- Period stats (month-to-date for phase 1) ---
  'revenue',
  'gross_profit',
  'net_profit',
  'expenses_section',
  'orders_summary',
  // --- Charts ---
  'profit_trend',
  'revenue_cost_profit',
  'category_pie',
  'route_pie',
  // --- Lists ---
  'top_customers',
  'top_debtors',
  'activity',
] as const;

export type DashboardKey = (typeof DASHBOARD_KEYS)[number];

/** Default visibility on first load (no saved prefs). Per the spec:
 *  show hero financials + profit trend + revenue-by-category + top
 *  customers + activity; default-HIDE the niche ones (pieces count,
 *  rev/cost/profit, route pie, top debtors). */
export const DEFAULT_VISIBILITY: Record<DashboardKey, boolean> = {
  net_position: true,
  outstanding_receivables: true,
  owed_to_flyers: true,
  active_orders: true,
  revenue: true,
  gross_profit: true,
  net_profit: true,
  expenses_section: true,
  orders_summary: false,      // pieces count is niche (spec)
  profit_trend: true,
  revenue_cost_profit: false, // niche (spec)
  category_pie: true,
  route_pie: false,           // niche (spec)
  top_customers: true,
  top_debtors: false,         // niche (spec)
  activity: true,
};

/** Human-readable labels for the customize-mode toggle list. */
export const DASHBOARD_LABELS: Record<DashboardKey, string> = {
  net_position: 'Net position',
  outstanding_receivables: 'Outstanding receivables',
  owed_to_flyers: 'Owed to flyers',
  active_orders: 'Active orders',
  revenue: 'Revenue · this month',
  gross_profit: 'Gross profit · this month',
  net_profit: 'Net profit · this month',
  expenses_section: 'Expenses (this month)',
  orders_summary: 'Orders · kg · pieces',
  profit_trend: 'Profit trend · last 30 days',
  revenue_cost_profit: 'Revenue vs cost vs profit',
  category_pie: 'Revenue by category',
  route_pie: 'Revenue by route',
  top_customers: 'Top customers · this month',
  top_debtors: 'Top debtors',
  activity: 'Recent activity',
};
