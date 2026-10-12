// Orbit Messenger — messaging delivery and storage policy repair
const CACHE_NAME = 'orbit-banner-20261012-r22';
const PRECACHE_URLS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./orbit-icon.svg",
    "./assets/vendor/tus.min.js",
    "./js/logger.js?v=authenticated-20261011",
    "./assets/vendor/supabase.min.js?v=2.117.3",
    "./style.css?v=banner-20261012-r15",
    "./tools.css",
    "./js/config.js?v=banner-20261012-r15",
    "./js/rooms.js?v=delivery-20261011-r11",
    "./js/chat-actions.js",
    "./js/actions/media-lightbox.js",
    "./js/actions/media-preview.js?v=delivery-20261011-r11",
    "./js/actions/file-viewer.js?v=delivery-20261011-r11",
    "./js/actions/voice-recorder.js",
    "./js/actions/chat-extras.js",
    "./js/chat-gestures.js",
    "./js/chat-select.js",
    "./js/chat-share.js",
    "./js/chat/chat-history.js?v=delivery-20261011-r11",
    "./js/chat/chat-feed.js?v=media-route-20261011",
    "./js/chat/chat-dispatcher.js?v=delivery-20261011-r11",
    "./js/chat/chat-realtime.js?v=delivery-20261011-r11",
    "./js/chat.js",
    "./js/calculator.js",
    "./js/tools.js",
    "./js/celestial.js",
    "./js/ui/ui-auth.js?v=delivery-20261011-r11",
    "./js/ui/ui-navigation.js?v=delivery-20261011-r16",
    "./js/ui/ui-modals.js?v=delivery-20261011-r16",
    "./js/ui/ui-notifications.js",
    "./js/ui.js",
    "./js/liquid-glass.js?v=4"
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then(keys => {
                return Promise.all(
                    keys.filter(k => k.startsWith('orbit-') && k !== CACHE_NAME).map(k => caches.delete(k))
                );
            })
        ])
    );
});

// Cache only application code, styles and library assets. Authenticated API
// requests and private chat media always go directly to the network.
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    const local = url.origin === self.location.origin;
    const navigation = local && (request.mode === 'navigate' || url.pathname.endsWith('.html'));
    const shellAsset = local && /\.(js|css|json|svg|woff2?)$/i.test(url.pathname);
    const library = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
    if (!navigation && !shellAsset && !library) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request) || (navigation ? await cache.match('./index.html') : null);
        const network = fetch(request).then(response => {
            if (response.ok || response.type === 'opaque') {
                event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
            }
            return response;
        });
        event.waitUntil(network.catch(() => {}));
        if (cached && !navigation) return cached;
        if (cached && !self.navigator.onLine) return cached;
        if (cached) {
            return Promise.race([
                network.catch(() => cached),
                new Promise(resolve => setTimeout(() => resolve(cached), 1500))
            ]);
        }
        return network.catch(() => new Response('Offline. Open Orbit once while connected to save this app on your device.', { status: 503 }));
    })());
});

// Handle incoming Web Push
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (_) {
        data = { title: 'Orbit Messenger', body: event.data ? event.data.text() : 'New notification' };
    }

    const title = data.title || 'Orbit Messenger';
    const options = {
        body: data.body || 'You have a new message',
        icon: data.icon || './orbit-icon.svg',
        badge: './orbit-icon.svg',
        tag: data.tag || `orbit-${Date.now()}`,
        renotify: true,
        vibrate: [200, 100, 200],
        silent: false,
        data: {
            url: self.location.origin + self.location.pathname,
            roomId: data.roomId || null,
            msgId: data.msgId || null,
            timestamp: data.timestamp || Date.now()
        },
        actions: [
            { action: 'open', title: 'Open Chat' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click -> Open app, open exact room, and focus the specific message with ms timestamp
self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'dismiss') return;

    const notifData = event.notification.data || {};
    const baseTarget = notifData.url || (self.location.origin + self.location.pathname);
    const targetUrl = new URL(baseTarget, self.location.origin);
    if (notifData.roomId) targetUrl.searchParams.set('openRoom', notifData.roomId);
    if (notifData.msgId) targetUrl.searchParams.set('focusMsg', notifData.msgId);
    if (notifData.timestamp) targetUrl.searchParams.set('msgTime', notifData.timestamp);

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes('Orbit') || client.url.startsWith(self.location.origin)) {
                    if ('focus' in client) {
                        client.postMessage({
                            type: 'NOTIFICATION_NAVIGATE',
                            roomId: notifData.roomId,
                            msgId: notifData.msgId,
                            timestamp: notifData.timestamp
                        });
                        return client.focus();
                    }
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl.href);
            }
        })
    );
});
