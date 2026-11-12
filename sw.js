// Offline app shell. The deploy workflow stamps VERSION with the commit so phones update.
const VERSION = 'larder-v3';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg',
  './js/app.js', './js/store.js', './js/sync.js',
  './js/core/normalizer.js', './js/core/matching.js', './js/core/planner.js', './js/core/shopping.js', './js/core/importer.js',
  './js/core/merge.js', './js/core/util.js', './js/core/kitchen.js', './js/core/receipt.js',
  './js/ai/llm.js', './js/ai/agent.js', './js/ai/vision.js',
  './js/data/ingredients.js', './js/data/seed.js',
  './js/ui/dom.js', './js/ui/inventory.js', './js/ui/recipes.js', './js/ui/plan.js', './js/ui/shop.js',
  './js/ui/settings.js', './js/ui/scan.js', './js/ui/assistant.js', './js/ui/receiptkey.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin GETs: network first (so updates show straight away), cache when offline.
// Cross-origin (AI, OCR library, proxies, GitHub) always network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  }));
});
