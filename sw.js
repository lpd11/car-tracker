const CACHE = 'car-tracker-v1';
const ASSETS = [
  '/car-tracker/',
  '/car-tracker/home.html',
  '/car-tracker/fuel.html',
  '/car-tracker/maintenance.html',
  '/car-tracker/history.html',
  '/car-tracker/css/style.css',
  '/car-tracker/js/app.js',
  '/car-tracker/js/api.js',
  '/car-tracker/favicon.png',
  '/car-tracker/icon-192.png',
  '/car-tracker/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Network-first: ใช้ข้อมูลสดจาก network, fallback to cache ถ้า offline
self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.googleusercontent.com') ||
      e.request.url.includes('googleapis.com')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
