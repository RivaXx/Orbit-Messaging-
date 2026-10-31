// Orbit Messenger — messaging delivery and storage policy repair
importScripts('./js/share-inbox.js');
const CACHE_NAME = 'orbit-albums-20261101-r2';
const PRECACHE_URLS = [
    "./js/share-inbox.js",
    "./js/media-source.js?v=albums-20261101-r2",
    "./js/chat-data.js?v=albums-20261101-r2",
    "./js/chat-backup-core.mjs",
    "./chat-data.css?v=albums-20261101-r2",
    "./js/orbit-encryption.js?v=albums-20261101-r2",
    "./encryption.css?v=albums-20261101-r2",
    "./js/e2ee-core.mjs",
    "./js/e2ee-worker.mjs",
    "./assets/vendor/openpgp.min.mjs",
    "./js/storage-recovery.js?v=albums-20261101-r2",
    "./notes.css?v=albums-20261101-r2",
    "./js/orbit-notes.js?v=albums-20261101-r2",
    "./",
    "./index.html",
    "./intro.css?v=albums-20261101-r2",
    "./js/orbit-introduction.js?v=albums-20261101-r2",
    "./js/orbit-intro-scene.js?v=albums-20261101-r2",
    "./manifest.json",
    "./orbit-icon-192.png",
    "./orbit-icon-512.png",
    "./orbit-icon.svg",
    "./orbit-icon.svg?v=brand-20261015",
    "./assets/vendor/tus.min.js",
    "./js/logger.js?v=albums-20261101-r2",
    "./assets/vendor/supabase.min.js?v=albums-20261101-r2",
    "./style.css?v=albums-20261101-r2",
    "./tools.css?v=albums-20261101-r2",
    "./chat-upgrades.css?v=albums-20261101-r2",
    "./photo-weather.css?v=albums-20261101-r2",
    "./messaging-experience.css?v=albums-20261101-r2",
    "./app-polish.css?v=albums-20261101-r2",
    "./js/config.js?v=albums-20261101-r2",
    "./js/rooms.js?v=albums-20261101-r2",
    "./js/chat-actions.js?v=albums-20261101-r2",
    "./js/actions/media-lightbox.js?v=albums-20261101-r2",
    "./js/actions/media-preview.js?v=albums-20261101-r2",
    "./js/actions/file-viewer.js?v=albums-20261101-r2",
    "./js/actions/voice-recorder.js?v=albums-20261101-r2",
    "./js/actions/chat-extras.js?v=albums-20261101-r2",
    "./js/messaging-notifications.js?v=albums-20261101-r2",
    "./js/chat-gestures.js?v=albums-20261101-r2",
    "./js/chat-select.js?v=albums-20261101-r2",
    "./js/chat-share.js?v=albums-20261101-r2",
    "./js/chat/message-controls.js?v=albums-20261101-r2",
    "./js/chat/chat-history.js?v=albums-20261101-r2",
    "./js/chat/chat-feed.js?v=albums-20261101-r2",
    "./js/chat/chat-dispatcher.js?v=albums-20261101-r2",
    "./js/chat/chat-realtime.js?v=albums-20261101-r2",
    "./js/chat.js?v=albums-20261101-r2",
    "./js/calculator.js?v=albums-20261101-r2",
    "./js/tools.js?v=albums-20261101-r2",
    "./js/celestial.js?v=albums-20261101-r2",
    "./js/ui/ui-auth.js?v=albums-20261101-r2",
    "./js/ui/ui-navigation.js?v=albums-20261101-r2",
    "./js/ui/ui-modals.js?v=albums-20261101-r2",
    "./js/ui/ui-notifications.js?v=albums-20261101-r2",
    "./js/ui.js?v=albums-20261101-r2",
    "./js/orbit-chat-services.js?v=albums-20261101-r2",
    "./js/orbit-media-editor.js?v=albums-20261101-r2",
    "./js/orbit-private-photos.js?v=albums-20261101-r2",
    "./js/orbit-banner-weather.js?v=albums-20261101-r2",
    "./js/liquid-glass.js?v=albums-20261101-r2",
    "./js/messaging-experience.js?v=albums-20261101-r2",
    "./js/call-experience.js?v=albums-20261101-r2",
    "./js/orbit-interface.js?v=albums-20261101-r2"
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
    const shareUrl=new URL(request.url);
    if(request.method==='POST'&&shareUrl.origin===self.location.origin&&shareUrl.pathname===new URL('_orbit-share',self.registration.scope).pathname){
        event.respondWith((async()=>{
            try{
                if(Number(request.headers.get('content-length'))>110*1024*1024)throw Error('Shared files are too large. Open Orbit and attach smaller batches.');
                const id=await OrbitShareInbox.save(await request.formData());
                const target=new URL('index.html',self.registration.scope);target.searchParams.set('orbitShare',id);
                return Response.redirect(target.href,303);
            }catch(error){
                const message=String(error.message||'Could not receive this share.').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                return new Response('<!doctype html><html><meta name="viewport" content="width=device-width"><title>Orbit share</title><body><h1>Could not receive shared items</h1><p>'+message+'</p><a href="./index.html">Open Orbit</a></body></html>',{status:400,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}});
            }
        })());return;
    }
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    const local = url.origin === self.location.origin;
    const navigation = local && (request.mode === 'navigate' || url.pathname.endsWith('.html'));
    const entryPath=new URL('./',self.registration?.scope||self.location.origin+'/').pathname;
    const appEntry=navigation&&(url.pathname===entryPath||url.pathname===entryPath+'index.html');
    const shellAsset = local && /\.(m?js|css|json|svg|woff2?)$/i.test(url.pathname);
    const library = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
    if (!navigation && !shellAsset && !library) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request) || (appEntry ? await cache.match('./index.html') : null);
        // Release-tagged assets are immutable until the next worker version.
        if(cached && shellAsset && url.searchParams.has("v"))return cached;
        const network = fetch(request).then(response => {
            if (response.ok || response.type === 'opaque') {
                event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
            }
            return response;
        });
        event.waitUntil(network.catch(() => {}));
        // The saved app shell is immediately usable; update it in the background.
        if (cached) return cached;
        return network.catch(() => new Response('Offline. Open Orbit once while connected to save this app on your device.', { status: 503 }));
    })());
});

// Device preferences survive closed tabs and shell-cache upgrades.
const ALERT_PREF_CACHE='notification-preferences';
const alertPreferenceKey=()=>new URL('_orbit_alert_preferences',self.registration.scope).href;
self.addEventListener('message',event=>{
 if(event.data?.type!=='ORBIT_ALERT_PREFERENCES')return;
 const prefs=event.data.preferences||{};
 event.waitUntil((async()=>{const cache=await caches.open(ALERT_PREF_CACHE);await cache.put(alertPreferenceKey(),new Response(JSON.stringify({previews:prefs.previews!==false,callSilent:prefs.callSilent===true,messageSilent:prefs.messageSilent===true}),{headers:{'Content-Type':'application/json'}}));})());
});
async function orbitWorkerAlertPreferences(){try{const cache=await caches.open(ALERT_PREF_CACHE),response=await cache.match(alertPreferenceKey());return response?await response.json():{};}catch(_){return {};}}

// Call alerts expire quickly; message and call tags are shared with foreground alerts.
self.addEventListener('push', event => {
 let data={};try{data=event.data?event.data.json():{};}catch(_){data={body:'New Orbit notification'};}
 const isCall=data.isCall===true,callId=isCall?(data.callId||data.msgId):null;
 if(isCall&&(!callId||!Number.isFinite(Number(data.timestamp))||(!data.ended&&Date.now()-Number(data.timestamp)>45000)))return;
 const tag=isCall?'orbit-call-'+callId:(data.tag||'orbit-message-'+(data.msgId||Date.now()));
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(isCall)for(const client of windows)client.postMessage({type:'ORBIT_CALL_PUSH',callId,ended:!!data.ended});
  const states=await Promise.all(windows.map(client=>new Promise(resolve=>{
   const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve({});},500);
   channel.port1.onmessage=reply=>{clearTimeout(timer);channel.port1.close();resolve(reply.data||{});};
   client.postMessage({type:'ORBIT_PUSH_VISIBLE_QUERY',roomId:data.roomId,isCall,callId},[channel.port2]);
  })));
  if(!data.ended&&states.some(state=>state.active===true))return;
  const existing=await self.registration.getNotifications({tag});
  if(!data.ended&&existing.length)return;
  const preferences=await orbitWorkerAlertPreferences();
  const previews=preferences.previews!==false&&!states.some(state=>state.previews===false),silent=!!data.ended||(isCall?preferences.callSilent:preferences.messageSilent)||states.some(state=>state.silent===true);
  await self.registration.showNotification(previews?(data.title||'Orbit Messenger'):'Orbit Messenger',{
   body:isCall?(data.ended?(data.body||'Voice call ended'):'Incoming voice call · Open Orbit to answer'):previews?(data.body||'You have a new message'):'You have a new message',
   icon:'./orbit-icon.svg',badge:'./orbit-icon.svg',tag,renotify:false,requireInteraction:isCall&&!data.ended,
   silent,vibrate:silent?[]:isCall?[300,150,300,150,300]:[150,80,150],timestamp:Number(data.timestamp)||Date.now(),
   data:{url:self.registration.scope,roomId:data.roomId||null,msgId:isCall?null:(data.msgId||null),callId,noteId:data.noteId||null,ended:!!data.ended,timestamp:data.timestamp||Date.now()},
   actions:[{action:'open',title:isCall?'View call':data.noteId?'Open note':'Open chat'},{action:'dismiss',title:'Dismiss alert'}]
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();if(event.action==='dismiss')return;
 const data=event.notification.data||{},target=new URL(self.registration.scope);
 if(data.noteId)target.searchParams.set('noteId',data.noteId);
 if(data.roomId)target.searchParams.set('openRoom',data.roomId);
 if(data.callId)target.searchParams.set('callId',data.callId);
 else if(data.msgId)target.searchParams.set('focusMsg',data.msgId);
 if(data.timestamp)target.searchParams.set('msgTime',data.timestamp);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(client=>new URL(client.url).origin===self.location.origin&&client.focused)||windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(client){client.postMessage({type:'NOTIFICATION_NAVIGATE',roomId:data.roomId,msgId:data.msgId,callId:data.callId,noteId:data.noteId,timestamp:data.timestamp});return client.focus();}
  if(self.clients.openWindow)return self.clients.openWindow(target.href);
 })());
});
