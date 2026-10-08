/* Offline shell + the phone's "Share" menu.
   Files are served cache-first and refreshed in the background, so an update lands on the next open.
   Text or a photo shared from another app arrives here as a POST to ./share; it is parked in IndexedDB
   and the app picks it up on ./?shared=1. Nothing the teacher writes ever passes through this file. */
const CACHE = 'shiurim-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './js/app.js', './js/util.js', './js/parser.js', './js/model.js', './js/store.js', './js/ui.js',
  './js/students.js', './js/settings.js', './js/table.js', './js/calendar.js', './js/export.js', './js/ocr.js',
  './vendor/anthropic-sdk.mjs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shiurim-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function inboxPut(value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shiurim', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
      if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox');
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const t = req.result.transaction('inbox', 'readwrite');
      t.objectStore('inbox').put(value, 'shared');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    };
  });
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.get('image');
    await inboxPut({
      title: form.get('title') || '',
      text: form.get('text') || '',
      url: form.get('url') || '',
      file: file && typeof file !== 'string' && file.size ? file : null,
    });
  } catch (err) {
    // Fall through: the app still opens.
  }
  return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  const cacheable = url.origin === location.origin
    || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  // Shared links (?text=...) open the app shell.
  const key = url.origin === location.origin && url.search && (url.pathname.endsWith('/') || url.pathname.endsWith('index.html'))
    ? new Request(new URL('./', self.registration.scope).href) : e.request;
  e.respondWith(
    caches.match(key).then((hit) => {
      const live = fetch(e.request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});
