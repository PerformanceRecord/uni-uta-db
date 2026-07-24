const CACHE_PREFIX = 'uni-uta-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = [
  './',
  './index.html',
  './src/app.js',
  './src/data/songsApi.js',
  './src/domain/songCatalog.js',
  './src/features/danmaku.js',
  './src/features/scrollBubbles.js',
  './src/platform/clipboard.js',
  './src/platform/pwa.js',
  './src/state/appState.js',
  './src/ui/dom.js',
  './src/ui/renderSongs.js',
  './src/ui/status.js',
  './src/ui/swipeTrack.js',
  './src/utils/scheduling.js',
  './assets/icons/site.webmanifest',
  './assets/icons/favicon.svg',
  './assets/icons/apple-touch-icon.png',
];

async function cacheResponse(request, response) {
  if (!response?.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    return await cacheResponse(request, response);
  } catch (_) {
    return (
      await caches.match(request)
      || await caches.match('./index.html')
      || await caches.match('./')
    );
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const networkRequest = fetch(request)
    .then((response) => cacheResponse(request, response))
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkRequest);
    return cached;
  }

  return networkRequest;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/songs.json')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
