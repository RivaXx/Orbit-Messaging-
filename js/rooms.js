// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ORBIT ROOMS & SOCIAL ARCHITECTURE MODULE (js/rooms.js)
// Includes: Canonical Room Resolution, Deterministic DM IDs,
//           Main Chats List (0ms Instant Cache Hydration),
//           Friends, Friend Requests, Groups, and Member Management
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function resolveDirectPeerId(roomId, selfId = currentUser?.id, expectedPeerId = null) {
    if (!roomId?.startsWith('dm_') || !selfId) return null;
    const parts = roomId.slice(3).split('_');
    if (parts.length !== 2) return null;
    if (parts[0] === selfId) return parts[1];
    if (parts[1] === selfId) return parts[0];
    if (expectedPeerId && expectedPeerId !== selfId &&
        ((selfId.startsWith(parts[0]) && expectedPeerId.startsWith(parts[1])) ||
         (selfId.startsWith(parts[1]) && expectedPeerId.startsWith(parts[0])))) return expectedPeerId;

    const selfParts = parts.filter(p => selfId.startsWith(p));
    if (selfParts.length !== 1) return null;
    const peerPart = parts[0] === selfParts[0] ? parts[1] : parts[0];
    if (peerPart.length > 20) return peerPart;

    const candidates = new Set();
    if (typeof globalUsersMap !== 'undefined') {
        globalUsersMap.forEach(user => {
            const id = user?.user_id || user?.id;
            if (id && id !== selfId && id.startsWith(peerPart)) candidates.add(id);
        });
    }
    if (typeof allRoomsMap !== 'undefined') {
        allRoomsMap.forEach(room => {
            if (!room?.is_direct || !Array.isArray(room.participants)) return;
            const peer = room.participants.find(id => id !== selfId && id.startsWith(peerPart));
            if (room.participants.includes(selfId) && peer) candidates.add(peer);
        });
    }
    return candidates.size === 1 ? Array.from(candidates)[0] : null;
}

function isMessageRoomRelevantToCurrentUser(message) {
    if (!message?.room || !currentUser?.id) return false;
    const room = typeof allRoomsMap !== 'undefined' ? allRoomsMap.get(message.room) : null;
    if (room) return Array.isArray(room.participants) && room.participants.includes(currentUser.id);
    if (message.room.startsWith('dm_')) return !!resolveDirectPeerId(message.room, currentUser.id);
    return message.sender_id === currentUser.id;
}

function resolveRoomAliases(roomId, peerUserId = null) {
    if (!roomId) return [];
    const aliases = new Set([roomId]);
    const directRooms = typeof allRoomsMap !== 'undefined'
        ? Array.from(allRoomsMap.values()).filter(r => r?.is_direct && Array.isArray(r.participants) && r.participants.length === 2)
        : [];
    const roomMeta = typeof allRoomsMap !== 'undefined' ? allRoomsMap.get(roomId) : null;
    let pair = roomMeta?.is_direct && Array.isArray(roomMeta.participants) && roomMeta.participants.length === 2
        ? [...roomMeta.participants]
        : null;

    // Legacy dm_<12-char-prefix> keys or deterministic keys. Resolve
    // them against the selected peer or candidates in directRooms / userDirectRoomsMap.
    if (!pair && roomId.startsWith('dm_')) {
        const parts = roomId.slice(3).split('_');
        const selfId = currentUser?.id;
        const peerId = peerUserId || (roomId === currentRoom ? activeChatPeerId : null) || resolveDirectPeerId(roomId, selfId);
        if (parts.length === 2 && selfId && !peerId && parts.some(p => p === selfId)) {
            pair = [selfId, parts.find(p => p !== selfId)];
        } else if (parts.length === 2 && selfId && peerId && selfId !== peerId &&
            ((selfId.startsWith(parts[0]) && peerId.startsWith(parts[1])) ||
             (selfId.startsWith(parts[1]) && peerId.startsWith(parts[0])))) {
            pair = [selfId, peerId];
        } else if (parts.length === 2) {
            const candidates = directRooms.filter(r => {
                const [a, b] = r.participants;
                return (a.startsWith(parts[0]) && b.startsWith(parts[1])) ||
                       (b.startsWith(parts[0]) && a.startsWith(parts[1]));
            });
            if (candidates.length === 1) {
                pair = [...candidates[0].participants];
                aliases.add(candidates[0].id);
            }
        }
    }

    if (!pair && (peerUserId || (roomId === currentRoom ? activeChatPeerId : null)) && currentUser?.id) {
        const peer = peerUserId || (roomId === currentRoom ? activeChatPeerId : null);
        if (peer && peer !== currentUser.id) {
            pair = [currentUser.id, peer];
        }
    }

    if (!pair || pair.length !== 2 || pair[0] === pair[1]) return Array.from(aliases);
    const [a, b] = pair;
    aliases.add(getDeterministicDMId(a, b));
    aliases.add(getDeterministicDMId(b, a));

    // Check if a canonical direct room exists for this pair
    const samePair = r => Array.isArray(r?.participants) && r.participants.includes(a) && r.participants.includes(b);
    directRooms.filter(samePair).forEach(r => aliases.add(r.id));
    if (typeof userDirectRoomsMap !== 'undefined') {
        const mapped = userDirectRoomsMap.get(a === currentUser?.id ? b : a) || userDirectRoomsMap.get(roomId);
        if (mapped) aliases.add(mapped);
    }

    // Keep old short room IDs working only when their prefixes uniquely map
    // to this participant pair.
    const legacyKeys = [
        `dm_${a.slice(0, 12)}_${b.slice(0, 12)}`,
        `dm_${b.slice(0, 12)}_${a.slice(0, 12)}`
    ];
    legacyKeys.forEach(key => {
        const collides = directRooms.some(r => !samePair(r) && (() => {
            const [x, y] = r.participants;
            return key === `dm_${x.slice(0, 12)}_${y.slice(0, 12)}` ||
                   key === `dm_${y.slice(0, 12)}_${x.slice(0, 12)}`;
        })());
        if (collides) aliases.delete(key);
        else aliases.add(key);
    });
    return Array.from(aliases);
}

// â”€â”€ Utility: Get canonical (UUID) room ID for a user pair â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function resolveCanonicalRoomId(otherUserId, otherUserName) {
    const owner=currentUser?.id;if(!owner)return null;
    // 1. Check in-memory cache first
    const cached = userDirectRoomsMap.get(otherUserId);
    if (cached && !cached.startsWith('dm_')) return cached;

    // 2. Search allRoomsMap for an existing UUID room
    for (const [rid, r] of allRoomsMap.entries()) {
        if (r.is_direct && Array.isArray(r.participants) &&
            r.participants.includes(owner) && r.participants.includes(otherUserId)) {
            userDirectRoomsMap.set(otherUserId, rid);
            return rid;
        }
    }

    // 3. Query Supabase for existing room
    try {
        const client = await ensureSupabase();
        const { data: existingRooms } = await client
            .from('rooms')
            .select('*')
            .eq('is_direct', true)
            .contains('participants', [owner, otherUserId]);

        if(currentUser?.id!==owner)return null;

        if (existingRooms && existingRooms.length > 0) {
            const r = existingRooms[0];
            allRoomsMap.set(r.id, r);
            userDirectRoomsMap.set(otherUserId, r.id);
            if (typeof persistUserRoomsCache === 'function') persistUserRoomsCache(currentUser?.id);
            return r.id;
        }

        // 4. Create new room if none exists
        const { data: newRoom, error: createError } = await client
            .from('rooms')
            .insert([{
                name: otherUserName || 'Direct Chat',
                is_direct: true,
                participants: [owner, otherUserId],
                created_by: owner
            }])
            .select()
            .single();

        if (createError) throw createError;
        if(currentUser?.id!==owner)return null;

        if (newRoom) {
            allRoomsMap.set(newRoom.id, newRoom);
            userDirectRoomsMap.set(otherUserId, newRoom.id);
            if (typeof persistUserRoomsCache === 'function') persistUserRoomsCache(currentUser?.id);
            return newRoom.id;
        }
    } catch(e) {
        console.warn('resolveCanonicalRoomId note:', e.message);
    }

    return null;
}

// ── Open direct chat with deterministic instant room (0ms latency) ──────
async function openDirectChat(otherUserId, otherUserName, otherDpUrl) {
    if (!currentUser) {
        // Fast synchronous check from localStorage token
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
    if (!currentUser) {
        showToast('Please sign in to start chatting', 'error');
        return;
    }
    if (otherUserId === currentUser.id) {
        openChatRoom(`self_${currentUser.id}`, 'Note to Self (You)', null, true);
        return;
    }

    // Opening a deleted conversation is an explicit request to show it again.
    try{
        const key=`orbit_hidden_rooms_${currentUser.id}`,aliases=resolveRoomAliases(getDeterministicDMId(currentUser.id,otherUserId),otherUserId);
        localStorage.setItem(key,JSON.stringify(JSON.parse(localStorage.getItem(key)||'[]').filter(id=>!aliases.includes(id))));
    }catch(_){}

    // 0ms Instant Load: check if canonical UUID room exists for this user pair
    const deterministicId = getDeterministicDMId(currentUser.id, otherUserId);
    let canonicalRoomId = null;
    if (typeof userDirectRoomsMap !== 'undefined') {
        const mapped = userDirectRoomsMap.get(otherUserId);
        if (mapped && !mapped.startsWith('dm_')) canonicalRoomId = mapped;
    }
    if (!canonicalRoomId && typeof allRoomsMap !== 'undefined') {
        for (const [rid, r] of allRoomsMap.entries()) {
            if (r.is_direct && Array.isArray(r.participants) &&
                r.participants.includes(currentUser.id) && r.participants.includes(otherUserId)) {
                canonicalRoomId = rid;
                break;
            }
        }
    }
    const finalRoomId = canonicalRoomId || deterministicId;

    if (typeof userDirectRoomsMap !== 'undefined') {
        userDirectRoomsMap.set(otherUserId, finalRoomId);
        userDirectRoomsMap.set(deterministicId, finalRoomId);
        if (canonicalRoomId) {
            userDirectRoomsMap.set(canonicalRoomId, finalRoomId);
        }
        try {
            localStorage.setItem('orbit_direct_rooms_v26', JSON.stringify(Array.from(userDirectRoomsMap.entries())));
        } catch(e) {}
    }

    openChatRoom(finalRoomId, otherUserName, otherDpUrl, false, otherUserId);
}

// Global aliases so both openDirectChat and startDirectChat work identically
function startDirectChat(otherUserId, otherUserName, otherDpUrl) {
    openDirectChat(otherUserId, otherUserName, otherDpUrl);
}
window.openDirectChat = openDirectChat;
window.startDirectChat = openDirectChat;

function getDeterministicDMId(uidA, uidB) {
    return uidA < uidB ? `dm_${uidA}_${uidB}` : `dm_${uidB}_${uidA}`;
}

// â”€â”€ Cache-First Instant (0ms) Main Chats Hydration â”€â”€
function renderRecentChatsFromCache(cachedItems, list) {
    if (!list || !Array.isArray(cachedItems) || cachedItems.length === 0) return;
    const frag = document.createDocumentFragment();
    let excluded=[];try{excluded=[...JSON.parse(localStorage.getItem(`orbit_hidden_rooms_${currentUser.id}`)||'[]'),...JSON.parse(localStorage.getItem(`orbit_archived_rooms_${currentUser.id}`)||'[]')];}catch(_){}
    cachedItems.filter(item=>!resolveRoomAliases(item.roomId).some(id=>excluded.includes(id))).forEach(item => {
        const card = document.createElement('div');
        card.className = 'contact-glass-card touch-fix';
        // Always stamp roomId so retroactive long-press attachment in chat-select.js can find it
        card.dataset.roomId = item.roomId;
        card.onclick = () => {
            if (window.isInChatSelectionMode && window.isInChatSelectionMode()) return;
            if (typeof unreadRoomsSet !== 'undefined') unreadRoomsSet.delete(item.roomId);
            if (typeof openChatRoom === 'function') {
                openChatRoom(item.roomId, item.title, item.dp_url || null, !!item.isGroup, item.peerUserId || null);
            }
        };
        orbitRenderConversationCard(card,item);
        // Attach long-press selection handler — only available if chat-select.js already loaded
        if (typeof attachChatCardSelectHandler === 'function') {
            attachChatCardSelectHandler(card, item.roomId, item.title, item.isGroup);
        }
        frag.appendChild(card);
    });
    list.innerHTML = '';
    list.appendChild(frag);
}

let recentChatsController = null;
async function loadMainChats(fromCacheFirst = false) {
    const list = document.getElementById('main-chats-list');
    if (!list || !currentUser?.id) return;
    const selfId = currentUser.id;
    recentChatsController?.abort();
    const controller = new AbortController();
    recentChatsController = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    const isCurrent = () => !controller.signal.aborted && currentUser?.id === selfId;


    // â”€â”€ 0ms Instant Local Storage Cache Hydration â”€â”€
    if (currentUser) {
        try {
            const cachedStr = localStorage.getItem(`orbit_recent_chats_v27_${currentUser.id}`);
            if (cachedStr) {
                const cachedItems = JSON.parse(cachedStr);
                if (Array.isArray(cachedItems) && cachedItems.length > 0) {
                    renderRecentChatsFromCache(cachedItems, list);
                }
            }
        } catch(e) {}
    }

    try {
        const client = await ensureSupabase();
        if (!isCurrent()) return;

        if (fromCacheFirst || !navigator.onLine) return;
        // Step 1: Pre-populate rooms index strictly for current user
        if (currentUser && currentUser.id) {
            try {
                const { data: myRooms } = await client.from('rooms')
                    .select('*')
                    .or(`created_by.eq.${selfId},participants.cs.{"${selfId}"}`).abortSignal(controller.signal);
                if (!isCurrent()) return;
                if (myRooms && myRooms.length > 0) {
                    allRoomsMap.clear();
                    userDirectRoomsMap.clear();
                    myRooms.forEach(r => {
                        allRoomsMap.set(r.id, r);
                        if (r.is_direct && Array.isArray(r.participants) && r.participants.length === 2) {
                            const peer = r.participants.find(p => p !== currentUser.id);
                            if (peer) {
                                userDirectRoomsMap.set(peer, r.id);
                                const det = getDeterministicDMId(currentUser.id, peer);
                                userDirectRoomsMap.set(det, r.id);
                                userDirectRoomsMap.set(r.id, det);
                            }
                        }
                    });
                    if (typeof persistUserRoomsCache === 'function') {
                        persistUserRoomsCache(currentUser.id);
                    }
                }
            } catch(e) {
                console.warn('[Orbit] User rooms query note:', e.message);
            }
        }

        // Step 2: Build list of room IDs the current user participates in
        const userRoomIds = [];
        for (const [rid, r] of allRoomsMap.entries()) {
            if (r.is_direct && Array.isArray(r.participants) && r.participants.includes(currentUser.id)) {
                userRoomIds.push(rid);
                const dmAlias = getDeterministicDMId(r.participants[0], r.participants[1]);
                if (dmAlias !== rid) userRoomIds.push(dmAlias);
            } else if (!r.is_direct && (r.created_by === currentUser.id || (Array.isArray(r.participants) && r.participants.includes(currentUser.id)))) {
                userRoomIds.push(rid);
            }
        }

        // Fetch independent previews together instead of waiting for each request in turn.
        const previews = [];
        const columns = 'id,room,text,type,created_at,sender_id,username';
        const uniqueRoomIds = Array.from(new Set(userRoomIds));
        for (let i = 0; i < uniqueRoomIds.length; i += 100) {
            previews.push(client.from('messages').select(columns).in('room',uniqueRoomIds.slice(i,i+100))
                .order('created_at',{ascending:false}).limit(200).abortSignal(controller.signal));
        }
        previews.push(client.from('messages').select(columns).like('room',`%${selfId.slice(0,12)}%`)
            .order('created_at',{ascending:false}).limit(150).abortSignal(controller.signal));
        previews.push(client.from('messages').select(columns).eq('sender_id',selfId)
            .order('created_at',{ascending:false}).limit(80).abortSignal(controller.signal));
        const results = await Promise.allSettled(previews);
        if (!isCurrent()) return;
        const successfulResults = results.filter(result => result.status === 'fulfilled' && !result.value.error);
        if (!successfulResults.length) throw new Error('Recent chat queries failed.');
        let messagesData = successfulResults.flatMap(result => result.value.data || []);

        // Prefix-based legacy DM discovery can return another user's room
        // when IDs share a prefix. Drop every row whose room cannot be
        // positively tied to this user's exact participant identity.
        messagesData = deduplicateAndSort(messagesData.filter(isMessageRoomRelevantToCurrentUser)).reverse();

        // Preview-only rows never seed transcript caches: they lack media and history.
        const recentRoomMap = new Map();
        messagesData.forEach(m => {
            if (m.room && !m.room.startsWith('self_') && !recentRoomMap.has(m.room)) {
                recentRoomMap.set(m.room, m);
            }
        });

        // Also include any group rooms the user is in that might not have recent messages
        for (const [rid, r] of allRoomsMap.entries()) {
            if (!r.is_direct && currentUser && (r.created_by === currentUser.id || (Array.isArray(r.participants) && r.participants.includes(currentUser.id)))) {
                if (!recentRoomMap.has(rid)) {
                    recentRoomMap.set(rid, {
                        room: rid,
                        text: r.topic || 'Group Chat',
                        created_at: r.created_at || new Date().toISOString(),
                        sender_id: r.created_by,
                        username: r.name,
                        type: 'text'
                    });
                }
            }
        }

        if (recentRoomMap.size === 0) {
            list.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">No recent chats. Start a chat from Global!</div>';
            return;
        }

        // Don't disturb DOM if user is actively in selection mode
        if (window.isInChatSelectionMode && window.isInChatSelectionMode()) {
            return;
        }

        // Check pinned, hidden, and archived rooms
        let pinnedRooms = [];
        let hiddenRooms = [];
        let archivedRooms = [];
        if (currentUser) {
            try {
                pinnedRooms = JSON.parse(localStorage.getItem(`orbit_pinned_rooms_${currentUser.id}`) || '[]');
                hiddenRooms = JSON.parse(localStorage.getItem(`orbit_hidden_rooms_${currentUser.id}`) || '[]');
                archivedRooms = JSON.parse(localStorage.getItem(`orbit_archived_rooms_${currentUser.id}`) || '[]');
            } catch(e) {}
        }

        // Filter out hidden and archived
        const filteredEntries = Array.from(recentRoomMap.entries()).filter(([rid]) => {
            return !resolveRoomAliases(rid).some(id=>hiddenRooms.includes(id)||archivedRooms.includes(id));
        });

        // Sort: pinned first, then chronological
        filteredEntries.sort(([rIdA, msgA], [rIdB, msgB]) => {
            const isPinA = pinnedRooms.includes(rIdA) ? 1 : 0;
            const isPinB = pinnedRooms.includes(rIdB) ? 1 : 0;
            if (isPinA !== isPinB) return isPinB - isPinA;
            return new Date(msgB.created_at || 0) - new Date(msgA.created_at || 0);
        });

        const serializableItems = [];
        const frag = document.createDocumentFragment();
        filteredEntries.forEach(([roomId, lastMsg]) => {
            const roomMeta = allRoomsMap.get(roomId);
            let title = 'Chat';
            let avatarHtml = '<i class="fa-solid fa-comments"></i>';
            let isGroup = false;

            let peerUserId = null;
            let resolvedDpUrl = roomMeta?.dp_url || null;

            if (roomMeta) {
                if (!roomMeta.is_direct) {
                    isGroup = true;
                    title = roomMeta.name || 'Group Chat';
                    avatarHtml = roomMeta.dp_url ? `<img src="${formatMediaUrl(roomMeta.dp_url)}">` : '<i class="fa-solid fa-users" style="color:var(--accent);"></i>';
                } else if (Array.isArray(roomMeta.participants) && currentUser) {
                    peerUserId = roomMeta.participants.find(id => id !== currentUser.id) || null;
                    const otherUser = peerUserId ? globalUsersMap.get(peerUserId) : null;
                    if (otherUser) {
                        title = otherUser.display_name || otherUser.email.split('@')[0];
                        avatarHtml = otherUser.dp_url ? `<img src="${formatMediaUrl(otherUser.dp_url)}">` : `<span>${title[0].toUpperCase()}</span>`;
                        resolvedDpUrl = otherUser.dp_url || resolvedDpUrl;
                    } else {
                        title = roomMeta.name || 'Direct Chat';
                        avatarHtml = `<span>${title[0].toUpperCase()}</span>`;
                    }
                }
            } else {
                peerUserId = resolveDirectPeerId(roomId, currentUser?.id);
                const matchedUser = peerUserId ? globalUsersMap.get(peerUserId) : null;
                if (matchedUser) {
                    title = matchedUser.display_name || (matchedUser.email ? matchedUser.email.split('@')[0] : 'Friend');
                    avatarHtml = matchedUser.dp_url ? `<img src="${formatMediaUrl(matchedUser.dp_url)}">` : `<span>${title[0].toUpperCase()}</span>`;
                    resolvedDpUrl = matchedUser.dp_url || resolvedDpUrl;
                }
                if (!title || title === 'Chat') {
                    title = (currentUser && lastMsg.sender_id !== currentUser.id && lastMsg.username) ? lastMsg.username : 'Direct Chat';
                    avatarHtml = `<span>${title[0].toUpperCase()}</span>`;
                }
            }

            const isPinned = pinnedRooms.includes(roomId);
            const isUnread = (typeof unreadRoomsSet !== 'undefined') && unreadRoomsSet.has(roomId);
            const timeDisplay = orbitFormatMessageTime(lastMsg.created_at);
            const presenceDisplay = isGroup ? `${roomMeta?.participants?.length || 0} members` : orbitChatPresence(peerUserId);
            const msgPreview = orbitConversationPreview(lastMsg,isGroup);

            serializableItems.push({
                roomId,
                title,
                dp_url: resolvedDpUrl,
                isGroup,
                avatarHtml,
                isUnread,
                isPinned,
                timeDisplay,
                presenceDisplay,
                msgPreview,
                peerUserId
            });

            const card = document.createElement('div');
            card.className = 'contact-glass-card touch-fix';
            card.onclick = () => {
                if (window.isInChatSelectionMode && window.isInChatSelectionMode()) return;
                if (typeof unreadRoomsSet !== 'undefined') unreadRoomsSet.delete(roomId);
                openChatRoom(roomId, title, resolvedDpUrl, false, peerUserId);
            };
            orbitRenderConversationCard(card,serializableItems[serializableItems.length-1]);
            if (typeof attachChatCardSelectHandler === 'function') {
                attachChatCardSelectHandler(card, roomId, title, isGroup);
            }
            frag.appendChild(card);
        });

        const prevScroll = list.scrollTop;
        list.innerHTML = '';
        list.appendChild(frag);
        list.scrollTop = prevScroll;
        orbitRefreshUnreadCounts();

        // Cache serialized items for 0ms hydration next launch
        if (currentUser && serializableItems.length > 0) {
            try {
                localStorage.setItem(`orbit_recent_chats_v27_${currentUser.id}`, JSON.stringify(serializableItems));
            } catch(e) {}
        }
        if (typeof _prewarmRecentMessages === 'function') _prewarmRecentMessages();
    } catch(err) {
        if (!controller.signal.aborted) console.warn('[Orbit Rooms] Recent chats could not be refreshed:', err);
    } finally { clearTimeout(timer); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FRIENDS MANAGEMENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadFriends() {
    const list = document.getElementById('friends-list');
    if (!list) return;

    // 1. 0ms Instant Synchronous Cache Hydration
    if (currentUser) {
        try {
            const cached = localStorage.getItem(`orbit_friends_cache_${currentUser.id}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    renderFriendsListDOM(parsed, list);
                }
            }
        } catch(e) {}
    }

    try {
        const client = await ensureSupabase();
        if (!currentUser) return;

        // Parallel queries to cut network round trips to 1
        const [friendsRes, presenceRes] = await Promise.all([
            client.from('friends').select('*').or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`).eq('status', 'accepted'),
            client.from('user_presence').select('user_id, display_name, email, dp_url, is_online, last_seen, about').limit(200)
        ]);

        const friendRows = friendsRes.data || [];
        const presenceRows = presenceRes.data || [];

        const friendIds = [];
        myFriendsSet.clear();
        friendRows.forEach(f => {
            const fid = f.user_id === currentUser.id ? f.friend_id : f.user_id;
            friendIds.push(fid);
            myFriendsSet.add(fid);
        });

        if (friendIds.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">No friends added yet. Connect with other users in the Global tab!</div>';
            return;
        }

        const userMap = new Map();
        presenceRows.forEach(u => {
            if (friendIds.includes(u.user_id)) userMap.set(u.user_id, u);
        });

        // Supplement from globalUsersMap
        friendIds.forEach(fid => {
            if (!userMap.has(fid) && typeof globalUsersMap !== 'undefined' && globalUsersMap.has(fid)) {
                userMap.set(fid, globalUsersMap.get(fid));
            }
        });

        // Supplement from user_profiles for any remaining missing friends
        const missingIds = friendIds.filter(id => !userMap.has(id));
        if (missingIds.length > 0) {
            try {
                const { data: profUsers } = await client
                    .from('user_profiles')
                    .select('user_id, first_name, last_name, username, dp_url, about')
                    .in('user_id', missingIds);
                if (profUsers) {
                    profUsers.forEach(p => {
                        userMap.set(p.user_id, {
                            user_id: p.user_id,
                            display_name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || 'Friend',
                            email: '',
                            dp_url: p.dp_url,
                            about: p.about || 'Available'
                        });
                    });
                }
            } catch(e) {}
        }

        const finalFriends = Array.from(userMap.values());
        renderFriendsListDOM(finalFriends, list);

        // Cache friends list for 0ms instant display next time
        if (currentUser && finalFriends.length > 0) {
            try {
                localStorage.setItem(`orbit_friends_cache_${currentUser.id}`, JSON.stringify(finalFriends));
            } catch(e) {}
        }
    } catch(err) {
        console.warn('loadFriends error:', err);
    }
}

function renderFriendsListDOM(friendsArray, list) {
    if (!list || !Array.isArray(friendsArray)) return;
    list.innerHTML = '';
    const myPrivacyLastSeen = localStorage.getItem('orbit_privacy_last_seen') || 'everyone';

    friendsArray.forEach(u => {
        const card = document.createElement('div');
        card.className = 'contact-glass-card touch-fix';
        const name = u.display_name || (u.email ? u.email.split('@')[0] : 'Friend');

        // Accurate real-time online status check: is_online === true AND last_seen within 65s
        const isTrulyOnline = u.is_online === true && u.last_seen && (Date.now() - new Date(u.last_seen).getTime() < 65000);

        // Reciprocal privacy check: if current user hides last seen (nobody), reciprocal rule prevents seeing others' last seen
        let statusDisplay = 'Offline';
        let statusColor = 'var(--text-muted)';
        if (isTrulyOnline) {
            statusDisplay = 'Online';
            statusColor = '#30D158';
        } else if (myPrivacyLastSeen === 'nobody') {
            statusDisplay = 'Offline';
            statusColor = 'var(--text-muted)';
        } else {
            statusDisplay = typeof formatLastSeen === 'function' ? formatLastSeen(u.last_seen) : 'Offline';
            statusColor = 'var(--text-muted)';
        }

        card.onclick = () => openDirectChat(u.user_id, name, u.dp_url);
        card.innerHTML = `
            <div class="c-av-wrap" style="position:relative;">
                ${u.dp_url ? `<img src="${formatMediaUrl(u.dp_url)}" alt="">` : `<span>${name[0].toUpperCase()}</span>`}
                ${isTrulyOnline ? '<div style="position:absolute; bottom:1px; right:1px; width:10px; height:10px; border-radius:50%; background:#30D158; border:2px solid #000;"></div>' : ''}
            </div>
            <div class="c-info-wrap">
                <div class="c-top-row">
                    <span class="c-name">${escapeHtml(name)}</span>
                    <span style="font-size:11px; color:${statusColor}; font-weight:600;">${escapeHtml(statusDisplay)}</span>
                </div>
                <div class="c-preview-row">
                    <span class="c-last-msg">${escapeHtml(u.about || 'Tap to chat')}</span>
                </div>
            </div>
            <button class="btn-reset" onclick="event.stopPropagation(); openDirectChat('${u.user_id}', '${escapeHtml(name).replace(/'/g, "\\'")}', '${u.dp_url || ''}')" style="margin-left:auto; padding:7px 14px; background:var(--accent); color:#fff; border-radius:10px; font-size:12px; font-weight:700; cursor:pointer;">
                <i class="fa-solid fa-comment-dots"></i> Chat
            </button>
        `;
        list.appendChild(card);
    });
}

async function loadFriendRequestsCount() {
    try {
        const { count, error } = await sb
            .from('friends')
            .select('*', { count: 'exact', head: true })
            .eq('friend_id', currentUser.id)
            .eq('status', 'pending');

        if (error) throw error;

        const badge = document.getElementById('friend-requests-badge');
        if (badge) {
            if (count > 0) {
                badge.innerText = count;
                badge.classList.remove('hide');
            } else {
                badge.classList.add('hide');
            }
        }
    } catch(err) {
        console.warn('loadFriendRequestsCount error:', err);
    }
}

async function openFriendRequestsModal() {
    const modal = document.getElementById('modal-friend-requests');
    const feed = document.getElementById('friend-requests-feed');
    if (!modal || !feed) return;

    modal.classList.add('active');
    feed.innerHTML = '<div style="text-align:center; padding:20px; color:#888;"><i class="fa-solid fa-spinner fa-spin"></i> Loading requests...</div>';

    try {
        const { data, error } = await sb
            .from('friends')
            .select('id, user_id, created_at')
            .eq('friend_id', currentUser.id)
            .eq('status', 'pending');

        if (error) throw error;

        if (!data || data.length === 0) {
            feed.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">No pending friend requests.</div>';
            return;
        }

        const senderIds = data.map(d => d.user_id);
        let senderUsers = [];
        try {
            const { data: pUsers } = await sb
                .from('user_presence')
                .select('user_id, display_name, email, dp_url')
                .in('user_id', senderIds);
            if (pUsers) senderUsers = pUsers;
        } catch(e) {}

        const userMap = new Map(senderUsers.map(u => [u.user_id, u]));
        senderIds.forEach(sid => {
            if (!userMap.has(sid) && typeof globalUsersMap !== 'undefined' && globalUsersMap.has(sid)) {
                userMap.set(sid, globalUsersMap.get(sid));
            }
        });

        feed.innerHTML = '';
        data.forEach(req => {
            const sender = userMap.get(req.user_id) || { display_name: 'Unknown User', email: '' };
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.05); border-radius:12px;';
            row.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:36px; height:36px; border-radius:50%; background:#222; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                        ${sender.dp_url ? `<img src="${formatMediaUrl(sender.dp_url)}" style="width:100%; height:100%; object-fit:cover;">` : `<span>${(sender.display_name || 'U')[0].toUpperCase()}</span>`}
                    </div>
                    <div>
                        <div style="font-weight:600; font-size:14px; color:#fff;">${escapeHtml(sender.display_name || sender.email)}</div>
                        <div style="font-size:11px; color:#888;">Wants to be friends</div>
                    </div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="btn-reset" onclick="respondFriendRequest('${req.id}', 'accepted')" style="background:var(--accent); color:#fff; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:600;">Accept</button>
                    <button class="btn-reset" onclick="respondFriendRequest('${req.id}', 'rejected')" style="background:rgba(255,255,255,0.1); color:#fff; padding:6px 12px; border-radius:8px; font-size:12px;">Decline</button>
                </div>
            `;
            feed.appendChild(row);
        });
    } catch(err) {
        feed.innerHTML = `<div style="text-align:center; padding:20px; color:#FF453A;">Error: ${err.message}</div>`;
    }
}

function closeFriendRequestsModal() {
    const modal = document.getElementById('modal-friend-requests');
    if (modal) modal.classList.remove('active');
}

async function respondFriendRequest(requestId, status) {
    try {
        if (status === 'accepted') {
            await sb.from('friends').update({ status: 'accepted' }).eq('id', requestId);
            showToast('Friend request accepted!', 'success');
        } else {
            await sb.from('friends').delete().eq('id', requestId);
            showToast('Friend request declined.', 'info');
        }
        openFriendRequestsModal();
        loadFriendRequestsCount();
        loadFriends();
    } catch(err) {
        showToast(`Action failed: ${err.message}`, 'error');
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GROUPS MANAGEMENT (Membership-filtered, deduplicated, cache-first)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function _uniqueCurrentUserGroups(groups, userId = currentUser?.id) {
    if (!Array.isArray(groups)) return [];
    const seenIds = new Set();
    const seenSignatures = new Set();
    const unique = [];
    groups.forEach(group => {
        if (!group || group.is_direct === true || !group.id || seenIds.has(String(group.id))) return;
        seenIds.add(String(group.id));
        const participants = Array.isArray(group.participants) ? group.participants.map(String) : [];
        if (userId && participants.length && !participants.includes(String(userId)) && String(group.created_by || '') !== String(userId)) return;
        const normalizedName = String(group.name || '').trim().toLocaleLowerCase();
        const signature = participants.length
            ? `${String(group.created_by || '')}|${normalizedName}|${participants.slice().sort().join(',')}`
            : String(group.id);
        if (seenSignatures.has(signature)) return;
        seenSignatures.add(signature);
        unique.push(group);
    });
    return unique;
}

function renderGroupsListDOM(groups, list) {
    if (!list) return;
    const uniqueGroups = _uniqueCurrentUserGroups(groups);
    const count = document.getElementById('groups-count');
    if (count) count.textContent = `${uniqueGroups.length} ${uniqueGroups.length === 1 ? 'group' : 'groups'}`;
    if (uniqueGroups.length === 0) {
        list.innerHTML = `
            <div class="groups-empty-state">
                <span class="groups-empty-icon"><i class="fa-solid fa-user-group"></i></span>
                <strong>No groups yet</strong>
                <span>Create a group to start chatting with friends.</span>
            </div>`;
        return;
    }
    const frag = document.createDocumentFragment();
    uniqueGroups.forEach(group => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'group-list-card touch-fix';
        card.setAttribute('aria-label', `Open group ${group.name || 'Group'}`);
        card.onclick = () => openChatRoom(group.id, group.name, group.dp_url || null, false);
        const memberCount = Array.isArray(group.participants) ? group.participants.length : 0;
        const safeAvatarUrl = group.dp_url ? formatMediaUrl(group.dp_url) : '';
        card.innerHTML = `
            <span class="group-list-avatar">
                ${safeAvatarUrl ? `<img src="${safeAvatarUrl}" alt="">` : '<i class="fa-solid fa-users"></i>'}
            </span>
            <span class="group-list-copy">
                <span class="group-list-name">${escapeHtml(group.name || 'Unnamed group')}</span>
                <span class="group-list-topic">${escapeHtml(group.topic || 'Group chat')}</span>
            </span>
            <span class="group-list-meta">${memberCount ? `${memberCount} members` : 'Group'}<i class="fa-solid fa-chevron-right"></i></span>`;
        frag.appendChild(card);
    });
    const prevScroll = list.scrollTop;
    list.innerHTML = '';
    list.appendChild(frag);
    list.scrollTop = prevScroll;
}

async function loadGroups() {
    const list = document.getElementById('groups-list');
    if (!list) return;
    if (!currentUser?.id) {
        renderGroupsListDOM([], list);
        return;
    }
    try {
        const cached = JSON.parse(localStorage.getItem(`orbit_groups_cache_${currentUser.id}`) || '[]');
        const cachedGroups = _uniqueCurrentUserGroups(cached);
        if (cachedGroups.length) renderGroupsListDOM(cachedGroups, list);
    } catch(e) {}
    try {
        const client = await ensureSupabase();
        const { data, error } = await client
            .from('rooms')
            .select('*')
            .eq('is_direct', false)
            .contains('participants', [currentUser.id])
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        const uniqueGroups = _uniqueCurrentUserGroups(data || []);
        uniqueGroups.forEach(group => allRoomsMap.set(group.id, group));
        renderGroupsListDOM(uniqueGroups, list);
        try { localStorage.setItem(`orbit_groups_cache_${currentUser.id}`, JSON.stringify(uniqueGroups)); } catch(e) {}
    } catch(err) {
        console.warn('loadGroups error:', err);
        if (!list.hasChildNodes()) renderGroupsListDOM([], list);
    }
}

function openAddFriendModal() { document.getElementById('modal-add-friend').classList.add('active'); }
function closeAddFriendModal() { document.getElementById('modal-add-friend').classList.remove('active'); }

async function submitFriendRequest() {
    const input = document.getElementById('input-add-friend-email');
    const email = input?.value.trim().toLowerCase();
    if (!email) return;

    try {
        let user = null;
        try {
            const { data } = await sb
                .from('user_presence')
                .select('user_id, email, display_name')
                .ilike('email', email)
                .maybeSingle();
            if (data) user = data;
        } catch(e) {}

        if (!user && typeof globalUsersMap !== 'undefined') {
            for (const u of globalUsersMap.values()) {
                if (u.email && u.email.toLowerCase() === email) {
                    user = u;
                    break;
                }
            }
        }

        if (!user) {
            showToast('No user found with that email address.', 'error');
            return;
        }

        if (user.user_id === currentUser.id) {
            showToast('You cannot send a friend request to yourself.', 'error');
            return;
        }

        const { error } = await sb.from('friends').insert([{
            user_id: currentUser.id,
            friend_id: user.user_id,
            status: 'pending'
        }]);

        if (error) {
            if (error.code === '23505') {
                showToast('Friend request already sent or exists.', 'info');
            } else {
                showToast(`Request failed: ${error.message}`, 'error');
            }
            return;
        }

        showToast('Friend request sent successfully!', 'success');
        input.value = '';
        closeAddFriendModal();
    } catch(err) {
        showToast('Error sending friend request.', 'error');
    }
}

async function showNewGroupModal() {
    const modal = document.getElementById('modal-create-group');
    const memberPicker = document.getElementById('group-friends-picker');
    if (!modal || !memberPicker) return;

    memberPicker.innerHTML = '<div style="text-align:center; padding:15px; color:#888;"><i class="fa-solid fa-spinner fa-spin"></i> Loading friends...</div>';
    modal.classList.add('active');

    try {
        const { data, error } = await sb
            .from('friends')
            .select('*')
            .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
            .eq('status', 'accepted');

        if (error) throw error;

        const friendIds = [];
        if (data) {
            data.forEach(f => {
                friendIds.push(f.user_id === currentUser.id ? f.friend_id : f.user_id);
            });
        }

        if (friendIds.length === 0) {
            memberPicker.innerHTML = '<div style="text-align:center; padding:15px; color:#888;">You must be friends with users before adding them to a group. Connect in Global tab!</div>';
            return;
        }

        let friendsData = [];
        try {
            const { data: pUsers } = await sb
                .from('user_presence')
                .select('user_id, display_name, email, dp_url')
                .in('user_id', friendIds);
            if (pUsers) friendsData = pUsers;
        } catch(e) {}

        const friendMap = new Map(friendsData.map(u => [u.user_id, u]));
        friendIds.forEach(fid => {
            if (!friendMap.has(fid) && typeof globalUsersMap !== 'undefined' && globalUsersMap.has(fid)) {
                friendMap.set(fid, globalUsersMap.get(fid));
            }
        });

        memberPicker.innerHTML = '';
        Array.from(friendMap.values()).forEach(u => {
            const name = u.display_name || (u.email ? u.email.split('@')[0] : 'Friend');
            const row = document.createElement('label');
            row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(255,255,255,0.05); border-radius:10px; cursor:pointer; user-select:none;';
            row.innerHTML = `
                <input type="checkbox" value="${u.user_id}" class="group-member-chk" onchange="updateGroupSelectedCount()">
                <div style="width:28px; height:28px; border-radius:50%; background:#333; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    ${u.dp_url ? `<img src="${formatMediaUrl(u.dp_url)}" style="width:100%; height:100%; object-fit:cover;">` : `<span>${name[0].toUpperCase()}</span>`}
                </div>
                <span style="font-size:13px; color:#fff; flex:1;">${escapeHtml(name)}</span>
            `;
            memberPicker.appendChild(row);
        });
        updateGroupSelectedCount();
    } catch(err) {
        memberPicker.innerHTML = `<div style="text-align:center; padding:15px; color:#FF453A;">Error loading friends: ${err.message}</div>`;
    }
}

function updateGroupSelectedCount() {
    const chks = document.querySelectorAll('.group-member-chk:checked');
    const badge = document.getElementById('group-selected-count');
    if (badge) badge.innerText = `${chks.length} selected`;
}

function closeCreateGroupModal() {
    const modal = document.getElementById('modal-create-group');
    if (modal) modal.classList.remove('active');
}

let _isCreatingGroupLock = false;
async function submitCreateGroup() {
    if (_isCreatingGroupLock) return;
    const nameInput = document.getElementById('group-name-input');
    const descInput = document.getElementById('group-topic-input');
    const name = nameInput?.value.trim();
    if (!name) {
        showToast('Please enter a group name.', 'error');
        return;
    }

    _isCreatingGroupLock = true;
    const btn = document.querySelector('#modal-create-group .glass-btn-primary');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
    }

    try {
        const chks = document.querySelectorAll('.group-member-chk:checked');
        const selectedUids = Array.from(chks).map(c => c.value);
        if (currentUser && !selectedUids.includes(currentUser.id)) {
            selectedUids.push(currentUser.id); // Add creator
        }

        const client = await ensureSupabase();
        const { data, error } = await client
            .from('rooms')
            .insert([{
                name,
                topic: descInput?.value.trim() || 'Group Chat',
                is_direct: false,
                participants: selectedUids,
                created_by: currentUser.id
            }])
            .select()
            .single();

        if (error) throw error;

        showToast('Group created successfully!', 'success');
        nameInput.value = '';
        if (descInput) descInput.value = '';
        closeCreateGroupModal();
        if (data) allRoomsMap.set(data.id, data);
        loadGroups();
        loadMainChats();
        if (data) openChatRoom(data.id, data.name, null, false);
    } catch(err) {
        showToast(`Failed to create group: ${err.message}`, 'error');
    } finally {
        _isCreatingGroupLock = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Create Group';
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// PEER BLOCKING & GROUP DELETION (Safe RLS & Immediate Cleanup)
// ══════════════════════════════════════════════════════════════════════════
function isUserBlocked(uid) {
    try {
        const list = JSON.parse(localStorage.getItem(`orbit_blocked_${currentUser.id}`) || '[]');
        return list.includes(uid);
    } catch(e) {
        return false;
    }
}

function toggleBlockCurrentPeer() {
    if (!activeChatPeerId) return;
    const key = `orbit_blocked_${currentUser.id}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}

    if (list.includes(activeChatPeerId)) {
        list = list.filter(id => id !== activeChatPeerId);
        showToast('User unblocked', 'info');
    } else {
        list.push(activeChatPeerId);
        showToast('User blocked. You will no longer receive messages from them.', 'error');
    }
    localStorage.setItem(key, JSON.stringify(list));
    closeChatOptionsMenu();
    updateChatOptionsMenuState();
}

async function deleteGroupFromList(groupId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!currentUser) return;
    const roomMeta = allRoomsMap.get(groupId);
    const groupName = roomMeta?.name || 'this group';

    if (!confirm(`Are you sure you want to delete "${groupName}"?`)) return;

    try {
        const client = await ensureSupabase();
        
        // 1. Delete user's own messages in this room (best effort, ignore RLS errors)
        try {
            await client.from('messages').delete().eq('room', groupId).eq('sender_id', currentUser.id);
        } catch(mErr) {
            console.warn('Messages delete notice:', mErr);
        }

        // 2. Attempt deleting the room itself
        let deleteError = null;
        try {
            const { error } = await client.from('rooms').delete().eq('id', groupId);
            if (error) deleteError = error;
        } catch(delErr) {
            deleteError = delErr;
        }

        // If deleting the room failed due to RLS (e.g. user is member or admin but not creator),
        // gracefully fallback to leaving the group & archiving it for the current user
        if (deleteError) {
            console.warn('[Orbit] Room delete restricted by policy, archiving/leaving:', deleteError);
            try {
                // Remove self from room_members
                await client.from('room_members').delete().eq('room_id', groupId).eq('user_id', currentUser.id);
            } catch(rmErr) {}

            try {
                // Remove self from participants array if present
                if (roomMeta && Array.isArray(roomMeta.participants)) {
                    const updatedParts = roomMeta.participants.filter(p => p !== currentUser.id);
                    await client.from('rooms').update({ participants: updatedParts }).eq('id', groupId);
                }
            } catch(partErr) {}
        }

        // 3. Immediately prune from memory, local cache, and recent chats
        allRoomsMap.delete(groupId);
        if (typeof messageCache !== 'undefined') messageCache.delete(groupId);
        try {
            localStorage.removeItem(`orbit_cache_msgs_${groupId}`);
            const cached = localStorage.getItem(`orbit_groups_cache_${currentUser.id}`);
            if (cached) {
                const parsed = JSON.parse(cached).filter(g => g.id !== groupId);
                localStorage.setItem(`orbit_groups_cache_${currentUser.id}`, JSON.stringify(parsed));
            }
            const recent = localStorage.getItem(`orbit_recent_chats_v27_${currentUser.id}`);
            if (recent) {
                const parsedRecent = JSON.parse(recent).filter(r => r.id !== groupId);
                localStorage.setItem(`orbit_recent_chats_v27_${currentUser.id}`, JSON.stringify(parsedRecent));
            }
        } catch(e) {}

        showToast(`Group "${groupName}" removed.`, 'success');

        if (typeof currentRoom !== 'undefined' && currentRoom === groupId) {
            if (typeof closeChatScreen === 'function') closeChatScreen();
        }

        loadGroups();
        loadMainChats();
    } catch(err) {
        // Safe UX fallback
        allRoomsMap.delete(groupId);
        showToast(`Group removed from your list.`, 'success');
        loadGroups();
        loadMainChats();
    }
}
window.deleteGroupFromList = deleteGroupFromList;

async function confirmDeleteGroup() {
    if (!currentRoom || isSelfChat || !isGroupChat) return;
    const roomMeta = allRoomsMap.get(currentRoom);
    const isCreator = roomMeta && roomMeta.created_by === currentUser.id;

    if (!isCreator && !isAdmin()) {
        showToast('Only group creators or admins can delete this group.', 'error');
        return;
    }

    if (!confirm('Are you sure you want to permanently delete this group? All chat history will be removed.')) return;

    try {
        const client = await ensureSupabase();
        const targetRoomId = currentRoom;

        // 1. Delete user's own messages
        try {
            await client.from('messages').delete().eq('room', targetRoomId).eq('sender_id', currentUser.id);
        } catch(mErr) {
            console.warn('Purge messages notice:', mErr);
        }

        // 2. Delete the room itself
        let deleteError = null;
        try {
            const { error } = await client.from('rooms').delete().eq('id', targetRoomId);
            if (error) deleteError = error;
        } catch(delErr) {
            deleteError = delErr;
        }

        if (deleteError) {
            console.warn('[Orbit] Room delete restricted, archiving/leaving:', deleteError);
            try {
                await client.from('room_members').delete().eq('room_id', targetRoomId).eq('user_id', currentUser.id);
            } catch(rmErr) {}
            try {
                if (roomMeta && Array.isArray(roomMeta.participants)) {
                    const updatedParts = roomMeta.participants.filter(p => p !== currentUser.id);
                    await client.from('rooms').update({ participants: updatedParts }).eq('id', targetRoomId);
                }
            } catch(partErr) {}
        }

        allRoomsMap.delete(targetRoomId);
        if (typeof messageCache !== 'undefined') messageCache.delete(targetRoomId);
        try {
            localStorage.removeItem(`orbit_cache_msgs_${targetRoomId}`);
            const cached = localStorage.getItem(`orbit_groups_cache_${currentUser.id}`);
            if (cached) {
                const parsed = JSON.parse(cached).filter(g => g.id !== targetRoomId);
                localStorage.setItem(`orbit_groups_cache_${currentUser.id}`, JSON.stringify(parsed));
            }
            const recent = localStorage.getItem(`orbit_recent_chats_v27_${currentUser.id}`);
            if (recent) {
                const parsedRecent = JSON.parse(recent).filter(r => r.id !== targetRoomId);
                localStorage.setItem(`orbit_recent_chats_v27_${currentUser.id}`, JSON.stringify(parsedRecent));
            }
        } catch(e) {}

        showToast('Group deleted successfully.', 'success');
        closeChatOptionsMenu();
        closeChatScreen();
        loadGroups();
        loadMainChats();
    } catch(err) {
        showToast(`Group removed from your list.`, 'success');
        closeChatOptionsMenu();
        closeChatScreen();
        loadGroups();
        loadMainChats();
    }
}

// ══════════════════════════════════════════════════════════════════════════
// GROUP ADMIN PERMISSIONS & PRIVACY SETTINGS
// ══════════════════════════════════════════════════════════════════════════
function setGroupPrivacyPref(pref) {
    if (!currentUser) return;
    localStorage.setItem(`orbit_group_privacy_${currentUser.id}`, pref);
    showToast(`Group privacy updated: ${pref}`);
}
window.setGroupPrivacyPref = setGroupPrivacyPref;

function getGroupPrivacyPref(uid) {
    if (!uid) return 'contacts';
    try {
        return localStorage.getItem(`orbit_group_privacy_${uid}`) || 'contacts';
    } catch(e) { return 'contacts'; }
}
window.getGroupPrivacyPref = getGroupPrivacyPref;

function isGroupAdmin(roomId) {
    if (!currentUser || !roomId) return false;
    if (typeof isAdmin === 'function' && isAdmin()) return true;
    const roomMeta = allRoomsMap.get(roomId);
    if (!roomMeta) return false;
    if (roomMeta.created_by === currentUser.id) return true;
    if (Array.isArray(roomMeta.admin_ids) && roomMeta.admin_ids.includes(currentUser.id)) return true;
    return false;
}
window.isGroupAdmin = isGroupAdmin;

async function handleGlobalFriendBtnClick(targetUid, btn, event) {
    if (event) event.stopPropagation();
    if (!currentUser || targetUid === currentUser.id) return;

    const isAlreadyFriend = myFriendsSet.has(targetUid);
    const isPending = myOutgoingRequestsSet.has(targetUid);

    if (isAlreadyFriend) {
        showToast('You are already friends with this user.', 'info');
        return;
    }

    if (isPending) {
        showToast('Friend request already sent.', 'info');
        return;
    }

    try {
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            btn.disabled = true;
        }

        const { error } = await sb.from('friends').insert([{
            user_id: currentUser.id,
            friend_id: targetUid,
            status: 'pending'
        }]);

        if (error) throw error;

        myOutgoingRequestsSet.add(targetUid);
        showToast('Friend request sent!', 'success');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-clock"></i> Requested';
            btn.style.background = 'rgba(255,255,255,0.1)';
        }
    } catch(err) {
        showToast(`Request failed: ${err.message}`, 'error');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Connect';
            btn.disabled = false;
        }
    }
}
