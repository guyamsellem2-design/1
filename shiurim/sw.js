/* Offline shell + the phone's "Share" menu.
   Files come from the network first (a new version shows up right away) and from the saved copy offline.
   Text shared from another app arrives here as a POST to ./share; it is parked in IndexedDB
   and the app picks it up on ./?shared=1. Nothing the teacher writes ever passes through this file. */
const CACHE = 'shiurim-v19';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './js/app.js', './js/util.js', './js/parser.js', './js/model.js', './js/store.js', './js/ui.js',
  './js/students.js', './js/settings.js', './js/table.js', './js/calendar.js', './js/export.js', './js/report.js', './js/sync.js', './js/syncmerge.js', './js/account.js', './js/install.js', './js/notebook.js', './js/images.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter((k) => k.startsWith('shiurim-') && k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    // An update replaced an older version: reload open windows so they run the new code right away,
    // instead of showing the old screens until the app is opened again.
    // (Started after activation finishes: the reload's own request needs this worker to be active.)
    if (old.length) {
      setTimeout(async () => {
        const wins = await self.clients.matchAll({ type: 'window' });
        for (const w of wins) w.navigate(w.url).catch(() => {});
      }, 50);
    }
  })());
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
    await inboxPut({
      title: form.get('title') || '',
      text: form.get('text') || '',
      url: form.get('url') || '',
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
  // Our own files: always the newest from the network (so updates show up immediately),
  // and the saved copy only when there is no connection. Fonts: the saved copy first.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request, { cache: 'no-cache' });
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      } catch (err) {
        return (await caches.match(key)) || (await caches.match(new URL('./', self.registration.scope).href)) || Response.error();
      }
    })());
    return;
  }
  e.respondWith(
    caches.match(key).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
      }
      return res;
    }))
  );
});
