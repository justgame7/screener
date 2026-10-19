/* MF Screener service worker. Bump VERSION on every release so installed apps update. */
const VERSION = 'v7';
const SHELL = `mfs-shell-${VERSION}`;
const RUNTIME = `mfs-runtime-${VERSION}`;
const ASSETS = [
  './', './index.html', './app.js', './manifest.webmanifest', './data/holdings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, RUNTIME].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Third-party requests (mfapi.in NAV data, Google Fonts) are never intercepted or cached here.
  if (url.origin !== location.origin) return;

  // Page navigations and the holdings data: network first, fall back to the cached copy (offline).
  if (req.mode === 'navigate' || (url.pathname.endsWith('/data/holdings.js')||url.pathname.endsWith('/data/portfolio.js'))) {
    e.respondWith(
      fetch(req).then(r => {
        if (r && r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); }
        return r;
      }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req))
    );
    return;
  }

  // Other same-origin files (icons, manifest): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(r => {
        if (r && r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(RUNTIME).then(c => c.put(req, copy)); }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
