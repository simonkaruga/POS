import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // main.tsx registers the worker itself (the same call the plugin would inject), because the desktop app must not.
      injectRegister: null,
      includeAssets: ['favicon.png', 'logo.png', 'icons/*.png'],
      manifest: {
        name: 'Faida POS',
        short_name: 'Faida POS',
        description: 'Modern Point of Sale system for Kenyan businesses',
        theme_color: '#01275C',
        background_color: '#F3F6FC',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        categories: ['business', 'finance', 'productivity'],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        // Links we hand to customers and suppliers must always fetch a fresh shell.
        // navigateFallback answers every navigation from the precache, so a device
        // that has the app cached can open /track/... on a months-old bundle — which
        // is how a public page ends up showing the staff login instead. First-time
        // visitors have no service worker and were never affected; the operator's
        // own browser was.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/offline\.html$/,
          /^\/track\//,
          /^\/quote\//,
          /^\/shop\//,
          /^\/pay\//,
          /^\/menu\//,
          /^\/order\//,
          /^\/portal/,
          /^\/affiliate/,
        ],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/v1\/(items|customers)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-data-cache',
              // NetworkFirst only serves this when the network fails, so keeping it for a week costs nothing while
              // online and lets a till reloaded during a long outage still show its items and customers.
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 3600 },
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /^\/api\/v1\/(sales|loyalty|etims|payments|gift-cards|notifications)/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 3600 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Resolve the shared package locally — no workspace install needed
      '@pos/shared': path.resolve(import.meta.dirname, '../../packages/shared/index.ts'),
      '@pos/print-core': path.resolve(import.meta.dirname, '../../packages/print-core/src/index.ts'),
    },
  },
  server: {
    port: 3005,
    proxy: {
      '/api': {
        // The API's dev port; override with VITE_API_PROXY when it runs elsewhere (a second API, a remote one).
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3010',
        changeOrigin: true,
      },
    },
    // Use polling to avoid ENOSPC inotify watcher limit on Linux
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});
