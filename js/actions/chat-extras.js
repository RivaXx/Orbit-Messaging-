// ORBIT CHAT ACTIONS - EXTRAS & UTILITIES (js/actions/chat-extras.js)
// Contact sharing, in-chat search, GPS live location, interactive polls, scheduled messages, WebRTC, dynamic island notifications.
// ── Contact Sharing Modal & Actions ──
function openShareContactModal() {
    const modal = document.getElementById('modal-share-contact');
    if (!modal) return;
    const list = document.getElementById('contact-share-list');
    if (list) {
        const contacts = [];
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
                <div class="contact-card-top touch-fix" onclick="sendContactCard('${escapeHtml(c.name)}', '${escapeHtml(c.username)}', '${escapeHtml(c.phone)}', '${escapeHtml(c.avatar_url)}')" style="cursor:pointer; padding:8px 10px; border-radius:10px; background:rgba(255,255,255,0.04); border:1px solid var(--glass-border); display:flex; align-items:center; gap:10px; margin-bottom:6px;">
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
    }
    modal.classList.add('active');
}

function closeShareContactModal(e) {
    if (e && e.target && e.target.classList && e.target.classList.contains('glass-modal-box')) return;
    const modal = document.getElementById('modal-share-contact');
    if (modal) modal.classList.remove('active');
}

function filterShareContacts(query) {
    const q = (query || '').toLowerCase().trim();
    const list = document.getElementById('contact-share-list');
    if (!list) return;
    const items = list.querySelectorAll('.contact-card-top');
    items.forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

async function sendContactCard(name, username, phone, avatar) {
    closeShareContactModal();
    if (!currentRoom || !currentUser) {
        showToast('Open a chat first', 'error');
        return;
    }

    const contactData = {
        name: name || 'Orbit Contact',
        username: username || '',
        phone: phone || '',
        avatar: avatar || ''
    };

    const sendRoomId = currentRoom;
    const payload = {
        room: sendRoomId,
        sender_id: currentUser.id,
        username: userProfile?.first_name ? `${userProfile.first_name}` : (currentUser.email ? currentUser.email.split('@')[0] : 'User'),
        text: `👤 Contact: ${contactData.name}`,
        type: 'contact',
        attachments: [contactData],
        created_at: new Date().toISOString()
    };

    const optId = `opt_${Date.now()}`;
    if (typeof appendSingleMessageNode === 'function') {
        appendSingleMessageNode({ ...payload, id: optId });
        if (typeof scrollFeedToBottom === 'function') scrollFeedToBottom(true);
    }

    try {
        const client = await ensureSupabase();
        await client.from('messages').insert([payload]);
    } catch(err) {
        console.warn('Contact send err:', err);
    }
}

async function sendManualContactCard() {
    const nameInput = document.getElementById('contact-manual-name');
    const phoneInput = document.getElementById('contact-manual-phone');
    const name = nameInput?.value.trim();
    const phone = phoneInput?.value.trim();
    if (!name) {
        showToast('Please enter contact name', 'error');
        return;
    }
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    await sendContactCard(name, '', phone, '');
}

// ── In-Chat Search ──
let chatSearchMatches = [];
let currentSearchMatchIdx = -1;

function toggleChatSearchBar() {
    const bar = document.getElementById('chat-search-bar');
    if (!bar) return;
    if (bar.classList.contains('hide')) {
        bar.classList.remove('hide');
        const input = document.getElementById('chat-search-input');
        if (input) {
            input.focus();
            if (input.value) handleChatSearchInput(input.value);
        }
    } else {
        closeChatSearchBar();
    }
}

function closeChatSearchBar() {
    const bar = document.getElementById('chat-search-bar');
    if (bar) bar.classList.add('hide');
    const count = document.getElementById('chat-search-count');
    if (count) count.textContent = '';
    clearChatSearchHighlights();
    chatSearchMatches = [];
    currentSearchMatchIdx = -1;
}

function clearChatSearchHighlights() {
    const feed = document.getElementById('chat-feed');
    if (!feed) return;
    const marks = feed.querySelectorAll('.search-highlight-match, .search-highlight-current');
    marks.forEach(m => {
        const parent = m.parentNode;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
    });
}

function handleChatSearchInput(query) {
    clearChatSearchHighlights();
    chatSearchMatches = [];
    currentSearchMatchIdx = -1;
    const countEl = document.getElementById('chat-search-count');

    const q = (query || '').trim().toLowerCase();
    if (!q) {
        if (countEl) countEl.textContent = '';
        return;
    }

    const feed = document.getElementById('chat-feed');
    if (!feed) return;
    const msgNodes = feed.querySelectorAll('.msg-text-content');

    msgNodes.forEach(node => {
        const text = node.textContent;
        const lower = text.toLowerCase();
        if (lower.includes(q)) {
            // Highlight occurrences
            const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            node.innerHTML = text.replace(regex, '<mark class="search-highlight-match">$1</mark>');
            node.querySelectorAll('.search-highlight-match').forEach(m => chatSearchMatches.push(m));
        }
    });

    if (chatSearchMatches.length > 0) {
        currentSearchMatchIdx = 0;
        focusCurrentSearchMatch();
    } else if (countEl) {
        countEl.textContent = '0 results';
    }
}

function focusCurrentSearchMatch() {
    const countEl = document.getElementById('chat-search-count');
    if (chatSearchMatches.length === 0) return;
    chatSearchMatches.forEach((m, idx) => {
        m.classList.toggle('search-highlight-current', idx === currentSearchMatchIdx);
    });
    const active = chatSearchMatches[currentSearchMatchIdx];
    if (active) {
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (countEl) {
        countEl.textContent = `${currentSearchMatchIdx + 1}/${chatSearchMatches.length}`;
    }
}

function nextChatSearchResult() {
    if (chatSearchMatches.length === 0) return;
    currentSearchMatchIdx = (currentSearchMatchIdx + 1) % chatSearchMatches.length;
    focusCurrentSearchMatch();
}

function prevChatSearchResult() {
    if (chatSearchMatches.length === 0) return;
    currentSearchMatchIdx = (currentSearchMatchIdx - 1 + chatSearchMatches.length) % chatSearchMatches.length;
    focusCurrentSearchMatch();
}


// GPS LIVE LOCATION SHARING (Strict currentRoom preservation)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function shareCurrentLocation() {
    if (!currentRoom || !currentUser) {
        showToast('Open a chat to share location');
        return;
    }

    const sendLocationPayload = async (lat, lng, accuracy, source = 'GPS') => {
        const sendRoomId = currentRoom; // Strictly currentRoom

        const locationMeta = {
            lat: lat.toFixed(5),
            lng: lng.toFixed(5),
            accuracy: accuracy ? `${accuracy}m` : null,
            source,
            timestamp: new Date().toISOString()
        };

        const mapUrl = `https://maps.google.com/?q=${locationMeta.lat},${locationMeta.lng}`;

        const payload = {
            room: sendRoomId,
            sender_id: currentUser.id,
            username: userProfile?.first_name ? `${userProfile.first_name}` : currentUser.email.split('@')[0],
            text: `ðŸ“ Live Location (${source}): ${locationMeta.lat}, ${locationMeta.lng}`,
            type: 'location',
            attachments: [mapUrl],
            reply_to: replyTargetMessage ? {
                id: replyTargetMessage.id,
                sender_id: replyTargetMessage.sender_id || null,
                username: replyTargetMessage.username || 'User',
                text: replyTargetMessage.text || '',
                type: replyTargetMessage.type || 'text'
            } : null,
            created_at: new Date().toISOString()
        };

        if (replyTargetMessage) {
            replyTargetMessage = null;
            document.getElementById('reply-preview-bar')?.classList.add('hide');
        }

        const optId = `opt_${Date.now()}`;
        appendSingleMessageNode({ ...payload, id: optId });
        scrollFeedToBottom(true);

        try {
            const client = await ensureSupabase();
            const { data } = await client.from('messages').insert([payload]).select();
            if (data && data[0]) {
                const optNode = document.getElementById(`msg-${optId}`);
                if (optNode) {
                    optNode.id = `msg-${data[0].id}`;
                    optNode.dataset.msgId = data[0].id;
                }
            }
        } catch(e) {
            console.error('Location send error:', e);
            showToast('Failed to send location');
        }
    };

    if (typeof getOrbitLocationOnce !== 'function') {
        showToast('Location is not available right now.', 'error');
        return;
    }
    showToast('Locating your position…', 'info');
    getOrbitLocationOnce().then(position => {
        sendLocationPayload(position.coords.latitude, position.coords.longitude, Math.round(position.coords.accuracy || 0), 'GPS');
        showToast('Location shared', 'success');
    }).catch(error => {
        showToast(error.message || 'Location access is unavailable.', 'info');
    });
}

async function fallbackIpLocation(callback) {
    try {
        showToast('Using approximate network location...', 'info');
        const res = await fetch('https://ipapi.co/json/');
        const data = await res.json();
        if (data.latitude && data.longitude) {
            callback(data.latitude, data.longitude, 1000, 'IP');
            showToast('Approximate location shared', 'success');
        } else {
            showToast('Unable to detect location. Check device permissions.', 'error');
        }
    } catch(e) {
        console.error('[Orbit Location] IP fallback error:', e);
        showToast('Location access denied or unavailable', 'error');
    }
}

// ══════════════════════════════════════════════════════════════════════════

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// POLLS CREATION & INTERACTIVE VOTING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function openCreatePollModal() {
    const modal = document.getElementById('modal-create-poll');
    const qInput = document.getElementById('poll-question-inp') || document.getElementById('input-poll-question');
    const optsContainer = document.getElementById('poll-options-container');

    if (qInput) qInput.value = '';
    if (optsContainer) {
        optsContainer.innerHTML = `
            <input type="text" class="glass-input poll-opt" placeholder="Option 1" style="margin-bottom:8px;">
            <input type="text" class="glass-input poll-opt" placeholder="Option 2" style="margin-bottom:8px;">
        `;
    }
    if (modal) modal.classList.add('active');
    setTimeout(() => { if (qInput) qInput.focus(); }, 100);
}

function closeCreatePollModal() {
    const modal = document.getElementById('modal-create-poll');
    if (modal) modal.classList.remove('active');
}

function addPollOptionField() {
    const optsContainer = document.getElementById('poll-options-container');
    if (!optsContainer) return;
    const count = optsContainer.querySelectorAll('.poll-opt, .poll-opt-inp, input').length;
    if (count >= 8) {
        showToast('Maximum 8 options allowed', 'info');
        return;
    }
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'glass-input poll-opt';
    inp.placeholder = `Option ${count + 1}`;
    inp.style.marginBottom = '8px';
    optsContainer.appendChild(inp);
    inp.focus();
}

async function submitPollToChat() {
    const qInput = document.getElementById('poll-question-inp') || document.getElementById('input-poll-question');
    const question = qInput?.value.trim();
    if (!question) {
        showToast('Please enter a question for the poll', 'error');
        return;
    }

    const optInputs = document.querySelectorAll('#poll-options-container input');
    const options = Array.from(optInputs).map(inp => inp.value.trim()).filter(v => v.length > 0);
    if (options.length < 2) {
        showToast('Please provide at least 2 options', 'error');
        return;
    }

    const sendRoomId = currentRoom;
    if (!sendRoomId) {
        showToast('No active chat selected', 'error');
        return;
    }

    if (!currentUser || !currentUser.id) {
        showToast('Please sign in to create a poll', 'error');
        return;
    }

    const multiAnswerInp = document.getElementById('poll-allow-multiple');
    const allowMultiple = multiAnswerInp ? multiAnswerInp.checked : false;

    const pollData = {
        question,
        multiple_answers: allowMultiple,
        options: options.map(opt => ({ text: opt, voters: [], votes: 0 }))
    };

    const payload = {
        room: sendRoomId,
        sender_id: currentUser.id,
        username: userProfile?.first_name ? `${userProfile.first_name}` : (currentUser.email ? currentUser.email.split('@')[0] : 'User'),
        text: `📊 ${question}`,
        type: 'poll',
        attachments: [{ type: 'poll', poll: pollData }],
        metadata: { poll: pollData },
        created_at: new Date().toISOString()
    };

    closeCreatePollModal();

    // Optimistic message append for 0ms instant display
    const optId = `opt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const optimisticMsg = { ...payload, id: optId, client_temp_id: optId };
    
    // Save to memory and localStorage across room aliases
    let msgs = messageCache.get(sendRoomId) || [];
    msgs.push(optimisticMsg);
    const aliases = typeof resolveRoomAliases === 'function' ? resolveRoomAliases(sendRoomId) : [sendRoomId];
    aliases.forEach(alias => {
        messageCache.set(alias, msgs);
        try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(msgs.slice(-40))); } catch(e) {}
    });

    if (typeof appendSingleMessageNode === 'function') {
        appendSingleMessageNode(optimisticMsg);
    }
    if (typeof scrollFeedToBottom === 'function') {
        scrollFeedToBottom(true);
    }

    try {
        const client = await ensureSupabase();
        let insertData = null;
        let insertErr = null;

        try {
            const res = await client.from('messages').insert([payload]).select();
            insertData = res.data;
            insertErr = res.error;
        } catch(e) {
            insertErr = e;
        }

        // Schema fallback if metadata column doesn't exist
        if (insertErr && (insertErr.message?.includes('metadata') || insertErr.code === '42703')) {
            try {
                const fallbackPayload = { ...payload };
                delete fallbackPayload.metadata;
                const res = await client.from('messages').insert([fallbackPayload]).select();
                insertData = res.data;
                insertErr = res.error;
            } catch(e2) {
                insertErr = e2;
            }
        }

        if (insertErr) throw insertErr;

        if (insertData && insertData[0]) {
            const realMsg = insertData[0];
            const optNode = document.getElementById(`msg-${optId}`);
            if (optNode) {
                optNode.id = `msg-${realMsg.id}`;
                optNode.dataset.msgId = realMsg.id;
                optNode.querySelectorAll('.poll-option-row').forEach((row, idx) => {
                    row.setAttribute('onclick', `voteOnPollMessage('${realMsg.id}', ${idx})`);
                });
            }

            aliases.forEach(alias => {
                let curMsgs = messageCache.get(alias) || [];
                const idx = curMsgs.findIndex(m => m.id === optId || m.client_temp_id === optId);
                if (idx !== -1) curMsgs[idx] = realMsg;
                else curMsgs.push(realMsg);
                messageCache.set(alias, curMsgs);
                try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(curMsgs.slice(-40))); } catch(e) {}
            });
        }
    } catch(e) {
        console.error('Poll creation error:', e);
        showToast('Failed to post poll: ' + (e.message || 'Check network'), 'error');
    }
}

async function voteOnPollMessage(msgId, optionIndex) {
    if (!currentUser) {
        showToast('Please sign in to vote', 'error');
        return;
    }
    try {
        const uid = currentUser.id;
        const aliases = typeof resolveRoomAliases === 'function' ? resolveRoomAliases(currentRoom) : [currentRoom];

        // Locate message in-memory across all aliases
        let target = null;
        for (const alias of aliases) {
            const list = messageCache.get(alias) || [];
            target = list.find(m => m.id === msgId || m.client_temp_id === msgId);
            if (target) break;
        }

        let pollData = null;
        if (target) {
            pollData = target.metadata?.poll || target.metadata || (Array.isArray(target.attachments) ? target.attachments.find(a => a && (a.type === 'poll' || a.poll))?.poll || target.attachments[0]?.poll : null);
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(msgId);

        if ((!pollData || !Array.isArray(pollData.options)) && isUuid) {
            try {
                const client = await ensureSupabase();
                const { data: dbMsg } = await client.from('messages').select('*').eq('id', msgId).maybeSingle();
                if (dbMsg) {
                    target = dbMsg;
                    pollData = dbMsg.metadata?.poll || dbMsg.metadata || (Array.isArray(dbMsg.attachments) ? dbMsg.attachments.find(a => a && (a.type === 'poll' || a.poll))?.poll || dbMsg.attachments[0]?.poll : null);
                }
            } catch(e) {}
        }

        if (!pollData || !Array.isArray(pollData.options)) {
            showToast('Unable to load poll data to vote', 'info');
            return;
        }

        // Single-choice vs Multiple-choice voting logic
        const allowMultiple = pollData.multiple_answers === true;
        const targetOpt = pollData.options[optionIndex];
        const alreadyVotedTarget = targetOpt && Array.isArray(targetOpt.voters) && targetOpt.voters.includes(uid);

        pollData.options.forEach((opt, idx) => {
            if (!Array.isArray(opt.voters)) {
                opt.voters = Array.isArray(opt.votes) ? opt.votes : [];
            }
            if (!allowMultiple) {
                // Single-choice: remove user's vote from all other options
                opt.voters = opt.voters.filter(id => id !== uid);
            }
            if (idx === optionIndex) {
                if (allowMultiple) {
                    if (opt.voters.includes(uid)) {
                        opt.voters = opt.voters.filter(id => id !== uid);
                    } else {
                        opt.voters.push(uid);
                    }
                } else {
                    // Single choice: if they previously had NOT voted for target, add their vote;
                    // if they already had voted for it, it remains deselected (toggle off).
                    if (!alreadyVotedTarget) {
                        opt.voters.push(uid);
                    }
                }
            }
            opt.votes = opt.voters.length;
        });

        // 1. Optimistic in-memory update across all aliases
        aliases.forEach(alias => {
            let list = messageCache.get(alias) || [];
            const t = list.find(m => m.id === msgId || m.client_temp_id === msgId);
            if (t) {
                t.metadata = { ...(t.metadata || {}), poll: pollData };
                t.attachments = [{ type: 'poll', poll: pollData }];
            }
            try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(list.slice(-40))); } catch(e) {}
        });

        // 2. Re-render message node smoothly in DOM
        if (typeof handleRemotePollVote === 'function') {
            handleRemotePollVote({ msgId, poll: pollData }, currentRoom, aliases);
        } else {
            const existingNode = document.getElementById(`msg-${msgId}`);
            if (existingNode && target && typeof createMessageDOMNode === 'function') {
                target.metadata = { ...(target.metadata || {}), poll: pollData };
                target.attachments = [{ type: 'poll', poll: pollData }];
                const newNode = createMessageDOMNode(target);
                existingNode.replaceWith(newNode);
            }
        }

        // 3. Peer-to-peer real-time broadcast (<100ms instant sync for all participants)
        if (typeof activeRealtimeChannel !== 'undefined' && activeRealtimeChannel) {
            try {
                activeRealtimeChannel.send({
                    type: 'broadcast',
                    event: 'poll_vote',
                    payload: { msgId, poll: pollData, room: currentRoom }
                });
            } catch(e) {}
        }

        // 4. Background DB persist
        if (isUuid) {
            (async () => {
                try {
                    const client = await ensureSupabase();
                    const { error: upErr } = await client.from('messages').update({
                        attachments: [{ type: 'poll', poll: pollData }]
                    }).eq('id', msgId);
                    if (upErr) {
                        await client.from('messages').update({
                            metadata: { poll: pollData },
                            attachments: [{ type: 'poll', poll: pollData }]
                        }).eq('id', msgId);
                    }
                } catch(err) {
                    console.warn('[Orbit] Poll vote background update note:', err);
                }
            })();
        }
    } catch(e) {
        console.error('Vote error:', e);
    }
}
window.voteOnPollMessage = voteOnPollMessage;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SCHEDULED MESSAGES (Send at Future Time)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let pendingScheduledMessageText = '';
let activeScheduledTimer = null;

function initScheduleButtonListener() {
    const sendBtn = document.getElementById('send-msg-btn');
    if (!sendBtn) return;

    let pressTimer = null;
    sendBtn.addEventListener('mousedown', () => {
        pressTimer = setTimeout(openScheduleModal, 600);
    });
    sendBtn.addEventListener('mouseup', () => clearTimeout(pressTimer));
    sendBtn.addEventListener('mouseleave', () => clearTimeout(pressTimer));

    sendBtn.addEventListener('touchstart', () => {
        pressTimer = setTimeout(openScheduleModal, 600);
    }, { passive: true });
    sendBtn.addEventListener('touchend', () => clearTimeout(pressTimer));

    // Check every minute for scheduled messages
    if (!activeScheduledTimer) {
        activeScheduledTimer = setInterval(checkAndDispatchScheduledMessages, 60000);
    }
}

function openScheduleModal() {
    const input = document.getElementById('msg-input');
    const text = input?.value.trim();
    if (!text) {
        showToast('Type a message first, then hold send to schedule it.');
        return;
    }
    pendingScheduledMessageText = text;
    const modal = document.getElementById('modal-schedule-msg');
    if (modal) modal.classList.add('active');
}

function closeScheduleModal() {
    const modal = document.getElementById('modal-schedule-msg');
    if (modal) modal.classList.remove('active');
}

function setSchedulePreset(minutes) {
    const d = new Date(Date.now() + minutes * 60000);
    const dateInput = document.getElementById('input-schedule-date');
    const timeInput = document.getElementById('input-schedule-time');
    if (dateInput) dateInput.value = d.toISOString().split('T')[0];
    if (timeInput) timeInput.value = d.toTimeString().split(' ')[0].substring(0, 5);
}

function confirmScheduleMessage() {
    const dateInput = document.getElementById('input-schedule-date');
    const timeInput = document.getElementById('input-schedule-time');
    if (!dateInput?.value || !timeInput?.value) {
        showToast('Please select date and time');
        return;
    }

    const scheduledTime = new Date(`${dateInput.value}T${timeInput.value}`).getTime();
    if (scheduledTime <= Date.now()) {
        showToast('Scheduled time must be in the future', 'error');
        return;
    }

    const key = `orbit_scheduled_${currentUser.id}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}

    list.push({
        id: `sched_${Date.now()}`,
        room: currentRoom,
        text: pendingScheduledMessageText,
        scheduledAt: scheduledTime
    });

    localStorage.setItem(key, JSON.stringify(list));

    const input = document.getElementById('msg-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }

    closeScheduleModal();
    updateScheduledChipForCurrentRoom();
    showToast('Message scheduled successfully!', 'success');
}

function updateScheduledChipForCurrentRoom() {
    const chip = document.getElementById('scheduled-msgs-chip');
    if (!chip || !currentUser) return;

    const key = `orbit_scheduled_${currentUser.id}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}

    const count = list.filter(item => item.room === currentRoom).length;
    if (count > 0) {
        chip.classList.remove('hide');
        chip.innerHTML = `<i class="fa-regular fa-clock"></i> ${count} Scheduled`;
    } else {
        chip.classList.add('hide');
    }
}

function openScheduledDrawer() {
    const drawer = document.getElementById('drawer-scheduled-msgs');
    const feed = document.getElementById('scheduled-msgs-feed');
    if (!drawer || !feed) return;

    const key = `orbit_scheduled_${currentUser.id}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}

    const roomItems = list.filter(item => item.room === currentRoom);
    if (roomItems.length === 0) {
        feed.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">No scheduled messages for this chat.</div>';
    } else {
        feed.innerHTML = roomItems.map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.05); border-radius:10px; margin-bottom:8px;">
                <div>
                    <div style="color:#fff; font-size:13px;">${escapeHtml(item.text)}</div>
                    <div style="color:#888; font-size:11px;">Send: ${new Date(item.scheduledAt).toLocaleString()}</div>
                </div>
                <button class="btn-reset" onclick="deleteScheduledMessage('${item.id}')" style="color:#FF453A; font-size:14px; padding:6px;"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('');
    }

    drawer.classList.add('active');
}

function closeScheduledDrawer() {
    const drawer = document.getElementById('drawer-scheduled-msgs');
    if (drawer) drawer.classList.remove('active');
}

function deleteScheduledMessage(id) {
    const key = `orbit_scheduled_${currentUser.id}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
    list = list.filter(item => item.id !== id);
    localStorage.setItem(key, JSON.stringify(list));
    openScheduledDrawer();
    updateScheduledChipForCurrentRoom();
}

async function checkAndDispatchScheduledMessages() {
    if (!currentUser) return;
    const key = `orbit_scheduled_${currentUser.id}`;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}

    const now = Date.now();
    const remaining = [];

    for (const item of list) {
        if (item.scheduledAt <= now) {
            try {
                const client = await ensureSupabase();
                const payload = {
                    room: item.room,
                    sender_id: currentUser.id,
                    username: userProfile?.first_name ? `${userProfile.first_name}` : currentUser.email.split('@')[0],
                    text: item.text,
                    type: 'text',
                    attachments: [],
                    created_at: new Date().toISOString()
                };
                await client.from('messages').insert([payload]);
                if (currentRoom === item.room) {
                    appendSingleMessageNode({ ...payload, id: `sched_${now}` });
                    scrollFeedToBottom(true);
                }
            } catch(e) {
                console.error('Scheduled dispatch error:', e);
            }
        } else {
            remaining.push(item);
        }
    }

    localStorage.setItem(key, JSON.stringify(remaining));
    updateScheduledChipForCurrentRoom();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WEBRTC VOICE CALLS (Peer to Peer)
// The two configured admin accounts can start calls; the peer can answer from the incoming-call dialog.
let peerConnection = null;
let localAudioStream = null;
let callDurationTimer = null;
let callNoAnswerTimer = null;
let callStartTime = 0;
let _activeCallId = null;
let _activeCallPeerId = null;
let _activeCallRoom = null;
let _activeCallRole = null;
let _pendingCallOffer = null;
let _pendingCallCandidates = [];

function _canStartVoiceCall() {
    const allowedEmails = Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS : [];
    return Boolean(currentUser?.email && allowedEmails.some(email => String(email).toLowerCase() === currentUser.email.toLowerCase()));
}

function updateVoiceCallButton() {
    const button = document.getElementById('btn-chat-voice-call');
    if (!button) return;
    const canCall = _canStartVoiceCall() && Boolean(currentRoom && activeChatPeerId && !isGroupChat && !isSelfChat);
    button.classList.toggle('hide', !canCall);
}
window.updateVoiceCallButton = updateVoiceCallButton;

function _setVoiceCallStatus(text) {
    const status = document.getElementById('call-status-label');
    if (status) status.textContent = text;
}

function _showVoiceCallModal({ incoming = false } = {}) {
    const modal = document.getElementById('modal-voice-call');
    const peerName = document.getElementById('call-peer-name');
    const timer = document.getElementById('call-timer-label');
    const answer = document.getElementById('call-btn-answer');
    if (peerName) peerName.textContent = document.getElementById('chat-target-name')?.textContent || 'Orbit user';
    if (timer) timer.textContent = '00:00';
    if (answer) answer.classList.toggle('hide', !incoming);
    if (modal) modal.classList.add('active');
}

async function _sendVoiceCallSignal(type, extra = {}) {
    if (!activeRealtimeChannel || !_activeCallPeerId || !_activeCallRoom || !_activeCallId) return false;
    try {
        const result = await activeRealtimeChannel.send({
            type: 'broadcast',
            event: 'webrtc_signal',
            payload: {
                type,
                room: _activeCallRoom,
                callId: _activeCallId,
                from: currentUser.id,
                to: _activeCallPeerId,
                ...extra
            }
        });
        return result === 'ok' || result?.status === 'ok';
    } catch (error) {
        console.warn('[Orbit Call] Signal dispatch failed:', error);
        return false;
    }
}

function _createVoicePeerConnection() {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnection = pc;
    pc.onicecandidate = event => {
        if (event.candidate) _sendVoiceCallSignal('candidate', { candidate: event.candidate.toJSON() });
    };
    pc.ontrack = event => {
        const audio = document.getElementById('remote-call-audio');
        if (!audio) return;
        audio.srcObject = event.streams[0];
        audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
        if (pc !== peerConnection) return;
        if (pc.connectionState === 'connected') {
            clearTimeout(callNoAnswerTimer);
            const answer = document.getElementById('call-btn-answer');
            if (answer) answer.classList.add('hide');
            _setVoiceCallStatus('Connected');
            startCallTimer();
        } else if (pc.connectionState === 'failed') {
            _setVoiceCallStatus('Call connection failed');
        }
    };
    return pc;
}

async function _applyPendingCallCandidates() {
    if (!peerConnection?.remoteDescription) return;
    const pending = _pendingCallCandidates.splice(0);
    for (const candidate of pending) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (error) { console.warn('[Orbit Call] ICE candidate rejected:', error); }
    }
}

async function startVoiceCall() {
    if (!_canStartVoiceCall()) {
        showToast('In-app calling is enabled for the configured accounts only.', 'error');
        return;
    }
    if (!currentRoom || !activeChatPeerId || isGroupChat || isSelfChat) {
        showToast('Open a direct chat before starting a voice call.', 'info');
        return;
    }
    if (peerConnection || _activeCallId) return;
    if (!activeRealtimeChannel) {
        showToast('Chat connection is still starting. Try calling again in a moment.', 'error');
        return;
    }

    _activeCallId = (window.crypto?.randomUUID ? window.crypto.randomUUID() : `call_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    _activeCallPeerId = activeChatPeerId;
    _activeCallRoom = currentRoom;
    _activeCallRole = 'caller';
    _pendingCallCandidates = [];
    _showVoiceCallModal();
    _setVoiceCallStatus('Requesting microphone…');

    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const pc = _createVoicePeerConnection();
        localAudioStream.getTracks().forEach(track => pc.addTrack(track, localAudioStream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sent = await _sendVoiceCallSignal('offer', { description: pc.localDescription.toJSON() });
        if (!sent) throw new Error('The other device is not connected to this chat yet.');
        _setVoiceCallStatus('Calling…');
        callNoAnswerTimer = setTimeout(() => {
            if (_activeCallRole === 'caller' && peerConnection?.connectionState !== 'connected') {
                showToast('No answer. You can try calling again.', 'info');
                endVoiceCall(true);
            }
        }, 45000);
    } catch (error) {
        console.warn('[Orbit Call] Could not start voice call:', error);
        showToast(error?.message || 'Could not start the voice call.', 'error');
        endVoiceCall(false);
    }
}
window.startVoiceCall = startVoiceCall;

async function answerVoiceCall() {
    if (_activeCallRole !== 'callee' || !_pendingCallOffer || !_activeCallId) return;
    const answer = document.getElementById('call-btn-answer');
    if (answer) answer.classList.add('hide');
    _setVoiceCallStatus('Requesting microphone…');
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const pc = _createVoicePeerConnection();
        localAudioStream.getTracks().forEach(track => pc.addTrack(track, localAudioStream));
        await pc.setRemoteDescription(new RTCSessionDescription(_pendingCallOffer));
        await _applyPendingCallCandidates();
        const description = await pc.createAnswer();
        await pc.setLocalDescription(description);
        const sent = await _sendVoiceCallSignal('answer', { description: pc.localDescription.toJSON() });
        if (!sent) throw new Error('Could not send the call answer.');
        _pendingCallOffer = null;
        _setVoiceCallStatus('Connecting…');
    } catch (error) {
        console.warn('[Orbit Call] Could not answer voice call:', error);
        showToast(error?.message || 'Could not answer the voice call.', 'error');
        endVoiceCall(true);
    }
}
window.answerVoiceCall = answerVoiceCall;

async function handleWebRTCSignal(payload) {
    if (!payload || payload.to !== currentUser?.id || payload.room !== currentRoom || payload.from !== activeChatPeerId) return;
    try {
        if (payload.type === 'offer') {
            if (peerConnection || _activeCallId) return;
            _activeCallId = payload.callId;
            _activeCallPeerId = payload.from;
            _activeCallRoom = payload.room;
            _activeCallRole = 'callee';
            _pendingCallOffer = payload.description;
            _pendingCallCandidates = [];
            _showVoiceCallModal({ incoming: true });
            _setVoiceCallStatus('Incoming voice call');
            return;
        }
        if (!_activeCallId || payload.callId !== _activeCallId || payload.from !== _activeCallPeerId) return;
        if (payload.type === 'answer' && _activeCallRole === 'caller' && peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.description));
            await _applyPendingCallCandidates();
            _setVoiceCallStatus('Connecting…');
        } else if (payload.type === 'candidate' && payload.candidate) {
            if (peerConnection?.remoteDescription) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } else {
                _pendingCallCandidates.push(payload.candidate);
            }
        } else if (payload.type === 'end') {
            endVoiceCall(false);
        }
    } catch (error) {
        console.warn('[Orbit Call] Could not process call signal:', error);
    }
}

function startCallTimer() {
    if (callDurationTimer) return;
    callStartTime = Date.now();
    const timer = document.getElementById('call-timer-label');
    callDurationTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        if (timer) timer.innerText = `${m}:${s}`;
    }, 1000);
}

function toggleCallMute() {
    if (!localAudioStream) return;
    const track = localAudioStream.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        const button = document.getElementById('call-btn-mute');
        if (button) {
            button.classList.toggle('active', !track.enabled);
            const icon = button.querySelector('i');
            if (icon) icon.className = track.enabled ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
        }
    }
}

function endVoiceCall(notifyPeer = true) {
    if (notifyPeer && _activeCallId) _sendVoiceCallSignal('end');
    clearInterval(callDurationTimer);
    clearTimeout(callNoAnswerTimer);
    callDurationTimer = null;
    callNoAnswerTimer = null;
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.close();
        peerConnection = null;
    }
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }
    const audio = document.getElementById('remote-call-audio');
    if (audio) { audio.pause(); audio.srcObject = null; }
    document.getElementById('modal-voice-call')?.classList.remove('active');
    document.getElementById('call-btn-answer')?.classList.add('hide');
    _activeCallId = null;
    _activeCallPeerId = null;
    _activeCallRoom = null;
    _activeCallRole = null;
    _pendingCallOffer = null;
    _pendingCallCandidates = [];
}
window.endVoiceCall = endVoiceCall;

// NOTIFICATIONS & DYNAMIC ISLAND
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let orbitNotificationAudioContext = null;
function notificationPreference(key, fallback = true) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value === 'true';
    } catch(e) { return fallback; }
}

function updateNotificationSettingsUI() {
    const status = document.getElementById('notification-device-status');
    const enableButton = document.getElementById('btn-enable-device-notifications');
    const device = document.getElementById('chk-notification-device');
    const previews = document.getElementById('chk-notification-previews');
    const sound = document.getElementById('chk-notification-sound');
    const supported = 'Notification' in window;
    const secure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname);

    if (device) device.checked = supported && Notification.permission === 'granted' && notificationPreference('orbit_device_notifications', true);
    if (previews) previews.checked = notificationPreference('orbit_notification_previews', true);
    if (sound) sound.checked = notificationPreference('orbit_notification_sound', true);
    if (!status || !enableButton) return;

    if (!supported) {
        status.textContent = 'This browser does not support system notifications.';
        enableButton.disabled = true;
        return;
    }
    if (!secure) {
        status.textContent = 'System notifications require HTTPS (or localhost). Open the secure Orbit site to enable them.';
        enableButton.disabled = true;
        return;
    }
    enableButton.disabled = false;
    if (Notification.permission === 'granted' && notificationPreference('orbit_device_notifications', true)) {
        status.textContent = typeof orbitPushStatus !== 'undefined' && orbitPushStatus ? orbitPushStatus : 'System alerts are enabled while Orbit is running. Enable background alerts to receive messages after closing the app.';
        enableButton.innerHTML = '<i class="fa-solid fa-bell"></i> ' + (typeof orbitPushStatus !== 'undefined' && orbitPushStatus.startsWith('Background notifications connected.') ? 'Background alerts enabled' : 'Enable alerts when Orbit is closed');
    } else if (Notification.permission === 'denied') {
        status.textContent = 'Notifications are blocked for this site. Allow them in your browser or device settings, then reload Orbit.';
        enableButton.innerHTML = '<i class="fa-solid fa-gear"></i> Notifications blocked — see browser settings';
    } else {
        status.textContent = 'Allow Orbit to show operating-system notifications when a new message arrives.';
        enableButton.innerHTML = '<i class="fa-solid fa-bell"></i> Allow system notifications';
    }
}

async function setNotificationDevicePreference(enabled) {
    if (!enabled) {
        if (typeof disableOrbitBackgroundPush === 'function' && !await disableOrbitBackgroundPush()) { showToast('Could not turn off background alerts. Reconnect and try again.', 'error'); return; }
        try { localStorage.setItem('orbit_device_notifications', 'false'); } catch(e) {}
        updateNotificationSettingsUI();
        showToast('System alerts turned off for Orbit.');
        return;
    }
    const granted = await requestNotificationPermission();
    if (granted && typeof enableOrbitBackgroundPush === 'function') await enableOrbitBackgroundPush(true);
    if (!granted) {
        try { localStorage.setItem('orbit_device_notifications', 'false'); } catch(e) {}
    }
    updateNotificationSettingsUI();
}

function setNotificationPreviewPreference(enabled) {
    try { localStorage.setItem('orbit_notification_previews', enabled ? 'true' : 'false'); } catch(e) {}
    if (typeof enableOrbitBackgroundPush === 'function') enableOrbitBackgroundPush();
    showToast(enabled ? 'Message previews are shown in alerts.' : 'Message previews are hidden in alerts.');
}

function setNotificationSoundPreference(enabled) {
    try { localStorage.setItem('orbit_notification_sound', enabled ? 'true' : 'false'); } catch(e) {}
    showToast(enabled ? 'In-app alert sound enabled.' : 'In-app alert sound muted.');
}

function playNotificationChime() {
    if (!notificationPreference('orbit_notification_sound', true) || document.hidden) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        orbitNotificationAudioContext ||= new AudioContextClass();
        const audioCtx = orbitNotificationAudioContext;
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(760, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1080, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.11, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.21);
    } catch(e) {}
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        showToast('This browser does not support device notifications.', 'error');
        return false;
    }
    if (Notification.permission === 'granted') {
        if (typeof enableOrbitBackgroundPush === 'function') await enableOrbitBackgroundPush(true);
        try { localStorage.setItem('orbit_device_notifications', 'true'); } catch(e) {}
        updateNotificationSettingsUI();
        showToast('Device notifications are enabled.', 'success');
        return true;
    }
    if (Notification.permission === 'denied') {
        showToast('Notifications are blocked in browser settings. Allow them for this site, then try again.', 'error');
        return false;
    }
    try {
        const permission = await Notification.requestPermission();
        const granted = permission === 'granted';
        if (granted && typeof enableOrbitBackgroundPush === 'function') await enableOrbitBackgroundPush(true);
        try { localStorage.setItem('orbit_device_notifications', granted ? 'true' : 'false'); } catch(e) {}
        if (granted && typeof initServiceWorker === 'function') await initServiceWorker();
        updateNotificationSettingsUI();
        showToast(granted ? 'Device notifications enabled.' : 'Notification permission was not granted.', granted ? 'success' : 'info');
        return granted;
    } catch(e) {
        showToast('Could not request notification permission.', 'error');
        return false;
    }
}

async function showNativeOrbitNotification(title, body, roomId, msgId) {
    if (!('Notification' in window) || Notification.permission !== 'granted' ||
        !notificationPreference('orbit_device_notifications', true)) return false;
    const showPreview = notificationPreference('orbit_notification_previews', true);
    const options = {
        body: showPreview ? body : 'You have a new message.',
        icon: new URL('./orbit-icon.svg', location.href).href,
        badge: new URL('./orbit-icon.svg', location.href).href,
        tag: msgId ? `orbit-message-${msgId}` : `orbit-room-${roomId || 'chat'}`,
        renotify: false,
        timestamp: Date.now(),
        actions: [
            { action: 'open', title: 'Open chat' },
            { action: 'dismiss', title: 'Dismiss' }
        ],
        data: { url: location.href.split('?')[0], roomId: roomId || null, msgId: msgId || null, timestamp: Date.now() }
    };
    const safeTitle = showPreview ? title : 'Orbit Messenger';
    try {
        if ('serviceWorker' in navigator) {
            const registration = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise(resolve => setTimeout(() => resolve(null), 1800))
            ]);
            if (registration?.showNotification) {
                await registration.showNotification(safeTitle, options);
                return true;
            }
        }
        const fallbackOptions = { ...options };
        delete fallbackOptions.actions;
        new Notification(safeTitle, fallbackOptions);
        return true;
    } catch(e) {
        console.warn('[Orbit] Native notification failed:', e);
        return false;
    }
}

async function testNotificationLive() {
    if (!('Notification' in window)) {
        showToast('This browser does not support device notifications.', 'error');
        return;
    }
    if (Notification.permission !== 'granted') {
        const granted = await requestNotificationPermission();
        if (!granted) return;
    }
    try { localStorage.setItem('orbit_device_notifications', 'true'); } catch(e) {}
    updateNotificationSettingsUI();
    const shown = await showNativeOrbitNotification('Orbit Messenger', 'System notifications are ready on this device.', currentRoom, `test-${Date.now()}`);
    showToast(shown ? 'System test alert sent.' : 'Could not display a system alert.', shown ? 'success' : 'error');
}

function updateTabUnreadBadges() {
    const badge = document.getElementById('tab-badge-chats');
    if (badge) {
        const count = unreadRoomsSet.size;
        if (count > 0) {
            badge.innerText = count;
            badge.classList.remove('hide');
        } else {
            badge.classList.add('hide');
        }
    }
}

let dynamicIslandTarget = null;
function showDynamicIslandNotification(msg) {
    const island = document.getElementById('dynamic-island-banner');
    const sender = document.getElementById('island-sender-name');
    const preview = document.getElementById('island-msg-preview');
    const av = document.getElementById('island-avatar');

    if (!island) return;
    dynamicIslandTarget = {
        room: msg.room,
        title: msg.username || 'Chat',
        avatarUrl: null
    };

    if (sender) sender.innerText = msg.username || 'New Message';
    if (preview) preview.innerText = msg.text || (msg.attachments?.length ? 'ðŸ“· Photo' : 'Message');
    if (av) av.innerText = (msg.username || 'U')[0].toUpperCase();

    island.classList.add('active');
    setTimeout(() => island.classList.remove('active'), 4500);
}

function onDynamicIslandClick() {
    const island = document.getElementById('dynamic-island-banner');
    if (island) island.classList.remove('active');
    if (dynamicIslandTarget && typeof openChatRoom === 'function') {
        openChatRoom(dynamicIslandTarget.room, dynamicIslandTarget.title, dynamicIslandTarget.avatarUrl, false);
    }
}

const notifiedMessageKeys = new Set();
function triggerMessageNotification(msg) {
    if (!msg || msg.sender_id === currentUser?.id) return;
    const notificationKey = `${msg.room || ''}:${msg.id || msg.created_at || ''}`;
    if (notifiedMessageKeys.has(notificationKey)) return;
    notifiedMessageKeys.add(notificationKey);
    if (notifiedMessageKeys.size > 300) notifiedMessageKeys.delete(notifiedMessageKeys.values().next().value);
    const isVisibleChat = typeof isOrbitChatVisible === 'function' ? isOrbitChatVisible(msg.room) : currentRoom === msg.room && !document.hidden;
    if (isVisibleChat) return;
    const muted = window.OrbitChatSelect?.getMutedRooms() || [];
    if (resolveRoomAliases(msg.room).some(room => muted.includes(room))) return;
    if (!document.hidden) playNotificationChime();
    showDynamicIslandNotification(msg);
    unreadRoomsSet.add(msg.room);
    updateTabUnreadBadges();
    {
        const sender = msg.username || 'New message';
        const body = msg.text || (msg.attachments?.length ? 'Sent an attachment' : 'You have a new message');
        showNativeOrbitNotification(sender, body, msg.room, msg.id);
    }
}

function handleNotificationBannerClick() {
    onDynamicIslandClick();
}

function openNotifHistoryModal() {
    const modal = document.getElementById('modal-notif-history');
    if (modal) modal.classList.add('active');
}

function closeNotifHistoryModal() {
    const modal = document.getElementById('modal-notif-history');
    if (modal) modal.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', updateNotificationSettingsUI);
