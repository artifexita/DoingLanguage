/**
 * DoingLanguage — Service Worker
 * Caches static assets for offline use.
 */

const CACHE_NAME = 'doing-language-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/variables.css',
  '/css/reset.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/exercises.css',
  '/js/app.js',
  '/js/services/speech-synthesis.js',
  '/js/services/speech-recognition.js',
  '/js/services/storage.js',
  '/js/services/progress.js',
  '/js/services/audio-feedback.js',
  '/js/engine/scoring.js',
  '/js/engine/cueing-system.js',
  '/js/engine/exercise-engine.js',
  '/js/engine/curriculum.js',
  '/js/exercises/multiple-choice.js',
  '/js/exercises/listen-repeat.js',
  '/js/exercises/match-pairs.js',
  '/js/exercises/sequence-order.js',
  '/data/tier1/letters.json',
  '/data/tier1/phonemes.json',
  '/data/tier1/numbers.json',
  '/data/tier1/punctuation.json',
  '/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first strategy for static assets, network-first for others
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // Cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, responseClone));
          }
          return response;
        });
      })
      .catch(() => {
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});
