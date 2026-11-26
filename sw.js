/* Offline cache for the app shell. Prices and sync always go to the network. */
const VERSION = "fb873cde7217";
const CACHE = "financien-" + VERSION;
const FILES = ["./", "index.html", "app/tokens.css", "app/shim.js", "app/app.js", "vendor/d3.v7.min.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "logos/logo-50plus.png", "logos/logo-amd.svg", "logos/logo-apple.png", "logos/logo-asml.png", "logos/logo-claude.png", "logos/logo-crowdstrike.png", "logos/logo-disney.png", "logos/logo-hbo.svg", "logos/logo-icloud.png", "logos/logo-invesco.png", "logos/logo-ishares.png", "logos/logo-lebara.png", "logos/logo-odido.png", "logos/logo-palantir.png", "logos/logo-playstation.png", "logos/logo-sofi.png", "logos/logo-tesla.png", "logos/logo-vanguard.png", "logos/logo-whoop.png", "logos/logo-wisdomtree.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("financien-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match("./")))
  );
});
