/**
 * ============================================================================
 *  Hybrid Athlete Hub – Service Worker (docs/sw.js)
 *  - App-Shell-Caching (Stale-While-Revalidate) für schnellen Offline-Start im Home Gym
 *  - POST-Requests an Google Apps Script werden niemals gecacht (immer direkt ans Netz)
 * ============================================================================
 */
'use strict';

const CACHE_NAME = 'hybrid-athlete-hub-v1';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur GET-Requests cachen – GAS-POST-Calls gehen immer direkt ans Netzwerk
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.endsWith('/version.json')) return;
  if (url.hostname.includes('script.google')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
