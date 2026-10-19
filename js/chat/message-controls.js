// Server-confirmed deletion, message selection, expiring locations and readable bubbles.
const orbitMessageSelection = new Set();
let orbitSelectionRoom = null;
let orbitDeleteBusy = false;
const orbitDeletionLedger = new Map();
function orbitMessageKey(id) { return `${currentUser?.id || ''}:${id}`; }
function orbitHiddenKey() { return `orbit_hidden_messages_${currentUser?.id || 'guest'}`; }
function orbitHiddenMessages() {
    try { return new Set(JSON.parse(localStorage.getItem(orbitHiddenKey()) || '[]')); } catch (_) { return new Set(); }
}
function orbitIsMessageHidden(id) { return orbitHiddenMessages().has(String(id)); }
function orbitLocationExpired(message, now = Date.now()) {
    if (message.type !== 'location') return false;
    const deadline = Date.parse(message.expires_at || '') || Date.parse(message.created_at) + 300000;
    return Number.isFinite(deadline) && now >= deadline;
}
function orbitNormalizeMessage(message) {
    if (!message) return message;
    let reply = message.reply_to;
    if (typeof reply === 'string') { try { reply = JSON.parse(reply); } catch (_) { reply = null; } }
    if (reply?.id && orbitDeletionLedger.has(orbitMessageKey(reply.id)) && reply.text !== 'This message was deleted') {
        message = {...message, reply_to:{...reply, type:'text', text:'This message was deleted', attachments:[]}};
    } else if (reply?.type === 'location' && reply.text !== 'Location shared for 5 minutes') {
        message = {...message, reply_to:{...reply, text:'Location shared for 5 minutes', attachments:[]}};
    }
    const deleted = message.deleted_at || message.is_deleted || orbitDeletionLedger.has(orbitMessageKey(message.id)) ||
        ['🚫 This message was deleted', '🚫 You deleted this message'].includes(message.text);
    if (!deleted && !orbitLocationExpired(message)) return message;
    return {...message, location_expired:orbitLocationExpired(message), is_deleted:true, text:'🚫 This message was deleted', attachments:[], reply_to:null, reactions:{}};
}
function orbitRememberDeletion(message) {
    orbitDeletionLedger.set(orbitMessageKey(message.id), true);
    for (const [room, messages] of messageCache) {
        const cleaned = messages.map(m => orbitNormalizeMessage(m.id === message.id ? {...m, ...message} : m));
        if (cleaned.every((m, index) => m === messages[index])) continue;
        messageCache.set(room, cleaned);
        try { localStorage.setItem(`orbit_cache_msgs_${room}`, JSON.stringify(cleaned.slice(-50))); } catch (_) {}
    }
    // Retain confirmation across restart, even if a stale history response races deletion.
    try {
        const key = `orbit_deleted_messages_${currentUser.id}`;
        const ids = new Set(JSON.parse(localStorage.getItem(key) || '[]')); ids.add(String(message.id));
        localStorage.setItem(key, JSON.stringify([...ids]));
    } catch (_) {}
    document.querySelectorAll('.quoted-reply-box[data-reply-id]').forEach(quote => {
        if (quote.dataset.replyId === String(message.id)) {
            const snippet = quote.querySelector('.quoted-reply-snippet');
            if (snippet) snippet.textContent = 'This message was deleted';
        }
    });
    if (typeof handleMessageDeleted === 'function') handleMessageDeleted(message.id, message.room);
}
function orbitRestoreDeletionLedger() {
    try { JSON.parse(localStorage.getItem(`orbit_deleted_messages_${currentUser.id}`) || '[]').forEach(id => orbitDeletionLedger.set(orbitMessageKey(id), true)); } catch (_) {}
}
function orbitFindMessage(id, room = currentRoom) {
    return (messageCache.get(room) || []).find(m => String(m.id) === String(id));
}
async function orbitDeleteMessagesForEveryone(ids, room = currentRoom) {
    if (orbitDeleteBusy || !currentUser?.id || !ids.length) return [];
    if (ids.length > 100) { showToast('Select up to 100 messages at a time.', 'info'); return []; }
    const owner = currentUser.id;
    const messages = ids.map(id => orbitFindMessage(id, room));
    if (messages.some(m => !m || m.sender_id !== owner || ['queued','sending','failed'].includes(m.status) || m.broadcast_pending)) {
        showToast('Select only your delivered messages to delete for everyone.', 'info'); return [];
    }
    if (!confirm(`Delete ${ids.length === 1 ? 'this message' : `${ids.length} messages`} for everyone?`)) return [];
    orbitDeleteBusy = true; orbitUpdateSelectionBar();
    try {
        const client = await ensureSupabase();
        const {data, error} = await client.rpc('orbit_delete_messages', {message_keys:ids});
        if (error) throw error;
        if (currentUser?.id !== owner) return [];
        const confirmed = Array.isArray(data) ? data.filter(m => m?.deleted_at && ids.includes(String(m.id)) && messages.some(original => String(original.id) === String(m.id) && original.room === m.room)) : [];
        const confirmedIds = new Set(confirmed.map(m => String(m.id)));
        confirmed.forEach(orbitRememberDeletion);
        if (confirmedIds.size !== ids.length) {
            showToast('Some messages were not confirmed deleted. Remaining messages are selected for retry.', 'error');
            return [...confirmedIds];
        }
        showToast(`${ids.length === 1 ? 'Message' : `${ids.length} messages`} deleted for everyone`, 'success');
        return [...confirmedIds];
    } catch (error) {
        const missing = /PGRST202|function.*not.*found|schema cache/i.test(`${error.code} ${error.message}`);
        showToast(missing ? 'Message deletion needs the latest backend update. Nothing was marked deleted.' : `Deletion not confirmed: ${error.message || 'Check your connection and retry.'}`, 'error');
        return [];
    } finally { orbitDeleteBusy = false; orbitUpdateSelectionBar(); }
}
function orbitDeleteMessagesForMe(ids) {
    const hidden = orbitHiddenMessages(); ids.forEach(id => hidden.add(String(id)));
    try { localStorage.setItem(orbitHiddenKey(), JSON.stringify([...hidden])); }
    catch (_) { showToast('Could not save deletion on this device.', 'error'); return false; }
    for (const [room, messages] of messageCache) {
        const remaining = messages.filter(m => !hidden.has(String(m.id)));
        messageCache.set(room, remaining);
        try { localStorage.setItem(`orbit_cache_msgs_${room}`, JSON.stringify(remaining.slice(-50))); } catch (_) {}
    }
    ids.forEach(id => document.getElementById(`msg-${id}`)?.remove());
    showToast('Deleted for you on this device', 'success'); return true;
}
function orbitStartMessageSelection(id) {
    orbitSelectionRoom = currentRoom; orbitMessageSelection.clear();
    if (id) orbitMessageSelection.add(String(id));
    closeChatOptionsMenu(); orbitUpdateSelectionBar();
}
function orbitEndMessageSelection() {
    orbitSelectionRoom = null; orbitMessageSelection.clear(); orbitUpdateSelectionBar();
}
function orbitUpdateSelectionBar() {
    const bar = document.getElementById('message-selection-bar'); if (!bar) return;
    const active = !!orbitSelectionRoom && orbitSelectionRoom === currentRoom;
    bar.hidden = !active;
    const ids = [...orbitMessageSelection];
    document.getElementById('message-selection-count').textContent = `${ids.length} selected`;
    const everyone = document.getElementById('message-delete-everyone');
    everyone.disabled = orbitDeleteBusy || !ids.length || ids.some(id => {
        const m = orbitFindMessage(id); return !m || m.sender_id !== currentUser?.id || m.is_deleted || m.deleted_at || m.broadcast_pending || ['queued','sending','failed'].includes(m.status);
    });
    document.getElementById('message-delete-me').disabled = orbitDeleteBusy || !ids.length;
    document.querySelectorAll('#chat-feed .msg-bubble-row').forEach(row => {
        row.classList.toggle('message-selection-active', active);
        row.classList.toggle('message-selected', active && orbitMessageSelection.has(row.dataset.msgId));
        if (active) { row.setAttribute('role','checkbox'); row.setAttribute('aria-checked', String(orbitMessageSelection.has(row.dataset.msgId))); row.tabIndex=0; }
        else { row.removeAttribute('role'); row.removeAttribute('aria-checked'); row.removeAttribute('tabindex'); }
    });
}
async function orbitDeleteSelected(everyone) {
    if (orbitSelectionRoom !== currentRoom || orbitDeleteBusy) return;
    const room = orbitSelectionRoom;
    const ids = [...orbitMessageSelection];
    if (!everyone) { if (ids.length && confirm(`Delete ${ids.length} messages for you on this device?`) && orbitDeleteMessagesForMe(ids)) orbitEndMessageSelection(); return; }
    const removed = await orbitDeleteMessagesForEveryone(ids, orbitSelectionRoom);
    if (orbitSelectionRoom !== room || currentRoom !== room) return;
    removed.forEach(id => orbitMessageSelection.delete(id));
    if (!orbitMessageSelection.size) orbitEndMessageSelection(); else orbitUpdateSelectionBar();
}
function orbitBindMessageSelection(row, message) {
    const toggle = event => {
        if (orbitSelectionRoom !== currentRoom || !orbitSelectionRoom) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (orbitDeleteBusy) return;
        const id = String(message.id);
        if (orbitMessageSelection.has(id)) orbitMessageSelection.delete(id);
        else if (orbitMessageSelection.size < 100) orbitMessageSelection.add(id);
        else showToast('Select up to 100 messages at a time.', 'info');
        orbitUpdateSelectionBar();
    };
    row.addEventListener('click', toggle, true);
    row.addEventListener('touchstart', event => {
        if (orbitSelectionRoom === currentRoom && orbitSelectionRoom) event.stopImmediatePropagation();
    }, {capture:true,passive:true});
    row.addEventListener('touchend', event => {
        if (orbitSelectionRoom === currentRoom && orbitSelectionRoom) event.stopImmediatePropagation();
    }, {capture:true,passive:true});
    row.addEventListener('dblclick', event => {
        if (orbitSelectionRoom === currentRoom && orbitSelectionRoom) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    row.addEventListener('contextmenu', event => {
        if (orbitSelectionRoom === currentRoom && orbitSelectionRoom) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    row.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') toggle(event); });
    if (orbitSelectionRoom && orbitSelectionRoom === currentRoom) {
        row.classList.add('message-selection-active'); row.classList.toggle('message-selected',orbitMessageSelection.has(String(message.id)));
        row.setAttribute('role','checkbox'); row.setAttribute('aria-checked',String(orbitMessageSelection.has(String(message.id)))); row.tabIndex=0;
    }
}
function orbitApplyBubbleStyle(value) {
    const allowed = ['balanced','blue','green','solid'];
    const style = allowed.includes(value) ? value : 'balanced';
    const screen = document.getElementById('screen-chat'); if (!screen) return;
    screen.dataset.bubbleStyle = style;
    const input = document.getElementById('chat-bubble-style'); if (input) input.value = style;
}
function orbitSetBubbleStyle(value) {
    orbitApplyBubbleStyle(value);
    try { localStorage.setItem(`orbit_bubbles_${currentUser?.id}_${currentRoom}`,value); } catch (_) {}
}
function orbitOpenMessageControls() {
    orbitEndMessageSelection(); orbitRestoreDeletionLedger();
    let style; try { style = localStorage.getItem(`orbit_bubbles_${currentUser?.id}_${currentRoom}`); } catch (_) {}
    orbitApplyBubbleStyle(style);
}
function orbitExpireVisibleLocations() {
    if (!currentUser?.id || !currentRoom || document.hidden) return;
    for (const message of messageCache.get(currentRoom) || []) {
        if (orbitLocationExpired(message) && !message.is_deleted) {
            const clean = orbitNormalizeMessage(message);
            for (const [room, messages] of messageCache) {
                if (!messages.some(m => m.id === message.id)) continue;
                const scrubbed = messages.map(m => m.id === message.id ? clean : m);
                messageCache.set(room,scrubbed);
                try { localStorage.setItem(`orbit_cache_msgs_${room}`, JSON.stringify(scrubbed.slice(-50))); } catch (_) {}
            }
            document.getElementById(`msg-${message.id}`)?.replaceWith(createMessageDOMNode(clean));
        }
    }
}
setInterval(orbitExpireVisibleLocations, 1000);
document.addEventListener('visibilitychange', orbitExpireVisibleLocations);
