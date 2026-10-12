// ══════════════════════════════════════════════════════════════════════════
// ORBIT CHAT LIST CONTEXTUAL ACTION BAR MODULE (js/chat-select.js)
// Handles:
// 1. Long-press (500ms) on any chat item in #main-chats-list to enter selection mode
// 2. Transforming the top app bar into a Contextual Action Bar
// 3. Multi-select toggle on click
// 4. Pin/Unpin, Mute/Unmute, Delete for Me, Archive, and Info actions
// ══════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // State
    const selectedRooms = new Map(); // roomId -> { cardEl, title, isGroup }
    let isSelectionMode = false;

    /**
     * Checks if selection mode is currently active
     */
    function isInSelectionMode() {
        return isSelectionMode;
    }

    /**
     * Attaches long-press and selection handlers to a chat card in #main-chats-list
     */
    function attachChatCardSelectHandler(cardEl, roomId, title, isGroup) {
        if (!cardEl || !roomId) return;
        // Guard against double-attaching (e.g. retroactive scan on already-wired live cards)
        if (cardEl._orbitSelectAttached) return;
        cardEl._orbitSelectAttached = true;
        cardEl.dataset.roomId = roomId;

        let pressTimer = null;
        let isLongPress = false;
        let startX = 0;
        let startY = 0;

        function startPress(x, y) {
            startX = x;
            startY = y;
            isLongPress = false;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => {
                isLongPress = true;
                if (navigator.vibrate) {
                    try { navigator.vibrate(25); } catch(e) {}
                }
                enterChatSelectionMode(roomId, title, isGroup, cardEl);
            }, 450);
        }

        function cancelPress() {
            clearTimeout(pressTimer);
        }

        // Touch events
        cardEl.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            startPress(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });

        cardEl.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 1) return;
            const diffX = Math.abs(e.touches[0].clientX - startX);
            const diffY = Math.abs(e.touches[0].clientY - startY);
            if (diffX > 10 || diffY > 10) {
                cancelPress();
            }
        }, { passive: true });

        cardEl.addEventListener('touchend', () => cancelPress(), { passive: true });
        cardEl.addEventListener('touchcancel', () => cancelPress(), { passive: true });

        // Mouse events
        cardEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            startPress(e.clientX, e.clientY);

            function onMouseMove(ev) {
                if (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8) {
                    cancelPress();
                    cardEl.removeEventListener('mousemove', onMouseMove);
                }
            }
            cardEl.addEventListener('mousemove', onMouseMove);
            cardEl.addEventListener('mouseup', () => {
                cancelPress();
                cardEl.removeEventListener('mousemove', onMouseMove);
            }, { once: true });
        });

        // Intercept standard click
        cardEl.addEventListener('click', (e) => {
            if (isLongPress) {
                e.stopPropagation();
                e.preventDefault();
                isLongPress = false;
                return;
            }

            if (isSelectionMode) {
                e.stopPropagation();
                e.preventDefault();
                toggleRoomSelection(roomId, title, isGroup, cardEl);
            }
        }, true);
    }

    /**
     * Enters selection mode and selects the first room
     */
    function enterChatSelectionMode(roomId, title, isGroup, cardEl) {
        isSelectionMode = true;
        selectedRooms.clear();
        selectedRooms.set(roomId, { cardEl, title, isGroup });
        cardEl.classList.add('selected-chat-card');

        updateContextBarDOM();
        showContextBar();
    }

    /**
     * Toggles a room in selection mode
     */
    function toggleRoomSelection(roomId, title, isGroup, cardEl) {
        if (selectedRooms.has(roomId)) {
            selectedRooms.delete(roomId);
            cardEl.classList.remove('selected-chat-card');
        } else {
            selectedRooms.set(roomId, { cardEl, title, isGroup });
            cardEl.classList.add('selected-chat-card');
        }

        if (selectedRooms.size === 0) {
            exitChatSelectionMode();
        } else {
            updateContextBarDOM();
        }
    }

    /**
     * Exits selection mode and restores normal header
     */
    function exitChatSelectionMode() {
        isSelectionMode = false;
        selectedRooms.forEach(({ cardEl }) => {
            if (cardEl) cardEl.classList.remove('selected-chat-card');
        });
        selectedRooms.clear();

        hideContextBar();
    }

    /**
     * Shows context bar and hides standard dash header
     */
    function showContextBar() {
        const contextBar = document.getElementById('chats-context-bar');
        const dashHeader = document.querySelector('.dash-nav.dash-header');
        if (contextBar) contextBar.classList.remove('hide');
        if (dashHeader) dashHeader.classList.add('hide');
    }

    /**
     * Hides context bar and restores standard dash header
     */
    function hideContextBar() {
        const contextBar = document.getElementById('chats-context-bar');
        const dashHeader = document.querySelector('.dash-nav.dash-header');
        if (contextBar) contextBar.classList.add('hide');
        if (dashHeader) dashHeader.classList.remove('hide');
    }

    /**
     * Updates context bar count and action buttons based on selection
     */
    function updateContextBarDOM() {
        const countEl = document.getElementById('context-selection-count');
        const infoBtn = document.getElementById('btn-context-info');
        const pinBtn = document.getElementById('btn-context-pin');
        const muteBtn = document.getElementById('btn-context-mute');

        const size = selectedRooms.size;
        if (countEl) countEl.innerText = `${size} selected`;

        // Info button only visible if 1 chat selected
        if (infoBtn) {
            infoBtn.style.display = (size === 1) ? 'flex' : 'none';
        }

        // Determine if all selected are pinned
        const pinnedList = getPinnedRooms();
        const allPinned = Array.from(selectedRooms.keys()).every(id => pinnedList.includes(id));
        if (pinBtn) {
            pinBtn.innerHTML = allPinned ? '<i class="fa-solid fa-thumbtack" style="color:var(--accent);"></i>' : '<i class="fa-solid fa-thumbtack"></i>';
            pinBtn.title = allPinned ? 'Unpin Chat' : 'Pin Chat';
        }

        // Determine if all selected are muted
        const mutedList = getMutedRooms();
        const allMuted = Array.from(selectedRooms.keys()).every(id => mutedList.includes(id));
        if (muteBtn) {
            muteBtn.innerHTML = allMuted ? '<i class="fa-solid fa-bell" style="color:var(--accent);"></i>' : '<i class="fa-solid fa-bell-slash"></i>';
            muteBtn.title = allMuted ? 'Unmute Notifications' : 'Mute Notifications';
        }
    }

    // ── Storage Helpers ──
    function getPinnedRooms() {
        if (!currentUser) return [];
        try {
            return JSON.parse(localStorage.getItem(`orbit_pinned_rooms_${currentUser.id}`) || '[]');
        } catch(e) { return []; }
    }

    function savePinnedRooms(list) {
        if (!currentUser) return;
        localStorage.setItem(`orbit_pinned_rooms_${currentUser.id}`, JSON.stringify(list));
    }

    function getMutedRooms() {
        if (!currentUser) return [];
        try {
            return JSON.parse(localStorage.getItem(`orbit_muted_rooms_${currentUser.id}`) || '[]');
        } catch(e) { return []; }
    }

    function saveMutedRooms(list) {
        if (!currentUser) return;
        localStorage.setItem(`orbit_muted_rooms_${currentUser.id}`, JSON.stringify(list));
        if (typeof enableOrbitBackgroundPush === 'function') enableOrbitBackgroundPush();
    }

    function getArchivedRooms() {
        if (!currentUser) return [];
        try {
            return JSON.parse(localStorage.getItem(`orbit_archived_rooms_${currentUser.id}`) || '[]');
        } catch(e) { return []; }
    }

    function saveArchivedRooms(list) {
        if (!currentUser) return;
        localStorage.setItem(`orbit_archived_rooms_${currentUser.id}`, JSON.stringify(list));
    }

    // ── Context Actions ──

    function handleContextInfo() {
        if (selectedRooms.size !== 1) return;
        const [roomId, { title, isGroup }] = Array.from(selectedRooms.entries())[0];
        exitChatSelectionMode();

        if (isGroup) {
            if (typeof openRoomInfoModal === 'function') {
                openRoomInfoModal(roomId);
            } else {
                showToast(`Group: ${title}`);
            }
        } else {
            // Find user id for direct room
            const otherUid = roomId.replace(currentUser.id, '').replace('_', '');
            if (otherUid && typeof openUserProfileInspector === 'function') {
                openUserProfileInspector(otherUid);
            } else {
                showToast(`Chat: ${title}`);
            }
        }
    }

    function handleContextPin() {
        if (selectedRooms.size === 0) return;
        let pinned = getPinnedRooms();
        const roomIds = Array.from(selectedRooms.keys());
        const allPinned = roomIds.every(id => pinned.includes(id));

        if (allPinned) {
            pinned = pinned.filter(id => !roomIds.includes(id));
            showToast(`${roomIds.length} chat${roomIds.length > 1 ? 's' : ''} unpinned`);
        } else {
            roomIds.forEach(id => {
                if (!pinned.includes(id)) pinned.unshift(id);
            });
            showToast(`${roomIds.length} chat${roomIds.length > 1 ? 's' : ''} pinned to top`);
        }
        savePinnedRooms(pinned);
        exitChatSelectionMode();
        if (typeof loadMainChats === 'function') loadMainChats();
    }

    function handleContextMute() {
        if (selectedRooms.size === 0) return;
        let muted = getMutedRooms();
        const roomIds = Array.from(selectedRooms.keys());
        const allMuted = roomIds.every(id => muted.includes(id));

        if (allMuted) {
            muted = muted.filter(id => !roomIds.includes(id));
            showToast(`Notifications unmuted`);
        } else {
            roomIds.forEach(id => {
                if (!muted.includes(id)) muted.push(id);
            });
            showToast(`Notifications muted`);
        }
        saveMutedRooms(muted);
        exitChatSelectionMode();
        if (typeof loadMainChats === 'function') loadMainChats();
    }

    function handleContextArchive() {
        if (selectedRooms.size === 0) return;
        let archived = getArchivedRooms();
        const roomIds = Array.from(selectedRooms.keys());

        roomIds.forEach(id => {
            if (!archived.includes(id)) archived.push(id);
        });
        saveArchivedRooms(archived);

        showToast(`${roomIds.length} chat${roomIds.length > 1 ? 's' : ''} archived`);
        exitChatSelectionMode();
        if (typeof loadMainChats === 'function') loadMainChats();
    }

    function handleContextDeleteForMe() {
        if (selectedRooms.size === 0) return;
        const size = selectedRooms.size;
        const first = Array.from(selectedRooms.values())[0];
        const confirmMsg = size === 1
            ? `Delete conversation with "${first.title}" for yourself? Your chat list will no longer show this chat.`
            : `Delete ${size} conversations for yourself?`;

        if (!confirm(confirmMsg)) return;

        const roomIds = Array.from(selectedRooms.keys());

        // Update local hidden/deleted rooms
        try {
            const hiddenKey = `orbit_hidden_rooms_${currentUser.id}`;
            const hidden = JSON.parse(localStorage.getItem(hiddenKey) || '[]');
            roomIds.forEach(id => {
                if (!hidden.includes(id)) hidden.push(id);
                // Clear local messages cache
                localStorage.removeItem(`orbit_cache_msgs_${id}`);
            });
            localStorage.setItem(hiddenKey, JSON.stringify(hidden));

            // Clean from recent chats cache
            const recentKey = `orbit_recent_chats_v27_${currentUser.id}`;
            const recent = JSON.parse(localStorage.getItem(recentKey) || '[]');
            const filtered = recent.filter(item => !roomIds.includes(item.roomId));
            localStorage.setItem(recentKey, JSON.stringify(filtered));
        } catch(e) {}

        showToast(`${size} chat${size > 1 ? 's' : ''} deleted for you`);
        exitChatSelectionMode();
        if (typeof loadMainChats === 'function') loadMainChats();
    }

    // Expose to window
    window.OrbitChatSelect = {
        isInSelectionMode,
        attachChatCardSelectHandler,
        exitChatSelectionMode,
        handleContextInfo,
        handleContextPin,
        handleContextMute,
        handleContextArchive,
        handleContextDeleteForMe,
        getPinnedRooms,
        getMutedRooms,
        getArchivedRooms
    };

    window.exitChatSelectionMode = exitChatSelectionMode;
    window.handleContextInfo = handleContextInfo;
    window.handleContextPin = handleContextPin;
    window.handleContextMute = handleContextMute;
    window.handleContextArchive = handleContextArchive;
    window.handleContextDeleteForMe = handleContextDeleteForMe;
    window.attachChatCardSelectHandler = attachChatCardSelectHandler;
    window.isInChatSelectionMode = isInSelectionMode;

    // ── Retroactive attachment: rooms.js loads before chat-select.js, so cards
    // rendered from cache during initial hydration don't have long-press yet.
    // Once this module loads, scan for any existing cards and attach handlers.
    try {
        const existingCards = document.querySelectorAll('#main-chats-list .contact-glass-card');
        existingCards.forEach(card => {
            const roomId = card.dataset.roomId;
            if (!roomId) return; // no roomId means handler not yet added — skip gracefully
            const nameEl = card.querySelector('.c-name');
            const title = nameEl ? nameEl.textContent.trim() : '';
            const isGroup = card.querySelector('.c-av-wrap')?.style.borderColor?.includes('accent') || false;
            attachChatCardSelectHandler(card, roomId, title, !!isGroup);
        });
    } catch(e) {}
})();
