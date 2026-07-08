// ── Cambia este número con cada deploy para forzar actualización ──
const CACHE_VERSION = 'morena-v1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;

const STATIC_ASSETS = [
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './logo.png',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            return Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    fetch(url, { cache: 'no-store' })
                        .then(resp => { if (resp.ok) return cache.put(url, resp); })
                        .catch(err => console.warn('SW: no se pudo cachear', url, err))
                )
            );
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;
    if (e.request.method !== 'GET') return;

    const isHTML = e.request.destination === 'document'
        || url.pathname.endsWith('.html')
        || url.pathname === '/' || url.pathname === '';

    if (isHTML) {
        e.respondWith(
            fetch(e.request, { cache: 'no-store' })
                .then(networkResp => {
                    if (networkResp.ok) {
                        const copia = networkResp.clone();
                        caches.open(STATIC_CACHE).then(cache => cache.put('./index.html', copia)).catch(() => {});
                    }
                    return networkResp;
                })
                .catch(() => caches.match('./index.html').then(cached => cached || new Response(
                    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width,initial-scale=1">
                    <title>Sin conexión</title>
                    <style>body{background:#fbf5fc;color:#2b1730;font-family:sans-serif;display:flex;
                        align-items:center;justify-content:center;min-height:100vh;margin:0;
                        text-align:center;padding:2rem;} h2{color:#9b3fc0;} p{color:#8a7594;}</style>
                    </head><body><div><h2>💜 Sin conexión</h2>
                    <p>Abre la app con internet al menos una vez<br>para que funcione sin conexión.</p>
                    </div></body></html>`,
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                )))
        );
    } else {
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                return fetch(e.request).then(networkResp => {
                    if (networkResp.ok) {
                        caches.open(STATIC_CACHE).then(cache => cache.put(e.request, networkResp.clone())).catch(() => {});
                    }
                    return networkResp;
                });
            })
        );
    }
});

self.addEventListener('message', e => {
    if (e.data === 'skipWaiting') self.skipWaiting();
});

// ── PUSH: los tres avisos de cobro llegan con distinto 'tag' ──
self.addEventListener('push', e => {
    let datos = {};
    try { datos = e.data ? e.data.json() : {}; } catch (err) { datos = {}; }

    const esUrgente = datos.tag === 'cobro-30';
    const titulo   = datos.title || (esUrgente ? '🚨 Cobro urgente' : '💌 Recordatorio de cobro');
    const opciones = {
        body: datos.body || '',
        icon: datos.icon || './icon-192.png',
        badge: './icon-192.png',
        tag: datos.tag || 'morena-aviso',
        vibrate: esUrgente ? [200, 100, 200, 100, 200] : [120],
        requireInteraction: esUrgente,
        data: { url: './?tab=cobros' },
    };

    e.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    const url = e.notification.data?.url || './';

    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
            for (const cliente of lista) {
                if (cliente.url.includes(self.location.origin) && 'focus' in cliente) {
                    cliente.navigate(url);
                    return cliente.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(url);
        })
    );
});
