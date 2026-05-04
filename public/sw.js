const STATIC_CACHE = "bazaar-static-v1";
const STATIC_ASSETS = [
  "/offline.html",
  "/brand/icon.png",
  "/brand/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest"
];

const isPrivateOrDynamicRequest = (url) =>
  url.pathname.startsWith("/api/") ||
  url.pathname.startsWith("/auth") ||
  url.pathname.startsWith("/_next/data/") ||
  url.pathname.startsWith("/login") ||
  url.pathname.startsWith("/signup") ||
  url.pathname.startsWith("/invite") ||
  url.pathname.startsWith("/reset") ||
  url.pathname.startsWith("/verify");

const isStaticAssetRequest = (request, url) => {
  if (url.origin !== self.location.origin) {
    return false;
  }
  if (isPrivateOrDynamicRequest(url)) {
    return false;
  }
  return (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font" ||
    request.destination === "image" ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/apple-touch-icon.png"
  );
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }

  if (url.origin !== self.location.origin || isPrivateOrDynamicRequest(url)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return cache.match("/offline.html");
      }),
    );
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          const responseToCache = networkResponse.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return networkResponse;
        });
      }),
    );
  }
});
