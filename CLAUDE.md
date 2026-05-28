# PP Logistics — Project Handover Brief

> Read this top-to-bottom on your first session with this repo. It exists so
> any developer (or Claude Code session) can pick up work without re-deriving
> what was already decided, learned, or sunk-cost discovered.

---

## 1. What this app is

A mobile-first web app for a small hand-carry logistics business between
**Bangkok ↔ Yangon / Mandalay**. The owner sells kilograms of luggage
capacity from travelers ("**flyers**") to customers (mostly online shop
owners). The app replaces the spreadsheets she was using for inventory,
orders, accounting, and customer comms.

There are exactly **two user surfaces**:

| Surface | Who | Auth | URL pattern |
|---|---|---|---|
| **Admin app** | The owner (+ optional staff) | Firebase Auth, email/password, `role=admin` custom claim | `/` (everything except `/t/:slug`) |
| **Public tracking page** | Customers | None — link is the auth | `/t/:slug` (10-char nanoid slug) |

Customers do NOT log in. They receive a link by Telegram/LINE/SMS and use it
to see their order's status, complete payment, and view the receipt.

## 2. Live deployment

| Thing | Value |
|---|---|
| Firebase project ID | `pp-logistics` |
| Region (Functions + Firestore + Storage) | `asia-southeast1` (Singapore) |
| Firestore database name | **`default`** (literal — NOT `(default)`. See §10 gotcha #1.) |
| Hosting URL (default) | https://pp-logistics.web.app |
| Custom domain | `ppl.sanwin.asia` (registered via Namecheap) |
| Custom domain status | DNS verified in our terminal; Firebase verifier auto-detect occasionally takes ~1 h on `.asia` TLDs |
| GitHub repo | https://github.com/sanwin2183/pplogistics |
| Admin user | `mi.poe192@gmail.com` (UID `XmGs95p7sSb5L4zZVO9nxHThe6B3`) |
| Sample tracking link | https://pp-logistics.web.app/t/va8J2nHnrH |

## 3. Tech stack (and why each was chosen)

| Layer | Choice | Notes |
|---|---|---|
| Build | **Vite 8 + React 19 + TypeScript strict** | `verbatimModuleSyntax`, `erasableSyntaxOnly` — see §6 |
| Styling | **Tailwind 3 + shadcn-style components on Radix** | All components hand-rolled in `src/components/ui/*` (no shadcn CLI used) |
| Routing | **React Router v6** | One root route file at `src/App.tsx` |
| Server state | **TanStack Query v5** | All Firestore reads/writes go through hooks under `features/*/use<X>.ts` |
| Client state | **Zustand** | Used for theme; could host more if needed |
| Forms | **react-hook-form + zod** (`@hookform/resolvers/zod`) | Schema-first validation |
| Charts | **Recharts** | Chart colours come from `chartTokens(resolved)` in `src/lib/theme.ts` so they adapt to dark mode |
| Dates | **Day.js** + `relativeTime`, `customParseFormat` | Don't introduce Luxon/Moment |
| IDs | **nanoid** (`customAlphabet`) | 10-char URL-safe slugs, no `0`/`O`/`1`/`l`/`I` |
| Currency | `Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })` | Always paired with `tabular-nums` class for alignment |
| Backend | **Firebase**: Auth, Firestore, Storage, Cloud Functions v2 (Node 20), Hosting | Single project; Blaze plan required for Functions |
| PWA | **vite-plugin-pwa** (workbox autoUpdate) | Offline app shell; FOUC-safe theme via inline `<script>` in `index.html` |
| Toasts | **sonner** | `<Toaster theme={resolved}>` in `main.tsx` |

## 4. Repository layout

```
pplogistics/
├── CLAUDE.md                       # ← you're reading this
├── README.md                       # Setup-from-scratch oriented (for humans)
├── index.html                      # FOUC-safe theme script, iOS meta tags
├── package.json                    # See "scripts" map below
├── vite.config.ts                  # PWA plugin config
├── tailwind.config.js              # CSS-var-driven palette, plus tailwindcss-animate
├── tsconfig.{json,app,node}.json   # Strict + verbatimModuleSyntax + erasableSyntaxOnly
├── firebase.json                   # Hosting + Firestore (database: "default") + Storage + Functions
├── firestore.rules                 # Admin-only direct access (see §11)
├── firestore.indexes.json          # Composite indexes for queries
├── storage.rules                   # QR/branding public-read; payment-proofs public-create
├── .firebaserc                     # { "default": "pp-logistics" }
├── .env.example                    # VITE_FIREBASE_* template
├── .env.local                      # Real config (gitignored)
├── service_accounts/               # Admin SDK JSON (gitignored)
│   └── pp-logistics-firebase-adminsdk-*.json
├── public/                         # PWA icons, favicon, apple-touch-icon
│   ├── favicon.svg
│   ├── icon.svg                    # Manifest icon (any)
│   ├── icon-maskable.svg           # Manifest icon (maskable, Android adaptive)
│   └── apple-touch-icon.svg        # iOS home-screen icon
├── src/
│   ├── main.tsx                    # Providers (Router, QueryClient, AuthProvider, Toaster, ThemeInit)
│   ├── App.tsx                     # All routes
│   ├── index.css                   # Tailwind + light/dark CSS vars + safe-area utilities
│   ├── types/
│   │   └── index.ts                # All Firestore-shaped TS types + PublicOrder
│   ├── lib/
│   │   ├── firebase.ts             # Client SDK init, exports auth/db/storage/functions
│   │   ├── theme.ts                # Zustand store for theme + chartTokens()
│   │   ├── platform.ts             # useStandalone() + isIOSSafari()
│   │   ├── formatters.ts           # fmtMoney, fmtKg, fmtDate, toDate
│   │   ├── status.ts               # All status constants + nextOrderStatus()
│   │   ├── tracking.ts             # newTrackingSlug, newOrderNumber, trackingUrl
│   │   ├── activity.ts             # logActivity() — fire-and-forget
│   │   ├── queries.ts              # fetchDoc, fetchCol, where, orderBy, limit helpers
│   │   └── utils.ts                # cn() = twMerge(clsx())
│   ├── hooks/
│   │   └── useAuth.tsx             # AuthProvider + useAuth()
│   ├── routes/
│   │   ├── ProtectedRoute.tsx      # Gates /admin/* on isAdmin claim
│   │   └── Login.tsx
│   ├── components/
│   │   ├── ui/                     # Hand-rolled shadcn-style primitives (button, dialog, sheet, …)
│   │   ├── AppLayout.tsx           # Mobile bottom-nav + desktop sidebar shell
│   │   ├── StatusBadge.tsx
│   │   ├── MoneyDisplay.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Spinner.tsx
│   │   ├── ThemeToggle.tsx
│   │   └── InstallHint.tsx         # iOS "Add to Home Screen" banner
│   └── features/
│       ├── dashboard/              # 4 stat cards, profit chart, activity feed
│       ├── orders/                 # List, new-order form, detail with status actions, OrderStatusTimeline
│       ├── flyers/                 # List, detail, sheet form
│       ├── customers/              # List, detail, sheet form
│       ├── categories/             # CRUD dialog list
│       ├── settings/               # Payment methods tab, business info tab, templates tab
│       ├── reports/                # Date-range totals + breakdowns + CSV export
│       └── tracking/               # PUBLIC /t/:slug — TrackingPage, PaymentSection, Receipt
├── functions/                      # Cloud Functions, deployed separately
│   ├── package.json                # Has its own node_modules
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                # initializeApp() + re-exports
│       ├── getTrackingOrder.ts     # Public callable → sanitized PublicOrder
│       └── submitPaymentProof.ts   # Public callable → attaches proof URL to order
└── scripts/
    ├── _initAdmin.ts               # Shared service-account loader (multi-location)
    ├── setAdmin.ts                 # Grant role=admin custom claim
    ├── seedCategories.ts           # Clothes, Electronics, Cosmetics, Documents, Food, Liquids, Other
    ├── seedSample.ts               # Settings + 1 customer + 1 flyer + 1 order
    └── printTrackingLinks.ts       # List all live order tracking URLs
```

## 5. Data model (Firestore)

All collections live at the root of the database named `default`. Subcollections
were deliberately avoided for query simplicity.

| Collection | Shape (TS types in `src/types/index.ts`) | Key constraints |
|---|---|---|
| `flyers/{id}` | `Flyer` | `route` ∈ `BKK→YGN \| BKK→MDL \| YGN→BKK \| MDL→BKK`. `kgUsed` is a derived rollup — updated by the order-create transaction. |
| `customers/{id}` | `Customer` | Has rollups `totalOrders`, `totalSpent`, `outstandingBalance` — also updated in transactions on order create + payment approval. |
| `categories/{id}` | `Category` | `defaultRatePerKg` pre-fills new order items. |
| `orders/{id}` | `Order` | `trackingSlug` is unique (10-char nanoid). `flyerAssignments[]` allows splitting one order across multiple flyers. `statusHistory[]` is an append-only audit trail. |
| `settings/app` | `AppSettings` | Single doc. Contains `payment.methods[]`, `business`, `templates` (en/th/my). |
| `activity/{id}` | `ActivityEntry` | Dashboard feed; written best-effort by `lib/activity.ts`. |

### Order status flow

```
pending → received → with_flyer → in_transit → delivered → awaiting_payment → paid
                                                                  ↑↓ reject (clears proof,
                                                                            stays awaiting)
```

- The status-advance buttons live in `src/features/orders/OrderDetailPage.tsx`.
- The state machine is encoded as a lookup in `src/lib/status.ts → nextOrderStatus()`.
- `delivered` automatically advances to `awaiting_payment` via the button labelled "Request Payment".
- On `paid`, the customer's `outstandingBalance` decreases and `totalSpent` increases via a transaction inside `useUpdateOrderStatus`.

### Status colour tokens

Each status has a pair of CSS variables (`--status-<name>` + `--status-<name>-fg`) defined in `src/index.css` for both light and dark mode, exposed via Tailwind as `bg-status-<name>` / `text-status-<name>-fg`. Add a new status by extending all three: the TS union in `types/index.ts`, the `STATUS_*` maps in `lib/status.ts`, and the two `--status-*` variable pairs in `index.css`.

## 6. TypeScript conventions

The `tsconfig.app.json` has some strict flags that affect day-to-day work:

| Flag | Effect | Means you have to… |
|---|---|---|
| `verbatimModuleSyntax: true` | Type-only imports MUST be marked | `import type { Foo } from '...'` for types, plain `import` for runtime |
| `erasableSyntaxOnly: true` | No `enum`, `namespace`, parameter properties | Use `const` + union types instead of enums |
| `noUnusedLocals: true` | Unused locals fail the build | Remove or prefix with `_` |
| `noUnusedParameters: true` | Same for params | Same |
| `noFallthroughCasesInSwitch: true` | Switch cases must `break`/`return` | Standard practice |

There is **no path aliasing** configured. Use relative imports (`../../lib/foo`). If you add aliases, update both `tsconfig.app.json` paths and `vite.config.ts` resolve aliases.

## 7. Styling conventions

- **All colour comes from CSS variables**, never hex literals in components. The light/dark palettes live in `src/index.css` under `:root` and `.dark`. Tailwind maps them in `tailwind.config.js`.
- **Accent colour**: deep emerald `#0F766E` (light) / brighter emerald `hsl(173 65% 50%)` (dark). Defined as `--primary` / `--ring`.
- **Cards** use the `card-soft` class (rounded-xl + bg-card + soft shadow). Don't roll your own.
- **Money** always wraps in `<MoneyDisplay>` or uses `fmtMoney()` + `tabular-nums` class.
- **Status pills** use the `status-pill` class + `bg-status-<name>` + `text-status-<name>-fg`.
- **No gradients anywhere** except the tracking-page hero (`.tracking-hero` class).
- **Mobile breakpoint** is `lg:` (1024px). Anything below is treated as mobile (bottom nav, single column, etc.).
- **Safe-area insets**: use the `pt-safe` / `pb-safe` / `px-safe` utilities defined in `src/index.css`. For arbitrary values: `bottom-[calc(4rem+var(--sa-bottom))]`.

## 8. Data hook pattern

Every feature owns its own data hooks under `features/<feature>/use<Feature>.ts`. Example pattern:

```ts
// features/customers/useCustomers.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchCol, orderBy } from '../../lib/queries';
import type { Customer } from '../../types';

const KEY = ['customers'] as const;

export function useCustomers() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => fetchCol<Customer>('customers', orderBy('name', 'asc')),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Customer, 'id' | ...>) => { /* addDoc */ },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
```

- Query keys are short tuples (`['customers']`, `['orders', id]`).
- `fetchCol<T>` and `fetchDoc<T>` in `lib/queries.ts` return docs with `id` merged in.
- Mutations always invalidate the relevant key on success.
- For derived rollups (customer.totalSpent, flyer.kgUsed) we use Firestore transactions inside the mutation.

## 9. Theme system

The theme has three states tracked in `src/lib/theme.ts` (Zustand):

```ts
pref: 'light' | 'dark' | 'auto'         // user's choice, persisted in localStorage as 'pp-theme'
resolved: 'light' | 'dark'              // what's actually applied (auto resolves via matchMedia)
```

- **FOUC prevention**: inline `<script>` in `index.html` reads localStorage and sets `<html class="dark">` BEFORE styles parse.
- **Live system changes** in `auto` mode: `init()` wires a `matchMedia('(prefers-color-scheme: dark)')` listener.
- **Charts**: Recharts can't read CSS vars, so use `chartTokens(resolved)` to get matching colours for grid/axis/line/tooltip.
- **Toasts**: `<Toaster theme={resolved}>` in `main.tsx`.
- **Print**: `@media print` in `index.css` overrides the dark vars back to light so receipts print cleanly regardless of theme.

## 10. Firebase quirks we hit (and the fixes)

These are the ones that wasted hours; document them so they don't again.

### Quirk 1: Firestore database is named `default`, not `(default)`

When the project was created the database was set up with the literal ID `default`. The Firebase SDK's implicit default is `(default)` (with parens), so calls like `getFirestore(app)` fail with `5 NOT_FOUND`.

**Workaround applied everywhere:**

```ts
// Client SDK:
export const FIRESTORE_DB_ID = 'default';
export const db = getFirestore(app, FIRESTORE_DB_ID);

// Admin SDK (functions + scripts):
const DB_ID = 'default';
const db = getFirestore(getApp(), DB_ID);
```

`firebase.json` also pins this:

```json
"firestore": { "database": "default", "rules": "...", "indexes": "..." }
```

`firebase deploy --only firestore` uses this name. Do NOT pass `--only firestore:rules` without the `:default` suffix — that path targets `(default)` and fails.

### Quirk 2: Cloud Functions v2 callables default to private at Cloud Run

`firebase deploy` of an `onCall` function returns success, but anonymous requests get `403 Forbidden` from Cloud Run before the function code ever runs. The fix:

```ts
export const myFn = onCall(
  { region: 'asia-southeast1', cors: true, invoker: 'public', maxInstances: 10 },
  async (req) => { /* ... */ },
);
```

**BUT** — Firebase CLI does NOT re-bind IAM on `update` operations. So if a function was already deployed without `invoker: 'public'`, adding the option and redeploying changes nothing.

**To force re-binding:**

```powershell
firebase functions:delete getTrackingOrder submitPaymentProof --region asia-southeast1 --project pp-logistics --force
firebase deploy --only functions --project pp-logistics
```

Now both functions return `invoker: 'public'` was applied because Firebase saw them as fresh creates.

### Quirk 3: Custom domain verifier has stale negative-cache for ~1h on `.asia`

When you add a new domain in Firebase Hosting and the DNS isn't ready yet, Firebase's verifier caches the "no record" answer for up to 3600s (the SOA negative TTL). Even after the record is correct, the verifier keeps reporting "Records not yet detected" until that cache expires.

**Mitigations:**
- Don't keep clicking Verify (it doesn't help and may keep the cache warm).
- After fixing DNS, wait ~50–60 min and Firebase auto-detects.
- If the Quick Setup CNAME path stays stuck, switch to **Advanced setup** (two TXT records: `hosting-site=<siteId>` and an ACME challenge). Different code path on Firebase's side, usually unblocks `.asia` / `.io` / `.dev` TLDs.

### Quirk 4: Namecheap host fields auto-append the root domain

When adding a record where Firebase says the FQDN is `_acme-challenge.ppl.sanwin.asia`, on Namecheap you must enter ONLY `_acme-challenge.ppl` in the Host field. If you type the full FQDN, Namecheap creates the record at `_acme-challenge.ppl.sanwin.asia.sanwin.asia` (double-appended) and Firebase can't find it.

### Quirk 5: PWA service worker can serve stale bundles

`vite-plugin-pwa` is configured with `registerType: 'autoUpdate'`. The new SW activates on the next page load *after* it finishes installing. For users with the PWA installed to their home screen, this means **they have to fully close and reopen the app** (not just background it) to pick up a deploy.

This is also why dev mode disables the SW (`devOptions.enabled: false`) — otherwise it would serve stale code during local edits.

## 11. Security model

### Firestore rules (`firestore.rules`)

- All collections — admin-only direct access via `request.auth.token.role == 'admin'` custom claim.
- Public clients CANNOT read orders directly. They go through `getTrackingOrder` Cloud Function which uses Admin SDK and returns a sanitized object.
- Public clients CANNOT write proofs directly. They go through `submitPaymentProof` Cloud Function which validates the input.

### Storage rules (`storage.rules`)

- `qrcodes/*`, `branding/*` — public-read, admin-write (so tracking page can show QR images without auth).
- `orders/{orderId}/photos/*` — admin-only.
- `payment-proofs/{slug}/*` — anyone can `create` (validated by mime + size); admin-only read/update/delete.

### Sanitization rules (public tracking)

The `getTrackingOrder` function returns a `PublicOrder` (defined in `src/types/index.ts`) that NEVER includes:

- `flyerAssignments[].payoutRatePerKg`
- `flyerAssignments[].payoutAmount`
- `flyerAssignments[].paidOutAt`
- `totalPayout`
- `profit`
- flyer phone, full name, or any flyer fields beyond firstName/flightDate/route
- customer phone, full name (only first name returned)
- order notes (internal)
- The image URL of payment proof (only `uploadedAt` + `note`)

The function is the trust boundary. If you add a new field to `Order`, decide whether it's public and update the sanitizer accordingly.

## 12. NPM scripts (`package.json`)

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server at http://localhost:5173 |
| `npm run build` | `tsc -b && vite build` — strict typecheck then bundle |
| `npm run preview` | Serve the production build locally at :4173 (good for PWA testing) |
| `npm run lint` | `eslint .` |
| `npm run set-admin -- --uid=<uid>` (or `-- <email>`) | Grant `role=admin` claim |
| `npm run seed-categories` | Idempotent default category seed |
| `npm run seed-sample` | Sample customer + flyer + order + settings doc |
| `npm run tracking-links` | Print all live tracking URLs |
| `npm run deploy` | Build + deploy hosting + rules + functions |
| `npm run deploy:hosting` | Build + push web only |
| `npm run deploy:rules` | Push Firestore + Storage rules only |
| `npm run deploy:functions` | Push Cloud Functions only |
| `npm run emulators` | Start the local emulator suite |

For Functions specifically:

| Command | What it does |
|---|---|
| `npm --prefix functions run build` | Compile functions TS to `functions/lib/` |
| `npm --prefix functions install` | Install function deps (separate package) |

## 13. Where credentials live

> **None of these files are committed.** All are gitignored.

| File | Purpose |
|---|---|
| `.env.local` | `VITE_FIREBASE_*` web config values + `VITE_PUBLIC_BASE_URL` |
| `service_accounts/pp-logistics-firebase-adminsdk-*.json` | Admin SDK private key for scripts |

The script loader (`scripts/_initAdmin.ts`) auto-discovers the service-account JSON in any of these locations, in order:

1. `$GOOGLE_APPLICATION_CREDENTIALS` env var (if set and file exists)
2. `<root>/serviceAccount.json`
3. `<root>/service-account.json`
4. `<root>/service_accounts/*.json` (any JSON in that dir)
5. `<root>/service-accounts/*.json`
6. `<root>/*-firebase-adminsdk-*.json` (Firebase's default download filename)

## 14. The `VITE_PUBLIC_BASE_URL` env var

This controls what URL the admin app's "Copy tracking link" buttons produce.

- **Empty (current setting)** → uses `window.location.origin`, so the link matches whatever URL the admin is currently on. This means once `ppl.sanwin.asia` goes live, links automatically use it without a rebuild.
- **Explicitly set** (e.g. `https://ppl.sanwin.asia`) → always uses that URL no matter where admin is viewing from. Useful if you want to force a canonical URL for customer-facing links during dev.

## 15. Adding a new feature (mental checklist)

If you're adding, say, a "vehicles" collection alongside flyers/customers, the
pattern is:

1. **Type**: Add the `Vehicle` interface in `src/types/index.ts`.
2. **Hooks**: Create `src/features/vehicles/useVehicles.ts` modeled on `useCustomers.ts`. Query key, CRUD mutations.
3. **List page**: `VehiclesListPage.tsx`. Use `<EmptyState>` for zero-state.
4. **Form**: A bottom sheet (`Sheet side="bottom"`) on mobile, like `CustomerFormSheet.tsx`.
5. **Detail page** (optional): Same pattern as `CustomerDetailPage.tsx`.
6. **Route**: Add `<Route path="vehicles" element={<VehiclesListPage />} />` in `App.tsx`.
7. **Nav**: Add to the `nav` array in `AppLayout.tsx`. Decide whether it goes in the mobile bottom nav (5 items max).
8. **Rules**: Add a `match /vehicles/{id} { allow read, write: if isAdmin(); }` block in `firestore.rules`. Deploy.
9. **Index** (if filtered queries): Add to `firestore.indexes.json`. Deploy.

## 16. Adding a new public surface

If you ever want to expose more to the public (rare), follow these rules:

1. Public surfaces NEVER read Firestore directly. They call a Cloud Function.
2. The function uses Admin SDK to read, then strips sensitive fields before returning.
3. The function gets `invoker: 'public'` in its `onCall` options (see Quirk 2).
4. The route in `App.tsx` is added OUTSIDE the `<ProtectedRoute>` wrapper.

## 17. Common debugging recipes

### "Function returns 403 Forbidden"
The function's Cloud Run service is private. Either it was deployed without `invoker: 'public'`, OR it was updated (not re-created) after adding the option. Fix: delete the function and redeploy. See Quirk 2.

### "Firestore read fails with 5 NOT_FOUND"
You used `getFirestore()` without the named-database argument. The project's primary DB is `default` (not `(default)`). Pass it explicitly. See Quirk 1.

### "Order create button does nothing"
react-hook-form's silent validation. The form has invalid rows but no error message rendered. Check `errors` in the React DevTools or look at the new `onInvalid` toast — which exists since commit `d5fa454`. If you see it again on a NEW field, add it to the inline-error renderer in `OrderFormPage.tsx`.

### "Custom domain stuck on 'Records not yet detected'"
DNS negative cache. Wait ~60 min from when the records were first added correctly, or switch to Advanced setup (TXT-based verification). See Quirk 3.

### "PWA still shows old UI after deploy"
SW autoUpdate activates on next launch. Fully close and reopen the installed PWA. If still stale, clear the SW from the browser's DevTools → Application → Service workers.

### "Local dev not picking up env changes"
Restart `npm run dev`. Vite caches `.env.local` at server startup.

### "Function logs"
```powershell
firebase functions:log --only <fnName> --project pp-logistics --lines 50
```

### "Test a callable function from the terminal"
PowerShell quoting is unreliable. Use a temp file:
```powershell
$body = '{"data":{"slug":"va8J2nHnrH"}}'
$tmp = New-TemporaryFile
Set-Content -Path $tmp.FullName -Value $body -Encoding utf8 -NoNewline
curl.exe -s -X POST -H "Content-Type: application/json" "https://asia-southeast1-pp-logistics.cloudfunctions.net/getTrackingOrder" --data "@$($tmp.FullName)"
Remove-Item $tmp.FullName
```

## 18. Known future work / open items

| Item | Severity | Notes |
|---|---|---|
| Bundle size 1.45 MB (417 KB gzip) | Low | Could code-split by route. Not blocking. |
| Node 20 runtime deprecation | Med (deadline 2026-10-30) | Migrate `functions/package.json` engines + `firebase.json` runtime to `nodejs22` |
| Dashboard kg-by-route chart shows "by status" instead | Cosmetic | Needs flyer join (Reports page does it right) |
| Order editing post-creation | Intentional out-of-scope | Cancel + recreate. If you change this, also expose an "Edit" button and pre-fill the form. |
| `firebase-functions` v6.1.1 → newer | Low | Has breaking changes; do during a maintenance window. |
| iOS-style large title nav bar with scroll-collapse | Polish | Current header is fine but could be more native. |

## 19. Things that look weird but are intentional

- **No `import.meta.env.DEV` emulator wiring** — emulators are configured in `firebase.json` but the client doesn't `connectXxxEmulator()` automatically. Add it manually when you want offline dev.
- **`getTrackingOrder` returns the payment-proof `uploadedAt` + `note` but NOT the image URL.** This is intentional — the proof image is admin-only. The tracking page shows "Payment received, awaiting confirmation" with a timestamp but no thumbnail.
- **`flyerAssignments[].weightKg` can sum to LESS than `totalWeightKg`** — partial assignment is allowed (you might assign some kg to a flyer and figure out the rest later). The form validates only that flyer kg ≤ item kg.
- **`useStandalone()` returns false during SSR** but we don't SSR, so this is fine.
- **`OrderFormPage` calls `useFieldArray` for items + assignments** — don't replace with plain state, RHF needs it for proper key tracking.
- **`MoneyDisplay` accepts negatives** and tints them with `text-destructive` when `signed` is true. Used in the "Payout" line of the profit preview.
- **`apple-mobile-web-app-status-bar-style` is `black`, not `default` and not `black-translucent`** (index.html). The owner explicitly wanted the admin app bar to be the same compact `--appbar-h` (48 px) height in the installed standalone PWA as in mobile Safari, AND the owner runs the installed PWA in dark mode. Both `default` and `black` make iOS render the status bar in standalone as a separate opaque region above the WebView, so `env(safe-area-inset-top)` collapses to 0 and `pt-safe` on the `<header>` adds nothing — the bar is 48 px in both contexts. We pick `black` because it paints the status bar opaque black with white clock/battery icons, blending into the dark app header; `default` would render a light status bar above the dark app and look jarring. Tradeoff: we lose the "translucent glass under the Dynamic Island" edge-to-edge look that `black-translucent` provides. **Do not switch back to `black-translucent`** (would reintroduce the ~59 px safe-area "hat" on the bar); **do not switch to `default`** (would render a light strip above the dark app). `viewport-fit=cover` stays (the bottom nav's `pb-safe` for the home indicator still needs it). The status bar style is global — iOS web-app meta tags don't support per-theme values, so if the owner ever flips the installed PWA to light mode, the black status bar will sit above a light header. That's an iOS limitation; the dark-mode optimisation wins because that's what the owner actually uses.

## 20. Style for git commits

We don't have strict conventional-commits, but commits in this repo follow this loose form:

```
<short imperative subject under ~70 chars>

<optional body explaining WHY and WHAT changed, wrapped at ~78 chars>

<optional bullets for multi-part changes>
```

Examples in history: `c02eee5`, `d5fa454`, `f09a0c4`.

## 21. Out-of-band communication / shared assumptions

- The owner runs this on her phone primarily (installed as PWA on iPhone 17 Pro Max). Desktop usage is secondary.
- Customers are roughly half Thai, half Burmese — multilingual templates matter.
- The "kg of capacity" business model is unusual; flyers are paid per kg they carry (not a flat fee per flight).
- All currency in the app is **THB**. Burmese kyat conversion is not in scope.
- The owner uses Telegram / LINE to send tracking links — not email or SMS. The Copy-Message dropdown produces text for those platforms.

---

*Last updated by the previous session: hand-off after the Cloud Functions IAM fix (commit `f09a0c4`). Custom domain `ppl.sanwin.asia` verification was the last item still in flight at handoff.*
