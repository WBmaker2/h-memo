const CACHE_NAME = "h-memo-web-v1";

const PRECACHED_PATHS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

function getScopePathname() {
  return new URL(self.registration.scope).pathname;
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isNavigationRequest(request) {
  if (request.mode === "navigate") {
    return true;
  }

  if (request.headers.get("accept")?.includes("text/html")) {
    return true;
  }

  return false;
}

function isStaticAssetRequest(url, scopePathname, request) {
  if (!url.pathname.startsWith(scopePathname)) {
    return false;
  }

  const relativePath = url.pathname.slice(scopePathname.length);

  if (relativePath.startsWith("assets/")) {
    return true;
  }

  if (request.destination === "script" || request.destination === "style" || request.destination === "font") {
    return true;
  }

  return false;
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  const response = networkResponse.clone();
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  return networkResponse;
}

async function networkFirstForNavigation(request, indexFallbackUrl) {
  try {
    const networkResponse = await fetch(request);
    const response = networkResponse.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    const indexFallback = await caches.match(indexFallbackUrl);
    if (indexFallback) {
      return indexFallback;
    }

    return new Response("오프라인 상태입니다.", { status: 503 });
  }
}

self.addEventListener("install", (event) => {
  const scopePath = getScopePathname();
  const precachedUrls = PRECACHED_PATHS.map((path) => new URL(path, new URL(scopePath, self.location.href)).href);

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(precachedUrls))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!isSameOrigin(url)) {
    return;
  }

  const scopePath = getScopePathname();
  const indexFallbackUrl = new URL("index.html", self.registration.scope).href;

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstForNavigation(request, indexFallbackUrl));
    return;
  }

  if (isStaticAssetRequest(url, scopePath, request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(
    fetch(request).catch(() => {
      return new Response("오프라인 상태입니다.", { status: 503 });
    })
  );
});
