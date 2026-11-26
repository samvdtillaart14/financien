/* App shell: online it always loads the newest files (network first, bypassing the browser's
   HTTP cache) and keeps a copy; offline it serves that copy. Prices and sync never pass through here. */
const VERSION = "16c14381a73d";
const CACHE = "financien-" + VERSION;
const FILES = ["./", "index.html", "app/tokens.css", "app/shim.js", "app/app.js", "vendor/d3.v7.min.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "logos/logo-50plus.png", "logos/logo-amd.svg", "logos/logo-apple.png", "logos/logo-asml.png", "logos/logo-claude.png", "logos/logo-crowdstrike.png", "logos/logo-disney.png", "logos/logo-hbo.svg", "logos/logo-icloud.png", "logos/logo-invesco.png", "logos/logo-ishares.png", "logos/logo-lebara.png", "logos/logo-odido.png", "logos/logo-palantir.png", "logos/logo-playstation.png", "logos/logo-sofi.png", "logos/logo-tesla.png", "logos/logo-vanguard.png", "logos/logo-whoop.png", "logos/logo-wisdomtree.png"];
const TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(FILES.map((f) => fetch(new Request(f, { cache: "reload" })).then((r) => { if (!r.ok) throw new Error(f + " " + r.status); return c.put(f, r); }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("financien-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = e.request.mode === "navigate" ? "./" : e.request;
    try {
      const net = await Promise.race([
        fetch(e.request, { cache: "no-cache" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))
      ]);
      if (net.ok) cache.put(key, net.clone());
      return net;
    } catch (err) {
      return (await cache.match(key, { ignoreSearch: true })) || (await cache.match("./")) || Response.error();
    }
  })());
});
