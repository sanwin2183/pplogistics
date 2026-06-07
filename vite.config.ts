import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.svg'],
      manifest: {
        name: 'PP Logistics',
        short_name: 'PP Logistics',
        description: 'Hand-carry logistics between Bangkok ↔ Yangon / Mandalay',
        theme_color: '#0F766E',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        // iOS hides the address bar in standalone mode; this keeps the splash clean.
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        //
        // PRECACHING SCOPE
        //   globPatterns only matches files on disk in the build output.
        //   Firebase / Google API URLs are remote and can never appear here
        //   — including the local app shell only (JS, CSS, HTML, SVG, PNG,
        //   ICO, WOFF2). Calling this out explicitly to address spec point
        //   #4: it's not possible for googleapis.com to be precached via
        //   globPatterns even if someone tried.
        //
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        //
        // NAVIGATION FALLBACK DENYLIST
        //   No `navigateFallback` is configured (the SPA-rewrites-to-
        //   index.html behavior is handled by Firebase Hosting's rewrites
        //   block in firebase.json, not by the SW). With no navigateFallback,
        //   this denylist is currently a no-op — but defining it pins
        //   intent: if a future config ever adds `navigateFallback`, these
        //   patterns guarantee no Firebase / Google API XHR is ever
        //   rewritten to /index.html.
        //
        navigateFallbackDenylist: [
          /^https:\/\/.*\.googleapis\.com\//,
          /^https:\/\/.*\.firebaseapp\.com\//,
          /^https:\/\/.*\.firebasestorage\.app\//,
          /^https:\/\/.*\.cloudfunctions\.net\//,
          /^https:\/\/.*\.run\.app\//,
        ],
        //
        // RUNTIME CACHING — DELIBERATELY EMPTY
        //
        //   This was the bug. Two prior config iterations both had
        //   `handler: 'NetworkOnly'` rules for googleapis.com / firebaseapp
        //   .com / etc. The intent was "let the request through, don't
        //   cache it." The reality is that Workbox's `NetworkOnly` STILL
        //   routes the request through the SW: when a urlPattern matches,
        //   Workbox calls `event.respondWith(strategy.handle(event))`, and
        //   the strategy's `handle` calls `fetch(event.request)` from
        //   inside the SW context. The browser sees a SW-mediated response,
        //   not a pure network response.
        //
        //   Firestore's WebChannel transport opens a long-poll XHR that
        //   the SDK holds for 30+ seconds. When Workbox wraps that in
        //   `event.respondWith()`, the response stream is parented to the
        //   SW. If the SW goes idle (which it will — Chrome aggressively
        //   reclaims idle SWs after ~30s), the held Response is severed
        //   and the SDK sees the connection drop. DevTools surfaces this
        //   as `failed net::ERR_FAILED` with workbox-*.js as the
        //   initiator. The first request usually completes (cached
        //   service alive); continuation polls fail. Confirmed by toggling
        //   "Bypass for network" in DevTools → Application → Service
        //   Workers, which makes the SW skip the URL entirely — reads
        //   start working.
        //
        //   Firebase JS SDK has filed bugs against this exact pattern:
        //   github.com/firebase/firebase-js-sdk/issues/3018 (Firestore +
        //   Workbox SW) and 6182. The recommended workaround in both
        //   threads is: do not register a SW handler for these URLs at
        //   all.
        //
        //   Mechanic of the empty array: Workbox's generated fetch handler
        //   iterates `runtimeCaching` looking for a urlPattern match. With
        //   no rules, no rule ever matches; `event.respondWith()` is never
        //   called; the browser handles the request through its native
        //   network stack — exactly equivalent to the page running with no
        //   SW installed for that specific URL. Precache lookups still
        //   serve the app shell from cache.
        //
        //   Trade-off accepted: we lose the (mostly cosmetic) Workbox
        //   defense against accidentally caching Firebase API responses
        //   via some future runtime rule. Firestore has its own
        //   IndexedDB-backed offline persistence anyway, so SW-layer
        //   caching of Firestore responses would be redundant.
        //
        runtimeCaching: [],
      },
      devOptions: {
        // Keep the service worker off during `npm run dev` to avoid stale caches.
        enabled: false,
      },
    }),
  ],
});
