// ══════════════════════════════════════════════════════════════════════════
// ORBIT SHARE & FORWARD MODULE (js/chat-share.js)
// Handles:
// 1. External Web Share API (share to WhatsApp, Telegram, System Share Sheet)
// 2. Inbound Share Target (PWA Web Share Target, Drag & Drop files, Clipboard Paste)
// 3. Forward Message Modal (multi-select chat/friend picker & batch dispatch)
// 4. Contact and Poll sharing end-to-end controllers
// ══════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    let messageToForward = null;
    let forwarding = false;
    const forwardSelectedRoomIds = new Set();

    /**
     * Share media or content to external apps via Web Share API
     */
    async function shareMediaExternal(url, title = 'Orbit Media') {
        if (!url) return;
        const cleanUrl = (typeof formatMediaUrl === 'function') ? formatMediaUrl(url) : url;

        if (navigator.share) {
            try {
                // Try sharing file if it can be fetched as a blob
                let sharedFile = false;
                try {
                    const response = await fetch(cleanUrl, { mode: 'cors' });
                    if (response.ok) {
                        const blob = await response.blob();
                        const fileName = cleanUrl.split('/').pop().split('?')[0] || 'orbit_media.jpg';
                        const file = new File([blob], fileName, { type: blob.type });
                        if (navigator.canShare && navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: title,
                                text: 'Shared via Orbit Messenger'
                            });
                            sharedFile = true;
                        }
                    }
                } catch(e) {
                    console.log('Direct file share fallback to URL:', e);
                }

                if (!sharedFile) {
                    await navigator.share({
                        title: title,
                        text: `${title} - Shared via Orbit Messenger`,
                        url: cleanUrl
                    });
                }
                showToast('Shared successfully!', 'success');
                return;
            } catch(err) {
                if (err.name === 'AbortError') return; // user cancelled share sheet
                console.warn('navigator.share failed:', err);
            }
        }

        // Fallback: Copy link to clipboard
        if (typeof copyToClipboard === 'function') {
            copyToClipboard(cleanUrl);
            showToast('Media link copied to clipboard!', 'success');
        } else {
            prompt('Copy media link:', cleanUrl);
        }
    }

    /**
     * Context menu action: Share active message externally
     */
    function contextShareExternal() {
        const msg = window.contextActiveMessage;
        if (!msg) return;
        if(orbitIsViewOnceMessage(msg)){showToast("View-once photos cannot be shared or forwarded.","error");return;}
        if (typeof closeMsgContextModal === 'function') closeMsgContextModal();

        if (msg.attachments && msg.attachments.length > 0) {
            const firstAtt = msg.attachments[0];
            const url = typeof firstAtt === 'string' ? firstAtt : (firstAtt.url || firstAtt.file_url);
            shareMediaExternal(url, msg.text || 'Orbit Media');
        } else if (msg.text) {
            if (navigator.share) {
                navigator.share({
                    title: 'Message from Orbit',
                    text: msg.text
                }).catch(() => {});
            } else if (typeof copyToClipboard === 'function') {
                copyToClipboard(msg.text);
                showToast('Message copied to clipboard');
            }
        }
    }

    /**
     * Context menu action: Open Forward Modal
     */
    function contextForwardMsg() {
        const msg = window.contextActiveMessage;
        if (!msg) return;
        if(orbitIsViewOnceMessage(msg)){showToast("View-once photos cannot be shared or forwarded.","error");return;}
        if (typeof closeMsgContextModal === 'function') closeMsgContextModal();
        openForwardModal(msg);
    }

    /**
     * Opens the forward message modal with contact and recent chat list
     */
    function openForwardModal(msg) {
        if (typeof msg === 'string') {
            const found = (typeof messageCache !== 'undefined' && typeof currentRoom !== 'undefined' && messageCache.get(currentRoom)?.find(m => m.id === msg)) || { id: msg, text: '' };
            msg = found;
        }
        messageToForward = msg;
        forwardSelectedRoomIds.clear();

        const modal = document.getElementById('modal-forward-msg');
        if (!modal) return;

        const snippetEl = document.getElementById('forward-msg-preview-snippet');
        if (snippetEl) {
            let preview = msg.text || '';
            if (!preview && msg.attachments?.length) preview = '📷 Media attachment';
            else if (msg.type === 'voice') preview = '🎤 Voice note';
            else if (msg.type === 'poll') preview = '📊 Poll';
            else if (msg.type === 'contact') preview = '👤 Contact card';
            snippetEl.innerText = preview || 'Message';
        }

        renderForwardTargetsList('');
        updateForwardSendBtn();
        modal.classList.add('active');

        const searchInp = document.getElementById('forward-search-input');
        if (searchInp) {
            searchInp.value = '';
            setTimeout(() => searchInp.focus(), 100);
        }
    }

    function closeForwardModal(event) {
        // A click on a target, search field or Send belongs to the picker.
        if(event && event.target !== event.currentTarget)return;
        const modal = document.getElementById('modal-forward-msg');
        if (modal) modal.classList.remove('active');
        messageToForward = null;
        forwardSelectedRoomIds.clear();
    }

    /**
     * Renders target chats and friends in the forward picker
     */
    function renderForwardTargetsList(filterQuery = '') {
        const listEl = document.getElementById('forward-targets-list');
        if (!listEl) return;

        const q = filterQuery.toLowerCase().trim();
        const targets = [];

        // 1. Add Recent Chats
        if (currentUser) {
            try {
                const cached = localStorage.getItem(`orbit_recent_chats_v27_${currentUser.id}`);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(item => {
                            targets.push({
                                id: item.roomId,
                                title: item.title,
                                isGroup: item.isGroup,
                                avatarHtml: item.avatarHtml || `<span>${(item.title || 'C')[0].toUpperCase()}</span>`
                            });
                        });
                    }
                }
            } catch(e) {}
        }

        // 2. Add Friends from globalUsersMap
        if (typeof globalUsersMap !== 'undefined' && typeof myFriendsSet !== 'undefined') {
            myFriendsSet.forEach(fId => {
                const u = globalUsersMap.get(fId);
                if (u && currentUser) {
                    const roomId = typeof userDirectRoomsMap !== 'undefined' && userDirectRoomsMap.get(u.user_id) || `dm_${[currentUser.id,u.user_id].sort().join('_')}`;
                    if (!targets.some(t => t.id === roomId)) {
                        const name = u.display_name || u.email?.split('@')[0] || 'Friend';
                        targets.push({
                            id: roomId,
                            title: name,
                            isGroup: false,
                            avatarHtml: u.dp_url ? `<img src="${formatMediaUrl(u.dp_url)}">` : `<span>${name[0].toUpperCase()}</span>`
                        });
                    }
                }
            });
        }

        if(typeof allRoomsMap !== 'undefined') allRoomsMap.forEach(room=>{
            if(!room || !Array.isArray(room.participants) || !room.participants.includes(currentUser?.id) || targets.some(t=>t.id===room.id))return;
            const peer=room.participants.find(id=>id!==currentUser.id), user=globalUsersMap.get(peer);
            targets.push({id:room.id,title:room.is_direct?(user?.display_name||room.name||'Direct chat'):(room.name||'Group'),isGroup:!room.is_direct,avatarHtml:'<i class="fa-solid fa-comments"></i>'});
        });
        const seenTargets=new Set();
        const filtered = targets.filter(t=>{
            if(!t.id || (q && !String(t.title||'Chat').toLowerCase().includes(q)))return false;
            let key=t.id;try{if(typeof resolveRoomAliases==='function')key=resolveRoomAliases(t.id).sort()[0]||t.id;}catch(_){}
            if(seenTargets.has(key))return false;seenTargets.add(key);return true;
        });

        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:13px;">No matching chats found</div>';
            return;
        }

        listEl.innerHTML = filtered.map(t => {
            const isSelected = forwardSelectedRoomIds.has(t.id);
            return `
                <div class="forward-target-card touch-fix ${isSelected ? 'selected' : ''}" onclick="toggleForwardTarget('${t.id}', this)" style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:12px; cursor:pointer; background:${isSelected ? 'rgba(10,132,255,0.18)' : 'rgba(255,255,255,0.04)'}; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--glass-border)'}; margin-bottom:6px;">
                    <div class="c-av-wrap" style="width:38px; height:38px; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.08); font-weight:700; flex-shrink:0;">
                        ${t.avatarHtml}
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13.5px; font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.title)}</div>
                        <div style="font-size:11px; color:var(--text-secondary);">${t.isGroup ? 'Group' : 'Direct Chat'}</div>
                    </div>
                    <div class="forward-chk-circle" style="width:22px; height:22px; border-radius:50%; border:2px solid ${isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.3)'}; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center; color:#000; font-size:11px;">
                        ${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function filterForwardTargets(query) {
        renderForwardTargetsList(query);
    }

    function toggleForwardTarget(roomId, cardEl) {
        if (forwardSelectedRoomIds.has(roomId)) {
            forwardSelectedRoomIds.delete(roomId);
            if (cardEl) {
                cardEl.classList.remove('selected');
                cardEl.style.background = 'rgba(255,255,255,0.04)';
                cardEl.style.borderColor = 'var(--glass-border)';
                const chk = cardEl.querySelector('.forward-chk-circle');
                if (chk) {
                    chk.style.background = 'transparent';
                    chk.style.borderColor = 'rgba(255,255,255,0.3)';
                    chk.innerHTML = '';
                }
            }
        } else {
            forwardSelectedRoomIds.add(roomId);
            if (cardEl) {
                cardEl.classList.add('selected');
                cardEl.style.background = 'rgba(10,132,255,0.18)';
                cardEl.style.borderColor = 'var(--accent)';
                const chk = cardEl.querySelector('.forward-chk-circle');
                if (chk) {
                    chk.style.background = 'var(--accent)';
                    chk.style.borderColor = 'var(--accent)';
                    chk.innerHTML = '<i class="fa-solid fa-check"></i>';
                }
            }
        }
        updateForwardSendBtn();
    }

    function updateForwardSendBtn() {
        const btn = document.getElementById('btn-execute-forward');
        const count = forwardSelectedRoomIds.size;
        if (btn) {
            btn.disabled = count === 0;
            btn.innerHTML = count > 0 ? `<i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i> Forward (${count})` : '<i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i> Select Chats';
            btn.style.opacity = count > 0 ? '1' : '0.5';
        }
    }

    /**
     * Executes forwarding of messageToForward to all selected rooms
     */
    async function executeForwardMessage() {
        if (forwarding || !messageToForward || forwardSelectedRoomIds.size === 0 || !currentUser) return;
        // Cache message copy BEFORE closing modal which sets messageToForward = null
        const msg = { ...messageToForward };
        if(orbitIsViewOnceMessage(msg)){showToast('View-once photos cannot be forwarded.','error');return;}
        if(msg.type==='call'){showToast('Call records cannot be forwarded.','info');return;}
        const targetRooms = Array.from(forwardSelectedRoomIds);
        const owner=currentUser.id;
        forwarding=true;
        const sendButton=document.getElementById('btn-execute-forward');
        if(sendButton){sendButton.disabled=true;sendButton.textContent='Forwarding…';}
        showToast(`Forwarding to ${targetRooms.length} chat${targetRooms.length > 1 ? 's' : ''}...`);

        try {
            const client = await ensureSupabase();
            if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
            const senderName = currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || 'User';

            const payloadBase = {
                sender_id: currentUser.id,
                username: senderName,
                text: msg.text || '',
                type: msg.type || 'text',
                attachments: [],
                reply_to: {forwarded:true},
                read_by: [currentUser.id],
                created_at: new Date().toISOString()
            };

            let sent=0;
            const failed=[];
            for (const rId of targetRooms) {
                if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
                let targetRoom=rId;
                if(rId.startsWith('dm_') && typeof resolveCanonicalRoomId==='function'){
                    const peer=resolveDirectPeerId(rId,owner);
                    if(!peer){failed.push({room:rId,error:{message:'This contact could not be identified. Reopen the chat first.'}});continue;}
                    targetRoom=await resolveCanonicalRoomId(peer,globalUsersMap.get(peer)?.display_name);
                    if(!targetRoom){failed.push({room:rId,error:{message:'Could not open the destination chat. Please retry.'}});continue;}
                }
                if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
                const forwardedAttachments=await orbitCopyForwardAttachments(msg.attachments?.length ? msg.attachments : (/^(https?:\/\/)/.test(msg.text||'') && ['image','video','file','audio','voice'].includes(msg.type) ? [{url:msg.text,type:msg.type,name:'Forwarded attachment'}] : []),msg.type,targetRoom);
                const insertPayload = { ...payloadBase,attachments:forwardedAttachments,sender_id:owner, id:crypto.randomUUID(), room: targetRoom };
                const result = typeof window.executeResilientMessageInsert === 'function'
                    ? await window.executeResilientMessageInsert(insertPayload)
                    : await client.from('messages').insert(insertPayload);
                if(result?.error) failed.push({room:rId,error:result.error}); else {sent++;forwardSelectedRoomIds.delete(rId);}
            }

            showToast(failed.length ? `Forwarded to ${sent} of ${targetRooms.length} chats. ${failed[0].error.message}` : `Forwarded to ${sent} chat${sent===1?'':'s'}.`, failed.length?'error':'success');
            if(!failed.length)closeForwardModal();
            else renderForwardTargetsList(document.getElementById('forward-search-input')?.value||'');

            // If active room was one of the targets, reload
            if (typeof currentRoom !== 'undefined' && targetRooms.includes(currentRoom)) {
                if (typeof loadRoomMessages === 'function') loadRoomMessages(currentRoom);
            }
        } catch(err) {
            console.error('Forward error:', err);
            showToast(`Failed to forward: ${err.message}`, 'error');
        } finally {forwarding=false;if(currentUser?.id!==owner)closeForwardModal();updateForwardSendBtn();}
    }

    // ── Inbound Share, Drag & Drop, and Paste Handlers ──

    function initInboundShareHandlers() {
        // 1. PWA Web Share Target URL query params
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const sharedTitle = urlParams.get('title') || '';
            const sharedText = urlParams.get('text') || '';
            const sharedUrl = urlParams.get('url') || '';

            if (sharedTitle || sharedText || sharedUrl) {
                const combined = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n');
                window.history.replaceState({}, document.title, window.location.pathname);
                setTimeout(() => {
                    const input = document.getElementById('msg-input');
                    if (input) {
                        input.value = combined;
                        if (typeof handleInputResize === 'function') handleInputResize(input);
                        showToast('Content imported from external share!', 'info');
                    }
                }, 1000);
            }
        } catch(e) {}

        // 2. Drag & Drop files into Chat with visual Frosted Dropzone
        let dragCounter = 0;
        const getDropOverlay = () => document.getElementById('chat-dropzone-overlay');

        window.addEventListener('dragenter', (e) => {
            const chatScreen = document.getElementById('screen-chat');
            if (!chatScreen || !chatScreen.classList.contains('active')) return;
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                dragCounter++;
                const overlay = getDropOverlay();
                if (overlay) overlay.classList.remove('hide');
            }
        });

        window.addEventListener('dragleave', (e) => {
            const chatScreen = document.getElementById('screen-chat');
            if (!chatScreen || !chatScreen.classList.contains('active')) return;
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                const overlay = getDropOverlay();
                if (overlay) overlay.classList.add('hide');
            }
        });

        window.addEventListener('dragover', (e) => {
            if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
            }
        });

        window.addEventListener('drop', (e) => {
            dragCounter = 0;
            const overlay = getDropOverlay();
            if (overlay) overlay.classList.add('hide');

            const chatScreen = document.getElementById('screen-chat');
            if (!chatScreen || !chatScreen.classList.contains('active')) return;

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files);
                handlePastedOrDroppedFiles(files);
            }
        });

        // 3. Clipboard Paste Image/Files
        window.addEventListener('paste', (e) => {
            const chatScreen = document.getElementById('screen-chat');
            if (!chatScreen || !chatScreen.classList.contains('active')) return;

            if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                const files = Array.from(e.clipboardData.files);
                handlePastedOrDroppedFiles(files);
            }
        });
    }

    async function handlePastedOrDroppedFiles(files) {
        if (!files || files.length === 0) return;
        const chatScreen = document.getElementById('screen-chat');
        if (!chatScreen || !chatScreen.classList.contains('active')) return;

        const items=Array.from(files).map(file=>({file,name:file.name||'Pasted file',type:file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'file',size:file.size||0,url:URL.createObjectURL(file)}));
        openMediaPreviewScreen(items);
    }

    // ── Fixes for Contact Sharing & Polls ──

    function openShareContactModalFixed() {
        const modal = document.getElementById('modal-share-contact');
        if (!modal) return;
        const list = document.getElementById('contact-share-list');
        if (!list) return;

        const contacts = [];
        // Pull all friends and global users
        if (window.globalUsersMap) {
            window.globalUsersMap.forEach(u => {
                if (!currentUser || u.user_id !== currentUser.id) {
                    contacts.push({
                        name: u.display_name || u.email?.split('@')[0] || 'Orbit User',
                        username: u.username || u.email?.split('@')[0] || '',
                        avatar_url: u.dp_url || '',
                        phone: u.phone || ''
                    });
                }
            });
        }

        if (contacts.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:18px; color:var(--text-muted); font-size:12.5px;">No contacts available. Enter manual details below.</div>';
        } else {
            list.innerHTML = contacts.map(c => `
                <div class="contact-card-top touch-fix" onclick="sendContactCard(${escapeHtml(JSON.stringify(c.name||''))}, ${escapeHtml(JSON.stringify(c.username||''))}, ${escapeHtml(JSON.stringify(c.phone||''))}, ${escapeHtml(JSON.stringify(c.avatar_url||''))})" style="cursor:pointer; padding:8px 10px; border-radius:10px; background:rgba(255,255,255,0.04); border:1px solid var(--glass-border); display:flex; align-items:center; gap:10px; margin-bottom:6px;">
                    <div class="contact-card-av" style="width:36px; height:36px; font-size:14px; border-radius:50%; background:rgba(10,132,255,0.2); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700;">
                        ${c.avatar_url ? `<img src="${formatMediaUrl(c.avatar_url)}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : (c.name[0] || 'U').toUpperCase()}
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:700; color:#fff;">${escapeHtml(c.name)}</div>
                        <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(c.username ? '@' + c.username : (c.phone || 'Orbit User'))}</div>
                    </div>
                    <button class="btn-reset" style="color:var(--accent); font-size:12px; font-weight:700;"><i class="fa-solid fa-share"></i> Share</button>
                </div>
            `).join('');
        }
        modal.classList.add('active');
    }

    // Auto-init inbound listeners on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInboundShareHandlers);
    } else {
        initInboundShareHandlers();
    }

    // Expose globally
    window.OrbitShare = {
        shareMediaExternal,
        contextShareExternal,
        contextForwardMsg,
        openForwardModal,
        closeForwardModal,
        filterForwardTargets,
        toggleForwardTarget,
        executeForwardMessage,
        openShareContactModalFixed
    };

    window.shareMediaExternal = shareMediaExternal;
    window.contextShareExternal = contextShareExternal;
    window.contextForwardMsg = contextForwardMsg;
    window.openForwardModal = openForwardModal;
    window.closeForwardModal = closeForwardModal;
    window.filterForwardTargets = filterForwardTargets;
    window.toggleForwardTarget = toggleForwardTarget;
    window.executeForwardMessage = executeForwardMessage;
})();
