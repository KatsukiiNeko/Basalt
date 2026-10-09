// Service worker for the Basalt PWA. CACHE_NAME is versioned so the
// activate handler deletes stale caches on deploy; bump vN to force
// every client to re-fetch the precache manifest. The V2 build splits
// ECharts into a lazy chunk — it is NOT precached (added to cache on
// first fetch below) so installs stay lean; it self-caches once used.
// The XLSX export chunk graph IS precached (V7): vite.config.js pins
// stable URLs for its three chunks, and exports must work offline on
// first use.
const CACHE_NAME = 'basalt-cache-v7';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons.svg',
  // Self-hosted typefaces (DM Sans + JetBrains Mono) — precached so the
  // zero-network guarantee holds offline; @font-face in index.css points here.
  '/fonts/dm-sans-latin.woff2',
  '/fonts/dm-sans-latin-ext.woff2',
  '/fonts/jetbrains-mono-latin.woff2',
  '/fonts/jetbrains-mono-latin-ext.woff2',
  '/fonts/jetbrains-mono-vietnamese.woff2',
  // Lazy export chunk graph (entry + write-excel-file/fflate + shared
  // chartData), stable names from vite.config.js chunkFileNames — must
  // match the built asset paths or offline export breaks on first use.
  '/assets/export-xlsx.js',
  '/assets/export-xlsx-writer.js',
  '/assets/chartData.js'
];

// Install event - cache static assets, skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches, claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fall back to cache when offline
        return caches.match(event.request);
      })
  );
});
