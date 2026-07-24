const CACHE_PREFIX = 'uni-uta-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v11`;
const APP_SHELL = [
  './index.html',
  './assets/styles.css?v=11',
  './src/app.js?v=11',
  './src/data/songsApi.js',
  './src/domain/songCatalog.js',
  './src/features/danmaku.js',
  './src/features/scrollBubbles.js',
  './src/platform/clipboard.js',
  './src/platform/pwa.js',
  './src/platform/storage.js',
  './src/state/appState.js',
  './src/ui/dom.js',
  './src/ui/panelLayout.js?v=11',
  './src/ui/mobileEffects.js?v=11',
  './src/ui/renderSongs.js?v=11',
  './src/ui/status.js',
  './src/ui/swipeTrack.js?v=11',
  './src/utils/scheduling.js',
  './assets/icons/site.webmanifest',
  './assets/icons/apple-touch-icon.png',
];

async function cacheResponse(request, response) {
  if (!response?.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function matchCurrentCache(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    return await cacheResponse('./index.html', response);
  } catch (error) {
    const cached = await matchCurrentCache('./index.html');
    if (cached) return cached;
    throw error;
  }
}

async function networkFirstAsset(request) {
  try {
    const response = await fetch(request);
    return await cacheResponse(request, response);
  } catch (error) {
    const cached = await matchCurrentCache(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await matchCurrentCache(request);

  if (cached) {
    event.waitUntil(
      fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => null),
    );
    return cached;
  }

  return fetch(request)
    .then((response) => cacheResponse(request, response));
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

  if (/\.(?:css|js|mjs)$/i.test(url.pathname)) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
