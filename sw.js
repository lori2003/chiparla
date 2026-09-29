// Service worker: tiene in cache l'interfaccia per l'uso offline.
// I dati delle riunioni NON passano da qui: stanno in IndexedDB sul telefono.
//
// Per pubblicare un aggiornamento: modificare i file, aumentare VERSION, fare commit e push.
// L'app mostrerà «Nuova versione disponibile» (mai durante una registrazione).

const VERSION = '1.1.0';
const CACHE = `chiparla-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/audio.js',
  'js/db.js',
  'js/env.js',
  'js/exporters.js',
  'js/haptics.js',
  'js/level.js',
  'js/mp4.js',
  'js/recorder.js',
  'js/session.js',
  'js/settings.js',
  'js/timeline.js',
  'js/transcriber.js',
  'js/ui.js',
  'js/util.js',
  'js/wakelock.js',
  'js/screens/diag.js',
  'js/screens/edit.js',
  'js/screens/export.js',
  'js/screens/home.js',
  'js/screens/record.js',
  'js/screens/setup.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' evita di mettere in cache copie vecchie prese dalla cache HTTP
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('chiparla-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// L'app chiede di attivare la nuova versione solo quando non sta registrando
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Sul computer (localhost) prima la rete, così si vedono subito le modifiche; poi la cache
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (DEV) {
    event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })
      .then((r) => r || caches.match('index.html'))));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
