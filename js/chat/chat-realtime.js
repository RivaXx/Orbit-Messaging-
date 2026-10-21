// ORBIT CHAT - REALTIME SYNCHRONIZATION & BROADCASTS (js/chat/chat-realtime.js)
// Deterministic channel subscriptions, global message listener, live status ticks,
// reactions broadcast, typing indicators, remote pin/delete updates.

let lastTypingBroadcastTime = 0;
let orbitTypingChannel=null;
let orbitTypingRoom=null;
let orbitTypingOwner=null;
let orbitTypingTopic=null;
let orbitTypingEpoch=0;
let typingDebounceTimer = null;
let typingInactivityTimer = null;
let isTypingActive = false;
let activeTypingUsers = new Map();
let globalRealtimeChannel = null;
let _realtimeSetupEpoch = 0;
let _fastMessageChannel = null;
const _fastPreviewTimers = new Map();

function expireFastPreviewLater(id, roomId, aliases) {
    clearTimeout(_fastPreviewTimers.get(id));
    _fastPreviewTimers.set(id, setTimeout(() => {
        _fastPreviewTimers.delete(id);
        const message = (messageCache.get(roomId) || []).find(m => m.id === id);
        if (!message?.broadcast_pending) return;
        aliases.forEach(alias => messageCache.set(alias, (messageCache.get(alias) || []).filter(m => m.id !== id)));
        if (aliases.includes(currentRoom)) document.getElementById(`msg-${id}`)?.remove();
    }, 45000));
}

async function setupFastMessageChannel(client, roomId, aliases, setupEpoch, viewEpoch) {
    if (_fastMessageChannel) client.removeChannel(_fastMessageChannel).catch(() => {});
    _fastMessageChannel = null;
    if (isSelfChat || !currentUser?.id || !isGroupChat) return; // Direct messages use server-confirmed delivery so blocks cannot be bypassed.
    const selfId = currentUser.id;
    const peerId = activeChatPeerId;
    const topicRoom = !isGroupChat && peerId ? getDeterministicDMId(selfId, peerId) : roomId;
    try {
        await client.realtime.setAuth();
        if (setupEpoch !== _realtimeSetupEpoch || viewEpoch !== _chatViewEpoch || currentRoom !== roomId || currentUser?.id !== selfId) return;
        const channel = client.channel(`orbit_fast_${topicRoom}`, { config: { private: true } })
            .on('broadcast', { event: 'new_message' }, event => {
                const message = event.payload;
                if(isUserBlocked(message?.sender_id))return;
                if (currentRoom !== roomId || currentUser?.id !== selfId || !message?.id || message.sender_id === selfId) return;
                if (!aliases.includes(message.room) || typeof message.text !== 'string' || !message.text || message.text.length > 32768) return;
                if (!/^[0-9a-f-]{36}$/i.test(message.id) || (message.attachments?.length || 0) > 0 || message.type !== 'text') return;
                if (peerId && message.sender_id !== peerId) return;
                if (!peerId) {
                    const room = allRoomsMap.get(roomId);
                    if (!room || !(room.participants || []).includes(message.sender_id) && room.created_by !== message.sender_id) return;
                }
                const messages = messageCache.get(roomId) || [];
                const existing = messages.find(m => m.id === message.id);
                if (existing) {
                    if (existing.broadcast_pending) expireFastPreviewLater(message.id, roomId, aliases);
                    return;
                }
                // Preview is temporary. Only a database INSERT confirms it,
                // persists it, or produces a read receipt.
                const preview = { ...message, status: 'sending', broadcast_pending: true };
                const sorted = deduplicateAndSort([...messages, preview]);
                aliases.forEach(alias => messageCache.set(alias, sorted));
                expireFastPreviewLater(message.id, roomId, aliases);
                const feed = document.getElementById('chat-feed');
                const nearBottom = !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 220;
                appendSingleMessageNode(preview);
                if (nearBottom) scrollFeedToBottom(false);
            });
        _fastMessageChannel = channel;
        channel.subscribe();
    } catch (_) { /* Database realtime remains the delivery fallback. */ }
}

function sendFastMessagePreview(message) {
    if (!navigator.onLine || _fastMessageChannel?.state !== 'joined' || message.type !== 'text' || message.attachments?.length || !message.text || message.text.length > 32768) return;
    try {
        _fastMessageChannel.send({ type: 'broadcast', event: 'new_message', payload: message }).catch(() => {});
    } catch (_) {}
}
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
        setupFastMessageChannel(client, roomId, aliases, setupEpoch, viewEpoch);
        setupOrbitTypingChannel(client,roomId,viewEpoch);

        // Deterministic channel name (NO random Date.now()) so both users join the exact same broadcast room!
        const channelName = `chat_stream_${roomId}`;
        activeRealtimeChannel = client.channel(channelName)
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
            .on('broadcast', { event: 'delete_message' }, payload => {
                const delId = payload.payload?.id;
                // Broadcasts are hints only: verify the database before hiding anything.
                if (delId) client.from('messages').select('id,room,text,attachments,type,deleted_at').eq('id',delId).maybeSingle().then(({data,error})=>{
                    if (!error && data && aliases.includes(data.room) && (data.deleted_at || data.text === '🚫 This message was deleted')) orbitRememberDeletion(data);
                }).catch(()=>{});
            })
            .on('broadcast', { event: 'poll_vote' }, payload => {
                const voteData = payload.payload;
                if (voteData && voteData.msgId) handleRemotePollVote(voteData, roomId, aliases);
            })
            .on('broadcast', { event: 'message_reaction' }, payload => {
                const d = payload.payload;
                if (d && d.msgId && d.reactions) handleRemoteReaction(d.msgId, d.reactions, roomId, aliases);
            })
            .on('broadcast', { event: 'pin_message' }, payload => {
                const d = payload.payload;
                if (d && d.msgId) handleRemotePin(d.msgId, roomId);
            })
            .on('broadcast', { event: 'unpin_message' }, () => {
                handleRemoteUnpin(roomId);
            })
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
                    if(typeof orbitReceiveConversationMessage==='function')orbitReceiveConversationMessage(newMsg);
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
                    if(typeof orbitReceiveConversationMessage==='function')orbitReceiveConversationMessage(newMsg);
                    unreadRoomsSet.add(newMsg.room);
                    if (typeof updateTabUnreadBadges === 'function') updateTabUnreadBadges();
                    if (typeof triggerMessageNotification === 'function') {
                        triggerMessageNotification(newMsg);
                    }
                }
            })
            .on('postgres_changes', {event:'UPDATE',schema:'public',table:'messages'}, payload => {
                if (payload.new?.deleted_at || payload.new?.text === '🚫 This message was deleted') orbitRememberDeletion(payload.new);
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
    if(aliases.includes(currentRoom))handleRemoteTyping({room:orbitTypingTopic,userId:newMsg.sender_id,state:'stop'});
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
    const raw = payload.new;
    if (raw?.deleted_at || raw?.text === '🚫 This message was deleted') {
        if (typeof orbitRememberDeletion === 'function') orbitRememberDeletion(raw);
    }
    const updated = typeof orbitNormalizeMessage === 'function' ? orbitNormalizeMessage(raw) : raw;
    if (!updated || !aliases.includes(updated.room)) return;
    let msgs = messageCache.get(primaryRoomId) || [];
    const idx = msgs.findIndex(m => m.id === updated.id);
    if (idx !== -1) {
        const textChanged=msgs[idx].text!==updated.text || msgs[idx].edited_at!==updated.edited_at;
        msgs[idx] = updated;
        aliases.forEach(alias => messageCache.set(alias, msgs));
        if (currentRoom === primaryRoomId || aliases.includes(currentRoom)) {
            // Update node in-place to completely prevent screen flashing or scroll jumps
            const existingNode = document.getElementById(`msg-${updated.id}`);
            if (existingNode) {
                if(textChanged && updated.type!=='call'){existingNode.replaceWith(createMessageDOMNode(updated,existingNode.classList.contains('grouped-consecutive')));return;}
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


// Typing uses a participant-authorized private channel. No draft text is sent.
async function setupOrbitTypingChannel(client,roomId,viewEpoch){
    disposeOrbitTyping();
    if(isSelfChat||!currentUser?.id)return;
    const epoch=orbitTypingEpoch,owner=currentUser.id;
    const topic=!isGroupChat&&activeChatPeerId?getDeterministicDMId(owner,activeChatPeerId):roomId;
    try{
        await client.realtime.setAuth();
        if(epoch!==orbitTypingEpoch||currentRoom!==roomId||_chatViewEpoch!==viewEpoch||currentUser?.id!==owner)return;
        const channel=client.channel('orbit_typing_'+topic,{config:{private:true,broadcast:{self:false}}});
        orbitTypingChannel=channel;orbitTypingRoom=roomId;orbitTypingOwner=owner;orbitTypingTopic=topic;
        channel.on('broadcast',{event:'typing'},event=>{
            if(orbitTypingChannel===channel&&currentRoom===roomId&&currentUser?.id===owner)handleRemoteTyping(event.payload);
        }).subscribe(state=>{
            if(orbitTypingChannel!==channel)return;
            if(state==='SUBSCRIBED'&&document.getElementById('msg-input')?.value.trim())broadcastTypingStatus();
            if(['CLOSED','CHANNEL_ERROR','TIMED_OUT'].includes(state)){isTypingActive=false;clearRemoteTyping();}
        });
    }catch(_){/* Chat delivery remains available if typing cannot connect. */}
}
function clearRemoteTyping(){
    activeTypingUsers.forEach(value=>clearTimeout(value.timer));activeTypingUsers.clear();renderTypingStatusDOM();
}
function disposeOrbitTyping(){
    stopTypingBroadcast();++orbitTypingEpoch;
    clearRemoteTyping();
    const channel=orbitTypingChannel;
    orbitTypingChannel=null;orbitTypingRoom=null;orbitTypingOwner=null;orbitTypingTopic=null;
    if(channel){try{getSupabase()?.removeChannel(channel)?.catch(()=>{});}catch(_){}}
}
function broadcastTypingStatus(){
    const input=document.getElementById('msg-input');
    if(!input?.value.trim()||document.hidden||!navigator.onLine){stopTypingBroadcast();return;}
    if(!orbitTypingChannel||orbitTypingChannel.state!=='joined'||currentRoom!==orbitTypingRoom||currentUser?.id!==orbitTypingOwner||isSelfChat)return;
    clearTimeout(typingInactivityTimer);
    // Refresh during continuous typing; receiver expiry must not flicker off.
    if(!isTypingActive||Date.now()-lastTypingBroadcastTime>=1200)sendTypingSignal('start');
    typingInactivityTimer=setTimeout(stopTypingBroadcast,2200);
}
function stopTypingBroadcast(){
    clearTimeout(typingDebounceTimer);typingDebounceTimer=null;
    clearTimeout(typingInactivityTimer);typingInactivityTimer=null;
    if(isTypingActive)sendTypingSignal('stop');
    isTypingActive=false;lastTypingBroadcastTime=0;
}
function sendTypingSignal(state='start'){
    if(!orbitTypingChannel||orbitTypingChannel.state!=='joined'||!orbitTypingOwner)return;
    isTypingActive=state==='start';lastTypingBroadcastTime=Date.now();
    try{orbitTypingChannel.send({type:'broadcast',event:'typing',payload:{room:orbitTypingTopic,userId:orbitTypingOwner,state}}).catch(()=>{});}catch(_){}
}
function handleRemoteTyping(payload){
    if(!payload||!currentUser||!currentRoom||payload.room!==orbitTypingTopic||typeof payload.userId!=='string'||payload.userId===currentUser.id||isSelfChat)return;
    if(typeof isUserBlocked==='function'&&isUserBlocked(payload.userId))return;
    if(!isGroupChat&&payload.userId!==activeChatPeerId)return;
    const group=isGroupChat?allRoomsMap.get(currentRoom):null;
    if(isGroupChat&&(!group||!(group.participants||[]).includes(payload.userId)&&group.created_by!==payload.userId))return;
    if(!['start','stop'].includes(payload.state))return;
    const old=activeTypingUsers.get(payload.userId);if(old)clearTimeout(old.timer);
    if(payload.state==='stop')activeTypingUsers.delete(payload.userId);
    else{
        const user=globalUsersMap.get(payload.userId);
        const username=user?.display_name||user?.username||user?.first_name||'Someone';
        const timer=setTimeout(()=>{activeTypingUsers.delete(payload.userId);renderTypingStatusDOM();},4500);
        activeTypingUsers.set(payload.userId,{username,timer});
    }
    renderTypingStatusDOM();
}
function renderTypingStatusDOM(){
    const statusEl=document.getElementById('chat-target-status');if(!statusEl)return;
    if(!activeTypingUsers.size){
        if(statusEl.dataset.typing==='true'){
            statusEl.innerHTML=statusEl.dataset.restingStatus||'';
            delete statusEl.dataset.typing;delete statusEl.dataset.restingStatus;
        }
        return;
    }
    if(statusEl.dataset.typing!=='true')statusEl.dataset.restingStatus=statusEl.innerHTML;
    statusEl.dataset.typing='true';
    const names=Array.from(activeTypingUsers.values());
    const label=isGroupChat?(names.length===1?escapeHtml(names[0].username)+' is typing':escapeHtml(names[0].username)+' and '+(names.length-1)+' more are typing'):'Typing';
    const labelNode=statusEl.querySelector('.typing-label');
    if(labelNode){if(labelNode.innerHTML!==label)labelNode.innerHTML=label;return;}
    statusEl.innerHTML='<span class="typing-indicator-pill" role="status" aria-live="polite"><span class="typing-dots" aria-hidden="true"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span><span class="typing-label">'+label+'</span></span>';
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopTypingBroadcast();clearRemoteTyping();}});
window.addEventListener('pagehide',stopTypingBroadcast);
window.addEventListener('offline',()=>{stopTypingBroadcast();clearRemoteTyping();});
document.getElementById('msg-input')?.addEventListener('blur',stopTypingBroadcast);

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
