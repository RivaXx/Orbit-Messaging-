// ORBIT CHAT - MESSAGE FEED & INTERACTIVE UI MODULE (js/chat/chat-feed.js)
// Message DOM node creation, formatted bubbles, WhatsApp-style collage grids, attachments,
// reaction pickers, swipe-to-reply gestures, context menus, and pinned banner.

let chatFeedRenderGeneration = 0;
function renderMessageFeed(msgs, shouldScrollBottom = true) {
    const generation = ++chatFeedRenderGeneration;
    const renderRoom = currentRoom;
    const renderEpoch = _chatViewEpoch;
    const isCurrentRender = () => generation === chatFeedRenderGeneration && renderRoom === currentRoom && renderEpoch === _chatViewEpoch;
    const feed = document.getElementById('chat-feed');
    if (!feed) return;

    // Suppress onscroll triggers during entire render pass to prevent spurious older history fetches
    isRenderingFeed = true;
    const priorScrollBehavior = feed.style.scrollBehavior;
    feed.style.scrollBehavior = 'auto';

    const hadMessages = feed.querySelectorAll('.msg-bubble-row').length > 0;
    const prevScrollBottomDist = feed.scrollHeight - feed.scrollTop;
    // A background refresh should keep the newest messages visible when the
    // reader was already near the bottom; otherwise preserve their read spot.
    const wasNearBottom = hadMessages && (prevScrollBottomDist - feed.clientHeight) <= 220;
    // Preserve the actual message the user is reading during background
    // refreshes. Distance-from-bottom changes whenever new messages arrive and
    // used to make the viewport jump unexpectedly.
    let scrollAnchorId = null;
    let scrollAnchorTop = 0;
    if (!shouldScrollBottom && hadMessages) {
        const feedTop = feed.getBoundingClientRect().top;
        const visibleAnchor = Array.from(feed.querySelectorAll('.msg-bubble-row')).find(node =>
            node.getBoundingClientRect().bottom > feedTop + 1
        );
        if (visibleAnchor) {
            scrollAnchorId = visibleAnchor.dataset.msgId || visibleAnchor.id.replace(/^msg-/, '');
            scrollAnchorTop = visibleAnchor.getBoundingClientRect().top - feedTop;
        }
    }

    if (!hadMessages && shouldScrollBottom) {
        feed.style.opacity = '0';
    }
    feed.innerHTML = '';
    
    if (!msgs || msgs.length === 0) {
        feed.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">Say hello! 👋</div>';
        if (shouldScrollBottom) feed.style.opacity = '1';
        feed.style.scrollBehavior = priorScrollBehavior;
        isRenderingFeed = false;
        return;
    }

    // Attach user gesture listeners to feed once to distinguish user scrolling from programmatic DOM changes
    if (!feed._hasInteractionListeners) {
        feed._hasInteractionListeners = true;
        feed.addEventListener('wheel', notifyFeedUserInteraction, { passive: true });
        feed.addEventListener('touchstart', notifyFeedUserInteraction, { passive: true });
        feed.addEventListener('touchmove', notifyFeedUserInteraction, { passive: true });
        feed.addEventListener('pointerdown', notifyFeedUserInteraction, { passive: true });
    }

    // Attach infinite scroll listener for continuous older history + floating jump-to-bottom button
    feed.onscroll = () => {
        if (!isRenderingFeed && feed.scrollTop <= 50 && !isLoadingOlderMessages && hasMoreOlderMessages && currentRoom && feed.scrollHeight > feed.clientHeight) {
            loadOlderHistory(currentRoom);
        }
        const distFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
        const jumpBtn = document.getElementById('btn-scroll-bottom');
        if (jumpBtn) {
            if (distFromBottom > 220) {
                jumpBtn.classList.remove('hide');
            } else {
                jumpBtn.classList.add('hide');
                const badge = document.getElementById('scroll-bottom-unread-badge');
                if (badge) { badge.classList.add('hide'); badge.innerText = '0'; }
            }
        }
    };

    // Deduplicate and sort using centralized utility
    const cleanList = deduplicateAndSort(msgs);
    const frag = document.createDocumentFragment();

    let lastDateStr = null;
    cleanList.forEach((msg, idx) => {
        try {
            const dateHeader = formatDateSeparator(msg.created_at);
            if (dateHeader !== lastDateStr) {
                const dateBadge = document.createElement('div');
                dateBadge.className = 'chat-date-separator';
                dateBadge.innerHTML = `<span class="chat-date-separator-pill">${dateHeader}</span>`;
                frag.appendChild(dateBadge);
                lastDateStr = dateHeader;
            }
            const prevMsg = idx > 0 ? cleanList[idx - 1] : null;
            const isConsecutive = prevMsg && (prevMsg.sender_id === msg.sender_id) &&
                Math.abs(new Date(msg.created_at || Date.now()) - new Date(prevMsg.created_at || Date.now())) < 120000;
            frag.appendChild(createMessageDOMNode(msg, isConsecutive));
        } catch(renderErr) {
            console.warn('[Orbit] Skipping rendering broken message item:', msg.id, renderErr);
        }
    });

    feed.appendChild(frag);

    if (shouldScrollBottom) {
        // Instantly anchor to bottom without jumping
        feed.scrollTop = feed.scrollHeight;
        requestAnimationFrame(() => {
            if (!isCurrentRender()) return;
            feed.scrollTop = feed.scrollHeight;
            if (!hadMessages) {
                feed.style.transition = 'opacity 0.15s ease';
                feed.style.opacity = '1';
            }
            feed.style.scrollBehavior = priorScrollBehavior;
            setTimeout(() => { if (isCurrentRender()) isRenderingFeed = false; }, 60);
        });
    } else {
        if (wasNearBottom) {
            feed.scrollTop = feed.scrollHeight;
            requestAnimationFrame(() => {
            if (!isCurrentRender()) return;
                feed.scrollTop = feed.scrollHeight;
                feed.style.scrollBehavior = priorScrollBehavior;
                setTimeout(() => { if (isCurrentRender()) isRenderingFeed = false; }, 60);
            });
            return;
        }
        // Restore the same visible message and its pixel offset first. Fall back
        // to bottom distance only if the anchor was removed from the new data.
        const anchor = scrollAnchorId ? document.getElementById(`msg-${scrollAnchorId}`) : null;
        if (anchor) {
            feed.scrollTop += anchor.getBoundingClientRect().top - feed.getBoundingClientRect().top - scrollAnchorTop;
        } else {
            feed.scrollTop = Math.max(0, feed.scrollHeight - prevScrollBottomDist);
        }
        requestAnimationFrame(() => {
            if (!isCurrentRender()) return;
            const liveAnchor = scrollAnchorId ? document.getElementById(`msg-${scrollAnchorId}`) : null;
            if (liveAnchor) {
                feed.scrollTop += liveAnchor.getBoundingClientRect().top - feed.getBoundingClientRect().top - scrollAnchorTop;
            } else {
                feed.scrollTop = Math.max(0, feed.scrollHeight - prevScrollBottomDist);
            }
            feed.style.scrollBehavior = priorScrollBehavior;
            setTimeout(() => { if (isCurrentRender()) isRenderingFeed = false; }, 60);
        });
    }
}

function appendSingleMessageNode(msg) {
    if (!currentRoom || !resolveRoomAliases(currentRoom, activeChatPeerId).includes(msg?.room)) return;
    const feed = document.getElementById('chat-feed');
    if (!feed) return;
    try {
        const lastMsgNode = feed.querySelector('.msg-bubble-row:last-of-type');
        let prevCreated = lastMsgNode?.dataset?.createdAt;
        // Delayed realtime inserts belong at their chronological position.
        if (prevCreated && Date.parse(msg.created_at) < Date.parse(prevCreated)) {
            renderMessageFeed(messageCache.get(currentRoom) || [], false);
            return;
        }
        const curDateHeader = formatDateSeparator(msg.created_at);
        const prevDateHeader = prevCreated ? formatDateSeparator(prevCreated) : null;
        if (curDateHeader !== prevDateHeader) {
            const dateBadge = document.createElement('div');
            dateBadge.className = 'chat-date-separator';
            dateBadge.innerHTML = `<span class="chat-date-separator-pill">${curDateHeader}</span>`;
            feed.appendChild(dateBadge);
        }
        const prevSenderId = lastMsgNode?.dataset?.senderId;
        const isConsecutive = (prevSenderId === msg.sender_id) && 
            (prevCreated && Math.abs(new Date(msg.created_at || Date.now()) - new Date(prevCreated)) < 120000);
        feed.appendChild(createMessageDOMNode(msg, isConsecutive));
    } catch(e) {
        console.warn('[Orbit] appendSingleMessageNode error:', e);
    }
}

function isDirectRecipientOnline() {
    const title = document.getElementById('chat-target-name')?.innerText;
    const otherUser = Array.from(globalUsersMap.values()).find(u => u.display_name === title);
    return !!otherUser?.is_online;
}

function getTickIconHtml(msg) {
    if (!msg || msg.type === 'call') return '';
    if (msg.status === 'failed' || msg.status === 'error') {
        const tempId = msg.client_temp_id || msg.id;
        return `<span class="msg-status-tick retry-error" onclick="event.stopPropagation(); retrySendMessage('${escapeHtml(String(tempId))}')" title="Failed to send. Tap to retry" style="color:#FF453A; cursor:pointer;"><i class="fa-solid fa-circle-exclamation"></i></span>`;
    }
    if (msg.status === 'sending' || msg.status === 'queued') {
        const title = msg.status === 'queued' ? 'Saved on this device; waiting for connection' : 'Sending...';
        const pctVal = typeof msg.upload_pct === 'number' && msg.upload_pct >= 0
            ? Math.round(msg.upload_pct)
            : (typeof msg.upload_progress === 'number' ? Math.round(msg.upload_progress) : null);
        const pctHtml = pctVal !== null ? `<span class="msg-sending-pct">${pctVal}%</span>` : '';
        return `<span class="msg-status-tick sending sending-tick" title="${title}"><i class="fa-regular fa-clock orbit-spin-clock"></i>${pctHtml}</span>`;
    }
    const isRead = Array.isArray(msg.read_by) 
        ? msg.read_by.length > 0 
        : (msg.read_by && Object.keys(msg.read_by).length > 0) || msg.is_read || msg.status === 'read';
    if (isRead) {
        return `<span class="msg-status-tick tick-read" title="Read"><i class="fa-solid fa-check-double"></i></span>`;
    }
    if (msg.status === 'delivered') {
        return `<span class="msg-status-tick tick-delivered" title="Delivered"><i class="fa-solid fa-check-double"></i></span>`;
    }
    return `<span class="msg-status-tick tick-sent" title="Sent"><i class="fa-solid fa-check"></i></span>`;
}

function updateBubbleSendingProgress(msgId, percent) {
    if (!msgId) return;
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    const node = document.getElementById(`msg-${msgId}`) ||
        document.querySelector(`[data-client-temp-id="${msgId}"]`) ||
        document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!node) return;

    // 1. In-bubble Media Progress Ring (WhatsApp/Telegram pro standard)
    const overlay = node.querySelector('.media-upload-overlay');
    if (overlay) {
        const bar = overlay.querySelector('.media-upload-bar');
        const label = overlay.querySelector('.media-upload-pct-label');
        if (bar) {
            const circumference = 125.66; // 2 * Math.PI * 20
            const offset = circumference * (1 - p / 100);
            bar.style.strokeDashoffset = offset;
        }
        if (label) {
            label.textContent = `${p}%`;
        }
        if (p >= 100) {
            overlay.classList.add('upload-complete');
            setTimeout(() => { try { overlay.remove(); } catch(e){} }, 350);
        }
    }

    // 2. Metadata row percentage badge & clock
    const meta = node.querySelector('.msg-meta-row');
    if (meta) {
        const tick = meta.querySelector('.msg-status-tick.sending, .msg-status-tick.sending-tick');
        if (tick) {
            let pctSpan = tick.querySelector('.msg-sending-pct');
            if (!pctSpan && p < 100) {
                pctSpan = document.createElement('span');
                pctSpan.className = 'msg-sending-pct';
                tick.appendChild(pctSpan);
            }
            if (pctSpan) {
                pctSpan.textContent = p >= 100 ? '' : `${p}%`;
            }
        }
    }
}
window.updateBubbleSendingProgress = updateBubbleSendingProgress;

// ── Star / Favorite Message Persistence ──
function getStarredMessageIds() {
    try {
        const uid = currentUser?.id || 'guest';
        const key = `orbit_starred_msgs_${uid}`;
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    } catch(e) {
        return [];
    }
}

function isMessageStarred(msgId) {
    if (!msgId) return false;
    const starred = getStarredMessageIds();
    return starred.includes(String(msgId));
}

function toggleStarMessage(msgId) {
    if (!msgId) return false;
    try {
        const uid = currentUser?.id || 'guest';
        const key = `orbit_starred_msgs_${uid}`;
        let starred = getStarredMessageIds();
        const strId = String(msgId);
        const idx = starred.indexOf(strId);
        let nowStarred = false;
        if (idx !== -1) {
            starred.splice(idx, 1);
            nowStarred = false;
            showToast('Message unstarred', 'info');
        } else {
            starred.push(strId);
            nowStarred = true;
            showToast('Message starred ⭐', 'success');
        }
        localStorage.setItem(key, JSON.stringify(starred));

        // Update DOM node in active chat feed if rendered
        const node = document.getElementById(`msg-${msgId}`);
        if (node) {
            const card = node.querySelector('.msg-bubble-card');
            if (card) {
                let badge = card.querySelector('.msg-star-badge');
                if (nowStarred) {
                    if (!badge) {
                        badge = document.createElement('i');
                        badge.className = 'fa-solid fa-star msg-star-badge';
                        badge.title = 'Starred message';
                        const meta = card.querySelector('.msg-meta-row');
                        if (meta) meta.insertBefore(badge, meta.firstChild);
                        else card.appendChild(badge);
                    }
                } else {
                    if (badge) badge.remove();
                }
            }
        }
        return nowStarred;
    } catch(e) {
        console.error('[Orbit] toggleStarMessage error:', e);
        return false;
    }
}
window.getStarredMessageIds = getStarredMessageIds;
window.isMessageStarred = isMessageStarred;
window.toggleStarMessage = toggleStarMessage;

function createMessageDOMNode(msg, isConsecutive = false) {
    try {
        const isOwn = (!msg.sender_id && !msg.from_user) || (currentUser && msg.sender_id === currentUser.id);
        const row = document.createElement('div');
        row.className = `msg-bubble-row ${isOwn ? 'own' : 'other'} ${isConsecutive ? 'grouped-consecutive' : ''}`;
        row.id = `msg-${msg.id}`;
        row.dataset.msgId = msg.id;
        row.dataset.createdAt = msg.created_at || new Date().toISOString();
        row.dataset.senderId = msg.sender_id || '';
        // Persist client_temp_id for realtime dedup — lets handleRealtimeInsert find this
        // optimistic node before sendMessage's async IIFE renames its id
        if (msg.client_temp_id) row.dataset.clientTempId = msg.client_temp_id;

        // Attach right-click / context menu with coordinates
        row.oncontextmenu = (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (typeof openMsgContextMenu === 'function') {
                openMsgContextMenu(e, msg, row);
            } else if (typeof showQuickReactionPicker === 'function') {
                showQuickReactionPicker(row, msg, e ? { x: e.clientX, y: e.clientY } : null);
            }
        };

        // Double-tap to quick-react ❤️
        let lastTapTime = 0;
        row.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTapTime < 300 && now - lastTapTime > 0) {
                e.preventDefault();
                if (typeof toggleMessageReaction === 'function') {
                    toggleMessageReaction(msg.id, '❤️');
                }
            }
            lastTapTime = now;
        });
        row.addEventListener('dblclick', () => {
            if (typeof toggleMessageReaction === 'function') {
                toggleMessageReaction(msg.id, '❤️');
            }
        });

        const d = new Date(msg.created_at || Date.now());
        const timeFormatted = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let replyHtml = '';
        let replyObj = msg.reply_to;
        if (typeof replyObj === 'string') {
            try { replyObj = JSON.parse(replyObj); } catch(e) { replyObj = null; }
        }
        if (!replyObj && Array.isArray(msg.attachments)) {
            const replyAtt = msg.attachments.find(a => a && (a.type === 'reply_to' || a.reply_to));
            if (replyAtt) {
                replyObj = replyAtt.reply_to || replyAtt;
            }
        }
        if (replyObj) {
            let snippet = replyObj.text || '';
            if (replyObj.type === 'voice' || replyObj.type === 'audio') snippet = '🎤 Voice Note';
            else if (replyObj.type === 'location') snippet = '📍 Location';
            else if (replyObj.type === 'poll') snippet = '📊 Poll';
            else if (replyObj.type === 'image' || (!snippet && String(replyObj.text).includes('http'))) snippet = '📷 Photo';
            else if (replyObj.type === 'video') snippet = '🎥 Video';
            else if (replyObj.type === 'file' || replyObj.type === 'document') snippet = '📄 Document';
            
            const targetId = replyObj.id ? escapeHtml(String(replyObj.id)) : '';
            replyHtml = `
                <div class="quoted-reply-box" onclick="scrollToMessage('${targetId}')" title="Click to view original message">
                    <div class="quoted-reply-sender">
                        <i class="fa-solid fa-reply" style="font-size:9px;"></i> ${escapeHtml(replyObj.username || 'User')}
                    </div>
                    <div class="quoted-reply-snippet">${escapeHtml(snippet)}</div>
                </div>
            `;
        }

        // Separate Images from Non-Images for WhatsApp Photo Grid
        const images = [];
        const files = [];

        let attList = msg.attachments;
        if (!attList) attList = [];
        if (typeof attList === 'string') {
            try { attList = JSON.parse(attList); } catch(e) { attList = [attList]; }
        }
        if (!Array.isArray(attList)) attList = [attList];

        if (attList.length > 0) {
            attList.forEach(rawAtt => {
                if (!rawAtt) return;
                let att = rawAtt;
                if (typeof att === 'string') {
                    try {
                        const parsed = JSON.parse(att);
                        if (parsed && typeof parsed === 'object') att = parsed;
                    } catch(e) {}
                }
                const rawUrl = att.url || att.publicUrl || att.storage_path || att.path || (typeof att === 'string' ? att : '');
                const cleanUrl = att.view_once && att.storage_bucket==='orbit-view-once' ? rawUrl : formatMediaUrl(rawUrl);
                if (!cleanUrl) return;

                const cleanUrlNoQuery = cleanUrl.split('?')[0].split('#')[0];
                const isImage = (!att.type && msg.type === 'image') ||
                    Boolean(cleanUrlNoQuery.match(/\.(jpg|jpeg|png|gif|webp|bmp|heic|svg)$/i)) ||
                    cleanUrl.startsWith('data:image') ||
                    Boolean(att && (att.type === 'image' || att.mimeType?.startsWith('image/')));

                const isVideo = (!att.type && msg.type === 'video') ||
                    Boolean(cleanUrlNoQuery.match(/\.(mp4|webm|mov|m4v|mkv)$/i)) ||
                    Boolean(att && att.type === 'video');

                const isAudio = (!att.type && (msg.type === 'audio' || msg.type === 'voice')) ||
                    Boolean(cleanUrlNoQuery.match(/\.(mp3|wav|ogg|opus|m4a|aac|webm)$/i)) ||
                    Boolean(att && (att.type === 'audio' || att.type === 'voice'));

                let fileName = att.name;
                if (!fileName || typeof fileName !== 'string' || fileName === 'File' || fileName === 'Document.pdf') {
                    if (msg.text && (msg.type === 'document' || msg.type === 'file') && msg.text.includes('.')) {
                        fileName = msg.text.replace(/^📄\s*/, '').trim();
                    } else if (typeof rawAtt === 'string' && !rawAtt.startsWith('data:')) {
                        const pathName = rawAtt.split('?')[0].split('/').pop();
                        fileName = pathName || 'File';
                    } else {
                        fileName = isImage ? 'Photo.jpg' : (isAudio ? 'Voice Note.webm' : (isVideo ? 'Video.mp4' : 'Document.pdf'));
                    }
                }

                if (typeof rawAtt === 'string' && rawAtt.includes('"poll"')) return;
                if (att && (att.poll || att.type === 'poll')) return;
                if (msg.type === 'poll') return;

                if (isImage) {
                    images.push({ url: cleanUrl, name: fileName, view_once: att.view_once===true || att.view_once==='true', storage_bucket:att.storage_bucket });
                } else {
                    files.push({ url: cleanUrl, name: fileName, isVideo, isAudio, type: att.type || msg.type, size: att.size });
                }
            });
        }

        // Direct fallback: if attachments list is empty but text contains media URL/data
        if (attList.length === 0 && msg.text) {
            const trimmedText = msg.text.trim();
            const cleanUrlNoQuery = trimmedText.split('?')[0].split('#')[0];
            const isDirectImageUrl = (msg.type === 'image') ||
                Boolean(cleanUrlNoQuery.match(/\.(jpg|jpeg|png|gif|webp|bmp|heic|svg)$/i)) ||
                trimmedText.startsWith('data:image');
            const isDirectVideoUrl = (msg.type === 'video') ||
                Boolean(cleanUrlNoQuery.match(/\.(mp4|webm|mov|m4v|mkv)$/i)) ||
                trimmedText.startsWith('data:video');
            const isDirectAudioUrl = (msg.type === 'audio' || msg.type === 'voice') ||
                Boolean(cleanUrlNoQuery.match(/\.(mp3|wav|ogg|opus|m4a|aac|webm)$/i)) ||
                trimmedText.startsWith('data:audio');

            if (isDirectImageUrl) {
                images.push({ url: trimmedText, name: 'Photo.jpg' });
            } else if (isDirectVideoUrl) {
                files.push({ url: trimmedText, name: 'Video.mp4', isVideo: true, isAudio: false, type: 'video' });
            } else if (isDirectAudioUrl) {
                files.push({ url: trimmedText, name: 'Voice Note.webm', isVideo: false, isAudio: true, type: 'audio' });
            }
        }

        // WhatsApp/Telegram In-Bubble Pro Media Upload Overlay
        const isMediaUploading = (images.length > 0 || files.length > 0) &&
            ['sending', 'queued'].includes(msg.status) &&
            Array.isArray(attList) && attList.some(a => a && (a.upload_pending || String(a.url || '').startsWith('blob:')));
        const initialPct = typeof msg.upload_pct === 'number' ? Math.round(msg.upload_pct) : 0;
        const ringCircumference = 125.66;
        const ringOffset = ringCircumference * (1 - initialPct / 100);
        const mediaUploadOverlayHtml = isMediaUploading ? `
            <div class="media-upload-overlay" id="upload-overlay-${msg.id || msg.client_temp_id}">
                <div class="media-shimmer-sweep"></div><span class="media-upload-pct-label" role="status">${initialPct}%</span>
                <div class="media-upload-ring-wrap" onclick="event.stopPropagation(); if(typeof cancelMediaUpload==='function') cancelMediaUpload('${msg.id || msg.client_temp_id}');" title="Cancel upload">
                    <svg class="media-upload-svg" viewBox="0 0 48 48">
                        <circle class="media-upload-track" cx="24" cy="24" r="20"></circle>
                        <circle class="media-upload-bar" cx="24" cy="24" r="20" style="stroke-dashoffset: ${ringOffset};"></circle>
                    </svg>
                    <span class="media-upload-cancel-btn"><i class="fa-solid fa-xmark"></i></span>
                </div>
            </div>
        ` : '';

        // All messages use the same live status row; never embed a second clock/tick in media.
        const mediaFloatingMetaHtml = ''; 

        // WhatsApp-Style Multi-Image Bunch / Collage Grid (1, 2, 3, 4, 4+ with +N overlay)
        let mediaGridHtml = '';
        // Check for View Once Photo
        const hasViewOnce = orbitIsViewOnceMessage(msg);
        if (hasViewOnce) {
            const voImg = images[0] || (Array.isArray(attList) ? attList.find(a => a && a.view_once) : null);
            const isOpened = localStorage.getItem(orbitViewOnceKey(msg.id)) === 'opened' || msg.view_status === 'opened';
            mediaGridHtml = `
                <div class="view-once-bubble-card ${isOpened ? 'opened' : 'unopened'}" data-view-once-id="${msg.id}" onclick="${isOpened || isOwn ? '' : `openViewOnceMedia('${msg.id}')`}">
                    <div class="view-once-icon-ring ${isOpened ? 'opened' : ''}">
                        <span class="view-once-badge">1</span>
                    </div>
                    <div class="view-once-info">
                        <div class="view-once-title">${isOpened ? 'Opened' : 'Photo'}</div>
                        <div class="view-once-subtitle">${isOpened ? 'This photo cannot be reopened' : isOwn ? 'View once · Sent' : 'View once · Tap to open'}</div>
                    </div>
                </div>
            `;
        } else if (images.length === 1) {
            mediaGridHtml = `
                <div class="wa-image-bunch-grid bunch-1" style="position:relative; border-radius:16px; overflow:hidden; margin-top:4px; max-width:320px; cursor:pointer; background:rgba(0,0,0,0.25);" onclick="openBatchLightbox(['${images[0].url}'], 0)">
                    <img src="${images[0].url}" alt="Photo" onerror="retryMediaPreview(this)" style="width:100%; max-height:360px; object-fit:cover; display:block; border-radius:16px;" loading="lazy">
                    ${mediaUploadOverlayHtml}
                    ${mediaFloatingMetaHtml}
                </div>
            `;
        } else if (images.length > 1) {
            const batchKey = `bunch_${String(msg.id || msg.client_temp_id || Date.now()).replace(/[^a-zA-Z0-9_-]/g,'')}`;
            if (!window._orbitBatches) window._orbitBatches = {};
            window._orbitBatches[batchKey] = images.map(im => im.url);

            if (images.length === 2) {
                // 2 images side-by-side
                mediaGridHtml = `
                    <div class="wa-image-bunch-grid bunch-2" style="position:relative; display:grid; grid-template-columns:1fr 1fr; gap:3px; max-width:320px; width:100%; border-radius:16px; overflow:hidden; margin-top:4px; background:rgba(0,0,0,0.25);">
                        ${mediaUploadOverlayHtml}
                        ${images.map((img, i) => `
                            <div style="position:relative; aspect-ratio:1; cursor:pointer; overflow:hidden;" onclick="openBatchLightbox(window._orbitBatches['${batchKey}'], ${i})">
                                <img src="${img.url}" alt="Photo ${i + 1}" onerror="retryMediaPreview(this)" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (images.length === 3) {
                // 3 images: 1 tall on left (span 2 rows), 2 stacked on right
                mediaGridHtml = `
                    <div class="wa-image-bunch-grid bunch-3" style="position:relative; display:grid; grid-template-columns:1.2fr 1fr; grid-template-rows:1fr 1fr; gap:3px; max-width:320px; width:100%; border-radius:16px; overflow:hidden; margin-top:4px; aspect-ratio:4/3; background:rgba(0,0,0,0.25);">
                        ${mediaUploadOverlayHtml}
                        <div style="grid-row:span 2; position:relative; cursor:pointer; overflow:hidden;" onclick="openBatchLightbox(window._orbitBatches['${batchKey}'], 0)">
                            <img src="${images[0].url}" alt="Photo 1" onerror="retryMediaPreview(this)" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                        </div>
                        <div style="position:relative; cursor:pointer; overflow:hidden;" onclick="openBatchLightbox(window._orbitBatches['${batchKey}'], 1)">
                            <img src="${images[1].url}" alt="Photo 2" onerror="retryMediaPreview(this)" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                        </div>
                        <div style="position:relative; cursor:pointer; overflow:hidden;" onclick="openBatchLightbox(window._orbitBatches['${batchKey}'], 2)">
                            <img src="${images[2].url}" alt="Photo 3" onerror="retryMediaPreview(this)" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                        </div>
                    </div>
                `;
            } else {
                // 4 or more images: 2x2 grid. If > 4, 4th image has darkened overlay with +N
                const displayImages = images.slice(0, 4);
                const remaining = images.length - 4; // e.g. 28 total -> 3 shown + 1 with "+25"
                mediaGridHtml = `
                    <div class="wa-image-bunch-grid bunch-4" style="position:relative; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:3px; max-width:320px; width:100%; border-radius:16px; overflow:hidden; margin-top:4px; aspect-ratio:1; background:rgba(0,0,0,0.25);">
                        ${mediaUploadOverlayHtml}
                        ${displayImages.map((img, i) => {
                            const hasOverlay = (i === 3 && images.length > 4);
                            return `
                                <div style="position:relative; aspect-ratio:1; cursor:pointer; overflow:hidden;" onclick="openBatchLightbox(window._orbitBatches['${batchKey}'], ${i})">
                                    <img src="${img.url}" alt="Photo ${i + 1}" onerror="retryMediaPreview(this)" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                                    ${hasOverlay ? `
                                        <div style="position:absolute; inset:0; background:rgba(0,0,0,0.62); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; color:#ffffff; font-size:26px; font-weight:800; letter-spacing:0.5px; z-index:2; text-shadow:0 2px 8px rgba(0,0,0,0.7);">
                                            +${remaining}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        }

        // Non-Image Attachments (Videos, Voice Notes with Speed Controls, Docs, Files)
        let filesHtml = '';
        files.forEach(f => {
            if (f.isVideo) {
                filesHtml += `<video src="${f.url}" controls playsinline style="max-width:100%; border-radius:12px; margin-top:4px; display:block;"></video>`;
            } else if (f.isAudio) {
                const playerUid = `vp_${msg.id || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const barHeights = [25, 45, 70, 90, 50, 65, 80, 100, 60, 40, 75, 85, 95, 60, 45, 80, 65, 90, 50, 70, 40, 60, 80, 50];
                const barsHtml = barHeights.map((h, i) => `
                    <div class="ios-voice-bar" id="${playerUid}-bar-${i}" style="height:${Math.max(6, Math.round(h * 0.22))}px;"></div>
                `).join('');

                filesHtml += `
                    <div class="ios-voice-bubble" id="${playerUid}">
                        <audio src="${f.url}" preload="metadata" id="${playerUid}-audio" onended="onVoiceAudioEnded('${playerUid}')" ontimeupdate="onVoiceAudioTimeUpdate('${playerUid}')" onloadedmetadata="onVoiceAudioMetadata('${playerUid}')"></audio>
                        <button type="button" class="ios-voice-play-circle touch-fix" onclick="toggleVoiceAudioPlay('${playerUid}')" id="${playerUid}-play-btn" title="Play Voice Note">
                            <i class="fa-solid fa-play" id="${playerUid}-icon"></i>
                        </button>
                        <div class="ios-voice-waveform-area">
                            <div class="ios-voice-bars-wrap" id="${playerUid}-waveform" onclick="seekVoiceAudioByBar('${playerUid}', event)">
                                ${barsHtml}
                            </div>
                            <div class="ios-voice-meta-row">
                                <span id="${playerUid}-curr">0:00</span>
                                <div style="display:flex; align-items:center; gap:6px;">
                                    <span class="ios-voice-speed-pill touch-fix" onclick="cycleVoiceAudioSpeed('${playerUid}')" id="${playerUid}-speed" title="Change Playback Speed">1x</span>
                                    <span id="${playerUid}-dur">--:--</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                filesHtml += `
                    <div class="file-preview-card" style="display:flex; align-items:center; gap:10px; background:rgba(255,255,255,0.06); padding:10px 12px; border-radius:12px; margin-top:4px;">
                        <div class="file-icon-box" style="background:rgba(127,87,255,0.2); color:#7F57FF; width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:18px;">
                            <i class="fa-solid fa-file-lines"></i>
                        </div>
                        <div style="flex:1; overflow:hidden; cursor:pointer;" onclick="handleDocumentFilePreview('${f.url}', '${escapeHtml(f.name)}')">
                            <div style="font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(f.name)}</div>
                            <div class="file-detail">${escapeHtml([typeof formatFileSize === 'function' ? formatFileSize(f.size) : '', (f.name.split('.').pop() || 'File').toUpperCase()].filter(Boolean).join(' · '))}</div>
                        </div>
                        <button class="btn-reset touch-fix" style="color:var(--accent); font-size:16px; padding:6px;" onclick="downloadFile('${f.url}', '${escapeHtml(f.name)}')" title="Download with original filename">
                            <i class="fa-solid fa-download"></i>
                        </button>
                    </div>
                `;
            }
        });

        // ── GPS Location Card with Embedded Interactive Map ───────────
        let extraCardHtml = '';
        if (msg.type === 'location' || (msg.text && msg.text.startsWith('geo:'))) {
            let lat = 0, lng = 0;
            if (msg.text && msg.text.startsWith('geo:')) {
                const coords = msg.text.replace('geo:', '').split(',');
                lat = parseFloat(coords[0]) || 0;
                lng = parseFloat(coords[1]) || 0;
            } else if (msg.attachments) {
                try {
                    let att = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
                    if (Array.isArray(att)) att = att[0];
                    if (typeof att === 'string') att = JSON.parse(att);
                    if (att && att.lat && att.lng) {
                        lat = parseFloat(att.lat);
                        lng = parseFloat(att.lng);
                    }
                } catch(e) {}
            }

            if (lat !== 0 || lng !== 0) {
                const latCardinal = lat >= 0 ? `${lat.toFixed(4)}° N` : `${(-lat).toFixed(4)}° S`;
                const lngCardinal = lng >= 0 ? `${lng.toFixed(4)}° E` : `${(-lng).toFixed(4)}° W`;
                const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.008}%2C${lat-0.005}%2C${lng+0.008}%2C${lat+0.005}&layer=mapnik&marker=${lat}%2C${lng}`;
                extraCardHtml = `
                    <div class="location-card-bubble">
                        <div style="font-size:12px; font-weight:800; color:#00E676; display:flex; align-items:center; gap:6px;">
                            <i class="fa-solid fa-location-dot" style="font-size:14px;"></i> Live GPS Location
                        </div>
                        <div class="location-preview-map">
                            <iframe src="${osmEmbedUrl}" title="Live Location Map"></iframe>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; margin-top:4px; gap:8px;">
                            <span style="color:var(--text-secondary); font-family:'Plus Jakarta Sans', monospace; font-weight:700;">${latCardinal}, ${lngCardinal}</span>
                            <div style="display:flex; gap:6px;">
                                <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="glass-btn-primary" style="padding:4px 9px; font-size:10.5px; text-decoration:none;">Google Maps</a>
                                <a href="https://maps.apple.com/?ll=${lat},${lng}" target="_blank" rel="noopener" class="glass-btn-secondary" style="padding:4px 9px; font-size:10.5px; text-decoration:none;">Apple Maps</a>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // ── Interactive Live Poll Card ─────────────────────────────────
        if (msg.type === 'poll') {
            let poll = null;
            try {
                if (msg.metadata) {
                    poll = msg.metadata.poll || msg.metadata;
                }
                if (!poll || !poll.options) {
                    if (typeof msg.attachments === 'string') {
                        const parsed = JSON.parse(msg.attachments);
                        poll = parsed.poll || (Array.isArray(parsed) ? (parsed[0]?.poll || parsed[0]) : parsed);
                    } else if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
                        const first = msg.attachments[0];
                        poll = typeof first === 'string' ? (JSON.parse(first).poll || JSON.parse(first)) : (first.poll || first);
                    }
                }
            } catch(e) {}

            // Fallback parse from poll text format
            if ((!poll || !poll.options) && msg.text) {
                const lines = msg.text.split('\n').filter(Boolean);
                const qLine = lines[0]?.replace(/^[📊\s]*Poll:\s*/i, '') || 'Poll';
                const optLines = lines.slice(1).map(l => l.replace(/^\d+\.\s*/, ''));
                if (optLines.length > 0) {
                    poll = {
                        question: qLine,
                        options: optLines.map(o => ({ text: o, votes: 0, voters: [] }))
                    };
                }
            }

            if (poll && Array.isArray(poll.options)) {
                const options = poll.options;
                let totalVotes = 0;
                options.forEach(o => {
                    const voters = Array.isArray(o.voters) ? o.voters : (Array.isArray(o.votes) ? o.votes : []);
                    const count = typeof o.votes === 'number' ? o.votes : voters.length;
                    totalVotes += count;
                });

                const myId = currentUser?.id;
                let optionsHtml = '';

                options.forEach((opt, oIdx) => {
                    const optVoters = Array.isArray(opt.voters) ? opt.voters : (Array.isArray(opt.votes) ? opt.votes : []);
                    const optVotes = typeof opt.votes === 'number' ? opt.votes : optVoters.length;
                    const hasVotedThis = Boolean(myId && optVoters.includes(myId));
                    const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
                    optionsHtml += `
                        <div class="poll-option-row ${hasVotedThis ? 'voted-by-me' : ''}" onclick="voteOnPollMessage('${msg.id}', ${oIdx})">
                            <div class="poll-progress-fill" style="width:${pct}%;"></div>
                            <span class="poll-option-text">
                                ${hasVotedThis ? '<i class="fa-solid fa-circle-check" style="color:#00BFA5;"></i>' : '<i class="fa-regular fa-circle" style="color:var(--text-muted);"></i>'}
                                ${escapeHtml(opt.text || 'Option')}
                            </span>
                            <span class="poll-option-percent">${pct}%</span>
                        </div>
                    `;
                });

                extraCardHtml = `
                    <div class="poll-card-bubble">
                        <div class="poll-question-title">
                            <i class="fa-solid fa-square-poll-vertical" style="color:#00BFA5;"></i>
                            <span>${escapeHtml(poll.question || 'Live Poll')}</span>
                        </div>
                        <div class="poll-options-list">${optionsHtml}</div>
                        <div class="poll-footer-meta">
                            <span>${totalVotes} vote${totalVotes === 1 ? '' : 's'}</span>
                            <span>Live Poll</span>
                        </div>
                    </div>
                `;
            }
        }

        // ── Contact Card Attachment ────────────────────────────────────
        if (msg.type === 'contact') {
            let contactInfo = null;
            try {
                if (msg.attachments) {
                    let att = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
                    if (Array.isArray(att)) att = att[0];
                    if (typeof att === 'string') att = JSON.parse(att);
                    contactInfo = att;
                }
            } catch(e) {}
            if (!contactInfo && msg.text) {
                contactInfo = { name: msg.text.replace(/^[👤\s]*Contact:\s*/i, '') };
            }
            if (contactInfo) {
                const contactName = contactInfo.name || 'Orbit Contact';
                const contactDetail = contactInfo.username ? `@${contactInfo.username}` : (contactInfo.phone || 'Orbit User');
                extraCardHtml = `
                    <div class="chat-contact-card">
                        <div class="contact-card-top">
                            <div class="contact-card-av">${(contactName[0] || 'U').toUpperCase()}</div>
                            <div style="flex:1; min-width:0;">
                                <div style="font-weight:700; color:#fff; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(contactName)}</div>
                                <div style="font-size:11.5px; color:var(--text-secondary);">${escapeHtml(contactDetail)}</div>
                            </div>
                        </div>
                        <button type="button" class="contact-card-btn touch-fix" onclick="startDirectChatWithContact('${escapeHtml(contactInfo.username || contactName)}')">
                            <i class="fa-solid fa-comment-dots" style="margin-right:4px;"></i> Message
                        </button>
                    </div>
                `;
            }
        }

        if (msg.type==='call') {
            const detail=formatOrbitCallDetail(msg.text);
            extraCardHtml=`<div class="orbit-call-message"><span class="orbit-call-message-icon"><i class="fa-solid fa-phone"></i></span><div><strong>Voice call</strong><small>${escapeHtml(detail)}</small></div></div>`;
        }

        // ── Text with Markdown, URLs & @Friend Mentions Formatting ──────
        let formattedTextHtml = '';
        const isMsgDeleted = msg.is_deleted || msg.text === '🚫 This message was deleted' || msg.text === '🚫 You deleted this message';
        if (isMsgDeleted) {
            const isOwnMsg = currentUser && msg.sender_id === currentUser.id;
            const deletedNotice = isOwnMsg ? 'You deleted this message' : 'This message was deleted';
            extraCardHtml = '';
            mediaGridHtml = '';
            filesHtml = '';
            replyHtml = '';
            formattedTextHtml = `<div class="msg-deleted-bubble" style="display:flex; align-items:center; gap:6px; font-style:italic; opacity:0.68; color:var(--text-muted); font-size:13px; padding:3px 2px;"><i class="fa-solid fa-ban" style="font-size:12px;"></i> <span>${deletedNotice}</span></div>`;
        } else if (msg.text && msg.type !== 'location' && msg.type !== 'poll' && msg.type !== 'contact' && msg.type !== 'call') {
            const rawTextTrimmed = msg.text.trim();
            // Check if text is a placeholder that shouldn't be duplicated when attachments are rendered
            const isImagePlaceholder = (images.length > 0) && (
                /^\d+\s+(images?|photos?)$/i.test(rawTextTrimmed) ||
                images.some(im => im.name && im.name.trim().toLowerCase() === rawTextTrimmed.toLowerCase())
            );
            const isFilePlaceholder = (files.length > 0) && (
                files.some(f => {
                    const fn = (f.name || '').trim().toLowerCase();
                    const tl = rawTextTrimmed.toLowerCase();
                    return fn === tl || `📄 ${fn}` === tl || `📄${fn}` === tl;
                })
            );

            if (!isImagePlaceholder && !isFilePlaceholder) {
                let text = formatOrbitMessageText(msg.text);
                if (msg.is_edited) {
                    text += '<span class="msg-edited-badge">(edited)</span>';
                }
                formattedTextHtml = `<div class="msg-text-content" style="white-space:pre-wrap; word-break:break-word; margin-top:${(images.length || files.length) ? '6px' : '0'};">${text}</div>`;
            }
        }

        // ── Emoji Reactions Bar & Reaction Badges ─────────────────────
        let reactionsHtml = '';
        if (!isMsgDeleted) {
            const reactionsMap = getMessageReactionsMap(msg);
            const reactionKeys = Object.keys(reactionsMap);
            if (reactionKeys.length > 0) {
                reactionsHtml = `<div class="msg-reactions-pill-bar" onclick="event.stopPropagation(); openReactionDetailsModal('${msg.id}')" title="View reactions">`;
                reactionKeys.forEach(emoji => {
                    const uids = reactionsMap[emoji] || [];
                    const userReacted = currentUser && uids.includes(currentUser.id);
                    reactionsHtml += `
                        <span class="reaction-badge ${userReacted ? 'user-reacted' : ''}">
                            ${emoji} <span style="font-weight:700; font-size:11px;">${uids.length}</span>
                        </span>
                    `;
                });
                reactionsHtml += `</div>`;
            }
        }

        // ── Forwarded Message Indicator ──────────────────────────────────
        let forwardedHtml = '';
        if (msg.is_forwarded || msg.forwarded) {
            forwardedHtml = `
                <div class="msg-forwarded-indicator" style="font-size:11px; color:var(--text-muted, #8e8e93); margin-bottom:4px; font-style:italic; display:flex; align-items:center; gap:5px; opacity:0.88;">
                    <i class="fa-solid fa-share" style="font-size:9.5px; opacity:0.75;"></i>
                    <span>Forwarded</span>
                </div>
            `;
        }

        const isStarred = isMessageStarred(msg.id);
        const starBadgeHtml = isStarred ? '<i class="fa-solid fa-star msg-star-badge" title="Starred message"></i>' : '';

        row.innerHTML = `
            <div class="msg-bubble-wrap">
                ${!isMsgDeleted ? '<div class="reply-slide-indicator"><i class="fa-solid fa-reply"></i></div>' : ''}
                <div class="msg-bubble-card ${isMsgDeleted ? 'is-deleted-card' : ''} anim-pop">
                    ${forwardedHtml}
                    ${replyHtml}
                    ${mediaGridHtml}
                    ${filesHtml}
                    ${extraCardHtml}
                    ${formattedTextHtml}
                    <div class="msg-meta-row">
                        ${starBadgeHtml}
                        ${msg.edited_at ? '<span class="msg-edited-label">edited</span>' : ''}
                        <span>${timeFormatted}</span>
                        ${isOwn ? getTickIconHtml(msg) : ''}
                    </div>
                </div>
            </div>
            ${reactionsHtml}
        `;

        // ── Slide to Reply & Long-Press Reaction Gesture ────────────────
        if (!isMsgDeleted) {
            attachSlideToReplyAndReactionGesture(row, msg);
        }

        return row;
    } catch(err) {
        console.warn('[Orbit] createMessageDOMNode fallback error:', err);
        const fallbackRow = document.createElement('div');
        fallbackRow.className = 'msg-bubble-row other';
        fallbackRow.innerHTML = `<div class="msg-bubble-card" style="padding:8px 12px; font-size:12px; color:var(--text-secondary);">${escapeHtml(msg.text || '[Attachment]')}</div>`;
        return fallbackRow;
    }
}

let scrollBottomDebounceTimer = null;
function scrollFeedToBottom(force = false, smooth = false) {
    const feed = document.getElementById('chat-feed');
    if (!feed) return;

    // If user is scrolled up reading history, don't force jump to bottom unless explicit force
    const isNearBottom = (feed.scrollHeight - feed.scrollTop - feed.clientHeight) < 220;
    if (!force && !isNearBottom) {
        // Increment unread badge on floating jump button if message arrived
        const badge = document.getElementById('scroll-bottom-unread-badge');
        if (badge) {
            const cur = parseInt(badge.innerText || '0', 10);
            badge.innerText = String(cur + 1);
            badge.classList.remove('hide');
        }
        return;
    }

    if (smooth) {
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    } else {
        if (scrollBottomDebounceTimer) cancelAnimationFrame(scrollBottomDebounceTimer);
        scrollBottomDebounceTimer = requestAnimationFrame(() => {
            feed.scrollTop = feed.scrollHeight;
        });
    }

    const jumpBtn = document.getElementById('btn-scroll-bottom');
    if (jumpBtn && (force || isNearBottom)) {
        jumpBtn.classList.add('hide');
        const badge = document.getElementById('scroll-bottom-unread-badge');
        if (badge) { badge.classList.add('hide'); badge.innerText = '0'; }
    }
}

// ══════════════════════════════════════════════════════════════════════════
// FULLSCREEN MEDIA LIGHTBOX VIEWER
// ══════════════════════════════════════════════════════════════════════════
// currentLightboxUrl pre-declared in js/chat-actions.js

// lightboxZoomLevel pre-declared in js/chat-actions.js



// â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
// SEND MESSAGE & ATTACHMENTS (Reliable 0ms Optimistic Pipeline)
// â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
// ── Guard: prevents double-send from rapid clicks or key-repeat Enter ──

function scrollToMessage(msgId) {
    if (!msgId) return;
    const cleanId = String(msgId).trim();
    const targetNode = document.getElementById(`msg-${cleanId}`) || document.querySelector(`[data-msg-id="${cleanId}"]`);
    if (targetNode) {
        targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetNode.classList.add('targeted-glow');
        setTimeout(() => {
            targetNode.classList.remove('targeted-glow');
        }, 2200);
    } else {
        showToast('Original message is not in current view', 'info');
    }
}
window.scrollToMessage = scrollToMessage;


function contextReactWithEmoji(emoji) {
    if (contextActiveMessage) {
        toggleMessageReaction(contextActiveMessage.id, emoji);
    }
    closeMsgContextModal();
}

function contextShowInfo() {
    if (!contextActiveMessage) return;
    const info = document.getElementById('msg-info-details');
    const d = new Date(contextActiveMessage.created_at);
    document.getElementById('info-sender').innerText = contextActiveMessage.username || 'User';
    document.getElementById('info-delivered').innerText = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    document.getElementById('info-read').innerText = isDirectRecipientOnline() ? 'Delivered & Seen' : 'Delivered to Server';
    info.style.display = 'block';
}

function contextDeleteForMe() {
    if (!contextActiveMessage) return;
    const node = document.getElementById(`msg-${contextActiveMessage.id}`);
    if (node) node.remove();
    let msgs = messageCache.get(currentRoom) || [];
    msgs = msgs.filter(m => m.id !== contextActiveMessage.id);
    // Update all aliases in cache
    const aliases = resolveRoomAliases(currentRoom);
    aliases.forEach(alias => messageCache.set(alias, msgs));
    closeMsgContextModal();
    showToast('Message deleted for you');
}

async function contextDeleteForEveryone(customMsgId) {
    const msgId = customMsgId || contextActiveMessage?.id;
    if (!msgId) return;

    if (!customMsgId && !confirm('Delete this message for everyone?')) return;

    // 1. Instant local DOM transformation & persistent cache update (WhatsApp style)
    handleMessageDeleted(msgId, currentRoom);

    // 2. Peer-to-peer real-time broadcast (<100ms instant update on recipient screen)
    if (activeRealtimeChannel) {
        try {
            activeRealtimeChannel.send({
                type: 'broadcast',
                event: 'delete_message',
                payload: { id: msgId, is_deleted: true, room: currentRoom }
            });
        } catch(e) {}
    }

    if (typeof closeMsgContextModal === 'function') closeMsgContextModal();
    showToast('Message deleted for everyone ✓', 'success');

    // 3. Background DB update: preserve message row with WhatsApp deleted placeholder
    try {
        const client = await ensureSupabase();
        await client.from('messages').update({
            text: '🚫 This message was deleted',
            attachments: [],
            type: 'text'
        }).eq('id', msgId);
    } catch(e) {
        console.warn('[Orbit] Delete for everyone network error:', e);
    }
}

function toggleChatOptionsMenu(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('chat-options-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('hide');
    updateChatOptionsMenuState();
}

function closeChatOptionsMenu() {
    document.getElementById('chat-options-dropdown')?.classList.add('hide');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#chat-options-dropdown') && !e.target.closest('#chat-options-menu-btn')) {
        closeChatOptionsMenu();
    }
});

function updateChatOptionsMenuState() {
    const blockItem = document.getElementById('chat-option-block-item');
    const blockIcon = document.getElementById('chat-option-block-icon');
    const blockLabel = document.getElementById('chat-option-block-label');
    const deleteGroupItem = document.getElementById('chat-option-delete-group-item');

    // Group Chat vs 1-on-1 Chat options
    if (isGroupChat) {
        if (blockItem) blockItem.style.display = 'none';
        if (deleteGroupItem) {
            const roomMeta = allRoomsMap.get(currentRoom);
            const isCreatorOrAdmin = (typeof isAdmin === 'function' && isAdmin()) || (roomMeta && roomMeta.created_by === currentUser?.id);
            deleteGroupItem.style.display = isCreatorOrAdmin ? 'flex' : 'none';
        }
        return;
    }

    if (deleteGroupItem) deleteGroupItem.style.display = 'none';

    if (!blockItem) return;
    if (!activeChatPeerId || isSelfChat) {
        blockItem.style.display = 'none';
        return;
    }
    blockItem.style.display = 'flex';

    if (blockedUsersSet.has(activeChatPeerId)) {
        blockItem.classList.remove('danger');
        if (blockIcon) {
            blockIcon.className = 'fa-solid fa-unlock';
            blockIcon.style.color = '#00E676';
        }
        if (blockLabel) {
            blockLabel.innerText = 'Unblock User';
            blockLabel.style.color = '#00E676';
        }
    } else {
        blockItem.classList.add('danger');
        if (blockIcon) {
            blockIcon.className = 'fa-solid fa-ban';
            blockIcon.style.color = '#FF453A';
        }
        if (blockLabel) {
            blockLabel.innerText = 'Block User';
            blockLabel.style.color = '#FF453A';
        }
    }
}

async function confirmClearChat() {
    closeChatOptionsMenu();
    if (!currentRoom) return;
    if (!confirm('Clear all chat messages in this conversation? This cannot be undone.')) return;

    try {
        showToast('Clearing chat...');
        const aliases = resolveRoomAliases(currentRoom);

        // Delete from Supabase
        await sb.from('messages').delete().in('room', aliases);

        // Clear local memory cache & persistent localStorage
        aliases.forEach(a => {
            messageCache.delete(a);
            try { localStorage.removeItem(`orbit_cache_msgs_${a}`); } catch(e) {}
        });

        // Reset feed UI
        const feed = document.getElementById('chat-feed');
        if (feed) {
            feed.innerHTML = `
                <div style="text-align:center; padding:60px 20px; color:var(--text-muted); font-size:12.5px;">
                    <i class="fa-solid fa-broom" style="font-size:28px; margin-bottom:10px; display:block; color:var(--accent);"></i>
                    Chat history cleared
                </div>
            `;
        }

        showToast('Chat history cleared ✓', 'success');
    } catch(e) {
        showToast('Failed to clear chat');
    }
}

function handleSearch(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.contact-glass-card, .news-card-liquid').forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = (!q || text.includes(q)) ? 'flex' : 'none';
    });
}

function handleInputResize(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    
    // Auto-capitalize first character if user starts typing
    if (textarea.value.length === 1 && textarea.value !== textarea.value.toUpperCase()) {
        textarea.value = textarea.value.toUpperCase();
    }
}

function handleInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// ══════════════════════════════════════════════════════════════════════════
// TOUCH & TRACKPAD GESTURE SWIPE NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
    const chatScreen = document.getElementById('screen-chat');
    if (!chatScreen || !chatScreen.classList.contains('active')) return;
    
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX;
    const diffY = Math.abs(touchEndY - touchStartY);

    // Swipe from left to right (back gesture)
    if (touchStartX < 60 && diffX > 90 && diffY < 60) {
        navBackFromChat();
    }
}, { passive: true });

// Laptop/Desktop horizontal trackpad swipe back gesture
document.addEventListener('wheel', e => {
    const chatScreen = document.getElementById('screen-chat');
    if (!chatScreen || !chatScreen.classList.contains('active')) return;
    if (e.deltaX < -55 && Math.abs(e.deltaY) < 25) {
        navBackFromChat();
    }
}, { passive: true });

function attachSlideToReplyAndReactionGesture(rowNode, msg) {
    const card = rowNode.querySelector('.msg-bubble-card');
    const indicator = rowNode.querySelector('.reply-slide-indicator');
    if (!card) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isDragging = false;
    let isHorizontalSwipe = null; // null: undecided, true: horizontal, false: vertical scroll
    let longPressTimer = null;

    function resetBubble() {
        card.classList.remove('swiping');
        card.classList.add('returning');
        card.style.transform = '';
        if (indicator) indicator.classList.remove('active');
        currentX = 0;
        isDragging = false;
        isHorizontalSwipe = null;
        setTimeout(() => card.classList.remove('returning'), 300);
    }

    // Touch events for Mobile (WhatsApp swipe-to-reply physics)
    card.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = 0;
        isDragging = false;
        isHorizontalSwipe = null;

        // Long press for reaction bar
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            if (!isDragging && isHorizontalSwipe !== true) {
                if (navigator.vibrate) navigator.vibrate(30);
                showQuickReactionPicker(rowNode, msg);
            }
        }, 500);
    }, { passive: true });

    card.addEventListener('touchmove', e => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;

        // Determine swipe direction once after small movement threshold
        if (isHorizontalSwipe === null) {
            if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
                if (Math.abs(diffX) > Math.abs(diffY) && diffX > 0) {
                    isHorizontalSwipe = true;
                    clearTimeout(longPressTimer);
                } else {
                    isHorizontalSwipe = false;
                    clearTimeout(longPressTimer);
                    return;
                }
            } else {
                return;
            }
        }

        if (!isHorizontalSwipe) return;

        // Only allow swiping right (towards reply) with rubber-band resistance
        if (diffX > 0) {
            isDragging = true;
            card.classList.add('swiping');
            card.classList.remove('returning');

            // Logarithmic rubber-band drag physics (max 85px)
            const clampedX = Math.min(diffX * 0.72, 85);
            currentX = clampedX;
            card.style.transform = `translateX(${clampedX}px)`;

            if (indicator) {
                if (clampedX >= 48) {
                    if (!indicator.classList.contains('active')) {
                        indicator.classList.add('active');
                        if (navigator.vibrate) navigator.vibrate(15);
                    }
                } else {
                    indicator.classList.remove('active');
                }
            }
        }
    }, { passive: true });

    card.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
        if (isDragging && currentX >= 48) {
            replyToMessage(msg.id, msg.username, msg.text || 'Attachment');
        }
        resetBubble();
    }, { passive: true });

    card.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimer);
        resetBubble();
    }, { passive: true });

    // Desktop/Laptop Mouse Drag Slide to Reply
    card.addEventListener('mousedown', e => {
        // Ignore right-click (allow context menu)
        if (e.button !== 0) return;

        // Ignore clicks on buttons, links, or inputs inside card
        if (e.target.closest('button, a, input, video')) return;

        startX = e.clientX;
        startY = e.clientY;
        currentX = 0;
        isDragging = false;
        isHorizontalSwipe = null;

        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            if (!isDragging) {
                showQuickReactionPicker(rowNode, msg);
            }
        }, 500);

        function onMouseMove(ev) {
            const diffX = ev.clientX - startX;
            const diffY = ev.clientY - startY;

            if (isHorizontalSwipe === null) {
                if (Math.abs(diffX) > 6 || Math.abs(diffY) > 6) {
                    if (diffX > 0 && Math.abs(diffX) > Math.abs(diffY)) {
                        isHorizontalSwipe = true;
                        clearTimeout(longPressTimer);
                    } else {
                        isHorizontalSwipe = false;
                        clearTimeout(longPressTimer);
                        return;
                    }
                } else {
                    return;
                }
            }

            if (!isHorizontalSwipe) return;

            if (diffX > 0) {
                isDragging = true;
                card.classList.add('swiping');
                card.classList.remove('returning');

                const clampedX = Math.min(diffX * 0.65, 80);
                currentX = clampedX;
                card.style.transform = `translateX(${clampedX}px)`;

                if (indicator) {
                    if (clampedX >= 44) {
                        indicator.classList.add('active');
                    } else {
                        indicator.classList.remove('active');
                    }
                }
            }
        }

        function onMouseUp() {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            clearTimeout(longPressTimer);

            if (isDragging && currentX >= 44) {
                replyToMessage(msg.id, msg.username, msg.text || 'Attachment');
            }
            resetBubble();
        }

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. MESSAGE EMOJI REACTIONS (👍 ❤️ 😂 😮 😢 🔥 👏)
// ══════════════════════════════════════════════════════════════════════════
const PRO_EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏'];

function getMessageReactionsMap(msg) {
    let raw = msg.reply_to;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch(e) { raw = null; }
    }
    if (raw && raw.reactions && typeof raw.reactions === 'object') {
        return raw.reactions;
    }
    return {};
}

function showQuickReactionPicker(rowNode, msg, coords) {
    // Remove any existing reaction picker overlay
    document.querySelectorAll('.orbit-msg-overlay').forEach(el => el.remove());

    const isOwn = (!msg.sender_id && !msg.from_user) || (currentUser && msg.sender_id === currentUser.id);

    // Get the bubble card's bounding rect relative to viewport
    const card = rowNode.querySelector('.msg-bubble-card') || rowNode;
    const rect = card.getBoundingClientRect();

    // ── Full-screen transparent overlay (dismiss on outside tap) ──
    const overlay = document.createElement('div');
    overlay.className = 'orbit-msg-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9990;
        background: rgba(0,0,0,0.25);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
    `;
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
    });
    overlay.addEventListener('touchstart', e => {
        if (e.target === overlay) overlay.remove();
    }, { passive: true });

    // ── 1. Emoji Reaction Pill Bar ──
    const bar = document.createElement('div');
    bar.className = 'reaction-quick-bar';

    PRO_EMOJI_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'quick-emoji-btn';
        btn.innerText = emoji;
        btn.onclick = (e) => {
            e.stopPropagation();
            toggleMessageReaction(msg.id, emoji);
            overlay.remove();
        };
        bar.appendChild(btn);
    });

    // '+' Button for full emoji picker
    const plusBtn = document.createElement('button');
    plusBtn.className = 'quick-emoji-btn';
    plusBtn.innerHTML = '<i class="fa-solid fa-plus" style="font-size:16px; color:var(--text-secondary);"></i>';
    plusBtn.title = 'More Reactions';
    plusBtn.onclick = (e) => {
        e.stopPropagation();
        overlay.remove();
        if (typeof openEmojiPickerModal === 'function') openEmojiPickerModal();
    };
    bar.appendChild(plusBtn);

    // ── 2. Action Menu ──
    const menu = document.createElement('div');
    menu.className = 'msg-bubble-action-menu';
    // Override position to use fixed viewport coords — never clipped by overflow containers
    menu.style.cssText = 'position:static; margin-top:8px; min-width:190px; border-radius:16px;';

    const menuItems = [
        {
            icon: 'fa-solid fa-reply',
            label: 'Reply',
            action: () => {
                if (typeof setReplyTarget === 'function') {
                    setReplyTarget(msg);
                } else if (typeof replyToMessage === 'function') {
                    replyToMessage(msg.id, msg.username, msg.text || 'Attachment');
                }
            }
        },
        {
            icon: 'fa-regular fa-copy',
            label: 'Copy',
            action: async () => {
                try {
                    const textToCopy = msg.text || (Array.isArray(msg.attachments) && msg.attachments[0]?.url) || '';
                    if (textToCopy) {
                        await navigator.clipboard.writeText(textToCopy);
                        showToast('Copied to clipboard ✓', 'success');
                    }
                } catch(e) { showToast('Failed to copy', 'error'); }
            }
        },
        (() => {
            const isPinned = isMessagePinned(msg.id, currentRoom);
            return {
                icon: isPinned ? 'fa-solid fa-thumbtack-slash' : 'fa-solid fa-thumbtack',
                label: isPinned ? 'Unpin Message' : 'Pin Message',
                action: () => {
                    if (isPinned) {
                        unpinMessage(msg.id, currentRoom);
                    } else {
                        pinMessage(msg.id, currentRoom);
                    }
                }
            };
        })(),
        {
            icon: 'fa-solid fa-share',
            label: 'Forward',
            action: () => {
                if (typeof openForwardModal === 'function') {
                    openForwardModal(msg);
                } else {
                    showToast('Forwarding message...', 'info');
                }
            }
        },
        (() => {
            const starred = isMessageStarred(msg.id);
            return {
                icon: starred ? 'fa-solid fa-star' : 'fa-regular fa-star',
                label: starred ? 'Unstar' : 'Star',
                action: () => { toggleStarMessage(msg.id); }
            };
        })(),
        {
            icon: 'fa-solid fa-circle-info',
            label: 'Info',
            action: () => {
                const dateStr = new Date(msg.created_at || Date.now()).toLocaleString();
                showToast(`Sent: ${dateStr}`, 'info');
            }
        },
        {
            icon: 'fa-solid fa-trash-can',
            label: 'Delete for Me',
            danger: true,
            action: () => {
                rowNode.remove();
                showToast('Deleted for you', 'info');
            }
        }
    ];

    if (typeof orbitCanEditMessage === "function" && orbitCanEditMessage(msg)) {
        menuItems.unshift({icon:"fa-solid fa-pen", label:"Edit message", action:()=>orbitBeginEdit(msg)});
    }
    if (isOwn) {
        menuItems.push({
            icon: 'fa-solid fa-ban',
            label: 'Delete for Everyone',
            danger: true,
            action: () => {
                contextDeleteForEveryone(msg.id);
            }
        });
    }

    menu.innerHTML = menuItems.map(item => `
        <div class="msg-action-menu-item ${item.danger ? 'danger' : ''}">
            <i class="${item.icon}"></i>
            <span>${item.label}</span>
        </div>
    `).join('');

    menu.querySelectorAll('.msg-action-menu-item').forEach((el, idx) => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            overlay.remove();
            menuItems[idx].action();
        });
    });

    // ── Layout container: stacks bar + menu with zero-overflow viewport clamping ──
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        z-index: 9991;
        display: flex;
        flex-direction: column;
        align-items: ${isOwn ? 'flex-end' : 'flex-start'};
        gap: 6px;
        max-height: calc(100vh - 24px);
        overflow-y: auto;
        box-sizing: border-box;
    `;

    container.appendChild(bar);
    container.appendChild(menu);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // Measure rendered dimensions for dynamic collision prevention
    const cRect = container.getBoundingClientRect();
    const containerHeight = cRect.height || 330;
    const containerWidth = cRect.width || 230;

    let targetTop = 0;
    let targetLeft = 0;

    if (coords && typeof coords.y === 'number') {
        if (coords.y + containerHeight + 16 <= window.innerHeight) {
            targetTop = coords.y + 6;
        } else {
            targetTop = coords.y - containerHeight - 6;
        }
    } else {
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (spaceBelow >= containerHeight + 12) {
            targetTop = rect.bottom + 6;
        } else if (spaceAbove >= containerHeight + 12) {
            targetTop = rect.top - containerHeight - 6;
        } else {
            // Pick whichever side offers greater real estate
            targetTop = spaceAbove > spaceBelow ? (rect.top - containerHeight - 6) : (rect.bottom + 6);
        }
    }

    // Strict vertical clamping: NEVER clip outside top or bottom screen edge
    targetTop = Math.max(12, Math.min(window.innerHeight - containerHeight - 12, targetTop));

    // Horizontal calculation & clamping
    if (coords && typeof coords.x === 'number') {
        targetLeft = isOwn ? (coords.x - containerWidth) : coords.x;
    } else {
        targetLeft = isOwn ? (rect.right - containerWidth) : rect.left;
    }
    targetLeft = Math.max(12, Math.min(window.innerWidth - containerWidth - 12, targetLeft));

    container.style.top = `${targetTop}px`;
    container.style.left = `${targetLeft}px`;

    // Haptic feedback
    if (navigator.vibrate) try { navigator.vibrate(30); } catch(e) {}
}

function openMsgContextMenu(e, msg, rowNode) {
    if (e) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
    }
    const targetRow = rowNode || (e && e.target && e.target.closest('.msg-bubble-row')) || document.getElementById(`msg-${msg.id}`);
    if (!targetRow) return;
    const coords = e ? { x: e.clientX, y: e.clientY } : null;
    showQuickReactionPicker(targetRow, msg, coords);
}
window.openMsgContextMenu = openMsgContextMenu;

// ── Pinned Messages System (WhatsApp & Telegram Standard) ──
function isMessagePinned(msgId, roomId) {
    if (!msgId || !roomId) return false;
    try {
        const pinnedId = localStorage.getItem(`orbit_pinned_msg_${roomId}`);
        return pinnedId === msgId;
    } catch(e) { return false; }
}

function pinMessage(msgId, roomId) {
    const rId = roomId || currentRoom;
    if (!msgId || !rId) return;
    try {
        localStorage.setItem(`orbit_pinned_msg_${rId}`, msgId);
        renderPinnedBannerForRoom(rId);
        if (activeRealtimeChannel) {
            activeRealtimeChannel.send({
                type: 'broadcast',
                event: 'pin_message',
                payload: { msgId, room: rId }
            });
        }
        showToast('Message pinned 📌', 'success');
    } catch(e) {}
}

function unpinMessage(msgId, roomId) {
    const rId = roomId || currentRoom;
    if (!rId) return;
    try {
        localStorage.removeItem(`orbit_pinned_msg_${rId}`);
        renderPinnedBannerForRoom(rId);
        if (activeRealtimeChannel) {
            activeRealtimeChannel.send({
                type: 'broadcast',
                event: 'unpin_message',
                payload: { room: rId }
            });
        }
        showToast('Message unpinned', 'info');
    } catch(e) {}
}

function unpinCurrentRoomMessage(e) {
    if (e) e.stopPropagation();
    unpinMessage(null, currentRoom);
}

function renderPinnedBannerForRoom(roomId) {
    const rId = roomId || currentRoom;
    const banner = document.getElementById('chat-pinned-banner');
    if (!banner) return;
    if (!rId) {
        banner.classList.add('hide');
        return;
    }

    const pinnedId = localStorage.getItem(`orbit_pinned_msg_${rId}`);
    if (!pinnedId) {
        banner.classList.add('hide');
        return;
    }

    let msgs = messageCache.get(rId) || [];
    let msg = msgs.find(m => m.id === pinnedId || m.client_temp_id === pinnedId);
    let snippet = 'Pinned message';
    if (msg) {
        snippet = msg.text || (msg.attachments?.[0]?.name) || (msg.type === 'poll' ? '📊 Poll' : '📎 Attachment');
    }

    const snippetEl = document.getElementById('pinned-msg-snippet');
    if (snippetEl) snippetEl.innerText = snippet;
    banner.classList.remove('hide');
}

function scrollToPinnedMessage() {
    if (!currentRoom) return;
    const pinnedId = localStorage.getItem(`orbit_pinned_msg_${currentRoom}`);
    if (pinnedId) {
        scrollToMessage(pinnedId);
    }
}

function handleRemotePin(msgId, roomId) {
    if (!msgId || !roomId) return;
    localStorage.setItem(`orbit_pinned_msg_${roomId}`, msgId);
    if (currentRoom === roomId) renderPinnedBannerForRoom(roomId);
}

function handleRemoteUnpin(roomId) {
    if (!roomId) return;
    localStorage.removeItem(`orbit_pinned_msg_${roomId}`);
    if (currentRoom === roomId) renderPinnedBannerForRoom(roomId);
}

// ── WhatsApp-Style Reaction Details Modal ("Who Reacted") ──
function openReactionDetailsModal(msgId, selectedEmoji = 'all') {
    const modal = document.getElementById('modal-reaction-details');
    if (!modal) return;

    let target = null;
    const msgs = messageCache.get(currentRoom) || [];
    target = msgs.find(m => m.id === msgId || m.client_temp_id === msgId);
    if (!target) return;

    const reactionsMap = getMessageReactionsMap(target);
    const emojis = Object.keys(reactionsMap);
    if (emojis.length === 0) return;

    // Calculate total reactions
    let totalCount = 0;
    emojis.forEach(e => totalCount += (reactionsMap[e] || []).length);

    // Render filter tabs
    const tabsContainer = document.getElementById('reaction-details-tabs');
    if (tabsContainer) {
        let tabsHtml = `<button class="reaction-tab-pill ${selectedEmoji === 'all' ? 'active' : ''}" onclick="openReactionDetailsModal('${msgId}', 'all')">All ${totalCount}</button>`;
        emojis.forEach(e => {
            const count = (reactionsMap[e] || []).length;
            tabsHtml += `<button class="reaction-tab-pill ${selectedEmoji === e ? 'active' : ''}" onclick="openReactionDetailsModal('${msgId}', '${e}')">${e} ${count}</button>`;
        });
        tabsContainer.innerHTML = tabsHtml;
    }

    // Render reactors list
    const listContainer = document.getElementById('reaction-details-list');
    if (listContainer) {
        let uidsToShow = [];
        if (selectedEmoji === 'all') {
            emojis.forEach(e => {
                (reactionsMap[e] || []).forEach(uid => uidsToShow.push({ uid, emoji: e }));
            });
        } else {
            (reactionsMap[selectedEmoji] || []).forEach(uid => uidsToShow.push({ uid, emoji: selectedEmoji }));
        }

        let listHtml = '';
        uidsToShow.forEach(({ uid, emoji }) => {
            const isMe = currentUser && uid === currentUser.id;
            let name = 'User';
            let avatarHtml = `<div class="user-av-mini" style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#333,#222); display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff;">U</div>`;

            if (isMe) {
                name = 'You';
                const myAv = userProfile?.dp_url;
                if (myAv) avatarHtml = `<img src="${formatMediaUrl(myAv)}" class="user-av-mini" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">`;
                else avatarHtml = `<div class="user-av-mini" style="width:36px; height:36px; border-radius:50%; background:var(--accent); color:#000; font-weight:800; display:flex; align-items:center; justify-content:center;">Y</div>`;
            } else {
                const u = typeof globalUsersMap !== 'undefined' ? globalUsersMap.get(uid) : null;
                if (u) {
                    name = u.display_name || u.first_name || u.username || 'User';
                    if (u.dp_url) avatarHtml = `<img src="${formatMediaUrl(u.dp_url)}" class="user-av-mini" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">`;
                    else avatarHtml = `<div class="user-av-mini" style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#444,#222); color:#fff; font-weight:700; display:flex; align-items:center; justify-content:center;">${(name[0]||'U').toUpperCase()}</div>`;
                }
            }

            listHtml += `
                <div class="reactor-item-row" style="display:flex; align-items:center; justify-content:space-between; padding:10px 18px; border-bottom:1px solid var(--glass-border-light);">
                    <div style="display:flex; align-items:center; gap:12px;">
                        ${avatarHtml}
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:700; font-size:14px; color:var(--text-primary);">${escapeHtml(name)}</span>
                            ${isMe ? `<span style="font-size:11px; color:#FF453A; cursor:pointer;" onclick="toggleMessageReaction('${msgId}', '${emoji}'); closeReactionDetailsModal();">Tap to remove</span>` : ''}
                        </div>
                    </div>
                    <span style="font-size:20px;">${emoji}</span>
                </div>
            `;
        });
        listContainer.innerHTML = listHtml;
    }

    modal.classList.add('active');
}

function closeReactionDetailsModal() {
    const modal = document.getElementById('modal-reaction-details');
    if (modal) modal.classList.remove('active');
}

// ── Reaction Persistence & Realtime Engine ──
async function toggleMessageReaction(msgId, emoji) {
    if (!currentUser || !currentRoom) return;

    let target = null;
    const aliases = resolveRoomAliases(currentRoom);
    for (const alias of aliases) {
        const msgs = messageCache.get(alias) || [];
        target = msgs.find(m => m.id === msgId || m.client_temp_id === msgId);
        if (target) break;
    }
    if (!target) return;

    let replyObj = target.reply_to;
    if (typeof replyObj === 'string') {
        try { replyObj = JSON.parse(replyObj); } catch(e) { replyObj = {}; }
    }
    if (!replyObj || typeof replyObj !== 'object') replyObj = {};
    if (!replyObj.reactions || typeof replyObj.reactions !== 'object') replyObj.reactions = {};

    if (!Array.isArray(replyObj.reactions[emoji])) {
        replyObj.reactions[emoji] = [];
    }

    const myId = currentUser.id;
    if (replyObj.reactions[emoji].includes(myId)) {
        // Remove reaction
        replyObj.reactions[emoji] = replyObj.reactions[emoji].filter(uid => uid !== myId);
        if (replyObj.reactions[emoji].length === 0) {
            delete replyObj.reactions[emoji];
        }
    } else {
        // In WhatsApp you have 1 reaction per user on a message — remove previous
        Object.keys(replyObj.reactions).forEach(k => {
            replyObj.reactions[k] = replyObj.reactions[k].filter(uid => uid !== myId);
            if (replyObj.reactions[k].length === 0) delete replyObj.reactions[k];
        });
        if (!Array.isArray(replyObj.reactions[emoji])) replyObj.reactions[emoji] = [];
        replyObj.reactions[emoji].push(myId);
    }

    target.reply_to = replyObj;
    target.reactions = replyObj.reactions;
    target.metadata = { ...(target.metadata || {}), reactions: replyObj.reactions };

    // Update in-memory messageCache & persistent localStorage across all aliases
    aliases.forEach(alias => {
        let msgs = messageCache.get(alias) || [];
        const idx = msgs.findIndex(m => m.id === msgId || m.client_temp_id === msgId);
        if (idx !== -1) msgs[idx] = target;
        messageCache.set(alias, msgs);
        try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(msgs.slice(-40))); } catch(e) {}
    });

    // Re-render message in local DOM
    const oldNode = document.getElementById(`msg-${msgId}`) || document.querySelector(`[data-msg-id="${msgId}"]`);
    if (oldNode) {
        const newNode = createMessageDOMNode(target);
        oldNode.replaceWith(newNode);
    }

    // Broadcast over Realtime channel (<100ms instant sync to peer)
    if (activeRealtimeChannel) {
        try {
            activeRealtimeChannel.send({
                type: 'broadcast',
                event: 'message_reaction',
                payload: { msgId, reactions: replyObj.reactions, room: currentRoom }
            });
        } catch(e) {}
    }

    // Persist to Supabase with column fallback
    try {
        const client = await ensureSupabase();
        const { error } = await client.from('messages')
            .update({ reply_to: replyObj })
            .eq('id', msgId);
        if (error) {
            await client.from('messages')
                .update({ metadata: { reactions: replyObj.reactions } })
                .eq('id', msgId);
        }
    } catch(e) {
        console.warn('[Orbit] toggleReaction error:', e);
    }
}

function handleRemoteReaction(msgId, reactions, roomId, aliases) {
    if (!msgId || !reactions) return;
    const targetAliases = aliases || resolveRoomAliases(roomId || currentRoom);
    let target = null;
    targetAliases.forEach(alias => {
        let msgs = messageCache.get(alias) || [];
        const m = msgs.find(msg => msg.id === msgId || msg.client_temp_id === msgId);
        if (m) {
            let rObj = m.reply_to;
            if (typeof rObj === 'string') {
                try { rObj = JSON.parse(rObj); } catch(e) { rObj = {}; }
            }
            if (!rObj || typeof rObj !== 'object') rObj = {};
            rObj.reactions = reactions;
            m.reply_to = rObj;
            m.reactions = reactions;
            m.metadata = { ...(m.metadata || {}), reactions };
            target = m;
        }
        try { localStorage.setItem(`orbit_cache_msgs_${alias}`, JSON.stringify(msgs.slice(-40))); } catch(e) {}
    });

    const oldNode = document.getElementById(`msg-${msgId}`) || document.querySelector(`[data-msg-id="${msgId}"]`);
    if (oldNode && target) {
        const newNode = createMessageDOMNode(target);
        oldNode.replaceWith(newNode);
    }
}

window.openReactionDetailsModal = openReactionDetailsModal;
window.closeReactionDetailsModal = closeReactionDetailsModal;
window.unpinCurrentRoomMessage = unpinCurrentRoomMessage;
window.scrollToPinnedMessage = scrollToPinnedMessage;
window.pinMessage = pinMessage;
window.unpinMessage = unpinMessage;
window.handleRemotePin = handleRemotePin;
window.handleRemoteUnpin = handleRemoteUnpin;
window.handleRemoteReaction = handleRemoteReaction;

// ══════════════════════════════════════════════════════════════════════════
// 3. MENTION A FRIEND (@friend autocomplete) & DRAFT CHAT AUTO-SAVE
// ══════════════════════════════════════════════════════════════════════════
let mentionQuery = null;

function updateDynamicActionButtons() {
    const input = document.getElementById('msg-input');
    const sendBtn = document.getElementById('send-msg-btn');
    const voiceBtn = document.getElementById('voice-rec-btn');
    const hasText = input && input.value.trim().length > 0;
    const hasAtt = typeof pendingAttachments !== 'undefined' && pendingAttachments && pendingAttachments.length > 0;

    if (sendBtn && voiceBtn) {
        if (hasText || hasAtt) {
            sendBtn.classList.remove('hide');
            voiceBtn.classList.add('hide');
        } else {
            sendBtn.classList.add('hide');
            voiceBtn.classList.remove('hide');
        }
    }
}


function handleChatInputText(textarea) {
    const text = textarea.value;

    // Dynamic Mic vs Send Button
    updateDynamicActionButtons();

    // 1. Auto-save Draft
    if (currentRoom) {
        if (text.trim()) {
            localStorage.setItem(`orbit_draft_${currentRoom}`, text);
        } else {
            localStorage.removeItem(`orbit_draft_${currentRoom}`);
        }
    }

    // 2. Broadcast Typing Indicator (debounced)
    broadcastTypingStatus();

    // 3. Detect @mentions (Group chats only)
    if (!isGroupChat || isSelfChat) {
        hideMentionAutocomplete();
        return;
    }

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIdx = textBeforeCursor.lastIndexOf('@');

    if (lastAtIdx !== -1 && (lastAtIdx === 0 || /\s/.test(textBeforeCursor[lastAtIdx - 1]))) {
        const query = textBeforeCursor.slice(lastAtIdx + 1).toLowerCase();
        if (!query.includes(' ')) {
            mentionQuery = { start: lastAtIdx, query };
            showMentionAutocomplete(query);
            return;
        }
    }
    hideMentionAutocomplete();
}

function showMentionAutocomplete(query) {
    const menu = document.getElementById('mention-autocomplete');
    if (!menu) return;

    // Filter available friends and participants
    const friends = Array.from(globalUsersMap.values()).filter(u => {
        if (u.user_id === currentUser?.id) return false;
        const name = (u.display_name || u.first_name || u.email || '').toLowerCase();
        const handle = (u.username || '').toLowerCase();
        return name.includes(query) || handle.includes(query);
    }).slice(0, 6);

    if (friends.length === 0) {
        hideMentionAutocomplete();
        return;
    }

    menu.innerHTML = '';
    friends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'mention-item-row';
        const name = f.display_name || f.first_name || f.email.split('@')[0];
        const handle = f.username || f.email.split('@')[0];
        item.innerHTML = `
            <div class="c-av-wrap" style="width:30px; height:30px; font-size:12px;">${name[0].toUpperCase()}</div>
            <div style="flex:1; overflow:hidden;">
                <div style="font-weight:700; font-size:12.5px; color:#fff;">${escapeHtml(name)}</div>
                <div style="font-size:10.5px; color:var(--accent);">@${escapeHtml(handle)}</div>
            </div>
        `;
        item.onclick = () => selectMentionFriend(handle);
        menu.appendChild(item);
    });

    menu.classList.add('show');
}

function hideMentionAutocomplete() {
    const menu = document.getElementById('mention-autocomplete');
    if (menu) menu.classList.remove('show');
    mentionQuery = null;
}

function selectMentionFriend(handle) {
    const textarea = document.getElementById('msg-input');
    if (!textarea || !mentionQuery) return;

    const text = textarea.value;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(textarea.selectionStart);
    textarea.value = `${before}@${handle} ${after}`;
    hideMentionAutocomplete();
    textarea.focus();
    handleInputResize(textarea);
}

// ══════════════════════════════════════════════════════════════════════════
// 4. REALTIME TYPING INDICATOR (Supabase Broadcast with typing:start / stop)
// ══════════════════════════════════════════════════════════════════════════

function openSelfChat() {
    if (!currentUser) return;
    openChatRoom(`self_${currentUser.id}`, 'Note to Self (You)', null, true);
}

function cancelReply() {
    replyTargetMessage = null;
    document.getElementById('reply-preview-bar')?.classList.add('hide');
}

function setReplyTarget(msg) {
    if (!msg) return;
    replyTargetMessage = msg;
    const bar = document.getElementById('reply-preview-bar');
    const userEl = document.getElementById('reply-preview-user');
    const textEl = document.getElementById('reply-preview-text');
    if (userEl) userEl.innerText = msg.username || 'User';
    let preview = msg.text;
    if (!preview) {
        if (msg.type === 'voice') preview = '🎤 Voice Note';
        else if (msg.type === 'image') preview = '📷 Photo';
        else if (msg.type === 'video') preview = '🎥 Video';
        else if (msg.type === 'file' || msg.type === 'document') preview = '📄 Document';
        else if (msg.type === 'location') preview = '📍 Location';
        else if (msg.type === 'contact') preview = '👤 Contact';
        else if (msg.type === 'poll') preview = '📊 Poll';
        else preview = 'Attachment';
    }
    if (textEl) textEl.innerText = preview;
    if (bar) bar.classList.remove('hide');
    const input = document.getElementById('msg-input');
    if (input) input.focus();
}
window.setReplyTarget = setReplyTarget;
window.replyToMessage = function(id, username, text) {
    setReplyTarget({ id, username, text });
};

function closeMsgContextModal(event) {
    if (event && event.target && event.target.closest('.glass-modal-box')) return;
    document.getElementById('modal-msg-context')?.classList.remove('active');
}

function contextCopyMsg() {
    if (contextActiveMessage && contextActiveMessage.text) {
        if (typeof copyToClipboard === 'function') copyToClipboard(contextActiveMessage.text);
        showToast('Message copied to clipboard');
    }
    closeMsgContextModal();
}

function contextReplyMsg() {
    if (contextActiveMessage) {
        replyTargetMessage = contextActiveMessage;
        const bar = document.getElementById('reply-preview-bar');
        const userEl = document.getElementById('reply-preview-user');
        const textEl = document.getElementById('reply-preview-text');
        if (userEl) userEl.innerText = contextActiveMessage.username || 'User';
        if (textEl) textEl.innerText = contextActiveMessage.text || (contextActiveMessage.type || 'Media');
        if (bar) bar.classList.remove('hide');
        document.getElementById('msg-input')?.focus();
    }
    closeMsgContextModal();
}


window.renderMessageFeed = renderMessageFeed;
window.appendSingleMessageNode = appendSingleMessageNode;
window.scrollFeedToBottom = scrollFeedToBottom;
window.scrollToMessage = scrollToMessage;
window.createMessageDOMNode = createMessageDOMNode;
window.getTickIconHtml = getTickIconHtml;
window.updateBubbleSendingProgress = updateBubbleSendingProgress;
window.toggleStarMessage = toggleStarMessage;
window.isMessageStarred = isMessageStarred;
window.openMsgContextMenu = openMsgContextMenu;
window.closeMsgContextModal = closeMsgContextModal;
window.contextCopyMsg = contextCopyMsg;
window.contextReplyMsg = contextReplyMsg;
window.pinMessage = pinMessage;
window.unpinMessage = unpinMessage;
window.renderPinnedBannerForRoom = renderPinnedBannerForRoom;
window.toggleMessageReaction = toggleMessageReaction;
window.openReactionDetailsModal = openReactionDetailsModal;
window.closeReactionDetailsModal = closeReactionDetailsModal;
window.handleChatInputText = handleChatInputText;
window.cancelReply = cancelReply;
window.setReplyTarget = setReplyTarget;
