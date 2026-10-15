// ORBIT CHAT - REALTIME SYNCHRONIZATION & BROADCASTS (js/chat/chat-realtime.js)
// Deterministic channel subscriptions, global message listener, live status ticks,
// reactions broadcast, typing indicators, remote pin/delete updates.

let typingBroadcastTimer = null;
let lastTypingBroadcastTime = 0;
let activeTypingUsersMap = new Map();
let typingIndicatorTimeout = null;
let typingDebounceTimer = null;
let typingInactivityTimer = null;
let isTypingActive = false;
let activeTypingUsers = new Map();
let globalRealtimeChannel = null;
let _realtimeSetupEpoch = 0;
// Only database-confirmed messages are accepted from peers. Client broadcasts
// cannot authenticate a payload's sender, even inside a private group channel.
function sendFastMessagePreview() {}
window.sendFastMessagePreview = sendFastMessagePreview;

async function setupRealtimeChatSubscription(roomId, viewEpoch = _chatViewEpoch) {
    const setupEpoch = ++_realtimeSetupEpoch;
    if (activeRealtimeChannel) {
        try { 
            const client = getSupabase();
            if (client) client.removeChannel(activeRealtimeChannel); 
        } catch(e) {}
    }

    try {
        const client = await ensureSupabase();
        if (setupEpoch !== _realtimeSetupEpoch || viewEpoch !== _chatViewEpoch || currentRoom !== roomId) return;
        const aliases = resolveRoomAliases(roomId, typeof activeChatPeerId !== 'undefined' ? activeChatPeerId : null);
        await client.realtime.setAuth();

        // Deterministic channel name (NO random Date.now()) so both users join the exact same broadcast room!
        const channelName = `chat_stream_${roomId}`;
        activeRealtimeChannel = client.channel(channelName, {config:{private:true}})
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `room=eq.${roomId}`
            }, payload => handleRealtimeInsert(payload, roomId, aliases))
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'messages',
                filter: `room=eq.${roomId}`
            }, payload => handleRealtimeUpdate(payload, roomId, aliases))
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'messages'
            }, payload => handleRealtimeDelete(payload, roomId, aliases))
            // Message, poll and reaction changes arrive through RLS-filtered
            // postgres_changes; untrusted broadcasts never mutate chat history.
            .on('broadcast', { event: 'typing' }, payload => handleRemoteTyping(payload.payload))
            .on('broadcast', { event: 'webrtc_signal' }, payload => handleWebRTCSignal(payload.payload));

        // If there are alt aliases, subscribe to them too
        const altAliases = aliases.filter(a => a !== roomId);
        altAliases.forEach(altAlias => {
            activeRealtimeChannel
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `room=eq.${altAlias}`
                }, payload => handleRealtimeInsert(payload, roomId, aliases))
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages',
                    filter: `room=eq.${altAlias}`
                }, payload => handleRealtimeUpdate(payload, roomId, aliases));
        });

        activeRealtimeChannel.subscribe();
    } catch(e) {
        console.warn('Realtime subscription setup note:', e);
    }
}

// ── Global Realtime Message Listener (Bug B Fix: Live delivery across all rooms) ──
async function setupGlobalRealtimeMessageListener() {
    if (globalRealtimeChannel) return;
    try {
        const client = await ensureSupabase();
        globalRealtimeChannel = client.channel('orbit_global_messages')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages'
            }, payload => {
                const newMsg = payload.new;
                if (!newMsg || !currentUser) return;
                // Ignore own message echo
                if (newMsg.sender_id === currentUser.id) return;

                const currentRoomAliases = currentRoom ? resolveRoomAliases(currentRoom) : [];
                const isViewingActiveRoom = currentRoom && (newMsg.room === currentRoom || currentRoomAliases.includes(newMsg.room));

                if (isViewingActiveRoom) {
                    if (!isOrbitChatVisible(newMsg.room)) triggerMessageNotification(newMsg);
                    handleRealtimeInsert(payload, currentRoom, currentRoomAliases);
                    return;
                }

                // Check if message belongs to user's rooms or direct chats
                let isRelevant = false;
                if (typeof allRoomsMap !== 'undefined' && allRoomsMap.has(newMsg.room)) {
                    const r = allRoomsMap.get(newMsg.room);
                    if (r && Array.isArray(r.participants) && r.participants.includes(currentUser.id)) {
                        isRelevant = true;
                    }
                }
                if (!isRelevant && newMsg.room && newMsg.room.startsWith('dm_')) {
                    // Do not mark a conversation as relevant from a short
                    // user-ID prefix alone; require an unambiguous peer match.
                    isRelevant = !!resolveDirectPeerId(newMsg.room, currentUser.id);
                }

                if (isRelevant) {
                    unreadRoomsSet.add(newMsg.room);
                    if (typeof updateTabUnreadBadges === 'function') updateTabUnreadBadges();
                    if (typeof triggerMessageNotification === 'function') {
                        triggerMessageNotification(newMsg);
                    }
                }
            })
            .subscribe();
    } catch(e) {
        console.warn('[Orbit] setupGlobalRealtimeMessageListener note:', e);
    }
}
window.setupGlobalRealtimeMessageListener = setupGlobalRealtimeMessageListener;

// ── WhatsApp-Style Delete for Everyone (In-place bubble transformation) ──
function handleMessageDeleted(deletedId, primaryRoomId, aliases) {
    if (!deletedId) return;

    const targetAliases = aliases || resolveRoomAliases(primaryRoomId || currentRoom);
    let updatedMsg = null;
    targetAliases.forEach(alias => {
        let msgs = messageCache.get(alias) || [];
        const idx = msgs.findIndex(m => m.id === deletedId || m.client_temp_id === deletedId);
        if (idx !== -1) {
            msgs[idx] = {
                ...msgs[idx],
                is_deleted: true,
                text: '🚫 This message was deleted',
                attachments: [],
                type: 'text'
            };
            updatedMsg = msgs[idx];
            messageCache.set(alias, msgs);
            try {
                localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(msgs.slice(-40)));
            } catch(e) {}
        }
    });

    const node = document.getElementById(`msg-${deletedId}`) || document.querySelector(`[data-msg-id="${deletedId}"]`);
    if (node && updatedMsg) {
        const newNode = createMessageDOMNode(updatedMsg);
        node.replaceWith(newNode);
    }
}

function handleRealtimeDelete(payload, primaryRoomId, aliases) {
    const deletedId = payload.old?.id;
    if (deletedId) handleMessageDeleted(deletedId, primaryRoomId, aliases);
}

function handleRemotePollVote(voteData, primaryRoomId, aliases) {
    if (!voteData || !voteData.msgId || !voteData.poll) return;
    const msgId = voteData.msgId;
    const pollData = voteData.poll;

    const targetAliases = aliases || resolveRoomAliases(primaryRoomId || currentRoom);
    targetAliases.forEach(alias => {
        let msgs = messageCache.get(alias) || [];
        const target = msgs.find(m => m.id === msgId);
        if (target) {
            target.metadata = { ...(target.metadata || {}), poll: pollData };
            target.attachments = [{ type: 'poll', poll: pollData }];
        }
        try {
            localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(msgs.slice(-40)));
        } catch(e) {}
    });

    const existingNode = document.getElementById(`msg-${msgId}`);
    if (existingNode) {
        let currentMsgs = messageCache.get(currentRoom) || [];
        let target = currentMsgs.find(m => m.id === msgId);
        if (!target) {
            target = { id: msgId, type: 'poll', metadata: { poll: pollData }, attachments: [{ type: 'poll', poll: pollData }] };
        }
        const newNode = createMessageDOMNode(target);
        existingNode.replaceWith(newNode);
    }
}
window.handleRemotePollVote = handleRemotePollVote;
window.handleMessageDeleted = handleMessageDeleted;

function handleRealtimeInsert(payload, primaryRoomId, aliases) {
    if(isUserBlocked(payload?.new?.sender_id)) return;
    const newMsg = payload.new;
    if (!newMsg) return;
    if (!aliases.includes(newMsg.room)) return;
    clearTimeout(_fastPreviewTimers.get(newMsg.id));
    _fastPreviewTimers.delete(newMsg.id);
    if (currentUser && newMsg.sender_id === currentUser.id && typeof confirmMessageDeliveredFromRealtime === 'function') {
        confirmMessageDeliveredFromRealtime(newMsg);
    }

    let msgs = messageCache.get(primaryRoomId) || [];

    // 1. Check DOM directly for a node that already holds this canonical id (e.g. optimistic bubble)
    const domNodeById = document.getElementById(`msg-${newMsg.id}`);
    if (domNodeById) {
        const meta = domNodeById.querySelector('.msg-meta-row');
        if (meta) {
            const tickEl = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
            if (tickEl) tickEl.outerHTML = getTickIconHtml({ ...newMsg, status: 'sent' });
        }
        const cacheIdx = msgs.findIndex(m => m.id === newMsg.id);
        const wasPreview = cacheIdx >= 0 && msgs[cacheIdx].broadcast_pending;
        if (cacheIdx !== -1) {
            msgs[cacheIdx] = { ...newMsg, status: 'sent' };
        } else {
            msgs.push({ ...newMsg, status: 'sent' });
            msgs = deduplicateAndSort(msgs);
        }
        aliases.forEach(alias => messageCache.set(alias, msgs));
        if (typeof _scheduleChatCachePersist === 'function') aliases.forEach(_scheduleChatCachePersist);
        if (wasPreview && newMsg.sender_id !== currentUser?.id) markRoomAsRead(primaryRoomId);
        // Clean up in-flight tracker
        if (typeof _inflightMessages !== 'undefined') _inflightMessages.delete(newMsg.id);
        return;
    }

    // 2. Check if canonical ID already in cache
    const existingIndex = msgs.findIndex(m => m.id === newMsg.id);
    if (existingIndex >= 0) {
        msgs[existingIndex] = { ...newMsg, status: 'sent' };
        aliases.forEach(alias => messageCache.set(alias, msgs));
        if (typeof _scheduleChatCachePersist === 'function') aliases.forEach(_scheduleChatCachePersist);
        if (currentRoom === primaryRoomId || aliases.includes(currentRoom)) {
            appendSingleMessageNode(newMsg);
            markRoomAsRead(primaryRoomId);
        }
        if (typeof _inflightMessages !== 'undefined') _inflightMessages.delete(newMsg.id);
        return;
    }

    // 3. v29.5.0 FIX: Check global in-flight tracker FIRST — this catches messages whose
    //    bubble has status='failed' (the old code only matched status='sending')
    if (currentUser && newMsg.sender_id === currentUser.id && typeof _inflightMessages !== 'undefined') {
        const inflight = _inflightMessages.get(newMsg.id);
        if (inflight) {
            console.log('[Orbit] Realtime dedup: matched in-flight message', newMsg.id, 'status was:', inflight.status);
            _inflightMessages.delete(newMsg.id);

            // Find and upgrade the optimistic bubble in cache
            const pendingIdx = msgs.findIndex(m =>
                m.id === newMsg.id ||
                m.client_temp_id === inflight.clientTempId
            );
            if (pendingIdx !== -1) {
                const oldTemp = msgs[pendingIdx];
                msgs[pendingIdx] = { ...newMsg, status: 'sent' };
                aliases.forEach(alias => messageCache.set(alias, msgs));

                const optNode = document.getElementById(`msg-${oldTemp.id}`) ||
                    document.getElementById(`msg-${inflight.clientTempId}`) ||
                    document.querySelector(`[data-client-temp-id="${inflight.clientTempId}"]`);
                if (optNode) {
                    optNode.id = `msg-${newMsg.id}`;
                    optNode.dataset.msgId = newMsg.id;
                    const meta = optNode.querySelector('.msg-meta-row');
                    if (meta) {
                        const tickEl = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
                        if (tickEl) tickEl.outerHTML = getTickIconHtml({ ...newMsg, status: 'sent' });
                    }
                }
                return;
            }
            // If not in cache but was in-flight, still don't duplicate
            msgs.push({ ...newMsg, status: 'sent' });
            msgs = deduplicateAndSort(msgs);
            aliases.forEach(alias => messageCache.set(alias, msgs));
            return;
        }
    }

    // Only correlate own optimistic bubbles by their generated message ID.
    // Matching pending text globally can upgrade a bubble from another chat.
    msgs.push(newMsg);
    msgs = deduplicateAndSort(msgs);
    aliases.forEach(alias => messageCache.set(alias, msgs));

    if (currentRoom === primaryRoomId || aliases.includes(currentRoom)) {
        appendSingleMessageNode(newMsg);
        scrollFeedToBottom(false);
        markRoomAsRead(primaryRoomId);
        if (!isOrbitChatVisible(newMsg.room) && newMsg.sender_id !== currentUser?.id) {
            triggerMessageNotification(newMsg);
        }
    } else {
        triggerMessageNotification(newMsg);
    }
}

function handleRealtimeUpdate(payload, primaryRoomId, aliases) {
    const updated = payload.new;
    if (!updated || !aliases.includes(updated.room)) return;
    let msgs = messageCache.get(primaryRoomId) || [];
    const idx = msgs.findIndex(m => m.id === updated.id);
    if (idx !== -1) {
        msgs[idx] = updated;
        aliases.forEach(alias => messageCache.set(alias, msgs));
        if (currentRoom === primaryRoomId || aliases.includes(currentRoom)) {
            // Update node in-place to completely prevent screen flashing or scroll jumps
            const existingNode = document.getElementById(`msg-${updated.id}`);
            if (existingNode) {
                if(updated.type==='call'){const detail=existingNode.querySelector('.orbit-call-message small');if(detail)detail.textContent=formatOrbitCallDetail(updated.text);}
                const meta = existingNode.querySelector('.msg-meta-row');
                if (meta) {
                    const tickEl = meta.querySelector('.msg-status-indicator, .msg-tick, .msg-status-tick');
                    if (tickEl) tickEl.outerHTML = getTickIconHtml(updated);
                }
                if (updated.reactions && typeof renderReactionsRow === 'function') {
                    renderReactionsRow(existingNode, updated);
                }
            } else {
                renderMessageFeed(msgs, false);
            }
        }
    }
}


function broadcastTypingStatus() {
    if (!activeRealtimeChannel || !currentRoom || !currentUser || isSelfChat) return;

    if (typingInactivityTimer) clearTimeout(typingInactivityTimer);

    if (!typingDebounceTimer && !isTypingActive) {
        typingDebounceTimer = setTimeout(() => {
            typingDebounceTimer = null;
            sendTypingSignal('start');
        }, 300);
    }

    typingInactivityTimer = setTimeout(() => {
        stopTypingBroadcast();
    }, 2500);
}

function stopTypingBroadcast() {
    if (typingDebounceTimer) {
        clearTimeout(typingDebounceTimer);
        typingDebounceTimer = null;
    }
    if (typingInactivityTimer) {
        clearTimeout(typingInactivityTimer);
        typingInactivityTimer = null;
    }
    if (isTypingActive) {
        sendTypingSignal('stop');
    }
}

function sendTypingSignal(state = 'start') {
    if (!activeRealtimeChannel || !currentRoom || !currentUser) return;
    try {
        isTypingActive = (state === 'start');
        activeRealtimeChannel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                room: currentRoom,
                userId: currentUser.id,
                username: userProfile?.display_name || userProfile?.first_name || currentUser.email.split('@')[0],
                state: state
            }
        });
    } catch(e) {}
}

function handleRemoteTyping(payload) {
    if (!payload || !currentRoom || payload.room !== currentRoom) return;
    if (payload.userId === currentUser?.id) return;

    if (payload.state === 'stop') {
        const existing = activeTypingUsers.get(payload.userId);
        if (existing?.timer) clearTimeout(existing.timer);
        activeTypingUsers.delete(payload.userId);
    } else {
        const existing = activeTypingUsers.get(payload.userId);
        if (existing?.timer) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            activeTypingUsers.delete(payload.userId);
            renderTypingStatusDOM();
        }, 3000);
        activeTypingUsers.set(payload.userId, {
            username: payload.username || 'Someone',
            timer: timer
        });
    }
    renderTypingStatusDOM();
}

function renderTypingStatusDOM() {
    const statusEl = document.getElementById('chat-target-status');
    if (!statusEl) return;

    if (activeTypingUsers.size === 0) {
        if (currentRoom) {
            statusEl.innerHTML = isSelfChat
                ? '<i class="fa-solid fa-cloud" style="font-size:10px;"></i> Personal Cloud'
                : '<i class="fa-solid fa-shield-halved" style="font-size:10px; color:var(--online);"></i> HTTPS connection';
        }
        return;
    }

    const typingArr = Array.from(activeTypingUsers.values());
    let label = '';
    if (isGroupChat) {
        if (typingArr.length === 1) {
            label = `${escapeHtml(typingArr[0].username)} is typing...`;
        } else if (typingArr.length === 2) {
            label = `${escapeHtml(typingArr[0].username)} & ${escapeHtml(typingArr[1].username)} are typing...`;
        } else {
            label = `${escapeHtml(typingArr[0].username)} & ${typingArr.length - 1} others are typing...`;
        }
    } else {
        label = 'Typing...';
    }

    statusEl.innerHTML = `
        <span class="typing-indicator-pill">
            <span class="typing-dots">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </span>
            ${label}
        </span>
    `;
}

// ══════════════════════════════════════════════════════════════════════════
// 5. SCHEDULE MESSAGE IN CHATS (Long-Press Send Button)
// ══════════════════════════════════════════════════════════════════════════


// â”€â”€ Additional UI Helpers & Context Action Handlers â”€â”€


window.setupRealtimeChatSubscription = setupRealtimeChatSubscription;
window.handleRealtimeInsert = handleRealtimeInsert;
window.handleRealtimeUpdate = handleRealtimeUpdate;
window.handleRealtimeDelete = handleRealtimeDelete;
window.handleMessageDeleted = handleMessageDeleted;
window.broadcastTypingStatus = broadcastTypingStatus;
window.stopTypingBroadcast = stopTypingBroadcast;
