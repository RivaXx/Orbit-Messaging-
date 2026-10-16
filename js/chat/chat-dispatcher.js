// ORBIT CHAT - MESSAGE DISPATCHER & RESILIENT SENDER (js/chat/chat-dispatcher.js)
// Handles optimistic bubbles, canonical room dispatch, idempotent UUID inserts,
// offline retry queuing, and status tick synchronization.
// v29.5.0 — Fixed: timeout ghost inserts, failed-bubble dedup, retry duplicate prevention

let _isSendingMessage = false;
const _messageOutbox = new Map();
const _messageDeliveryActive = new Set();
const _messageRetryTimers = new Map();
let _outboxHydratedForUser = null;
const _mediaOutboxDbName = 'orbit-media-outbox-v1';
let _mediaOutboxDbPromise = null;
// Some devices deny IndexedDB or cannot clone File objects. Keep the original
// bytes in this tab so a disk-cache failure never prevents an online upload.
const _mediaOutboxMemory = new Map();
const _mediaOutboxVolatile = new Set();
const _pendingChatCacheWrites = new Set();
let _chatCacheWriteTimer = null;
let _mediaUploadLane = Promise.resolve();

function _flushChatCacheWrites() {
    _chatCacheWriteTimer = null;
    for (const alias of _pendingChatCacheWrites) {
        try {
            const safe = (messageCache.get(alias) || []).filter(m => !m.broadcast_pending).slice(-200).map(m => ({
                ...m,
                attachments: (m.attachments || []).map(a => a && /^(blob:|data:)/.test(a.url || '') ? { ...a, url: '' } : a)
            }));
            localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(safe));
        } catch (_) {}
    }
    _pendingChatCacheWrites.clear();
}

function _scheduleChatCachePersist(alias) {
    _pendingChatCacheWrites.add(alias);
    if (_chatCacheWriteTimer === null) _chatCacheWriteTimer = setTimeout(_flushChatCacheWrites, 80);
}
window.addEventListener('pagehide', _flushChatCacheWrites);

function _openMediaOutboxDb() {
    if (_mediaOutboxDbPromise) return _mediaOutboxDbPromise;
    _mediaOutboxDbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('This browser cannot save media for background upload.'));
        let settled = false;
        const timeout = setTimeout(() => { settled = true; reject(new Error('Device media storage did not respond.')); }, 3000);
        let request;
        try { request = indexedDB.open(_mediaOutboxDbName, 1); }
        catch (error) { clearTimeout(timeout); reject(error); return; }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
        };
        request.onsuccess = () => { clearTimeout(timeout); if (settled) { request.result.close(); return; } settled = true; resolve(request.result); };
        request.onerror = () => { clearTimeout(timeout); settled = true; reject(request.error || new Error('Could not open media queue.')); };
    });
    _mediaOutboxDbPromise.catch(() => { _mediaOutboxDbPromise = null; });
    return _mediaOutboxDbPromise;
}

async function _storeOutboxMedia(messageId, index, file) {
    const key = `${messageId}:${index}`;
    _mediaOutboxMemory.set(key, file);
    if (_mediaOutboxVolatile.has(key)) return false;
    try {
        const db = await _openMediaOutboxDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readwrite');
            const timer = setTimeout(() => { try { tx.abort(); } catch (_) {} reject(new Error('Device media storage stalled.')); }, 3000);
            const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
            tx.oncomplete = () => finish();
            tx.onerror = () => finish(tx.error || new Error('Could not save media for upload.'));
            tx.onabort = () => finish(tx.error || new Error('Could not save media for upload.'));
            try { tx.objectStore('files').put({ key, messageId, index, file }); }
            catch (error) { finish(error); }
        });
        _mediaOutboxVolatile.delete(key);
        return true;
    } catch (error) {
        _mediaOutboxVolatile.add(key);
        console.warn('[Orbit] Device media cache unavailable; sending from this tab:', error?.message);
        return false;
    }
}

async function _getOutboxMedia(messageId, index) {
    const memory = _mediaOutboxMemory.get(`${messageId}:${index}`);
    if (memory) return memory;
    const db = await _openMediaOutboxDb();
    return new Promise((resolve, reject) => {
        const request = db.transaction('files', 'readonly').objectStore('files').get(`${messageId}:${index}`);
        request.onsuccess = () => resolve(request.result?.file || null);
        request.onerror = () => reject(request.error || new Error('Could not restore queued media.'));
    });
}

async function _deleteOutboxMedia(messageId, index = null) {
    for (const key of _mediaOutboxMemory.keys()) {
        if (index === null ? key.startsWith(`${messageId}:`) : key === `${messageId}:${index}`) {
            _mediaOutboxMemory.delete(key); _mediaOutboxVolatile.delete(key);
        }
    }
    try {
        const db = await _openMediaOutboxDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            if (index !== null) store.delete(`${messageId}:${index}`);
            else {
                const request = store.openCursor();
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    if (cursor.value?.messageId === messageId) cursor.delete();
                    cursor.continue();
                };
            }
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (_) {}
}

// ── Global in-flight tracking: lets realtime dedup find optimistic bubbles regardless of status ──
// Maps clientMsgId → { clientTempId, room, status }
const _inflightMessages = new Map();
window._inflightMessages = _inflightMessages;

function _messageOutboxStorageKey(userId) {
    return `orbit_message_outbox_v1_${userId}`;
}

function _persistMessageOutbox(userId = currentUser?.id) {
    if (!userId) return;
    try {
        const items = Array.from(_messageOutbox.values())
            .filter(item => item.payload?.sender_id === userId)
            .map(item => {
                const safeItem = { ...item, payload: { ...item.payload, attachments: (item.payload.attachments || []).map(a => ({ ...a })) } };
                (safeItem.mediaUploadInfo || []).forEach(upload => {
                    if (safeItem.payload.attachments[upload.index]?.upload_pending !== false) {
                        safeItem.payload.attachments[upload.index].url = '';
                        safeItem.payload.attachments[upload.index].upload_pending = true;
                    }
                });
                delete safeItem.mediaReadyPromise;
                delete safeItem.progressTimer;
                delete safeItem.previewObjectUrls;
                return safeItem;
            });
        localStorage.setItem(_messageOutboxStorageKey(userId), JSON.stringify(items));
    } catch (error) {
        console.warn('[Orbit] Could not persist message outbox:', error);
    }
}

function _updateOutboxMessage(item, status, error = null) {
    item.status = status;
    item.lastError = error?.message || null;
    const cacheMessage = { ...item.payload, client_temp_id: item.clientTempId, status };
    (item.aliases || [item.payload.room]).forEach(alias => {
        const messages = messageCache.get(alias) || [];
        const index = messages.findIndex(message => message.id === item.payload.id || message.client_temp_id === item.clientTempId);
        if (index >= 0) messages[index] = cacheMessage;
        else messages.push(cacheMessage);
        const sorted = deduplicateAndSort(messages);
        messageCache.set(alias, sorted);
        _scheduleChatCachePersist(alias);
    });
    let node = document.getElementById(`msg-${item.payload.id}`) ||
        document.getElementById(`msg-${item.clientTempId}`) ||
        document.querySelector(`[data-client-temp-id="${item.clientTempId}"]`) ||
        document.querySelector(`[data-msg-id="${item.payload.id}"]`);
    if (node) {
        if (['sending', 'sent', 'delivered', 'read'].includes(status) &&
            cacheMessage.attachments?.length && cacheMessage.attachments.every(a => a?.url && !a.upload_pending) &&
            node.dataset.mediaDelivered !== 'true' && typeof createMessageDOMNode === 'function') {
            // Reloaded pending media has no blob URL. Rebuild its final bubble
            // and click handlers from the confirmed attachment, not only ticks.
            const replacement = createMessageDOMNode(cacheMessage, node.classList.contains('grouped-consecutive'));
            replacement.dataset.mediaDelivered = 'true';
            node.replaceWith(replacement);
            node = replacement;
        }
        if (['sent','delivered','read','failed','error'].includes(status)) {
            node.querySelectorAll('.media-floating-status,.media-upload-pct-label').forEach(el => el.remove());
            node.id = `msg-${item.payload.id}`;
            node.dataset.msgId = item.payload.id;
            const overlay = node.querySelector('.media-upload-overlay');
            if (overlay) {
                overlay.classList.add('upload-complete');
                setTimeout(() => { try { overlay.remove(); } catch(e){} }, 350);
            }
        }
        const meta = node.querySelector('.msg-meta-row');
        if (meta) {
            let tick = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
            const tickHtml = getTickIconHtml({ ...cacheMessage, client_temp_id: item.payload.id });
            if (tick) {
                tick.outerHTML = tickHtml;
            } else if (tickHtml) {
                const span = document.createElement('span');
                span.innerHTML = tickHtml;
                meta.appendChild(span.firstElementChild || span);
            }
        }
    }
    _persistMessageOutbox(item.payload.sender_id);
}

function _isTransientMessageError(error) {
    if (!error || !navigator.onLine) return true;
    const code = String(error.code || '');
    if (['42501', '22P02', '23503', '23505', '23514', '42703', '42804', '42P01', 'PGRST204', 'PGRST205'].includes(code)) return false;
    const message = String(error.message || error.error_description || '');
    const parsedHttpStatus = Number(message.match(/HTTP\s+(\d{3})/i)?.[1] || 0);
    const status = Number(error.status || error.statusCode || parsedHttpStatus || 0);
    if (status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) return false;
    if (/permission|not authorized|unauthorized|policy|bucket.*(missing|not found)|bad request|invalid|schema cache|column/i.test(message)) return false;
    return status >= 500 || [408, 409, 425, 429].includes(status) || /network|failed to fetch|fetch failed|timeout|abort|offline|connection|temporar|cors/i.test(message);
}

function _scheduleMessageRetry(item) {
    if (_messageRetryTimers.has(item.payload.id) || !navigator.onLine) return;
    const delay = Math.min(30000, 800 * Math.pow(2, Math.min(item.attempt || 0, 5)));
    const timer = setTimeout(() => {
        _messageRetryTimers.delete(item.payload.id);
        _deliverOutboxMessage(item.payload.id);
    }, delay);
    _messageRetryTimers.set(item.payload.id, timer);
}

async function _deliverOutboxMessage(messageId) {
    const item = _messageOutbox.get(messageId);
    if (!item || _messageDeliveryActive.has(messageId) || item.status === 'failed') return;
    if (!currentUser?.id || item.payload.sender_id !== currentUser.id) return;
    if (!navigator.onLine) {
        _updateOutboxMessage(item, 'queued');
        if (!item.offlineNotified) {
            item.offlineNotified = true;
            _persistMessageOutbox(item.payload.sender_id);
            showToast('Message saved on this device. It will send automatically when you reconnect.', 'info');
        }
        return;
    }
    _messageDeliveryActive.add(messageId);
    if (item.mediaUploadInfo?.length) {
        _updateOutboxMessage(item, 'sending');
    }
    try {
        if (item.mediaUploadInfo?.length) {
            // One media transfer at a time leaves capacity for small text sends.
            const previousUpload = _mediaUploadLane;
            let releaseUpload;
            _mediaUploadLane = new Promise(resolve => { releaseUpload = resolve; });
            await previousUpload;
            try {
                if (_messageOutbox.get(messageId) !== item) return;
                await _uploadQueuedMedia(item);
            } finally { releaseUpload(); }
        }
        if (_messageOutbox.get(messageId) !== item || item.cancelled) return;
        if (typeof sendFastMessagePreview === 'function') sendFastMessagePreview(item.payload);
        const { data, error } = await executeResilientMessageInsert(item.payload);
        // Realtime can confirm the insert before the slower REST response; its
        // acknowledgement wins and a late timeout must not revert to failed.
        if (_messageOutbox.get(messageId) !== item) return;
        if (error) {
            if (_isTransientMessageError(error)) {
                item.attempt = (item.attempt || 0) + 1;
                // Keep unconfirmed messages visibly pending.
                _updateOutboxMessage(item, 'queued', error);
                if (!item.slowConnectionNotified && item.attempt >= 2) {
                    item.slowConnectionNotified = true;
                    _persistMessageOutbox(item.payload.sender_id);
                    showToast('Connection is slow. Message is saved and will retry automatically.', 'info');
                }
                _scheduleMessageRetry(item);
            } else {
                _updateOutboxMessage(item, 'failed', error);
                showToast('Message was not accepted: ' + (error.message || 'Check Supabase message permissions/schema.'), 'error');
            }
            return;
        }
        if (item.progressTimer) clearInterval(item.progressTimer);
        const sentMessage = { ...item.payload, ...(data || {}), status: 'sent' };
        item.payload = { ...sentMessage };
        _updateOutboxMessage(item, 'sent');
        _messageOutbox.delete(messageId);
        await _deleteOutboxMedia(messageId);
        _persistMessageOutbox(sentMessage.sender_id);
        _inflightMessages.delete(messageId);
        if (typeof updateBubbleSendingProgress === 'function') {
            updateBubbleSendingProgress(messageId, 100);
            if (item.clientTempId) updateBubbleSendingProgress(item.clientTempId, 100);
        }
    } catch (error) {
        if (_messageOutbox.get(messageId) !== item) return;
        hideChatMediaUploadProgress();
        if (/missing on this device|cannot save media|device storage error|browser cannot save media/i.test(error?.message || '')) {
            _updateOutboxMessage(item, 'failed', error);
            showToast(error.message || 'Media could not be restored. Select it again to retry.', 'error');
            return;
        }
        if (!_isTransientMessageError(error)) {
            _updateOutboxMessage(item, 'failed', error);
            showToast('Media was queued but the upload was rejected: ' + (error.message || 'Check Supabase Storage permissions and bucket settings.'), 'error');
            return;
        }
        item.attempt = (item.attempt || 0) + 1;
        _updateOutboxMessage(item, 'queued', error);
        _scheduleMessageRetry(item);
    } finally {
        _messageDeliveryActive.delete(messageId);
    }
}

function _hydrateAndResumeMessageOutbox(userId = currentUser?.id) {
    if (!userId) return;
    if (_outboxHydratedForUser !== userId) {
        _outboxHydratedForUser = userId;
        try {
            const stored = JSON.parse(localStorage.getItem(_messageOutboxStorageKey(userId)) || '[]');
            if (Array.isArray(stored)) stored.forEach(item => {
                if (item?.payload?.id && item.payload.sender_id === userId) {
                    delete item.progressTimer;
                    const oldNetworkFailure = /Network error during file upload|failed to fetch|ERR_INTERNET_DISCONNECTED|timed out|connection dropped/i.test(item.lastError || '');
                    item.status = item.status === 'failed' && !oldNetworkFailure ? 'failed' : 'queued';
                    _messageOutbox.set(item.payload.id, item);
                }
            });
        } catch (_) {}
    }
    _messageOutbox.forEach(item => {
        if (item.payload.sender_id === userId && item.status !== 'failed') _deliverOutboxMessage(item.payload.id);
    });
}

function confirmMessageDeliveredFromRealtime(serverMessage) {
    const item = serverMessage?.id ? _messageOutbox.get(serverMessage.id) : null;
    if (!item || serverMessage.sender_id !== item.payload.sender_id) return;
    const isRoomMatch = serverMessage.room === item.payload.room || (Array.isArray(item.aliases) && item.aliases.includes(serverMessage.room));
    if (!isRoomMatch) return;
    if (item.progressTimer) clearInterval(item.progressTimer);
    _deleteOutboxMedia(serverMessage.id).catch(() => {});
    item.payload = { ...item.payload, ...serverMessage };
    _updateOutboxMessage(item, 'sent');
    _messageOutbox.delete(serverMessage.id);
    const timer = _messageRetryTimers.get(serverMessage.id);
    if (timer) clearTimeout(timer);
    _messageRetryTimers.delete(serverMessage.id);
    _inflightMessages.delete(serverMessage.id);
    _persistMessageOutbox(item.payload.sender_id);
    if (typeof updateBubbleSendingProgress === 'function') {
        updateBubbleSendingProgress(serverMessage.id, 100);
        if (item.clientTempId) updateBubbleSendingProgress(item.clientTempId, 100);
    }
}
window.confirmMessageDeliveredFromRealtime = confirmMessageDeliveredFromRealtime;

window.addEventListener('online', () => _hydrateAndResumeMessageOutbox());
setTimeout(() => {
    try {
        const client = getSupabase();
        if (!client?.auth) return;
        client.auth.getSession().then(({ data }) => {
            if (data?.session?.user) {
                currentUser = currentUser || data.session.user;
                _hydrateAndResumeMessageOutbox(data.session.user.id);
            }
        }).catch(() => {});
        client.auth.onAuthStateChange((_event, session) => {
            if (session?.user) setTimeout(() => _hydrateAndResumeMessageOutbox(session.user.id), 0);
        });
    } catch (_) {}
}, 0);

async function sendMessage() {
    if (typeof orbitEditingMessage !== "undefined" && orbitEditingMessage) return orbitSaveEdit();
    // ── Double-send guard: prevent duplicate messages from rapid clicks or Enter key-repeat ──
    if (_isSendingMessage) return;

    const input = document.getElementById('msg-input');
    const text = input ? input.value.trim() : '';
    if (!text && pendingAttachments.length === 0) return;
    if (!currentRoom) return;
    // Bind this send to the room visible at click time. Network responses may
    // arrive after navigation and must never use a later currentRoom value.
    const sendViewRoom = currentRoom;
    const sendPeerId = activeChatPeerId;

    if (sendPeerId && typeof isUserBlocked === 'function' && isUserBlocked(sendPeerId)) {
        showToast('You have blocked this user. Unblock to send messages.', 'error');
        return;
    }

    // ── Engage lock immediately before any async/DOM work ──
    _isSendingMessage = true;

    // ── Session Verification: Ensure user is authenticated ──
    if (!currentUser || !currentUser.id) {
        try {
            const client = await ensureSupabase();
            const { data: { session } } = await client.auth.getSession();
            if (session && session.user) {
                currentUser = session.user;
            }
        } catch(e) {}
    }
    if (!currentUser || !currentUser.id) {
        _isSendingMessage = false;
        showToast('Please sign in again to send messages.', 'error');
        return;
    }
    if (currentRoom !== sendViewRoom) {
        _isSendingMessage = false;
        showToast('Chat changed before the message could send. Reopen that chat and retry.', 'error');
        return;
    }

    if (input) { input.value = ''; input.style.height = 'auto'; }
    stopTypingBroadcast();

    let sendRoomId = sendViewRoom;
    if (!isGroupChat && sendPeerId && currentUser) {
        if (typeof userDirectRoomsMap !== 'undefined' && userDirectRoomsMap.get(sendPeerId)) {
            const mapped = userDirectRoomsMap.get(sendPeerId);
            if (mapped && !mapped.startsWith('dm_')) sendRoomId = mapped;
        }
        if (sendRoomId === sendViewRoom && typeof allRoomsMap !== 'undefined') {
            const canonicalRoom = Array.from(allRoomsMap.values()).find(room =>
                room && room.is_direct === true && Array.isArray(room.participants) &&
                room.participants.length === 2 &&
                room.participants.includes(currentUser.id) && room.participants.includes(sendPeerId)
            );
            if (canonicalRoom) sendRoomId = canonicalRoom.id;
        }
    }
    const sendAliases = Array.from(new Set([
        ...(typeof resolveRoomAliases === 'function' ? resolveRoomAliases(sendViewRoom, sendPeerId) : [sendViewRoom]),
        sendRoomId
    ]));
    // Standard JSON object attachments for 100% JSONB compatibility
    const attData = pendingAttachments.map(a => ({
        name: a.name || 'File',
        url: a.url || '',
        type: a.type || 'file'
    }));

    // Generate valid UUID for idempotent database insert & immediate client tracking
    const clientMsgId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    const clientTempId = `c_${Date.now()}_${clientMsgId.substring(0, 8)}`;

    const payload = {
        id: clientMsgId,
        room: sendRoomId,
        sender_id: currentUser.id,
        username: userProfile?.first_name ? `${userProfile.first_name}` : (currentUser.email ? currentUser.email.split('@')[0] : 'User'),
        text: text || null,
        type: pendingAttachments.length > 0 ? (pendingAttachments[0].type || 'file') : 'text',
        attachments: attData,
        reply_to: replyTargetMessage ? { id: replyTargetMessage.id, username: replyTargetMessage.username, text: replyTargetMessage.text } : null,
        created_at: new Date().toISOString()
    };

    pendingAttachments = [];
    if (typeof updateDynamicActionButtons === 'function') {
        updateDynamicActionButtons();
    }
    const mediaStrip = document.getElementById('media-preview-strip');
    if (mediaStrip) {
        mediaStrip.classList.add('hide');
        mediaStrip.innerHTML = '';
    }

    // Clear reply bar
    if (replyTargetMessage) {
        replyTargetMessage = null;
        document.getElementById('reply-preview-bar')?.classList.add('hide');
    }

    const isMedia = Array.isArray(payload.attachments) && payload.attachments.length > 0;

    // Show a pending state until the database confirms delivery; media also shows upload progress.
    const optimisticMsg = {
        ...payload,
        id: clientMsgId,
        client_temp_id: clientTempId,
        status: 'sending',
        upload_pct: isMedia ? 0 : undefined
    };

    // Register in global in-flight tracker so realtime dedup can always find this bubble
    _inflightMessages.set(clientMsgId, { clientTempId, room: sendRoomId, status: 'sending', text: payload.text });

    let msgs = messageCache.get(sendViewRoom) || [];
    msgs.push(optimisticMsg);
    sendAliases.forEach(alias => {
        messageCache.set(alias, msgs);
        _scheduleChatCachePersist(alias);
    });

    const feed = document.getElementById('chat-feed');
    const wasNearBottom = !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 220;
    appendSingleMessageNode(optimisticMsg);
    if (wasNearBottom) {
        scrollFeedToBottom(true);
    } else {
        const badge = document.getElementById('scroll-bottom-unread-badge');
        if (badge) {
            badge.innerText = String((parseInt(badge.innerText || '0', 10) || 0) + 1);
            badge.classList.remove('hide');
        }
    }
    // Release lock immediately after optimistic render — user can type next message right away
    _isSendingMessage = false;

    // A joined private channel can show the peer a preview while REST saves it.
    // Never send private message bodies to the global public channel.
    const outboxItem = { payload, aliases: sendAliases, clientTempId, attempt: 0, status: 'queued' };
    _messageOutbox.set(clientMsgId, outboxItem);
    _persistMessageOutbox(currentUser.id);
    _deliverOutboxMessage(clientMsgId);
}

// Queue media locally and render its bubble before any network transfer. The
// actual message row is inserted only after every attachment has a durable URL.
async function queueMediaMessage(items, caption = '', messageType = null, targetContext = null) {
    if (!Array.isArray(items) || !items.length || !currentRoom || !currentUser?.id) return;
    const roomAtSend = targetContext?.roomId || currentRoom;
    const userAtSend = targetContext?.userId || currentUser.id;
    if (currentRoom !== roomAtSend || currentUser.id !== userAtSend) {
        showToast('Chat changed before the media was queued. Reopen the original chat and try again.', 'error');
        return;
    }
    const peerAtSend = activeChatPeerId;
    if (peerAtSend && typeof isUserBlocked === 'function' && isUserBlocked(peerAtSend)) {
        showToast('You have blocked this user. Unblock to send messages.', 'error');
        return;
    }

    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
    if(items.some(item=>!item.file && !item.url?.startsWith('data:')))throw new Error('An original file is missing. Select the photos again.');
    const originals = items.map((item,index)=>item.type==='image' && item.originalQuality ? index : -1).filter(index=>index>=0);
    if (originals.length) {
        const client = await ensureSupabase();
        const {error} = await client.rpc('orbit_reserve_original_photos',{message_key:id,photo_indexes:originals});
        if(error) throw new Error(error.message || 'Could not reserve original-quality allowance.');
        if(currentUser?.id!==userAtSend || currentRoom!==roomAtSend)throw new Error('The account or chat changed. Reopen the original chat before sending.');
    }
    const tempId = `c_${Date.now()}_${id.slice(0, 8)}`;
    let sendRoomId = roomAtSend;
    if (!isGroupChat && peerAtSend && typeof allRoomsMap !== 'undefined') {
        const canonicalRoom = Array.from(allRoomsMap.values()).find(room =>
            room && room.is_direct === true && Array.isArray(room.participants) && room.participants.length === 2 &&
            room.participants.includes(userAtSend) && room.participants.includes(peerAtSend)
        );
        if (canonicalRoom) sendRoomId = canonicalRoom.id;
    }
    const aliases = Array.from(new Set([
        ...(typeof resolveRoomAliases === 'function' ? resolveRoomAliases(roomAtSend, peerAtSend) : [roomAtSend]),
        roomAtSend,
        sendRoomId
    ]));
    const mediaUploadInfo = [];
    const attachments = items.map((item, index) => {
        let file = item.file;
        if (!file && item.url && item.url.startsWith('data:')) {
            try {
                const arr = item.url.split(',');
                const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) u8arr[n] = bstr.charCodeAt(n);
                file = new Blob([u8arr], { type: mime });
                file.name = item.name || `photo_${Date.now()}.jpg`;
            } catch (_) {}
        }
        if (!file) throw new Error(`Could not queue ${item.name || 'media'}: the original file is no longer available.`);
        const type = item.type || (file.type?.startsWith('image/') ? 'image' : file.type?.startsWith('video/') ? 'video' : 'file');
        const name = item.name || file.name || `media-${index + 1}`;
        const previewUrl = (file instanceof Blob || file instanceof File) ? URL.createObjectURL(file) : (item.url || '');
        item.file = file;
        mediaUploadInfo.push({ index, name, type, mime: file.type || 'application/octet-stream', rotation: Number(item.rotation || 0), hdQuality: !!isPreviewHdQuality, originalQuality: !!item.originalQuality, subfolder: type === 'image' ? 'images' : type === 'video' ? 'videos' : 'documents' });
        return { name, url: previewUrl, type, size: file.size, upload_pending: true, view_once: !!item.viewOnce };
    });
    const payload = {
        id,
        room: sendRoomId,
        sender_id: userAtSend,
        username: userProfile?.first_name ? `${userProfile.first_name}` : (currentUser.email ? currentUser.email.split('@')[0] : 'User'),
        text: String(caption || '').trim() || null,
        type: messageType || attachments[0]?.type || 'file',
        attachments,
        reply_to: replyTargetMessage ? { id: replyTargetMessage.id, username: replyTargetMessage.username, text: replyTargetMessage.text } : null,
        created_at: new Date().toISOString()
    };
    const item = { payload, aliases, clientTempId: tempId, attempt: 0, status: 'queued', mediaUploadInfo };
    item.mediaReadyPromise = Promise.all(mediaUploadInfo.map(info => _storeOutboxMedia(id, info.index, items[info.index].file)));
    _messageOutbox.set(id, item);
    _inflightMessages.set(id, { clientTempId: tempId, room: roomAtSend, status: 'sending', text: payload.text });

    const msgs = messageCache.get(roomAtSend) || [];
    msgs.push({ ...payload, client_temp_id: tempId, status: 'sending' });
    aliases.forEach(alias => {
        messageCache.set(alias, msgs);
        try {
            const persisted = msgs.slice(-40).map(message => message.id === id
                ? { ...message, attachments: message.attachments.map(a => ({ ...a, url: '' })) }
                : message);
            localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(persisted));
        } catch (_) {}
    });
    appendSingleMessageNode({ ...payload, client_temp_id: tempId, status: 'sending' });
    const feed = document.getElementById('chat-feed');
    if (!feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 220) scrollFeedToBottom(true);
    const input = document.getElementById('msg-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    if (replyTargetMessage) {
        replyTargetMessage = null;
        document.getElementById('reply-preview-bar')?.classList.add('hide');
    }
    _persistMessageOutbox(userAtSend);
    item.mediaReadyPromise.then(() => {
        if (mediaUploadInfo.some(info => _mediaOutboxVolatile.has(`${id}:${info.index}`))) {
            showToast('Device storage is unavailable. Keep this tab open until the media finishes sending.', 'info');
        }
        return _deliverOutboxMessage(id);
    }).catch(error => {
        item.status = 'failed';
        _updateOutboxMessage(item, 'failed', error);
        showToast(`Media saved in chat but could not be queued for upload: ${error.message || 'device storage error'}`, 'error');
    });
}
window.queueMediaMessage = queueMediaMessage;

async function _uploadQueuedMedia(item) {
    if (!Array.isArray(item.mediaUploadInfo) || !item.mediaUploadInfo.length) return;
    if (item.mediaReadyPromise) await item.mediaReadyPromise;
    const totalUploads = item.mediaUploadInfo.length;
    let completedCount = 0;
    const uploadBytes = new Map();
    const completedPreviewUrls = item.previewObjectUrls || (item.previewObjectUrls = []);
    const uploadTotals = new Map(item.mediaUploadInfo.map(info => [info.index, Number(item.payload.attachments[info.index]?.size) || 0]));
    const reportProgress = () => {
        const loaded = [...uploadBytes.values()].reduce((a,b) => a+b,0);
        const total = [...uploadTotals.values()].reduce((a,b) => a+b,0);
        const pct = total ? Math.min(99, Math.floor(loaded / total * 100)) : 0;
        updateBubbleSendingProgress(item.payload.id, pct);
        if (item.clientTempId) updateBubbleSendingProgress(item.clientTempId, pct);
    };

    // Serialize uploads so one failed request cannot race other files or queue persistence.
    for (const info of item.mediaUploadInfo) {
        if (item.cancelled) return;
        const saved = item.payload.attachments[info.index];
        if (saved?.upload_pending === false && (/^https?:\/\//.test(saved.url || '') || saved.storage_bucket==='orbit-view-once')) {
            completedCount++;
            uploadBytes.set(info.index, uploadTotals.get(info.index));
            reportProgress();
            continue;
        }
        const file = await _getOutboxMedia(item.payload.id, info.index);
        if (!file) throw new Error(`Queued file ${info.name || ''} is missing on this device. Please select it again.`);
        uploadTotals.set(info.index, file.size);
        const attachment = item.payload.attachments[info.index];
        if (attachment && !attachment.url) {
            attachment.url = URL.createObjectURL(file);
            attachment.upload_pending = true;
        }

        let uploadBody = file;
        let mime = info.mime;


        if (!info.prepared && info.rotation && typeof bakeImageRotation === 'function') {
            const rotationUrl = URL.createObjectURL(file);
            const rotated = await bakeImageRotation(rotationUrl, info.rotation);
            URL.revokeObjectURL(rotationUrl);
            if (rotated?.startsWith('data:image/')) uploadBody = rotated;
        }

        if (!info.prepared && !info.originalQuality && info.type === 'image' && !/image\/(gif|svg\+xml)/i.test(info.mime) && typeof compressImageForUpload === 'function') {
            const isHd = info.hdQuality;
            const slowLink = ['slow-2g', '2g', '3g'].includes(navigator.connection?.effectiveType) || navigator.connection?.saveData;
            const targetDim = isHd ? 2560 : slowLink ? 720 : 1080;
            const targetQuality = isHd ? 0.92 : slowLink ? 0.58 : 0.70;
            const compressed = await compressImageForUpload(uploadBody, targetDim, targetQuality);
            if (compressed?.startsWith('data:image/')) {
                uploadBody = compressed;
                mime = compressed.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';

            }
        }

        if (!info.prepared) {
            if (typeof uploadBody === 'string' && uploadBody.startsWith('data:')) {
                const encoded = uploadBody.split(',')[1];
                const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
                const converted = new Blob([bytes], { type: mime });
                if (info.rotation || converted.size < file.size) uploadBody = converted;
                else { uploadBody = file; mime = file.type || info.mime; }
            }
            await _storeOutboxMedia(item.payload.id, info.index, uploadBody);
            info.prepared = true;
            info.rotation = 0;
            info.mime = mime;
            attachment.size = uploadBody.size;
            _persistMessageOutbox(item.payload.sender_id);
        }

        let url = null, privatePhoto = null;
        try {
            if(attachment?.view_once){
                privatePhoto=await uploadOrbitPrivatePhoto(uploadBody,info.name,item.payload.id,info.index,progress=>{uploadTotals.set(info.index,progress.total||uploadBody.size);uploadBytes.set(info.index,progress.loaded||0);reportProgress();});url=privatePhoto.url;
            } else url = await uploadMediaToStorage(uploadBody, info.name, mime, info.subfolder, progress => {
                updateChatMediaUploadProgress(info.name, progress.percent, completedCount, totalUploads);
                uploadTotals.set(info.index, progress.total);
                uploadBytes.set(info.index, progress.loaded);
                reportProgress();
                const overallPct = Math.min(99, Math.floor([...uploadBytes.values()].reduce((a,b)=>a+b,0) / [...uploadTotals.values()].reduce((a,b)=>a+b,0) * 100));
                if (typeof updateBubbleSendingProgress === 'function') {
                    updateBubbleSendingProgress(item.payload.id, overallPct);
                    if (item.clientTempId) updateBubbleSendingProgress(item.clientTempId, overallPct);
                }
            }, `${item.payload.id}_${info.index}`);
        } catch (uploadError) {
            console.warn('[Orbit] Cloud storage upload failed:', uploadError?.message);
            // CRITICAL: Never inject multi-megabyte base64 strings into the database!
            // It overflows PostgREST HTTP buffers, crashing with 500 and freezing chat history for all users.
            const failure = new Error(`Cloud storage upload failed: ${uploadError?.message || 'Check storage permissions'}`);
            failure.status = uploadError?.status;
            failure.code = uploadError?.code;
            throw failure;
        }

        if (!url) throw new Error(`Could not generate media URL for ${info.name || 'file'}.`);
        if (item.cancelled) return;

        if (attachment?.url?.startsWith('blob:')) {
            completedPreviewUrls.push(attachment.url);
        }
        item.payload.attachments[info.index] = { name: info.name, url, storage_path: privatePhoto?.storage_path || getOrbitStorageObjectPath(url), storage_bucket: privatePhoto?.storage_bucket, type: info.type, size: attachment?.size || file.size, upload_pending: false, view_once: !!attachment?.view_once };
        
        // Update bubble DOM element directly so the permanent URL is immediately active
        const bubbleNode = document.getElementById(`msg-${item.payload.id}`) ||
            document.querySelector(`[data-client-temp-id="${item.clientTempId}"]`);
        if (bubbleNode) {
            const imgEls = bubbleNode.querySelectorAll('.wa-image-bunch-grid img');
            if (imgEls && imgEls[info.index]) imgEls[info.index].src = url;
        }

        // Persist completed URLs before starting the next file; keep blobs until delivery.
        _persistMessageOutbox(item.payload.sender_id);
        // Keep original blobs until the entire message is confirmed, so partial retries work.
        completedCount++;
        updateChatMediaUploadProgress(info.name, 100, completedCount, totalUploads);
        uploadBytes.set(info.index, uploadTotals.get(info.index));
        const overallDonePct = completedCount === totalUploads ? 100 : Math.min(99, Math.floor([...uploadBytes.values()].reduce((a,b)=>a+b,0) / [...uploadTotals.values()].reduce((a,b)=>a+b,0) * 100));
        if (typeof updateBubbleSendingProgress === 'function') {
            updateBubbleSendingProgress(item.payload.id, overallDonePct);
            if (item.clientTempId) updateBubbleSendingProgress(item.clientTempId, overallDonePct);
        }
    }

    item.mediaUploadInfo = [];
    _updateOutboxMessage(item, 'sending');
    // Replace image/video bubbles and their click handlers before releasing
    // local previews. Single-photo bubbles need the same update as galleries.
    completedPreviewUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (_) {} });
    completedPreviewUrls.length = 0;
    _persistMessageOutbox(item.payload.sender_id);
    hideChatMediaUploadProgress();
}

// ── Resilient Message Dispatcher (Idempotent UUID & Ultra-Reliable Inserts) ──
// Timeouts are surfaced to the user instead of triggering hidden retries.
// The stable message ID makes a deliberate retry idempotent.

async function executeResilientMessageInsert(payload) {
    let timer = null;

    try {
        const client = await ensureSupabase();
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 30000);

        // Sanitize attachments: never allow raw base64 >2000 chars into PostgreSQL!
        const safeAttachments = Array.isArray(payload.attachments) ? payload.attachments.map(a => {
            if (a && a.url && a.url.startsWith('data:') && a.url.length > 2000) {
                console.warn('[Orbit] Refusing to insert bloated base64 attachment into DB:', a.name);
                return { ...a, url: '' };
            }
            return a;
        }) : [];

        const cleanPayload = {
            id: payload.id,
            room: payload.room,
            sender_id: payload.sender_id,
            username: payload.username || 'Orbit User',
            text: payload.text || '',
            created_at: payload.created_at || new Date().toISOString()
        };
        // Empty optional columns waste bytes and cause a schema-error round trip
        // on older installations. Database defaults cover ordinary text sends.
        if (payload.type && payload.type !== 'text') cleanPayload.type = payload.type;
        if (safeAttachments.length) cleanPayload.attachments = safeAttachments;
        if (payload.reply_to) cleanPayload.reply_to = payload.reply_to;
        if (payload.is_forwarded) cleanPayload.is_forwarded = true;
        if (payload.metadata) cleanPayload.metadata = payload.metadata;
        const result = await client.from('messages')
            .insert([cleanPayload])
            .abortSignal(controller.signal);

        if (!result.error) return { data: payload, error: null };

        // Primary key UUID duplicate mathematically proves this exact message committed to DB
        const isDuplicate = result.error.code === '23505';
        if (isDuplicate) {
            const confirmed = await client.from('messages').select('id,room,sender_id').eq('id', payload.id).eq('sender_id', payload.sender_id).eq('room', payload.room).abortSignal(controller.signal).maybeSingle();
            if (!confirmed.error && confirmed.data) return { data: payload, error: null };
            return { data: null, error: confirmed.error || result.error };
        }

        const isColumnError = result.error.code === '42703' ||
            /column|schema cache|reply_to|attachments|read_by|is_forwarded|type/i.test(result.error.message || '');

        if (isColumnError) {
            // Never report a media message as delivered after silently stripping
            // its attachment column. Keep it queued so the sender can fix schema.
            if ((Array.isArray(payload.attachments) && payload.attachments.length > 0) || payload.reply_to || payload.is_forwarded || payload.metadata) {
                return { data: null, error: result.error };
            }
            const corePayload = {
                id: payload.id,
                room: payload.room,
                sender_id: payload.sender_id,
                username: payload.username || 'Orbit User',
                text: payload.text || '',
                created_at: payload.created_at || new Date().toISOString()
            };
            const fallback = await client.from('messages')
                .insert([corePayload])
                .abortSignal(controller.signal);
            if (!fallback.error) return { data: corePayload, error: null };
            return { data: null, error: fallback.error };
        }

        return { data: null, error: result.error };
    } catch (error) {
        return {
            data: null,
            error: error.name === 'AbortError'
                ? { message: 'Network timeout. Check the message status before retrying.', code: 'NETWORK_TIMEOUT' }
                : error
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
window.executeResilientMessageInsert = executeResilientMessageInsert;


async function _legacyRetrySendMessage(tempId) {
    const retryRoom = currentRoom;
    const retryAliases = typeof resolveRoomAliases === 'function' ? resolveRoomAliases(retryRoom) : [retryRoom];
    let msgs = messageCache.get(retryRoom) || [];
    const msg = msgs.find(m => m.id === tempId || m.client_temp_id === tempId);
    if (!msg) return;
    if (msg.status === 'sending') return;
    msg.status = 'sending';

    // v29.5.0 FIX: Before re-inserting, check if the message already exists in DB
    // This prevents duplicates when the original "timed out" request actually succeeded
    try {
        const client = await ensureSupabase();
        const { data: existing } = await client.from('messages')
            .select('id, room, sender_id, text, created_at')
            .eq('id', msg.id)
            .maybeSingle();
        
        if (existing) {
            console.log('[Orbit] retrySendMessage: Message already exists in DB — upgrading bubble to sent');
            // Message already in DB — just update the bubble to "sent"
            const confirmed = { ...msg, ...existing, status: 'sent' };
            const optNode = document.getElementById(`msg-${tempId}`) || (msg.id ? document.getElementById(`msg-${msg.id}`) : null);
            if (optNode) {
                optNode.id = `msg-${confirmed.id}`;
                optNode.dataset.msgId = confirmed.id;
                const meta = optNode.querySelector('.msg-meta-row');
                if (meta) {
                    const tick = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
                    if (tick) tick.outerHTML = getTickIconHtml({ ...confirmed, status: 'sent' });
                }
            }
            // Update cache
            retryAliases.forEach(alias => {
                let currentMsgs = messageCache.get(alias) || [];
                const idx = currentMsgs.findIndex(m => m.id === tempId || m.client_temp_id === tempId);
                if (idx !== -1) currentMsgs[idx] = confirmed;
                messageCache.set(alias, currentMsgs);
                try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(currentMsgs.slice(-40))); } catch(e) {}
            });
            _inflightMessages.delete(msg.id);
            showToast('Message sent ✓', 'success');
            return;
        }
    } catch(e) {
        console.warn('[Orbit] retrySendMessage DB check failed, will attempt re-insert:', e);
    }

    msg.status = 'sending';
    _inflightMessages.set(msg.id, { clientTempId: msg.client_temp_id || tempId, room: msg.room, status: 'sending', text: msg.text });

    const optNode = document.getElementById(`msg-${tempId}`) || (msg.id ? document.getElementById(`msg-${msg.id}`) : null);
    if (optNode) {
        const meta = optNode.querySelector('.msg-meta-row');
        if (meta) {
            const tick = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
            if (tick) tick.outerHTML = getTickIconHtml(msg);
        }
    }

    const payload = {
        id: (msg.id && String(msg.id).length > 20) ? msg.id : undefined,
        room: msg.room,
        sender_id: msg.sender_id,
        username: msg.username,
        text: msg.text,
        type: msg.type || 'text',
        attachments: msg.attachments || [],
        reply_to: msg.reply_to || null,
        created_at: new Date().toISOString()
    };

    const { data: saved, error } = await executeResilientMessageInsert(payload);
    if (error) {
        msg.status = 'failed';
        _inflightMessages.set(msg.id, { ..._inflightMessages.get(msg.id), status: 'failed' });
        if (optNode) {
            const meta = optNode.querySelector('.msg-meta-row');
            if (meta) {
                const tick = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
                if (tick) tick.outerHTML = `<span class="msg-status-tick retry-error" onclick="event.stopPropagation(); retrySendMessage('${tempId}')" title="Failed to send. Tap to retry" style="color:#FF453A; cursor:pointer;"><i class="fa-solid fa-circle-exclamation"></i></span>`;
            }
        }
        showToast(error.message ? 'Send failed: ' + error.message : 'Message send failed. Tap to retry.', 'error');
        return;
    }

    _inflightMessages.delete(msg.id);
    const confirmed = saved || { ...msg, status: 'sent' };
    if (optNode) {
        optNode.id = `msg-${confirmed.id}`;
        optNode.dataset.msgId = confirmed.id;
        const meta = optNode.querySelector('.msg-meta-row');
        if (meta) {
            const tick = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
            if (tick) tick.outerHTML = getTickIconHtml({ ...confirmed, status: 'sent' });
        }
    }

    // Update in-memory and local storage cache
    retryAliases.forEach(alias => {
        let currentMsgs = messageCache.get(alias) || [];
        const idx = currentMsgs.findIndex(m => m.id === tempId || m.client_temp_id === tempId);
        if (idx !== -1) currentMsgs[idx] = { ...confirmed, status: 'sent' };
        messageCache.set(alias, currentMsgs);
        try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(currentMsgs.slice(-40))); } catch(e) {}
    });

    showToast('Message sent ✓', 'success');
}
function retrySendMessage(tempId) {
    const retryRoom = currentRoom;
    const messages = messageCache.get(retryRoom) || [];
    const msg = messages.find(message => message.id === tempId || message.client_temp_id === tempId);
    if (!msg || msg.status === 'sending') return;

    const messageId = msg.id;
    let item = _messageOutbox.get(messageId);
    if (!item) {
        const aliases = Array.from(new Set([
            ...(typeof resolveRoomAliases === 'function' ? resolveRoomAliases(retryRoom) : [retryRoom]),
            msg.room || retryRoom
        ]));
        item = {
            payload: {
                id: messageId,
                room: msg.room || retryRoom,
                sender_id: msg.sender_id,
                username: msg.username || 'Orbit User',
                text: msg.text || null,
                type: msg.type || 'text',
                attachments: msg.attachments || [],
                reply_to: msg.reply_to || null,
                created_at: msg.created_at || new Date().toISOString()
            },
            aliases,
            clientTempId: msg.client_temp_id || `c_${Date.now()}_${String(messageId).slice(0, 8)}`,
            attempt: 0,
            status: 'queued'
        };
        _messageOutbox.set(messageId, item);
    }
    item.attempt = 0;
    item.status = 'queued';
    _inflightMessages.set(messageId, {
        clientTempId: item.clientTempId,
        room: item.payload.room,
        status: 'sending',
        text: item.payload.text
    });
    const pendingTimer = _messageRetryTimers.get(messageId);
    if (pendingTimer) clearTimeout(pendingTimer);
    _messageRetryTimers.delete(messageId);
    _updateOutboxMessage(item, 'queued');
    _persistMessageOutbox(item.payload.sender_id);
    _deliverOutboxMessage(messageId);
}

window.retrySendMessage = retrySendMessage;


function startDirectChatWithContact(usernameOrName) {
    if (!usernameOrName) return;
    const clean = usernameOrName.replace(/^@/, '').trim().toLowerCase();
    const peer = Array.from(globalUsersMap.values()).find(u => 
        (u.username && u.username.toLowerCase() === clean) ||
        (u.display_name && u.display_name.toLowerCase() === clean) ||
        (u.first_name && u.first_name.toLowerCase() === clean)
    );
    if (peer && peer.id) {
        openDirectChat(peer.id, peer.display_name || peer.username, peer.avatar_url);
    } else {
        showToast(`Contact: ${usernameOrName}`, 'info');
    }
}



window.sendMessage = sendMessage;
window.executeResilientMessageInsert = executeResilientMessageInsert;
window.retrySendMessage = retrySendMessage;
window.startDirectChatWithContact = startDirectChatWithContact;

