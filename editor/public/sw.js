const CACHE_PREFIX = "restyle-editor-shell-";
const CACHE_NAME = "__PVO_CACHE_NAME__";
const PRECACHE_URLS = ["__PVO_PRECACHE_URLS__"];

const scope = new URL(self.registration.scope);
const shellUrl = new URL("./index.html", scope);
const assetPaths = new Set(PRECACHE_URLS.map(path => new URL(path, scope).pathname));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS.map(path => new URL(path, scope).href));
    // Activation waits for an explicit update request from the editor.
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (request.mode === "navigate") {
    if (url.pathname !== scope.pathname && url.pathname !== shellUrl.pathname) return;
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(shellUrl) || Response.error();
    }));
    return;
  }

  // Only immutable build assets and explicitly listed app-shell files are cached.
  // Camera blobs, downloaded PVOs, and user/API requests never enter this cache.
  if (!assetPaths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const canonicalUrl = new URL(url.pathname, scope.origin);
    const cached = await cache.match(canonicalUrl);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(canonicalUrl, response.clone());
    return response;
  })());
});
