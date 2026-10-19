// Orbit Messenger — messaging delivery and storage policy repair
const CACHE_NAME = 'orbit-calculator-profile-20261019-r1';
const PRECACHE_URLS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./orbit-icon.svg",
    "./orbit-icon.svg?v=brand-20261015",
    "./assets/vendor/tus.min.js",
    "./js/logger.js?v=calculator-profile-20261019-r1",
    "./assets/vendor/supabase.min.js?v=calculator-profile-20261019-r1",
    "./style.css?v=calculator-profile-20261019-r1",
    "./tools.css?v=calculator-profile-20261019-r1",
    "./chat-upgrades.css?v=calculator-profile-20261019-r1",
    "./photo-weather.css?v=calculator-profile-20261019-r1",
    "./messaging-experience.css?v=calculator-profile-20261019-r1",
    "./app-polish.css?v=calculator-profile-20261019-r1",
    "./js/config.js?v=calculator-profile-20261019-r1",
    "./js/rooms.js?v=calculator-profile-20261019-r1",
    "./js/chat-actions.js?v=calculator-profile-20261019-r1",
    "./js/actions/media-lightbox.js?v=calculator-profile-20261019-r1",
    "./js/actions/media-preview.js?v=calculator-profile-20261019-r1",
    "./js/actions/file-viewer.js?v=calculator-profile-20261019-r1",
    "./js/actions/voice-recorder.js?v=calculator-profile-20261019-r1",
    "./js/actions/chat-extras.js?v=calculator-profile-20261019-r1",
    "./js/messaging-notifications.js?v=calculator-profile-20261019-r1",
    "./js/chat-gestures.js?v=calculator-profile-20261019-r1",
    "./js/chat-select.js?v=calculator-profile-20261019-r1",
    "./js/chat-share.js?v=calculator-profile-20261019-r1",
    "./js/chat/message-controls.js?v=calculator-profile-20261019-r1",
    "./js/chat/chat-history.js?v=calculator-profile-20261019-r1",
    "./js/chat/chat-feed.js?v=calculator-profile-20261019-r1",
    "./js/chat/chat-dispatcher.js?v=calculator-profile-20261019-r1",
    "./js/chat/chat-realtime.js?v=calculator-profile-20261019-r1",
    "./js/chat.js?v=calculator-profile-20261019-r1",
    "./js/calculator.js?v=calculator-profile-20261019-r1",
    "./js/tools.js?v=calculator-profile-20261019-r1",
    "./js/celestial.js?v=calculator-profile-20261019-r1",
    "./js/ui/ui-auth.js?v=calculator-profile-20261019-r1",
    "./js/ui/ui-navigation.js?v=calculator-profile-20261019-r1",
    "./js/ui/ui-modals.js?v=calculator-profile-20261019-r1",
    "./js/ui/ui-notifications.js?v=calculator-profile-20261019-r1",
    "./js/ui.js?v=calculator-profile-20261019-r1",
    "./js/orbit-chat-services.js?v=calculator-profile-20261019-r1",
    "./js/orbit-media-editor.js?v=calculator-profile-20261019-r1",
    "./js/orbit-private-photos.js?v=calculator-profile-20261019-r1",
    "./js/orbit-banner-weather.js?v=calculator-profile-20261019-r1",
    "./js/liquid-glass.js?v=calculator-profile-20261019-r1",
    "./js/messaging-experience.js?v=calculator-profile-20261019-r1",
    "./js/orbit-interface.js?v=calculator-profile-20261019-r1"
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
        // Release-tagged assets are immutable until the next worker version.
        if(cached && shellAsset && url.searchParams.has("v"))return cached;
        const network = fetch(request).then(response => {
            if (response.ok || response.type === 'opaque') {
                event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
            }
            return response;
        });
        event.waitUntil(network.catch(() => {}));
        if (cached && !navigation) return cached;
        if (cached && !self.navigator.onLine) return cached;
        if (cached) return Promise.race([network.catch(() => cached),new Promise(resolve=>setTimeout(()=>resolve(cached),1200))]);
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
        renotify: false,
        vibrate: [200, 100, 200],
        silent: false,
        data: {
            url: self.registration.scope,
            roomId: data.roomId || null,
            msgId: data.msgId || null,
            timestamp: data.timestamp || Date.now()
        },
        actions: [
            { action: 'open', title: 'Open Chat' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
        const states = await Promise.all(clients.map(client => new Promise(resolve => {
            const channel = new MessageChannel();
            const timer = setTimeout(() => {channel.port1.close(); resolve(false);}, 500);
            channel.port1.onmessage = reply => {clearTimeout(timer);channel.port1.close();resolve(reply.data?.active === true);};
            client.postMessage({type:'ORBIT_PUSH_VISIBLE_QUERY',roomId:data.roomId},[channel.port2]);
        })));
        if (!states.some(Boolean)) await self.registration.showNotification(title, options);
    })());
});

// Handle notification click -> Open app, open exact room, and focus the specific message with ms timestamp
self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'dismiss') return;

    const notifData = event.notification.data || {};
    const baseTarget = notifData.url || self.registration.scope;
    const targetUrl = new URL(baseTarget, self.location.origin);
    if (notifData.roomId) targetUrl.searchParams.set('openRoom', notifData.roomId);
    if (notifData.msgId) targetUrl.searchParams.set('focusMsg', notifData.msgId);
    if (notifData.timestamp) targetUrl.searchParams.set('msgTime', notifData.timestamp);

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (new URL(client.url).origin === self.location.origin) {
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
