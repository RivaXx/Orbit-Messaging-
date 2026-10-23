// Browser push enrollment and notification visibility.
let orbitPushStatus = '';
let orbitStorageWarningAt=0;
window.addEventListener('orbit-storage-full',()=>{
    if(Date.now()-orbitStorageWarningAt<10000)return;orbitStorageWarningAt=Date.now();
    if(typeof showToast==='function')showToast('Browser storage is full. This change could not be saved; your drafts and pending uploads were kept.','error');
});
async function orbitAcknowledgeDelivery(messages){
    const owner=currentUser?.id;
    const ids=messages.filter(m=>m.id&&m.sender_id!==owner&&!m.broadcast_pending&&!(m.delivered_to||[]).includes(owner)).map(m=>m.id).slice(0,100);
    if(!owner||!ids.length||!navigator.onLine)return;
    try{const client=await ensureSupabase();if(currentUser?.id!==owner)return;await orbitAwaitPushQuery(client.rpc('orbit_mark_messages_delivered',{message_keys:ids}));}catch(_){}
}
let orbitReceiptSyncBusy=false,orbitLastDeliverySweep=0;
async function orbitRefreshReceipts(){
    if(orbitReceiptSyncBusy||document.hidden||!navigator.onLine||!currentUser?.id)return;
    const owner=currentUser.id,room=currentRoom;orbitReceiptSyncBusy=true;
    try{
        const client=await ensureSupabase();
        if(Date.now()-orbitLastDeliverySweep>60000){
            const incoming=await orbitAwaitPushQuery(client.from('messages').select('id,sender_id,delivered_to').neq('sender_id',owner).order('created_at',{ascending:false}).limit(100));
            if(currentUser?.id!==owner)return;
            if(!incoming.error){orbitLastDeliverySweep=Date.now();await orbitAcknowledgeDelivery(incoming.data||[]);}
        }
        if(room&&isOrbitChatVisible(room)){
            const aliases=resolveRoomAliases(room,activeChatPeerId);
            const result=await orbitAwaitPushQuery(client.from('messages').select('id,room,sender_id,read_by,delivered_to').in('room',aliases).eq('sender_id',owner).order('created_at',{ascending:false}).limit(100));
            if(currentUser?.id!==owner||currentRoom!==room||result.error)return;
            for(const receipt of result.data||[]){const old=(messageCache.get(room)||[]).find(m=>m.id===receipt.id);if(old)handleRealtimeUpdate({new:{...old,...receipt}},room,aliases);}
            markRoomAsRead(room);
        }
    }catch(_){}finally{orbitReceiptSyncBusy=false;}
}
setInterval(orbitRefreshReceipts,10000);
window.addEventListener('online',orbitRefreshReceipts);
window.addEventListener('focus',orbitRefreshReceipts);
let orbitPushConnectPromise=null,orbitPushConnectOwner=null,orbitPushEpoch=0;
function isOrbitChatVisible(roomId) {
    if (!currentUser || !currentRoom || document.hidden || !document.hasFocus() ||
        !document.getElementById('screen-chat')?.classList.contains('active')) return false;
    return resolveRoomAliases(currentRoom, activeChatPeerId).includes(roomId);
}
async function orbitAwaitPushQuery(query){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await (typeof query.abortSignal==='function'?query.abortSignal(controller.signal):query);}
    finally{clearTimeout(timer);}
}
async function orbitPushApi(path, body, method = 'POST') {
    const client = await ensureSupabase();
    if (!currentUser?.id) throw new Error('Sign in before enabling notifications.');
    let result;
    if (method === 'DELETE') result = await orbitAwaitPushQuery(client.from('orbit_push_subscriptions').delete().eq('user_id',currentUser.id).eq('endpoint',body.endpoint));
    else result = await orbitAwaitPushQuery(client.from('orbit_push_subscriptions').upsert({user_id:currentUser.id,endpoint:body.subscription.endpoint,subscription:body.subscription,previews:body.previews,muted_rooms:body.mutedRooms,updated_at:new Date().toISOString()}, {onConflict:'endpoint'}));
    if (result.error) {
        console.warn('[Orbit] Push subscription save failed:',result.error.code || 'network',result.error.message);
        throw new Error(`Background notifications could not connect (${result.error.code || 'network'}). Please try again.`);
    }
    return result;
}
function enableOrbitBackgroundPush(prompt=false){
    const owner=currentUser?.id;
    if(orbitPushConnectPromise&&orbitPushConnectOwner===owner)return orbitPushConnectPromise;
    orbitPushConnectOwner=owner;
    const pending=orbitConnectBackgroundPush(prompt).finally(()=>{if(orbitPushConnectPromise===pending){orbitPushConnectPromise=null;orbitPushConnectOwner=null;}});
    orbitPushConnectPromise=pending;return pending;
}
async function orbitConnectBackgroundPush(prompt = false) {
    if (!currentUser || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
    const owner = currentUser.id,epoch=orbitPushEpoch;
    try {
        const client = await ensureSupabase();
        const {data:config, error} = await orbitAwaitPushQuery(client.rpc('orbit_push_public_config'));
        if (error || !config?.publicKey) throw new Error('Background notifications are awaiting server setup.');
        const registration = await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),6000))]);
        if(registration)syncOrbitAlertPreferences(registration);
        if (!registration) throw new Error('Reload Orbit and try enabling background notifications again.');
        let subscription = await registration.pushManager.getSubscription();
        if (currentUser?.id !== owner||epoch!==orbitPushEpoch) return false;
        // Permission is already granted: repair a missing subscription on login too.
        if (!subscription) {
            const raw = atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
            subscription = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:Uint8Array.from(raw, c => c.charCodeAt(0))});
        }
        if (currentUser?.id !== owner) return false;
        const mutedRooms = [...new Set((window.OrbitChatSelect?.getMutedRooms() || []).flatMap(room => [room,...resolveRoomAliases(room)]))];
        await orbitPushApi('subscription', {subscription:subscription.toJSON(), previews:notificationPreference('orbit_notification_previews',true), mutedRooms});
        orbitPushStatus = 'Background notifications connected on this device. Calls and reminders can alert while Orbit is closed; delivery depends on connectivity and device notification settings.';
        return true;
    } catch (error) { orbitPushStatus = error.message; return false; }
    finally { updateNotificationSettingsUI(); }
}
async function disableOrbitBackgroundPush() {
    orbitPushEpoch++;
    try {
        if(orbitPushConnectPromise)await orbitPushConnectPromise;
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
            if (!await subscription.unsubscribe()) throw new Error('Could not disconnect this device.');
            try { await orbitPushApi('subscription', {endpoint:subscription.endpoint}, 'DELETE'); } catch (_) { /* Expired endpoints are pruned by the push sender. */ }
        }
        orbitPushStatus = '';
    } catch (_) { orbitPushStatus = 'Could not disconnect background alerts. Reconnect and try again.'; return false; }
    return true;
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isOrbitChatVisible(currentRoom)) markRoomAsRead(currentRoom);
    else if (document.hidden && typeof stopTypingBroadcast === 'function') stopTypingBroadcast();
});
window.addEventListener('focus', () => { if (isOrbitChatVisible(currentRoom)) markRoomAsRead(currentRoom); });

function orbitAlertPreferences(){return {previews:notificationPreference('orbit_notification_previews',true),callSilent:localStorage.getItem('orbit_call_ringtone')==='silent',messageSilent:!notificationPreference('orbit_notification_sound',true)};}
async function syncOrbitAlertPreferences(registration){
    try{registration=registration||await navigator.serviceWorker?.getRegistration();registration?.active?.postMessage({type:'ORBIT_ALERT_PREFERENCES',preferences:orbitAlertPreferences()});}catch(_){}
}
window.addEventListener('online',()=>{if(currentUser&&notificationPreference('orbit_device_notifications',true))enableOrbitBackgroundPush();});
