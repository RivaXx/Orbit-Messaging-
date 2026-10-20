// Orbit Messenger — messaging delivery and storage policy repair
const CACHE_NAME = 'orbit-advanced-calls-20261020-r1';
const PRECACHE_URLS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./orbit-icon.svg",
    "./orbit-icon.svg?v=brand-20261015",
    "./assets/vendor/tus.min.js",
    "./js/logger.js?v=advanced-calls-20261020-r1",
    "./assets/vendor/supabase.min.js?v=advanced-calls-20261020-r1",
    "./style.css?v=advanced-calls-20261020-r1",
    "./tools.css?v=advanced-calls-20261020-r1",
    "./chat-upgrades.css?v=advanced-calls-20261020-r1",
    "./photo-weather.css?v=advanced-calls-20261020-r1",
    "./messaging-experience.css?v=advanced-calls-20261020-r1",
    "./app-polish.css?v=advanced-calls-20261020-r1",
    "./js/config.js?v=advanced-calls-20261020-r1",
    "./js/rooms.js?v=advanced-calls-20261020-r1",
    "./js/chat-actions.js?v=advanced-calls-20261020-r1",
    "./js/actions/media-lightbox.js?v=advanced-calls-20261020-r1",
    "./js/actions/media-preview.js?v=advanced-calls-20261020-r1",
    "./js/actions/file-viewer.js?v=advanced-calls-20261020-r1",
    "./js/actions/voice-recorder.js?v=advanced-calls-20261020-r1",
    "./js/actions/chat-extras.js?v=advanced-calls-20261020-r1",
    "./js/messaging-notifications.js?v=advanced-calls-20261020-r1",
    "./js/chat-gestures.js?v=advanced-calls-20261020-r1",
    "./js/chat-select.js?v=advanced-calls-20261020-r1",
    "./js/chat-share.js?v=advanced-calls-20261020-r1",
    "./js/chat/message-controls.js?v=advanced-calls-20261020-r1",
    "./js/chat/chat-history.js?v=advanced-calls-20261020-r1",
    "./js/chat/chat-feed.js?v=advanced-calls-20261020-r1",
    "./js/chat/chat-dispatcher.js?v=advanced-calls-20261020-r1",
    "./js/chat/chat-realtime.js?v=advanced-calls-20261020-r1",
    "./js/chat.js?v=advanced-calls-20261020-r1",
    "./js/calculator.js?v=advanced-calls-20261020-r1",
    "./js/tools.js?v=advanced-calls-20261020-r1",
    "./js/celestial.js?v=advanced-calls-20261020-r1",
    "./js/ui/ui-auth.js?v=advanced-calls-20261020-r1",
    "./js/ui/ui-navigation.js?v=advanced-calls-20261020-r1",
    "./js/ui/ui-modals.js?v=advanced-calls-20261020-r1",
    "./js/ui/ui-notifications.js?v=advanced-calls-20261020-r1",
    "./js/ui.js?v=advanced-calls-20261020-r1",
    "./js/orbit-chat-services.js?v=advanced-calls-20261020-r1",
    "./js/orbit-media-editor.js?v=advanced-calls-20261020-r1",
    "./js/orbit-private-photos.js?v=advanced-calls-20261020-r1",
    "./js/orbit-banner-weather.js?v=advanced-calls-20261020-r1",
    "./js/liquid-glass.js?v=advanced-calls-20261020-r1",
    "./js/messaging-experience.js?v=advanced-calls-20261020-r1",
    "./js/call-experience.js?v=advanced-calls-20261020-r1",
    "./js/orbit-interface.js?v=advanced-calls-20261020-r1"
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

// Call alerts expire quickly; message and call tags are shared with foreground alerts.
self.addEventListener('push', event => {
 let data={};try{data=event.data?event.data.json():{};}catch(_){data={body:'New Orbit notification'};}
 const isCall=data.isCall===true,callId=isCall?(data.callId||data.msgId):null;
 if(isCall&&(!callId||!Number.isFinite(Number(data.timestamp))||Date.now()-Number(data.timestamp)>45000))return;
 const tag=isCall?'orbit-call-'+callId:(data.tag||'orbit-message-'+(data.msgId||Date.now()));
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const states=await Promise.all(windows.map(client=>new Promise(resolve=>{
   const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve({});},500);
   channel.port1.onmessage=reply=>{clearTimeout(timer);channel.port1.close();resolve(reply.data||{});};
   client.postMessage({type:'ORBIT_PUSH_VISIBLE_QUERY',roomId:data.roomId,isCall,callId},[channel.port2]);
  })));
  if(states.some(state=>state.active===true))return;
  if((await self.registration.getNotifications({tag})).length)return;
  const previews=!states.some(state=>state.previews===false),silent=states.some(state=>state.silent===true);
  await self.registration.showNotification(previews?(data.title||'Orbit Messenger'):'Orbit Messenger',{
   body:isCall?'Incoming voice call · Open Orbit to answer':previews?(data.body||'You have a new message'):'You have a new message',
   icon:'./orbit-icon.svg',badge:'./orbit-icon.svg',tag,renotify:false,requireInteraction:isCall,
   silent,vibrate:silent?[]:isCall?[300,150,300,150,300]:[150,80,150],timestamp:Number(data.timestamp)||Date.now(),
   data:{url:self.registration.scope,roomId:data.roomId||null,msgId:isCall?null:(data.msgId||null),callId,timestamp:data.timestamp||Date.now()},
   actions:[{action:'open',title:isCall?'View call':'Open chat'},{action:'dismiss',title:'Dismiss alert'}]
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();if(event.action==='dismiss')return;
 const data=event.notification.data||{},target=new URL(self.registration.scope);
 if(data.roomId)target.searchParams.set('openRoom',data.roomId);
 if(data.callId)target.searchParams.set('callId',data.callId);
 else if(data.msgId)target.searchParams.set('focusMsg',data.msgId);
 if(data.timestamp)target.searchParams.set('msgTime',data.timestamp);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(client=>new URL(client.url).origin===self.location.origin&&client.focused)||windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(client){client.postMessage({type:'NOTIFICATION_NAVIGATE',roomId:data.roomId,msgId:data.msgId,callId:data.callId,timestamp:data.timestamp});return client.focus();}
  if(self.clients.openWindow)return self.clients.openWindow(target.href);
 })());
});
