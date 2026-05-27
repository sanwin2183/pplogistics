# PP Logistics

A mobile-first web app for a hand-carry logistics business between **Bangkok ↔ Yangon / Mandalay**. Sell kg of luggage capacity from travellers (flyers) to customers (mostly online shop owners); manage inventory, orders, accounting, and a public per-order tracking page — no spreadsheets, no customer logins.

- **Admin:** Linear / Stripe-dashboard aesthetic — neutral palette, deep emerald accent, tabular money.
- **Public tracking page:** Apple-receipt / Stripe-checkout aesthetic — single column, mobile-first.

---

## Stack

| Layer | Tech |
|---|---|
| Build | Vite + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS + shadcn-style components (Radix primitives) |
| Routing | React Router v6 |
| State | Zustand (client) + TanStack Query v5 (server) |
| Forms | react-hook-form + zod |
| Charts | Recharts |
| Dates | Day.js |
| IDs | nanoid (10-char URL-safe slugs) |
| Backend | Firebase Auth, Firestore, Storage, Cloud Functions (Node 20, 2nd gen, `asia-southeast1`), Hosting |
| Money | `Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })` + `tabular-nums` |

---

## First-run setup

### 1. Install dependencies

```bash
# Project root
npm install

# Cloud Functions (separate package)
npm --prefix functions install
```

### 2. Add Firebase admin credentials

Download a service account JSON from
**Firebase Console → ⚙ Project settings → Service accounts → Generate new private key**
and save it as **`serviceAccount.json`** in the project root.

> This file is gitignored — never commit it. It holds full admin rights to your project.

### 3. Wire up your Firebase web config

The web config lives in `.env.local`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`.env.local` is gitignored. Use `.env.example` as a template for new machines.

### 4. Promote yourself to admin

Create your Auth user (any provider you've enabled, default is email/password) in the Firebase console, then:

```bash
npm run set-admin -- you@example.com
# or by UID:
npm run set-admin -- --uid=XmGs95p7sSb5L4zZVO9nxHThe6B3
```

Sign out and back in for the `role=admin` claim to take effect.

### 5. Seed defaults

```bash
npm run seed-categories   # Clothes, Electronics, Cosmetics, Documents, Food, Other
npm run seed-sample       # 1 customer + 1 flyer + 1 order so the dashboard isn't empty
```

### 6. Deploy security rules + functions

```bash
firebase deploy --only firestore:rules,storage,functions
```

### 7. Run locally

```bash
npm run dev
# → http://localhost:5173
```

---

## Deployment

```bash
npm run deploy            # build + hosting + functions + rules
npm run deploy:hosting    # just the web app
npm run deploy:functions  # just the callables
npm run deploy:rules      # just firestore + storage rules
```

Hosting URL after first deploy: `https://pp-logistics.web.app/`
(or your custom domain, configured in Firebase Hosting.)

Public tracking links look like:
`https://pp-logistics.web.app/t/aB3kZpQ9Rm`

---

## Project layout

```
src/
  components/ui/         # shadcn-style primitives
  components/            # shared (StatusBadge, MoneyDisplay, EmptyState, Spinner, AppLayout)
  features/
    dashboard/           # 4 stat cards + profit line + activity feed
    flyers/              # list / detail / form sheet
    customers/           # list / detail / form sheet
    categories/          # CRUD list + dialog
    orders/              # list / new / detail + status timeline
    settings/            # payment methods + business info + multilingual templates
    reports/             # date-range totals + breakdowns + CSV export
    tracking/            # PUBLIC /t/:slug — hero, timeline, payment, receipt
  hooks/                 # useAuth (provider)
  lib/                   # firebase, formatters, status, tracking slugs, activity log, utils
  routes/                # ProtectedRoute, Login
  types/                 # all Firestore-shaped TypeScript types
functions/               # Cloud Functions (Node 20, asia-southeast1)
  src/
    getTrackingOrder.ts  # public callable — returns sanitized PublicOrder
    submitPaymentProof.ts # public callable — attaches proof to order
scripts/
  setAdmin.ts            # promote UID/email to role=admin
  seedCategories.ts      # default categories
  seedSample.ts          # 1 sample customer + flyer + order
firestore.rules          # admin-only by default
storage.rules            # QR/branding public-read; payment-proofs write-only public, admin-read
firebase.json            # hosting + rules + functions + emulators config
```

---

## Data model (Firestore)

| Collection | Owner | Notes |
|---|---|---|
| `flyers/{id}` | admin | route, flightDate, kgAvailable, kgUsed (auto), ratePerKg, status |
| `customers/{id}` | admin | totalOrders / totalSpent / outstandingBalance — rolled up on order create/pay |
| `categories/{id}` | admin | defaultRatePerKg used to pre-fill new order items |
| `orders/{id}` | admin | items[], flyerAssignments[] (split allowed), statusHistory[], paymentProof, photos[] |
| `settings/app` | admin | { payment.methods[], business, templates } — single doc |
| `activity/{id}` | admin | dashboard feed |

Public reads of orders are denied at the rule level. The `/t/:slug` page calls the **`getTrackingOrder`** Cloud Function, which returns a sanitized `PublicOrder` — no payouts, profit, or flyer phone numbers leave the server.

---

## Order status flow

```
pending → received → with_flyer → in_transit → delivered → awaiting_payment → paid
                                                                ↑ ↓ reject
                                                    customer uploads proof
```

Status advances via buttons on the admin order detail page. Payment proof rejection returns the order to `awaiting_payment` and clears the proof.

---

## What's safe to share

- **`VITE_FIREBASE_*` web config values** — these are public identifiers. Security is enforced by Firestore/Storage rules + Auth claims.
- **`serviceAccount.json`** — **never share, never commit**. Full admin rights. Rotate immediately if it leaks (Firebase Console → Service accounts).

---

## Common tweaks

- **Change accent colour:** edit the `--primary` HSL in `src/index.css` and the `--ring` to match.
- **Change region:** Cloud Functions are pinned to `asia-southeast1` in `functions/src/*.ts` and the client constructor in `src/lib/firebase.ts`. Change both if you move regions.
- **Add a payment method type:** extend `PaymentMethodType` in `src/types/index.ts`, add an icon in `PaymentMethodsTab.tsx`, add a label in `PaymentSection.tsx`.
- **Tracking link domain:** set `VITE_PUBLIC_BASE_URL` in `.env.local` if your hosting domain differs from `window.location.origin`.

---

## Local emulator suite

If you want to develop offline:

```bash
firebase emulators:start
# Auth → http://localhost:9099
# Firestore → http://localhost:8080
# Storage → http://localhost:9199
# Functions → http://localhost:5001
# UI → http://localhost:4000
```

You'll need to point the client at the emulators — uncomment the `connectXxxEmulator` calls in `src/lib/firebase.ts` (currently not wired; add them under a `import.meta.env.DEV` check if/when you want them).
