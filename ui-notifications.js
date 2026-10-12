// ORBIT UI - NOTIFICATIONS, TOASTS & INTERACTIONS (js/ui/ui-notifications.js)
// Toast alerts, emoji selector modal, bootstrap event listeners, and global ESC handler.

// ========================================================================
// ORBIT MESSENGER - UI, THEMES & APP SUITES MODULE (js/ui.js)
// ========================================================================

// ══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    initServiceWorker();
    initTheme();
    initLiquidPod();
    checkExistingSession();
    handleUrlDeepLinkParams();

    // Bind Enter key for seamless login / signup submission
    ['auth-login-email', 'auth-login-pass'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleLogin();
        });
    });
    ['auth-signup-name', 'auth-signup-email', 'auth-signup-pass', 'auth-signup-confirm'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleSignUp();
        });
    });
    document.getElementById('forgot-email-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleSendForgotOtp();
    });
    ['forgot-otp-input', 'forgot-new-pass-input'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') handleVerifyForgotOtpAndReset();
        });
    });

    // Global ESC Key Handler (Closes active modals, cancels previews, or navigates back from chat)
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' || e.keyCode === 27) {
            // 1. Lightbox viewer
            const lightbox = document.getElementById('modal-media-lightbox');
            if (lightbox && lightbox.classList.contains('active')) {
                closeMediaLightbox();
                return;
            }

            // 2. Live Camera Viewfinder
            const camModal = document.getElementById('modal-live-camera');
            if (camModal && camModal.classList.contains('active')) {
                closeLiveCameraModal();
                return;
            }

            // 3. Attachment Action Sheet
            const attachSheet = document.getElementById('modal-attachment-sheet');
            if (attachSheet && attachSheet.classList.contains('active')) {
                closeAttachmentSheet();
                return;
            }

            // 4. Emoji Picker Modal
            const emojiModal = document.getElementById('modal-emoji-picker');
            if (emojiModal && emojiModal.classList.contains('active')) {
                closeEmojiPickerModal();
                return;
            }

            // 5. Message Context Menu / Info Modal
            const msgContext = document.getElementById('modal-msg-context');
            if (msgContext && msgContext.classList.contains('active')) {
                closeMsgContextModal();
                return;
            }

            // 6. Settings Modal
            const settingsModal = document.getElementById('modal-settings');
            if (settingsModal && settingsModal.classList.contains('active')) {
                closeSettingsModal();
                return;
            }

            // 7. Profile Screen / Profile Inspector
            const profileInspector = document.getElementById('modal-user-profile-inspector');
            if (profileInspector && profileInspector.classList.contains('active')) {
                closeUserProfileInspector();
                return;
            }

            const profileScreen = document.getElementById('screen-profile');
            if (profileScreen && profileScreen.classList.contains('active')) {
                closeUserProfile();
                return;
            }

            // 8. Poll Creator Modal
            const pollModal = document.getElementById('modal-create-poll');
            if (pollModal && pollModal.classList.contains('active')) {
                closeCreatePollModal();
                return;
            }

            // 9. Friend Requests Modal
            const friendModal = document.getElementById('modal-friend-requests');
            if (friendModal && friendModal.classList.contains('active')) {
                closeFriendRequestsModal();
                return;
            }

            // 10. Forgot Password Modal
            const forgotModal = document.getElementById('modal-forgot-password');
            if (forgotModal && forgotModal.classList.contains('active')) {
                closeForgotPasswordModal();
                return;
            }

            // 11. User Dropdown Menu
            const userDropdown = document.getElementById('user-dropdown');
            if (userDropdown && userDropdown.classList.contains('open')) {
                userDropdown.classList.remove('open');
                return;
            }

            // 12. Active Reply Preview
            const replyBar = document.getElementById('reply-preview-bar');
            if (replyBar && !replyBar.classList.contains('hide')) {
                replyTargetMessage = null;
                replyBar.classList.add('hide');
                return;
            }

            // 13. Pending Attachment Preview Strip
            if (pendingAttachments && pendingAttachments.length > 0) {
                pendingAttachments = [];
                const strip = document.getElementById('media-preview-strip');
                if (strip) {
                    strip.classList.add('hide');
                    strip.innerHTML = '';
                }
                showToast('Preview removed');
                return;
            }

            // 14. If in Chat Room Screen -> Go back to Dashboard
            const chatScreen = document.getElementById('screen-chat');
            if (chatScreen && chatScreen.classList.contains('active')) {
                navBackFromChat();
                return;
            }
        }
    });
});


function showToast(msg, type = '') {
    const toast = document.getElementById('simple-toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.className = `simple-toast active ${type}`;
    setTimeout(() => toast.classList.remove('active'), 2500);
}


function toggleEmojiPicker() {
    const modal = document.getElementById('modal-emoji-picker');
    if (modal.classList.contains('active')) {
        closeEmojiPickerModal();
    } else {
        openEmojiPickerModal();
    }
}

function openEmojiPickerModal() {
    const modal = document.getElementById('modal-emoji-picker');
    modal.classList.add('active');
    renderEmojiGrid(EMOJI_DATABASE[currentEmojiCategory] || EMOJI_DATABASE.smileys);
    document.getElementById('emoji-search-inp').value = '';
}

function closeEmojiPickerModal(e) {
    if (!e || e.target.id === 'modal-emoji-picker' || !e.target.closest('.emoji-picker-container')) {
        document.getElementById('modal-emoji-picker').classList.remove('active');
    }
}

function switchEmojiCategory(cat, btn) {
    currentEmojiCategory = cat;
    document.querySelectorAll('.emoji-nav-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('emoji-search-inp').value = '';
    renderEmojiGrid(EMOJI_DATABASE[cat] || []);
}

function filterEmojis(query) {
    const q = query.trim().toLowerCase();
    const grid = document.getElementById('emoji-grid-wrap');
    if (!q) {
        renderEmojiGrid(EMOJI_DATABASE[currentEmojiCategory] || []);
        return;
    }
    
    // Search across all emoji categories
    let all = [];
    Object.values(EMOJI_DATABASE).forEach(list => {
        all = all.concat(list);
    });
    const unique = Array.from(new Set(all));
    renderEmojiGrid(unique.slice(0, 70));
}

function renderEmojiGrid(emojis) {
    const grid = document.getElementById('emoji-grid-wrap');
    if (!grid) return;
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    emojis.forEach(em => {
        const btn = document.createElement('button');
        btn.className = 'emoji-item-btn';
        btn.innerText = em;
        btn.onclick = () => insertEmoji(em);
        frag.appendChild(btn);
    });
    grid.appendChild(frag);
}

function insertEmoji(em) {
    const input = document.getElementById('msg-input');
    if (!input) return;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const val = input.value;
    input.value = val.substring(0, start) + em + val.substring(end);
    input.selectionStart = input.selectionEnd = start + em.length;
    input.focus();
    handleInputResize(input);
}


// ══════════════════════════════════════════════════════════════════════════
// MULTI-IMAGE ALBUM / CAROUSEL CONTROLLER & TOUCH GESTURES
// ══════════════════════════════════════════════════════════════════════════
function stepCarousel(carouselId, dir, event) {
    if (event) event.stopPropagation();
    const track = document.getElementById(`track-${carouselId}`);
    const badge = document.getElementById(`badge-${carouselId}`);
    const dotsContainer = document.getElementById(`dots-${carouselId}`);
    if (!track) return;

    const slides = track.querySelectorAll('.carousel-slide');
    const total = slides.length;
    if (total <= 1) return;

    let current = parseInt(track.dataset.currentIndex || '0', 10);
    let next = current + dir;
    if (next < 0) next = total - 1;
    if (next >= total) next = 0;

    track.dataset.currentIndex = next;
    track.style.transform = `translateX(-${next * 100}%)`;

    if (badge) badge.innerText = `${next + 1} / ${total}`;
    if (dotsContainer) {
        dotsContainer.querySelectorAll('.carousel-dot').forEach((dot, idx) => {
            dot.classList.toggle('active', idx === next);
        });
    }
}

function setCarouselSlide(carouselId, index, event) {
    if (event) event.stopPropagation();
    const track = document.getElementById(`track-${carouselId}`);
    const badge = document.getElementById(`badge-${carouselId}`);
    const dotsContainer = document.getElementById(`dots-${carouselId}`);
    if (!track) return;

    const slides = track.querySelectorAll('.carousel-slide');
    const total = slides.length;
    if (total <= 1 || index < 0 || index >= total) return;

    track.dataset.currentIndex = index;
    track.style.transform = `translateX(-${index * 100}%)`;

    if (badge) badge.innerText = `${index + 1} / ${total}`;
    if (dotsContainer) {
        dotsContainer.querySelectorAll('.carousel-dot').forEach((dot, idx) => {
            dot.classList.toggle('active', idx === index);
        });
    }
}

function initCarouselTouchGestures(container, carouselId) {
    if (!container) return;
    let startX = 0;
    let startY = 0;
    let isHorizontalSwipe = false;

    container.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isHorizontalSwipe = false;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
            isHorizontalSwipe = true;
        }
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (!isHorizontalSwipe) return;
        const endX = e.changedTouches[0].clientX;
        const diffX = endX - startX;
        if (diffX > 45) {
            stepCarousel(carouselId, -1);
        } else if (diffX < -45) {
            stepCarousel(carouselId, 1);
        }
    }, { passive: true });
}

// ══════════════════════════════════════════════════════════════════════════
// TAB CUSTOMIZATION & CONFIGURABLE VISIBILITY SYSTEM
// ══════════════════════════════════════════════════════════════════════════

const DEFAULT_TAB_CONFIG = {
    'main-chats': true,
    'friends': true,
    'groups': true,
    'global': true,
    'notes': true,
    'clock': true,
    'calculator': true,
    'calendar': true,
    'compass': true,
    'news': false,
    'trending': false
};

let userTabConfig = (() => {
    try {
        const stored = localStorage.getItem('orbit_tab_preferences');
        if (stored) return { ...DEFAULT_TAB_CONFIG, ...JSON.parse(stored) };
    } catch(e) {}
    return { ...DEFAULT_TAB_CONFIG };
})();



window.showToast = showToast;
window.toggleEmojiPicker = toggleEmojiPicker;
window.openEmojiPickerModal = openEmojiPickerModal;
window.closeEmojiPickerModal = closeEmojiPickerModal;
window.switchEmojiCategory = switchEmojiCategory;
window.filterEmojis = filterEmojis;
window.insertEmoji = insertEmoji;
window.stepCarousel = stepCarousel;
window.setCarouselSlide = setCarouselSlide;
