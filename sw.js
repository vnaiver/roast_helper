const CACHE = 'coffee-roaster-v1';

const ASSETS = [
    '/',
    'index.html',
    'style.css',
    'app.js',
    'manifest.json',
    'https://cdn.jsdelivr.net/npm/chart.js@4'
];

self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(CACHE).then(function(cache) {
            return Promise.allSettled(
                ASSETS.map(url => cache.add(url).catch(() => {}))
            );
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(k => k !== CACHE).map(k => caches.delete(k))
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function(e) {
    if (e.request.method !== 'GET') return;

    e.respondWith(
        caches.match(e.request).then(function(cached) {
            const fetchPromise = fetch(e.request).then(function(response) {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return response;
            }).catch(function() {
                // offline — return cached or nothing
            });
            return cached || fetchPromise;
        })
    );
});
