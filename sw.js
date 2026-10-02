const CACHE = 'guia-caja-v0.4.2';
const ASSETS = ['./','./index.html','./styles.css','./content.enc.json','./app.js','./manifest.webmanifest','./icon.svg','./icon-192.png?v=0.2.13','./icon-512.png?v=0.2.13'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(new URL(url, self.location.href), {cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('guia-caja-') && key !== CACHE).map(key => caches.delete(key)))),self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  const freshWhenOnline = event.request.mode === 'navigate' || path.endsWith('/content.enc.json');
  if (freshWhenOnline) {
    event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}));
      }
      return response;
    }).catch(async () => (await caches.match(event.request, {ignoreSearch:true})) || (event.request.mode === 'navigate' && await caches.match('./index.html')) || Response.error()));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
