// ══════════════════════════════════════════════════════════════════════════
// ORBIT CHAT GESTURES MODULE (js/chat-gestures.js)
// Specialized gesture engine for:
// 1. Swipe-to-reply on message bubbles with dynamic bubble-relative indicator
// 2. Rubber-band drag physics (0 to 60px), 48px threshold, 25ms haptic feedback
// 3. Double-tap to quick react with ❤️
// 4. Lightbox pinch-to-zoom & swipe-down-to-dismiss
// ══════════════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    /**
     * Attaches swipe-to-reply and double-tap reaction gestures to a message bubble row.
     * Works seamlessly on sent (.own) and received (.other) messages across text,
     * image, audio/voice note, video, and document bubbles.
     */
    function attachSlideToReplyAndReactionGesture(rowNode, msg) {
        if (!rowNode || !msg) return;
        const card = rowNode.querySelector('.msg-bubble-card');
        if (!card) return;

        // Ensure bubble wrapper exists or position indicator adjacent to card
        let indicator = rowNode.querySelector('.reply-slide-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'reply-slide-indicator';
            indicator.innerHTML = '<i class="fa-solid fa-reply"></i>';
            card.parentNode.insertBefore(indicator, card);
        }

        let startX = 0;
        let startY = 0;
        let currentX = 0;
        let isDragging = false;
        let isHorizontalSwipe = null;
        let thresholdTriggered = false;
        let lastTapTime = 0;
        let longPressTimer = null;

        function resetBubble(animated = true) {
            card.classList.remove('swiping');
            if (animated) {
                card.classList.add('returning');
                setTimeout(() => card.classList.remove('returning'), 280);
            }
            card.style.transform = '';
            if (indicator) {
                indicator.style.opacity = '0';
                indicator.style.transform = 'translateY(-50%) scale(0.6)';
                indicator.classList.remove('active');
            }
            currentX = 0;
            isDragging = false;
            isHorizontalSwipe = null;
            thresholdTriggered = false;
        }

        // ── Double-Tap to React (❤️) ──
        card.addEventListener('click', (e) => {
            // Ignore click if interactive element inside bubble
            if (e.target.closest('button, a, input, video, audio, .wa-image-bunch-grid, .poll-option-row, .poll-card-bubble, .quoted-reply-box, .file-preview-card')) return;
            const now = Date.now();
            if (now - lastTapTime < 300) {
                // Double tap detected!
                lastTapTime = 0;
                if (navigator.vibrate) {
                    try { navigator.vibrate(25); } catch(err) {}
                }
                if (typeof toggleMessageReaction === 'function') {
                    toggleMessageReaction(msg.id, '❤️');
                }
                showHeartBurst(card);
            } else {
                lastTapTime = now;
            }
        });

        // ── Touch Events (Mobile) ──
        card.addEventListener('touchstart', e => {
            if (e.target.closest('button, a, input, video, audio, .poll-option-row, .poll-card-bubble, .quoted-reply-box, .file-preview-card')) return;
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            currentX = 0;
            isDragging = false;
            isHorizontalSwipe = null;
            thresholdTriggered = false;

            // Long press for reaction menu
            clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
                if (!isDragging && isHorizontalSwipe !== true) {
                    if (navigator.vibrate) {
                        try { navigator.vibrate(25); } catch(err) {}
                    }
                    if (typeof showQuickReactionPicker === 'function') {
                        showQuickReactionPicker(rowNode, msg);
                    }
                }
            }, 500);
        }, { passive: true });

        card.addEventListener('touchmove', e => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            const diffX = touch.clientX - startX;
            const diffY = touch.clientY - startY;

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

            // Swiping right towards reply (diffX > 0)
            if (diffX > 0) {
                isDragging = true;
                card.classList.add('swiping');
                card.classList.remove('returning');

                // Logarithmic rubber-band resistance (clamped between 0 and 70px)
                const clampedX = Math.min(diffX * 0.65, 70);
                currentX = clampedX;
                card.style.transform = `translateX(${clampedX}px)`;

                if (indicator) {
                    const progress = Math.min(1, clampedX / 48);
                    indicator.style.opacity = `${progress}`;
                    indicator.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * progress})`;

                    if (clampedX >= 48) {
                        indicator.classList.add('active');
                        if (!thresholdTriggered) {
                            thresholdTriggered = true;
                            if (navigator.vibrate) {
                                try { navigator.vibrate(25); } catch(err) {}
                            }
                        }
                    } else {
                        indicator.classList.remove('active');
                        thresholdTriggered = false;
                    }
                }
            }
        }, { passive: true });

        card.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
            if (isDragging && currentX >= 48) {
                // Trigger reply preview
                if (typeof setReplyTarget === 'function') {
                    setReplyTarget(msg);
                } else if (typeof replyToMessage === 'function') {
                    replyToMessage(msg.id, msg.username, msg.text || 'Attachment');
                }
            }
            resetBubble(true);
        }, { passive: true });

        card.addEventListener('touchcancel', () => {
            clearTimeout(longPressTimer);
            resetBubble(true);
        }, { passive: true });

        // ── Mouse Drag Events (Desktop) ──
        card.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target.closest('button, a, input, video, audio, .wa-image-bunch-grid, .poll-option-row, .poll-card-bubble, .quoted-reply-box, .file-preview-card')) return;

            startX = e.clientX;
            startY = e.clientY;
            currentX = 0;
            isDragging = false;
            isHorizontalSwipe = null;
            thresholdTriggered = false;

            clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
                if (!isDragging) {
                    if (typeof showQuickReactionPicker === 'function') {
                        showQuickReactionPicker(rowNode, msg);
                    }
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

                    const clampedX = Math.min(diffX * 0.65, 70);
                    currentX = clampedX;
                    card.style.transform = `translateX(${clampedX}px)`;

                    if (indicator) {
                        const progress = Math.min(1, clampedX / 48);
                        indicator.style.opacity = `${progress}`;
                        indicator.style.transform = `translateY(-50%) scale(${0.6 + 0.4 * progress})`;

                        if (clampedX >= 48) {
                            indicator.classList.add('active');
                            if (!thresholdTriggered) {
                                thresholdTriggered = true;
                                if (navigator.vibrate) {
                                    try { navigator.vibrate(25); } catch(err) {}
                                }
                            }
                        } else {
                            indicator.classList.remove('active');
                            thresholdTriggered = false;
                        }
                    }
                }
            }

            function onMouseUp() {
                clearTimeout(longPressTimer);
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                if (isDragging && currentX >= 48) {
                    if (typeof setReplyTarget === 'function') {
                        setReplyTarget(msg);
                    } else if (typeof replyToMessage === 'function') {
                        replyToMessage(msg.id, msg.username, msg.text || 'Attachment');
                    }
                }
                resetBubble(true);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    /**
     * Heart burst visual effect for double tap reaction
     */
    function showHeartBurst(card) {
        const heart = document.createElement('div');
        heart.className = 'heart-burst-anim';
        heart.innerHTML = '❤️';
        card.appendChild(heart);
        setTimeout(() => heart.remove(), 700);
    }

    /**
     * Lightbox gestures: swipe-down-to-dismiss & pinch-to-zoom
     */
    function initLightboxGestures(modalEl, imgEl) {
        if (!modalEl || !imgEl) return;

        let touchStartY = 0;
        let touchDiffY = 0;
        let isSwipingDown = false;
        let initialPinchDist = 0;
        let initialScale = 1.0;

        modalEl.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                touchStartY = e.touches[0].clientY;
                touchDiffY = 0;
                isSwipingDown = false;
            } else if (e.touches.length === 2) {
                // Pinch start
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                initialScale = window.lightboxZoomLevel || 1.0;
            }
        }, { passive: true });

        modalEl.addEventListener('touchmove', e => {
            if (e.touches.length === 1 && (!window.lightboxZoomLevel || window.lightboxZoomLevel <= 1.05)) {
                touchDiffY = e.touches[0].clientY - touchStartY;
                if (touchDiffY > 20) {
                    isSwipingDown = true;
                    const opacity = Math.max(0.3, 1 - (touchDiffY / 400));
                    modalEl.style.backgroundColor = `rgba(0, 0, 0, ${opacity * 0.95})`;
                    imgEl.style.transform = `translateY(${touchDiffY * 0.8}px) scale(${Math.max(0.75, 1 - touchDiffY / 600)})`;
                }
            } else if (e.touches.length === 2 && initialPinchDist > 0) {
                // Pinch zoom
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                const scaleRatio = dist / initialPinchDist;
                const newScale = Math.min(Math.max(0.8, initialScale * scaleRatio), 4.0);
                window.lightboxZoomLevel = newScale;
                imgEl.style.transform = `scale(${newScale})`;
            }
        }, { passive: true });

        modalEl.addEventListener('touchend', e => {
            if (isSwipingDown) {
                if (touchDiffY > 120) {
                    if (typeof closeMediaLightbox === 'function') {
                        closeMediaLightbox();
                    } else {
                        modalEl.classList.remove('active');
                    }
                }
                modalEl.style.backgroundColor = '';
                imgEl.style.transform = '';
                isSwipingDown = false;
            }
            initialPinchDist = 0;
        }, { passive: true });
    }

    // Expose globally
    window.OrbitGestures = {
        attachSlideToReplyAndReactionGesture,
        initLightboxGestures
    };
    window.attachSlideToReplyAndReactionGesture = attachSlideToReplyAndReactionGesture;
    window.initLightboxGestures = initLightboxGestures;
})();
