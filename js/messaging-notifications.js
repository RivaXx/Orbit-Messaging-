// Browser push enrollment and notification visibility.
let orbitPushStatus = '';
function isOrbitChatVisible(roomId) {
    if (!currentUser || !currentRoom || document.hidden || !document.hasFocus() ||
        !document.getElementById('screen-chat')?.classList.contains('active')) return false;
    return resolveRoomAliases(currentRoom, activeChatPeerId).includes(roomId);
}
async function orbitPushApi(path, body, method = 'POST') {
    const client = await ensureSupabase();
    if (!currentUser?.id) throw new Error('Sign in before enabling notifications.');
    let result;
    if (method === 'DELETE') result = await client.from('orbit_push_subscriptions').delete().eq('user_id',currentUser.id).eq('endpoint',body.endpoint);
    else result = await client.from('orbit_push_subscriptions').upsert({user_id:currentUser.id,endpoint:body.subscription.endpoint,subscription:body.subscription,previews:body.previews,muted_rooms:body.mutedRooms,updated_at:new Date().toISOString()}, {onConflict:'endpoint'});
    if (result.error) {
        console.warn('[Orbit] Push subscription save failed:',result.error.code || 'network',result.error.message);
        throw new Error(`Background notifications could not connect (${result.error.code || 'network'}). Please try again.`);
    }
    return result;
}
async function enableOrbitBackgroundPush(prompt = false) {
    if (!currentUser || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
    const owner = currentUser.id;
    try {
        const client = await ensureSupabase();
        const {data:config, error} = await client.rpc('orbit_push_public_config');
        if (error || !config?.publicKey) throw new Error('Background notifications are awaiting server setup.');
        const registration = await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),6000))]);
        if (!registration) throw new Error('Reload Orbit and try enabling background notifications again.');
        let subscription = await registration.pushManager.getSubscription();
        if (currentUser?.id !== owner) return false;
        if (!subscription && !prompt) return false;
        if (!subscription) {
            const raw = atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
            subscription = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:Uint8Array.from(raw, c => c.charCodeAt(0))});
        }
        if (currentUser?.id !== owner) return false;
        const mutedRooms = [...new Set((window.OrbitChatSelect?.getMutedRooms() || []).flatMap(room => [room,...resolveRoomAliases(room)]))];
        await orbitPushApi('subscription', {subscription:subscription.toJSON(), previews:notificationPreference('orbit_notification_previews',true), mutedRooms});
        orbitPushStatus = 'Background notifications connected. Alerts can arrive when Orbit is closed.';
        return true;
    } catch (error) { orbitPushStatus = error.message; return false; }
    finally { updateNotificationSettingsUI(); }
}
async function disableOrbitBackgroundPush() {
    try {
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
