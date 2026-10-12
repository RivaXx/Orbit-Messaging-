// User-scoped unread counts and browser push enrollment.
const orbitUnreadCounts = new Map();
const orbitUnreadMessageIds = new Set();
let orbitUnreadOwner = null;
let orbitUnreadRevision = 0;
let orbitUnreadSyncTimer = null;
let orbitPushStatus = '';
let orbitRecentRefreshTimer = null;
function refreshOrbitInboxSoon() {
    clearTimeout(orbitRecentRefreshTimer);
    orbitRecentRefreshTimer = setTimeout(() => { if (currentUser && typeof loadMainChats === 'function') loadMainChats().catch(() => {}); }, 400);
}
function isOrbitChatVisible(roomId) {
    if (!currentUser || !currentRoom || document.hidden || !document.hasFocus() ||
        !document.getElementById('screen-chat')?.classList.contains('active')) return false;
    return resolveRoomAliases(currentRoom, activeChatPeerId).includes(roomId);
}
function hydrateOrbitUnread() {
    if (orbitUnreadOwner === currentUser?.id) return;
    orbitUnreadOwner = currentUser?.id || null;
    orbitUnreadCounts.clear(); orbitUnreadMessageIds.clear(); unreadRoomsSet.clear();
    try {
        const values = JSON.parse(localStorage.getItem(`orbit_unread_counts_${orbitUnreadOwner}`) || '{}');
        for (const [room, count] of Object.entries(values)) {
            if (Number.isSafeInteger(count) && count > 0) { orbitUnreadCounts.set(room, count); unreadRoomsSet.add(room); }
        }
    } catch (_) {}
}
function persistOrbitUnread() {
    try { if (currentUser?.id) localStorage.setItem(`orbit_unread_counts_${currentUser.id}`, JSON.stringify(Object.fromEntries(orbitUnreadCounts))); } catch (_) {}
}
function getOrbitUnreadCount(room) {
    const aliases = typeof resolveRoomAliases === 'function' ? resolveRoomAliases(room) : [room];
    return [...new Set([room, ...aliases])].reduce((sum, alias) => sum + (orbitUnreadCounts.get(alias) || 0), 0);
}
function orbitUnreadBadgeHtml(room) {
    const count = getOrbitUnreadCount(room);
    return `<span class="chat-unread-count${count ? '' : ' hide'}" data-unread-room="${escapeHtml(room)}" aria-label="${count} unread messages">${count > 99 ? '99+' : count}</span>`;
}
function renderOrbitUnreadCounts() {
    document.querySelectorAll('[data-unread-room]').forEach(el => {
        const count = getOrbitUnreadCount(el.dataset.unreadRoom);
        el.textContent = count > 99 ? '99+' : count;
        el.classList.toggle('hide', !count);
        el.setAttribute('aria-label', `${count} unread messages`);
    });
    updateTabUnreadBadges();
    const total = [...orbitUnreadCounts.values()].reduce((sum, count) => sum + count, 0);
    if (navigator.setAppBadge && total) navigator.setAppBadge(total).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
}
function recordOrbitUnread(msg) {
    hydrateOrbitUnread();
    if (!msg?.id || msg.sender_id === currentUser?.id || isOrbitChatVisible(msg.room)) return;
    const key = `${msg.room}:${msg.id}`;
    if (orbitUnreadMessageIds.has(key)) return;
    orbitUnreadMessageIds.add(key);
    if (orbitUnreadMessageIds.size > 2000) orbitUnreadMessageIds.delete(orbitUnreadMessageIds.values().next().value);
    orbitUnreadCounts.set(msg.room, (orbitUnreadCounts.get(msg.room) || 0) + 1);
    unreadRoomsSet.add(msg.room); orbitUnreadRevision++;
    persistOrbitUnread(); renderOrbitUnreadCounts();
    refreshOrbitInboxSoon();
}
function clearOrbitRoomUnread(room) {
    const aliases = resolveRoomAliases(room, activeChatPeerId);
    for (const alias of new Set([room, ...aliases])) { orbitUnreadCounts.delete(alias); unreadRoomsSet.delete(alias); }
    orbitUnreadRevision++; persistOrbitUnread(); renderOrbitUnreadCounts();
}
async function syncOrbitUnreadCounts() {
    hydrateOrbitUnread();
    const owner = currentUser?.id, revision = orbitUnreadRevision;
    if (!owner || !navigator.onLine) return;
    try {
        const client = await ensureSupabase();
        const {data, error} = await client.rpc('orbit_unread_counts');
        if (error || currentUser?.id !== owner) return;
        if (revision !== orbitUnreadRevision) {
            clearTimeout(orbitUnreadSyncTimer); orbitUnreadSyncTimer = setTimeout(syncOrbitUnreadCounts, 500); return;
        }
        orbitUnreadCounts.clear(); unreadRoomsSet.clear();
        for (const row of data || []) {
            const count = Number(row.unread_count);
            if (count > 0) { orbitUnreadCounts.set(row.room, count); unreadRoomsSet.add(row.room); }
        }
        persistOrbitUnread(); renderOrbitUnreadCounts();
    } catch (_) {}
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
    if (!document.hidden && currentUser) {
        if (isOrbitChatVisible(currentRoom)) markRoomAsRead(currentRoom);
        syncOrbitUnreadCounts();
    } else if (typeof stopTypingBroadcast === 'function') stopTypingBroadcast();
});
window.addEventListener('focus', () => { if (isOrbitChatVisible(currentRoom)) markRoomAsRead(currentRoom); });
window.addEventListener('online', syncOrbitUnreadCounts);
