// ORBIT CHAT - ROOM LIFECYCLE & HISTORY MODULE (js/chat/chat-history.js)
// Screen navigation, room hydration, history query, older pagination, and read receipts.

let roomKeyCache = new Map();
let _chatViewEpoch = 0;
let currentBatchPhotos = [];
let isLoadingOlderMessages = false;
let olderHistoryInFlight = new Set();
let hasMoreOlderMessages = true;
let isUserInteractingWithFeed = false;
let isRenderingFeed = false;
let userInteractionTimer = null;

function notifyFeedUserInteraction() {
    isUserInteractingWithFeed = true;
    if (userInteractionTimer) clearTimeout(userInteractionTimer);
    userInteractionTimer = setTimeout(() => {
        isUserInteractingWithFeed = false;
    }, 1200);
}

async function openChatRoom(roomId, roomTitle, avatarUrl, isSelf = false, peerUserId = null) {
    if (!roomId) return;
    if(typeof disposeOrbitTyping==='function')disposeOrbitTyping();
    if(typeof orbitCancelEdit==='function')orbitCancelEdit();
    // Inbox previews are speculative; the opened conversation has priority.
    if (typeof recentChatsController !== 'undefined') recentChatsController?.abort();
    chatHistoryController?.abort();
    const viewEpoch = ++_chatViewEpoch;
    const previousRoom = currentRoom;

    currentRoom = roomId;
    isSelfChat = isSelf;
    isUserInteractingWithFeed = false;
    clearTimeout(userInteractionTimer);

    // ── 0ms Instant Screen Transition: Never block UI screen switch ──
    try {
        document.getElementById('screen-dash')?.classList.remove('active');
        document.getElementById('screen-profile')?.classList.remove('active');
        document.getElementById('screen-chat')?.classList.add('active');
    } catch(e) {}

    // Safeguard currentUser if not hydrated in memory yet
    if (!currentUser) {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && ((k.startsWith('sb-') && k.endsWith('-auth-token')) || k === 'supabase.auth.token')) {
                try {
                    const parsed = JSON.parse(localStorage.getItem(k));
                    if (parsed && parsed.user) { currentUser = parsed.user; break; }
                } catch(e) {}
            }
        }
    }
    if (!currentUser) {
        try {
            const client = (typeof getSupabase === 'function') ? getSupabase() : null;
            if (client && client.auth) {
                const { data: { session } } = await client.auth.getSession();
                if (session && session.user) currentUser = session.user;
            }
        } catch(e) {}
    }
    // A slow session lookup must never let an older room-open overwrite the
    // room the user selected most recently.
    if (viewEpoch !== _chatViewEpoch || currentRoom !== roomId) return;

    // Move legacy short DMs onto the collision-safe full-ID room key or existing canonical UUID room
    if (!isSelf && currentUser) {
        let exactPeerId = peerUserId;
        if (!exactPeerId && roomId.startsWith('dm_')) {
            exactPeerId = resolveDirectPeerId(roomId, currentUser.id, peerUserId);
        }
        if (exactPeerId) {
            peerUserId = exactPeerId;
            activeChatPeerId = exactPeerId;
            let canonical = (typeof userDirectRoomsMap !== 'undefined') ? userDirectRoomsMap.get(exactPeerId) : null;
            if (!canonical && typeof allRoomsMap !== 'undefined') {
                for (const [rid, r] of allRoomsMap.entries()) {
                    if (r.is_direct && Array.isArray(r.participants) &&
                        r.participants.includes(currentUser.id) && r.participants.includes(exactPeerId)) {
                        canonical = rid;
                        break;
                    }
                }
            }
            if (canonical) {
                roomId = canonical;
                currentRoom = roomId;
            } else if (roomId.startsWith('dm_')) {
                roomId = getDeterministicDMId(currentUser.id, exactPeerId);
                currentRoom = roomId;
            }
        }
    }

    const roomMeta = typeof allRoomsMap !== 'undefined' ? allRoomsMap.get(roomId) : null;
    isGroupChat = !isSelf && (roomMeta ? roomMeta.is_direct === false : (!peerUserId && !roomId.startsWith('dm_') && roomId.length > 20));

    // Resolve peer user ID for 1-on-1 chats safely
    activeChatPeerId = peerUserId || null;
    if (!isGroupChat && !isSelf && currentUser) {
        if (roomMeta?.is_direct && Array.isArray(roomMeta.participants) && roomMeta.participants.includes(currentUser.id)) {
            activeChatPeerId = roomMeta.participants.find(p => p !== currentUser.id) || null;
        } else if (roomId.startsWith('dm_')) {
            const parsedPeer = resolveDirectPeerId(roomId, currentUser.id);
            if (parsedPeer) {
                activeChatPeerId = parsedPeer;
            } else {
                const parts = roomId.slice(3).split('_');
                const suppliedPeerIsExact = parts.length === 2 && activeChatPeerId && currentUser.id !== activeChatPeerId &&
                    ((currentUser.id.startsWith(parts[0]) && activeChatPeerId.startsWith(parts[1])) ||
                     (currentUser.id.startsWith(parts[1]) && activeChatPeerId.startsWith(parts[0])));
                if (!suppliedPeerIsExact) activeChatPeerId = null;
            }
        }
    }
    if (typeof orbitOpenMessageControls === 'function') orbitOpenMessageControls();
    if (typeof updateChatOptionsMenuState === 'function') updateChatOptionsMenuState();
    if (typeof updateVoiceCallButton === 'function') updateVoiceCallButton();

    // Clear unread state for this room and update tab badges safely
    try {
        unreadRoomsSet.delete(roomId);
        if(typeof orbitClearConversationUnread==='function')orbitClearConversationUnread(roomId);
        if (typeof resolveRoomAliases === 'function') {
            resolveRoomAliases(roomId, activeChatPeerId).forEach(a => unreadRoomsSet.delete(a));
        }
        if (typeof updateTabUnreadBadges === 'function') updateTabUnreadBadges();
    } catch(e) {}

    try {
        // Cleanly teardown any prior realtime channel to prevent channel leakage & cross-room bleeding
        if (activeRealtimeChannel) {
            try {
                const client = (typeof getSupabase === 'function') ? getSupabase() : null;
                if (client) client.removeChannel(activeRealtimeChannel);
            } catch(e) {}
            activeRealtimeChannel = null;
        }

        // Flush feed DOM when switching rooms to guarantee clean state
        const feedEl = document.getElementById('chat-feed');
        if (feedEl && previousRoom !== roomId) {
            feedEl.innerHTML = '';
        }

        // ── Reset pagination state ──────────────────────────────────────────
        hasMoreOlderMessages = true;
        isLoadingOlderMessages = false;

        const titleEl = document.getElementById('chat-target-name');
        if (titleEl) titleEl.innerText = roomTitle || 'Chat';
        const statusEl = document.getElementById('chat-target-status');
        if (statusEl) {
            statusEl.innerHTML = isSelf
                ? '<i class="fa-solid fa-cloud" style="font-size:10px;"></i> Personal Cloud'
                : '<i class="fa-solid fa-shield-halved" style="font-size:10px; color:var(--online);"></i> E2EE Active';
        }

        const av = document.getElementById('chat-header-avatar');
        if (av) {
            if (isSelf) {
                av.style.background = 'rgba(10,132,255,0.2)';
                av.style.borderColor = 'var(--self-chat-blue)';
                av.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" style="color:var(--self-chat-blue);"></i>';
            } else if (avatarUrl) {
                av.innerHTML = `<img src="${formatMediaUrl(avatarUrl)}" alt="${escapeHtml(roomTitle || 'User')}">`;
            } else {
                av.style.background = 'linear-gradient(135deg, #262632, #16161E)';
                av.style.borderColor = 'var(--glass-border)';
                av.innerText = (roomTitle && roomTitle[0]) ? roomTitle[0].toUpperCase() : 'U';
            }
        }

        // ── 0ms Instant Load: Check memory cache AND persistent localStorage across all aliases ──
        const possibleKeys = resolveRoomAliases(roomId, activeChatPeerId);
        const allowedTranscriptRooms = new Set(possibleKeys);
        let cachedPool = [];
        for (const key of possibleKeys) {
            let cachedMsgs = messageCache.get(key);
            if (!cachedMsgs || cachedMsgs.length === 0) {
                try {
                    const localRaw = localStorage.getItem(`orbit_cache_msgs_${key}`);
                    if (localRaw) {
                        const parsed = JSON.parse(localRaw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            cachedMsgs = parsed;
                            messageCache.set(key, parsed);
                        }
                    }
                } catch(e) {}
            }
            if (cachedMsgs && cachedMsgs.length > 0) {
                cachedPool = cachedPool.concat(cachedMsgs.filter(message =>
                    message && allowedTranscriptRooms.has(message.room)
                ));
            }
        }

        // Direct room key fallback if alias filter was too restrictive
        if (cachedPool.length === 0) {
            const directMem = messageCache.get(roomId);
            if (directMem && directMem.length > 0) cachedPool = directMem.filter(m => allowedTranscriptRooms.has(m?.room));
            else {
                try {
                    const raw = localStorage.getItem(`orbit_cache_msgs_${roomId}`);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length > 0) cachedPool = parsed.filter(m => allowedTranscriptRooms.has(m?.room));
                    }
                } catch(e) {}
            }
        }

        let shownFromCache = false;
        if (cachedPool.length > 0) {
            const combined = deduplicateAndSort(filterRoomHistory(cachedPool, possibleKeys, activeChatPeerId));
            possibleKeys.forEach(k => messageCache.set(k, combined));
            renderMessageFeed(combined, true);
            shownFromCache = true;
        }

        if (!shownFromCache) {
            const feed = document.getElementById('chat-feed');
            if (feed) {
                feed.innerHTML = `
                    <div class="chat-skeleton-stream" style="padding:16px 12px; opacity:0.85;">
                        <div class="skeleton-msg-row">
                            <div class="skeleton-avatar" style="width:28px; height:28px;"></div>
                            <div class="skeleton-msg-bubble" style="width:48%; min-height:36px; border-radius:14px;"></div>
                        </div>
                        <div class="skeleton-msg-row out">
                            <div class="skeleton-msg-bubble" style="width:36%; min-height:36px; border-radius:14px; background:linear-gradient(90deg, rgba(255,215,0,0.12) 25%, rgba(255,215,0,0.22) 50%, rgba(255,215,0,0.12) 75%);"></div>
                        </div>
                    </div>
                `;
            }
        }

        // Render Pinned Message Banner if a message is pinned in this room
        renderPinnedBannerForRoom(roomId);

        // Restore Draft Message
        const inputEl = document.getElementById('msg-input');
        if (inputEl) {
            const savedDraft = localStorage.getItem(`orbit_draft_${roomId}`) || '';
            inputEl.value = savedDraft;
            handleInputResize(inputEl);
        }

        if (typeof updateDynamicActionButtons === 'function') {
            updateDynamicActionButtons();
        }

        // Update scheduled messages chip safely
        if (typeof updateScheduledChipForCurrentRoom === 'function') {
            try { updateScheduledChipForCurrentRoom(); } catch(e) {}
        }
    } catch(err) {
        console.warn('[Orbit] openChatRoom UI error:', err);
    }

    // Always fetch messages and subscribe to realtime
    if (viewEpoch !== _chatViewEpoch || currentRoom !== roomId) return;
    setupRealtimeChatSubscription(roomId, viewEpoch);
    fetchFreshRoomMessages(roomId, activeChatPeerId, viewEpoch);
    markRoomAsRead(roomId);
}

function navBackFromChat() {
    chatHistoryController?.abort();
    _chatViewEpoch++;
    // Save draft chat before navigating back
    const inputEl = document.getElementById('msg-input');
    if (currentRoom && inputEl) {
        const currentText = inputEl.value.trim();
        if (currentText) {
            localStorage.setItem(`orbit_draft_${currentRoom}`, currentText);
        } else {
            localStorage.removeItem(`orbit_draft_${currentRoom}`);
        }
        inputEl.value = '';
        inputEl.style.height = 'auto';
    }

    // Hide mention autocomplete
    hideMentionAutocomplete();
    if(typeof disposeOrbitTyping==='function')disposeOrbitTyping();
    else stopTypingBroadcast();


    currentRoom = null;
    activeChatPeerId = null;
    _isSendingMessage = false;
    isGroupChat = false;
    isSelfChat = false;
    replyTargetMessage = null;
    document.getElementById('reply-preview-bar')?.classList.add('hide');
    document.getElementById('screen-chat')?.classList.remove('active');
    document.getElementById('screen-dash')?.classList.add('active');
    if (activeRealtimeChannel) {
        try { 
            const client = (typeof getSupabase === 'function') ? getSupabase() : (typeof sb !== 'undefined' ? sb : null);
            if (client) client.removeChannel(activeRealtimeChannel); 
        } catch(e) {}
        activeRealtimeChannel = null;
    }
}

async function markRoomAsRead(roomId) {
    if (!roomId || !currentUser) return;
    if (typeof isOrbitChatVisible === 'function' && !isOrbitChatVisible(roomId)) return;
    try {
        const msgs = messageCache.get(roomId) || [];
        const unreadMsgs = msgs.filter(m => {
            if (m.broadcast_pending) return false;
            if (m.sender_id === currentUser.id) return false;
            if (Array.isArray(m.read_by)) return !m.read_by.includes(currentUser.id);
            if (m.read_by && typeof m.read_by === 'object') return !m.read_by[currentUser.id];
            return true;
        });
        if (msgs.some(m => !m.broadcast_pending && m.created_at)) {
            const owner = currentUser.id;
            const aliases = resolveRoomAliases(roomId,activeChatPeerId);
            const client = await ensureSupabase();
            if (currentUser?.id !== owner) return;
            const readBefore = msgs.filter(m => !m.broadcast_pending).reduce((latest,m) => Date.parse(m.created_at)>Date.parse(latest) ? m.created_at : latest, msgs[0]?.created_at || new Date().toISOString());
            const results = await Promise.all(aliases.map(alias => client.rpc('orbit_mark_room_read', {chat_room:alias,read_before:readBefore})));
            if (results.some(result => result.error) || currentUser?.id !== owner) return;
            const nowIso = new Date().toISOString();
            unreadMsgs.forEach(m => {
                if (Array.isArray(m.read_by)) {
                    if (!m.read_by.includes(currentUser.id)) m.read_by.push(currentUser.id);
                } else {
                    if (!m.read_by) m.read_by = {};
                    m.read_by[currentUser.id] = nowIso;
                }
            });
            messageCache.set(roomId, msgs);
        }
    } catch(e) {}
}




let chatHistoryController = null;
let chatHistoryRetryTimer = null;
const olderPageCache = new Map();
const ROOM_HISTORY_PAGE_SIZE = 25;
function filterRoomHistory(messages, aliases, peerId = null, selfId = currentUser?.id) {
    return (messages || []).filter(message => message && (typeof orbitIsMessageHidden !== 'function' || !orbitIsMessageHidden(message.id)) && aliases.includes(message.room) &&
        (!peerId || message.sender_id === selfId || message.sender_id === peerId));
}
async function queryRoomHistoryPage(client, aliases, cursor = null, signal = null) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new DOMException('History request cancelled', 'AbortError');
    signal?.addEventListener('abort', abort, { once:true });
    const timer = setTimeout(abort, 30000);
    try {
        const run = (columns) => {
            let query = client.from('messages').select(columns).in('room', aliases);
            if (cursor) {
                const timestamp = new Date(cursor.created_at).toISOString();
                const id = String(cursor.id);
                if (/^[a-zA-Z0-9_-]+$/.test(id)) query = query.or(`created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id})`);
                else query = query.lt('created_at', timestamp);
            }
            return query.order('created_at', { ascending:false }).order('id', { ascending:false })
                .limit(ROOM_HISTORY_PAGE_SIZE).abortSignal(controller.signal);
        };
        let result = await run('id,room,sender_id,username,text,type,attachments,reactions,reply_to,read_by,delivered_to,pinned,created_at,deleted_at,expires_at');
        // Missing optional columns warrant a schema fallback; a slow network does not.
        const firstErrorText = `${result.error?.code || ''} ${result.error?.message || ''}`;
        if (result.error && /42703|PGRST204|column .* (?:does not exist|not found)|could not find .*column/i.test(firstErrorText)) {
            result = await run('id,room,sender_id,username,text,type,attachments,created_at');
        }
        if (controller.signal.aborted) throw new DOMException('History request cancelled or timed out', 'AbortError');
        if (result.error) throw result.error;
        return result.data || [];
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}
function persistRoomHistory(roomId, aliases, messages) {
    aliases.forEach(alias => {
        messageCache.set(alias, messages);
        if (typeof _scheduleChatCachePersist === 'function') _scheduleChatCachePersist(alias);
        else try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(messages.filter(m => !m.broadcast_pending).slice(-50))); } catch (_) {}
    });
}
function prefetchOlderRoomPage(client, roomId, aliases, cursor, signal) {
    if (!cursor || signal?.aborted) return;
    const key = `${cursor.created_at}|${cursor.id}`;
    const previous = olderPageCache.get(roomId);
    if (previous?.key === key && previous.signal === signal) return;
    const promise = queryRoomHistoryPage(client, aliases, cursor, signal);
    // Attach a rejection handler immediately so background failures are never unhandled.
    promise.catch(() => {});
    olderPageCache.set(roomId, { key, promise, signal });
}
function showChatHistoryRetry(roomId, error) {
    const feed = document.getElementById('chat-feed');
    if (!feed) return;
    document.getElementById('chat-history-retry')?.remove();
    const banner = document.createElement('div');
    banner.id = 'chat-history-retry';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:12px auto;padding:10px 14px;max-width:520px;border:1px solid rgba(255,145,0,.35);border-radius:14px;background:rgba(22,18,14,.94);color:#f1dfc5;font:600 12px/1.4 var(--apple-font);text-align:center;';
    const detail = error?.name === 'AbortError'
        ? 'The server took too long to respond.'
        : String(error?.message || 'Check your connection and try again.').slice(0, 140);
    const label = document.createElement('span');
    label.textContent = `Message history could not refresh. ${detail} Cached messages are kept.`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.style.cssText = 'border:0;border-radius:9px;padding:7px 12px;background:var(--accent);color:#111;font:700 12px var(--apple-font);cursor:pointer;';
    retry.onclick = retryChatHistory;
    banner.append(label, retry);
    banner.dataset.roomId = roomId;
    feed.before(banner);
}
function retryChatHistory() {
    const roomId = currentRoom;
    if (!roomId) return;
    if(typeof orbitCancelEdit==='function')orbitCancelEdit();
    document.getElementById('chat-history-retry')?.remove();
    fetchFreshRoomMessages(roomId, activeChatPeerId, _chatViewEpoch);
}
window.retryChatHistory = retryChatHistory;
async function fetchFreshRoomMessages(roomId, peerUserId = activeChatPeerId, viewEpoch = _chatViewEpoch, retryAttempt = 0) {
    clearTimeout(chatHistoryRetryTimer);
    chatHistoryRetryTimer = null;
    if (!roomId) return;
    if(typeof orbitCancelEdit==='function')orbitCancelEdit();
    const selfId = currentUser?.id;
    const startedAt = Date.now();
    const aliases = resolveRoomAliases(roomId, peerUserId);
    chatHistoryController?.abort();
    const controller = new AbortController();
    chatHistoryController = controller;
    const isCurrent = () => !controller.signal.aborted && viewEpoch === _chatViewEpoch && currentRoom === roomId && currentUser?.id === selfId;
    try {
        const client = await ensureSupabase();
        if (!isCurrent()) return;
        if (typeof syncOrbitCleanupWatermark === 'function') await syncOrbitCleanupWatermark();
        if (!isCurrent()) return;
        const data = await queryRoomHistoryPage(client, aliases, null, controller.signal);
        if (!isCurrent()) return;
        const fresh = filterRoomHistory(data, aliases, peerUserId, selfId);
        const existing = filterRoomHistory(messageCache.get(roomId), aliases, peerUserId, selfId);
        // Preserve sends and realtime inserts that arrived after this request started.
        const oldestFresh = fresh.length ? Math.min(...fresh.map(m => Date.parse(m.created_at))) : null;
        const retained = existing.filter(m => !fresh.some(d => d.id === m.id) &&
            (['sending','queued','failed'].includes(m.status) || Date.parse(m.created_at) >= startedAt ||
             (oldestFresh !== null && Date.parse(m.created_at) < oldestFresh)));
        if(typeof orbitAcknowledgeDelivery==='function')orbitAcknowledgeDelivery(fresh);
        const combined = deduplicateAndSort([...fresh, ...retained]);
        hasMoreOlderMessages = data.length === ROOM_HISTORY_PAGE_SIZE;
        persistRoomHistory(roomId, aliases, combined);
        const feed = document.getElementById('chat-feed');
        renderMessageFeed(combined, !feed?.querySelector('.msg-bubble-row') || !isUserInteractingWithFeed);
        document.getElementById('chat-history-retry')?.remove();
        renderPinnedBannerForRoom(roomId);
        markRoomAsRead(roomId);
        if (hasMoreOlderMessages) prefetchOlderRoomPage(client, roomId, aliases, fresh.slice().sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)))[0], controller.signal);
    } catch (error) {
        if (!isCurrent()) return;
        console.warn('[Orbit History] Latest messages could not be loaded:', error);
        const feed = document.getElementById('chat-feed');
        if (!feed?.querySelector('.msg-bubble-row')) {
            const cached = filterRoomHistory(messageCache.get(roomId), aliases, peerUserId, selfId);
            renderMessageFeed(cached, false);
        }
        showChatHistoryRetry(roomId, error);
        const transient = error?.name === 'AbortError' || (typeof _isTransientMessageError === 'function' && _isTransientMessageError(error));
        if (transient && retryAttempt < 3) {
            const label = document.querySelector('#chat-history-retry span');
            if (label) label.textContent = 'Connection interrupted. Reconnecting… Your cached messages are available.';
            chatHistoryRetryTimer = setTimeout(() => {
                if (isCurrent()) fetchFreshRoomMessages(roomId, peerUserId, viewEpoch, retryAttempt + 1);
            }, Math.min(15000, 2000 * 2 ** retryAttempt));
        }
    }
}
async function loadOlderHistory(roomId) {
    if (!roomId || roomId !== currentRoom || olderHistoryInFlight.has(roomId) || !hasMoreOlderMessages) return;
    const viewEpoch = _chatViewEpoch;
    const controller = chatHistoryController;
    const aliases = resolveRoomAliases(roomId, activeChatPeerId);
    const peerId = activeChatPeerId;
    const selfId = currentUser?.id;
    const existing = filterRoomHistory(messageCache.get(roomId), aliases, peerId, selfId);
    const cursor = existing.find(m => !['sending','queued','failed'].includes(m.status));
    if (!cursor) return;
    olderHistoryInFlight.add(roomId);
    isLoadingOlderMessages = true;
    try {
        const client = await ensureSupabase();
        const cached = olderPageCache.get(roomId);
        const key = `${cursor.created_at}|${cursor.id}`;
        const data = cached?.key === key && !cached.signal?.aborted
            ? await cached.promise : await queryRoomHistoryPage(client, aliases, cursor, controller?.signal);
        if (viewEpoch !== _chatViewEpoch || currentRoom !== roomId || currentUser?.id !== selfId || controller?.signal.aborted) return;
        const older = filterRoomHistory(data, aliases, peerId, selfId);
        const combined = deduplicateAndSort([...older, ...filterRoomHistory(messageCache.get(roomId), aliases, peerId, selfId)]);
        hasMoreOlderMessages = data.length === ROOM_HISTORY_PAGE_SIZE;
        persistRoomHistory(roomId, aliases, combined);
        renderMessageFeed(combined, false);
        if (hasMoreOlderMessages) prefetchOlderRoomPage(client, roomId, aliases, combined[0], controller?.signal);
    } catch (error) {
        if (viewEpoch === _chatViewEpoch && currentRoom === roomId && !controller?.signal.aborted) {
            console.warn('[Orbit History] Older messages could not be loaded:', error);
            olderPageCache.delete(roomId);
            showToast('Could not load older messages. Scroll up to retry.', 'error');
        }
    } finally {
        olderHistoryInFlight.delete(roomId);
        isLoadingOlderMessages = olderHistoryInFlight.has(currentRoom);
    }
}

window.notifyFeedUserInteraction = notifyFeedUserInteraction;
window.openChatRoom = openChatRoom;
window.navBackFromChat = navBackFromChat;
window.markRoomAsRead = markRoomAsRead;
window.fetchFreshRoomMessages = fetchFreshRoomMessages;
window.loadOlderHistory = loadOlderHistory;

window.addEventListener('online', () => { if (currentRoom && document.getElementById('chat-history-retry')) retryChatHistory(); });
