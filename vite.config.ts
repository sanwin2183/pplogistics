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
        // Cache the app shell + static assets so installed PWAs launch offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Firebase calls should always hit the network — Firestore has its own
        // offline persistence, and Auth tokens must be fresh.
        runtimeCaching: [
          { urlPattern: /^https:\/\/.*\.googleapis\.com\//,    handler: 'NetworkOnly' },
          { urlPattern: /^https:\/\/.*\.firebaseapp\.com\//,    handler: 'NetworkOnly' },
          { urlPattern: /^https:\/\/.*\.firebasestorage\.app\//, handler: 'NetworkOnly' },
          { urlPattern: /^https:\/\/.*\.cloudfunctions\.net\//,  handler: 'NetworkOnly' },
          { urlPattern: /^https:\/\/.*\.run\.app\//,             handler: 'NetworkOnly' },
        ],
      },
      devOptions: {
        // Keep the service worker off during `npm run dev` to avoid stale caches.
        enabled: false,
      },
    }),
  ],
});
