/**
 * DoingLanguage — Service Worker
 * Network-First strategy for application code and assets, with offline cache fallback.
 */

const CACHE_NAME = 'doing-language-v6';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/variables.css',
  '/css/reset.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/exercises.css',
  '/js/app.js',
  '/js/components/calibration-wizard.js',
  '/js/services/speech-synthesis.js',
  '/js/services/speech-recognition.js',
  '/js/services/on-device-speech.js',
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

// Install: cache static assets immediately and skip waiting
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// Activate: delete all old caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-First strategy (try network, update cache, fallback to cache if offline)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

