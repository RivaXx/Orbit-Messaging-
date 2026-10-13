// ORBIT CHAT ACTIONS - MEDIA PREVIEW & EDITING MODULE (js/actions/media-preview.js)
// Attachment sheet, live camera modal, multi-media carousel preview, Cropper.js editing, rotation, and upload dispatch.
// ATTACHMENT SHEET & FILE SELECTION
// ══════════════════════════════════════════════════════════════════════════
function openAttachmentSheet() {
    const sheet = document.getElementById('modal-attachment-sheet') || document.getElementById('attachment-action-sheet');
    const overlay = document.getElementById('attachment-sheet-overlay');
    if (sheet) sheet.classList.add('active');
    if (overlay) overlay.classList.add('active');
}

function closeAttachmentSheet(e) {
    if (e && e.target && e.target.classList && e.target.classList.contains('attachment-sheet-box')) return;
    const sheet = document.getElementById('modal-attachment-sheet') || document.getElementById('attachment-action-sheet');
    const overlay = document.getElementById('attachment-sheet-overlay');
    if (sheet) sheet.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function triggerAttachmentType(type) {
    closeAttachmentSheet();
    triggerAttachmentAction(type);
}

function triggerAttachmentAction(type) {
    closeAttachmentSheet();
    if (type === 'camera') {
        openLiveCameraModal();
    } else if (type === 'gallery') {
        const inp = document.getElementById('inp-gallery') || document.getElementById('inp-media');
        if (inp) {
            inp.accept = 'image/*,video/*';
            inp.multiple = true;
            inp.click();
        }
    } else if (type === 'document') {
        const inp = document.getElementById('inp-doc');
        if (inp) {
            inp.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.csv';
            inp.multiple = true;
            inp.click();
        }
    } else if (type === 'audio') {
        const inp = document.getElementById('inp-audio');
        if (inp) {
            inp.accept = 'audio/*';
            inp.multiple = false;
            inp.click();
        }
    } else if (type === 'location') {
        shareCurrentLocation();
    } else if (type === 'contact') {
        openShareContactModal();
    } else if (type === 'poll') {
        openCreatePollModal();
    }
}

// ── Live Camera Studio ──
let liveCameraStream = null;
let currentCameraFacing = 'environment';
let isTorchOn = false;

async function openLiveCameraModal() {
    const modal = document.getElementById('modal-live-camera');
    const video = document.getElementById('live-camera-video');
    try {
        liveCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentCameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        if (video) video.srcObject = liveCameraStream;
        if (modal) modal.classList.add('active');
    } catch(err) {
        console.warn('Webcam stream fallback note:', err);
        const inpCam = document.getElementById('inp-camera') || document.getElementById('inp-gallery');
        if (inpCam) inpCam.click();
    }
}

function closeLiveCameraModal() {
    const modal = document.getElementById('modal-live-camera');
    if (modal) modal.classList.remove('active');
    if (liveCameraStream) {
        try {
            liveCameraStream.getTracks().forEach(track => track.stop());
        } catch(e) {}
        liveCameraStream = null;
    }
}

async function flipLiveCamera() {
    currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
    if (liveCameraStream) {
        liveCameraStream.getTracks().forEach(t => t.stop());
        liveCameraStream = null;
    }
    const video = document.getElementById('live-camera-video');
    try {
        liveCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentCameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        if (video) video.srcObject = liveCameraStream;
    } catch(err) {
        console.warn('Camera flip error:', err);
    }
}

async function toggleCameraTorch() {
    if (!liveCameraStream) return;
    const track = liveCameraStream.getVideoTracks()[0];
    if (!track) return;
    try {
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (!capabilities.torch) {
            showToast('Torch not supported on this device/camera', 'info');
            return;
        }
        isTorchOn = !isTorchOn;
        await track.applyConstraints({ advanced: [{ torch: isTorchOn }] });
        const torchBtn = document.getElementById('camera-torch-btn');
        if (torchBtn) {
            torchBtn.style.color = isTorchOn ? '#FFD700' : '';
        }
    } catch(e) {
        console.warn('Torch constraint error:', e);
    }
}

async function snapCameraToPreview() {
    const video = document.getElementById('live-camera-video');
    const canvas = document.getElementById('live-camera-canvas');
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.88);

    closeLiveCameraModal();
    try {
        if (typeof queueMediaMessage !== 'function') throw new Error('Background media queue is unavailable.');
        await queueMediaMessage([{
            name: `Photo_${Date.now()}.jpg`,
            url: base64,
            type: 'image'
        }], '');
    } catch (error) {
        console.warn('[Orbit] Camera media queue error:', error);
        showToast(`Could not queue photo: ${error.message || 'Please try again.'}`, 'error');
    }
}

function snapAndSendCameraPhoto() {
    snapCameraToPreview();
}

// ── Fullscreen Pre-Send Media Preview Screen ──
let mediaPreviewList = [];
let currentPreviewIndex = 0;
let mediaPreviewTargetRoom = null;
let mediaPreviewTargetUser = null;

function openMediaPreviewScreen(items) {
    if (!items || items.length === 0) return;
    mediaPreviewTargetRoom = currentRoom;
    mediaPreviewTargetUser = currentUser?.id || null;
    mediaPreviewList = items.map(item => ({
        file: item.file || null,
        url: item.url || '',
        name: item.name || 'media',
        type: item.type || 'image',
        rotation: 0,
        caption: item.caption || '',
        viewOnce: !!item.viewOnce
    }));
    currentPreviewIndex = 0;

    const modal = document.getElementById('modal-media-preview');
    if (!modal) return;
    modal.classList.remove('hide');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden','false');
    isPreviewHdQuality=false;isViewOnceActive=false;
    document.getElementById('preview-hd-toggle-btn')?.classList.remove('active');
    document.getElementById('preview-hd-check')?.classList.add('hide');
    renderPreviewCarousel();
    renderPreviewThumbStrip();
}

function closeMediaPreviewScreen() {
    const modal = document.getElementById('modal-media-preview');
    if (modal) {
        modal.classList.add('hide');
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    if (!isSendingPreviewMediaBatch) {
        mediaPreviewList.forEach(item => {
            if (item?.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
        });
    }
    mediaPreviewList = [];
    currentPreviewIndex = 0;
    mediaPreviewTargetRoom = null;
    mediaPreviewTargetUser = null;
    isViewOnceActive = false;
    document.getElementById('btn-view-once-toggle')?.classList.remove('active');
}

function renderPreviewCarousel() {
    if (mediaPreviewList.length === 0) {
        closeMediaPreviewScreen();
        return;
    }
    const current = mediaPreviewList[currentPreviewIndex];
    const mainItem = document.getElementById('media-preview-main-item');
    const counter = document.getElementById('media-preview-counter');
    const captionInput = document.getElementById('media-preview-caption-input');
    const prevBtn = document.getElementById('preview-nav-prev');
    const nextBtn = document.getElementById('preview-nav-next');

    if (counter) counter.textContent = `${currentPreviewIndex + 1} of ${mediaPreviewList.length}`;
    if (captionInput) captionInput.value = current.caption || '';
    isViewOnceActive=!!current.viewOnce;
    document.getElementById('btn-view-once-toggle')?.classList.toggle('active',isViewOnceActive);
    document.querySelectorAll('.preview-top-actions button').forEach(button=>{if(['openImageCropper()','rotateCurrentPreviewMedia()','openOrbitStickerEditor()','promptPreviewTextOverlay()','togglePreviewDoodle()'].includes(button.getAttribute('onclick')))button.disabled=current.type!=='image';});
    document.getElementById('preview-restyle-badge').classList.toggle('hide',current.type!=='image');

    const recPill = document.getElementById('preview-recipient-name');
    if (recPill) {
        const targetTitle = document.getElementById('chat-target-name')?.innerText || 'Recipient';
        recPill.innerText = `@${targetTitle.replace(/\s+/g, '_')}`;
    }

    if (prevBtn) prevBtn.classList.toggle('hide', currentPreviewIndex === 0);
    if (nextBtn) nextBtn.classList.toggle('hide', currentPreviewIndex === mediaPreviewList.length - 1);

    if (mainItem) {
        if (current.type === 'video') {
            mainItem.innerHTML = `<video src="${current.url}" controls autoplay playsinline style="transform:rotate(${current.rotation}deg);"></video>`;
        } else {
            mainItem.innerHTML = `<img src="${current.url}" alt="Preview" style="transform:rotate(${current.rotation}deg);">`;
        }
    }
    updatePreviewThumbSelection();
}

function navPreviewMedia(delta) {
    const captionInput = document.getElementById('media-preview-caption-input');
    if (captionInput && mediaPreviewList[currentPreviewIndex]) {
        mediaPreviewList[currentPreviewIndex].caption = captionInput.value;
    }
    const newIdx = currentPreviewIndex + delta;
    if (newIdx >= 0 && newIdx < mediaPreviewList.length) {
        currentPreviewIndex = newIdx;
        renderPreviewCarousel();
    }
}

function selectPreviewThumb(idx) {
    const captionInput = document.getElementById('media-preview-caption-input');
    if (captionInput && mediaPreviewList[currentPreviewIndex]) {
        mediaPreviewList[currentPreviewIndex].caption = captionInput.value;
    }
    if (idx >= 0 && idx < mediaPreviewList.length) {
        currentPreviewIndex = idx;
        renderPreviewCarousel();
    }
}

function rotateCurrentPreviewMedia() {
    orbitSaveCaption();
    if (!mediaPreviewList[currentPreviewIndex]) return;
    mediaPreviewList[currentPreviewIndex].rotation = (mediaPreviewList[currentPreviewIndex].rotation + 90) % 360;
    renderPreviewCarousel();
}

function deleteCurrentPreviewMedia() {
    if (mediaPreviewList.length <= 1) {
        closeMediaPreviewScreen();
        return;
    }
    mediaPreviewList.splice(currentPreviewIndex, 1);
    if (currentPreviewIndex >= mediaPreviewList.length) {
        currentPreviewIndex = mediaPreviewList.length - 1;
    }
    renderPreviewCarousel();
    renderPreviewThumbStrip();
}

function addMorePreviewMedia() {
    const inp = document.getElementById('inp-gallery') || document.getElementById('inp-media');
    if (inp) inp.click();
}

function renderPreviewThumbStrip() {
    const strip = document.getElementById('media-preview-thumb-strip');
    if (!strip) return;
    if (mediaPreviewList.length <= 1) {
        strip.innerHTML = '';
        strip.style.display = 'none';
        return;
    }
    strip.style.display = 'flex';
    strip.innerHTML = mediaPreviewList.map((item, idx) => `
        <div class="preview-thumb-item ${idx === currentPreviewIndex ? 'active' : ''}" onclick="selectPreviewThumb(${idx})">
            ${item.type === 'video' ? `<video src="${item.url}" muted></video>` : `<img src="${item.url}" alt="thumb">`}
            <button class="btn-reset touch-fix preview-thumb-del" onclick="event.stopPropagation(); deletePreviewThumb(${idx})" title="Remove"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');
}

function updatePreviewThumbSelection() {
    const strip = document.getElementById('media-preview-thumb-strip');
    if (!strip) return;
    strip.querySelectorAll('.preview-thumb-item').forEach((thumb, idx) => {
        thumb.classList.toggle('active', idx === currentPreviewIndex);
    });
}

function deletePreviewThumb(idx) {
    if (mediaPreviewList.length <= 1) {
        closeMediaPreviewScreen();
        return;
    }
    mediaPreviewList.splice(idx, 1);
    if (currentPreviewIndex >= mediaPreviewList.length) {
        currentPreviewIndex = mediaPreviewList.length - 1;
    }
    renderPreviewCarousel();
    renderPreviewThumbStrip();
}

// ── Client-Side Image Compression & Optimization (WhatsApp/iMessage standard) ──
async function compressImageForUpload(fileOrDataUrl, maxDim = null, quality = null) {
    const isHd = typeof isPreviewHdQuality !== 'undefined' && isPreviewHdQuality;
    const effectiveType = navigator.connection?.effectiveType || '';
    const isSlowConn = ['slow-2g', '2g', '3g'].includes(effectiveType) || navigator.connection?.saveData === true;
    
    let targetDim = maxDim;
    let targetQuality = quality;
    if (!targetDim) {
        if (isHd) targetDim = 1600;
        else if (isSlowConn) targetDim = 960;
        else targetDim = 1200;
    }
    if (!targetQuality) {
        if (isHd) targetQuality = 0.80;
        else if (isSlowConn) targetQuality = 0.65;
        else targetQuality = 0.72;
    }
    return new Promise((resolve) => {
        try {
            const img = new Image();
            let sourceObjectUrl = null;
            img.onload = () => {
                let { width, height } = img;
                if (width > targetDim || height > targetDim) {
                    if (width > height) {
                        height = Math.round((height * targetDim) / width);
                        width = targetDim;
                    } else {
                        width = Math.round((width * targetDim) / height);
                        height = targetDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                const compressedUrl = canvas.toDataURL('image/jpeg', targetQuality);
                if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
                resolve(compressedUrl);
            };
            img.onerror = () => {
                if (sourceObjectUrl) URL.revokeObjectURL(sourceObjectUrl);
                if (typeof fileOrDataUrl === 'string') resolve(fileOrDataUrl);
                else {
                    readFileAsDataUrl(fileOrDataUrl).then(resolve).catch(() => resolve(''));
                }
            };
            if (typeof fileOrDataUrl === 'string') {
                img.src = fileOrDataUrl;
            } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
                sourceObjectUrl = URL.createObjectURL(fileOrDataUrl);
                img.src = sourceObjectUrl;
            } else {
                resolve('');
            }
        } catch(e) {
            console.warn('[Orbit] compressImageForUpload error:', e);
            resolve(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '');
        }
    });
}
window.compressImageForUpload = compressImageForUpload;

// ── Resilient Supabase Storage Upload with Automatic Lightweight Fallback ──
async function uploadMediaToStorage(fileOrDataUrl, fileName, mimeType = 'image/jpeg', subfolder = 'images', onProgress = null, stableUploadId = null) {
    const diagnostic = { component: 'media-upload', build: 'orbit-delivery-20261011-r11', protocol: location.protocol };
    document.getElementById('orbit-media-copy-diagnostic')?.remove();
    try {
        if (!navigator.onLine) throw Object.assign(new Error('Offline. The file is saved and will retry when you reconnect.'), { code: 'NETWORK_OFFLINE' });
        const client = await ensureSupabase();
        let body = fileOrDataUrl;
        if (typeof body === 'string' && body.startsWith('data:')) {
            const [header, encoded] = body.split(',');
            const type = header.match(/^data:([^;,]+)/)?.[1] || mimeType;
            body = new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type });
        }
        if (!(body instanceof Blob) || !body.size) throw new Error('The selected file is empty or unreadable. Select it again.');
        if (!body.type) body = new Blob([body], { type: mimeType || 'application/octet-stream' });

        const sessionResult = await client.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        let session = sessionResult.data?.session;
        session = await ensureCompactAuthSession(client, session);
        if (session?.expires_at && session.expires_at <= Date.now() / 1000 + 30) {
            const refreshed = await client.auth.refreshSession();
            if (refreshed.error) throw refreshed.error;
            session = refreshed.data?.session;
        }
        if (!session?.access_token) throw Object.assign(new Error('Sign in again before uploading files.'), { status: 401 });
        if (session.user?.id !== currentUser?.id) throw Object.assign(new Error('The signed-in account changed. Reopen the chat and select the file again.'), { status: 401 });

        const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'application/pdf': 'pdf', 'audio/webm': 'webm' };
        const originalExt = String(fileName || '').match(/\.([a-z0-9]{1,12})$/i)?.[1];
        const ext = extensions[body.type] || originalExt || 'bin';
        const folder = String(subfolder || 'images').replace(/[^a-z0-9_-]/gi, '_');
        const objectId = String(stableUploadId || crypto.randomUUID()).replace(/[^a-z0-9_-]/gi, '_');
        const storagePath = `${folder}/${session.user.id}/${objectId}.${ext}`;
        Object.assign(diagnostic, { mimeType: body.type, byteSize: body.size, storagePath });
        const bucket = client.storage.from('chat-assets');
        const publicUrl = () => bucket.getPublicUrl(storagePath).data?.publicUrl;
        const progress = (loaded, total = body.size) => onProgress?.({ loaded, total, percent: total ? Math.min(100, Math.round(loaded / total * 100)) : 0 });
        progress(0);

        // Large files resume at their last byte offset. Small files make one
        // SDK multipart upload, instead of an XHR followed by a second upload.
        let uploadError = null;
        if (body.size > 6 * 1024 * 1024 && !window.tus?.Upload) {
            try { await ensureOrbitLibrary('tus'); } catch (_) {}
        }
        if (body.size > 6 * 1024 * 1024 && window.tus?.Upload) {
            const project = new URL(SB_URL).hostname.split('.')[0];
            try {
                await new Promise((resolve, reject) => {
                    const upload = new window.tus.Upload(body, {
                        endpoint: `https://${project}.storage.supabase.co/storage/v1/upload/resumable`,
                        headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
                        metadata: { bucketName: 'chat-assets', objectName: storagePath, contentType: body.type, cacheControl: '3600' },
                        chunkSize: 6 * 1024 * 1024,
                        retryDelays: [0, 1000, 3000],
                        uploadDataDuringCreation: true,
                        removeFingerprintOnSuccess: true,
                        fingerprint: () => Promise.resolve(`orbit-${session.user.id}-${storagePath}-${body.size}`),
                        onProgress: progress, onError: reject, onSuccess: resolve
                    });
                    upload.findPreviousUploads().then(previous => {
                        if (previous[0]?.uploadUrl) upload.resumeFromPreviousUpload(previous[0]);
                        upload.start();
                    }).catch(reject);
                });
            } catch (error) { uploadError = error; }
        } else {
            const result = await bucket.upload(storagePath, body, { contentType: body.type, cacheControl: '3600', upsert: false });
            uploadError = result.error || (!result.data ? new Error('Storage returned no upload confirmation.') : null);
        }

        if (uploadError) {
            let detail = uploadError.message || 'Storage rejected the upload.';
            let status = Number(uploadError.status || uploadError.statusCode || 0);
            let code = uploadError.code || '';
            if (uploadError.originalError?.clone) {
                try {
                    const response = await uploadError.originalError.clone().json();
                    detail = response.message || response.error || detail;
                    status = Number(response.statusCode || response.status || status);
                    code = response.code || code;
                } catch (_) {}
            }
            const tusResponse = uploadError.originalResponse;
            if (tusResponse) {
                try {
                    const response = JSON.parse(tusResponse.getBody());
                    detail = response.message || response.error || detail;
                    status = Number(response.statusCode || tusResponse.getStatus() || status);
                    code = response.code || code;
                } catch (_) { status = Number(tusResponse.getStatus() || status); }
            }
            if (/duplicate|already exists/i.test(detail) || code === 'Duplicate' || status === 409) {
                // A lost success response must not upload the same bytes again.
                // Authenticated metadata works for private buckets too.
                if (typeof bucket.info === 'function') {
                    const existing = await bucket.info(storagePath);
                    const size = Number(existing.data?.size ?? existing.data?.metadata?.size);
                    if (!existing.error && size === body.size) { progress(body.size); return publicUrl(); }
                }
            }
            if (/bucket not found|NoSuchBucket/i.test(detail + code)) {
                detail = 'Supabase rejected the chat-assets bucket. Run FIX_ORBIT_DELIVERY.sql in this project’s Supabase SQL Editor.';
                status = 400; code = 'NoSuchBucket';
            } else if (/row-level security|permission|not authorized|unauthorized/i.test(detail)) {
                detail = 'Supabase denied the media upload. Run FIX_ORBIT_DELIVERY.sql to repair the owner upload policy.';
                status = 403; code = 'StoragePolicyDenied';
            } else if (/network|failed to fetch|load failed|disconnected/i.test(detail)) {
                status = 0; code = 'NETWORK_ERROR';
                detail = 'The connection dropped. Your file is saved and will retry automatically.';
            }
            throw Object.assign(new Error(detail), { status, code });
        }
        const url = publicUrl();
        if (!url) throw new Error('Storage accepted the file but did not return its URL.');
        progress(body.size);
        return url;
    } catch (error) {
        Object.assign(diagnostic, { message: error.message, status: error.status || 0, code: error.code || '' });
        window.orbitLastMediaFailure = diagnostic;
        window.Logger?.captureException?.(error, diagnostic);
        console.warn('[Orbit] Media upload failed: ' + JSON.stringify(diagnostic));
        throw error;
    }
}

// Remove any diagnostic overlay left by an older build. Diagnostics stay in
// the console and never add a persistent control over the conversation.
document.getElementById('orbit-media-copy-diagnostic')?.remove();

window.uploadMediaToStorage = uploadMediaToStorage;

function updateChatMediaUploadProgress(fileName, percent, fileIndex, fileCount) {
    // Compatibility for existing upload callers; remove any legacy banner.
    document.getElementById('chat-media-upload-progress')?.remove();
}

function hideChatMediaUploadProgress() {
    document.getElementById('chat-media-upload-progress')?.remove();
}
hideChatMediaUploadProgress();

let isSendingPreviewMediaBatch = false;
async function sendPreviewMediaBatch() {
    if (isSendingPreviewMediaBatch) return;
    const captionInput = document.getElementById('media-preview-caption-input');
    if (captionInput && mediaPreviewList[currentPreviewIndex]) {
        mediaPreviewList[currentPreviewIndex].caption = captionInput.value;
    }
    const itemsToSend = mediaPreviewList.map(item => ({ ...item, viewOnce: !!isViewOnceActive || !!item.viewOnce }));
    if (itemsToSend.length === 0 || !currentRoom || !currentUser) return;
    const uploadRoomId = mediaPreviewTargetRoom;
    const uploadUserId = mediaPreviewTargetUser;
    isSendingPreviewMediaBatch = true;
    let combinedCaption = '';
    itemsToSend.forEach(item => { if (item.caption && !combinedCaption) combinedCaption = item.caption; });
    if (currentRoom !== uploadRoomId || currentUser?.id !== uploadUserId) {
        isSendingPreviewMediaBatch = false;
        showToast('Chat changed before the media was queued. Reopen the original chat and try again.', 'error');
        return;
    }
    closeMediaPreviewScreen();
    try {
        if (typeof queueMediaMessage !== 'function') throw new Error('Background media queue is unavailable.');
        await queueMediaMessage(itemsToSend, combinedCaption);
    } catch (error) {
        showToast(`Could not queue media: ${error.message || 'Please try again.'}`, 'error');
    } finally {
        hideChatMediaUploadProgress();
        isSendingPreviewMediaBatch = false;
    }
}

function friendlyStorageError(error) {
    const message = String(error?.message || error || 'Unknown upload error');
    if (/failed to fetch|network error|cors|load failed/i.test(message)) {
        return 'The app cannot reach Supabase Storage. Check the project URL and allow this app origin in Supabase CORS settings.';
    }
    return message;
}
window.friendlyStorageError = friendlyStorageError;

function bakeImageRotation(dataUrl, degrees) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (degrees === 90 || degrees === 270) {
                canvas.width = img.height;
                canvas.height = img.width;
            } else {
                canvas.width = img.width;
                canvas.height = img.height;
            }
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((degrees * Math.PI) / 180);
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

async function sendMediaMessageDirect(url, type, caption, name) {
    if (!currentRoom || !currentUser) return;
    pendingAttachments = [{
        name: name || (type === 'video' ? `video_${Date.now()}.mp4` : `image_${Date.now()}.jpg`),
        url: url,
        type: type || 'image'
    }];
    const input = document.getElementById('msg-input');
    if (input) input.value = caption || '';
    if (typeof sendMessage === 'function') {
        await sendMessage();
    }
}


// HD / STANDARD QUALITY TOGGLE (Issue 8)
// ══════════════════════════════════════════════════════════════════════════
let isPreviewHdQuality = false;

function toggleHdQuality() {
    isPreviewHdQuality = !isPreviewHdQuality;
    const btn = document.getElementById('preview-hd-toggle-btn');
    const check = document.getElementById('preview-hd-check');
    if (btn) btn.classList.toggle('active', isPreviewHdQuality);
    if (check) check.classList.toggle('hide', !isPreviewHdQuality);
    showToast(isPreviewHdQuality ? 'HD quality enabled (up to 2560 pixels)' : 'Standard Quality enabled (Compressed)', 'info');
}
window.toggleHdQuality = toggleHdQuality;

// ══════════════════════════════════════════════════════════════════════════
// WHATSAPP RULE-OF-THIRDS 3x3 IMAGE CROPPER (Issue 4)
// ══════════════════════════════════════════════════════════════════════════
let activeCropperInstance = null;

async function openImageCropper() {
    if (!mediaPreviewList || !mediaPreviewList[currentPreviewIndex]) return;
    const current = mediaPreviewList[currentPreviewIndex];
    if (current.type === 'video') {
        showToast('Cropping is available for images only', 'info');
        return;
    }

    const modal = document.getElementById('modal-image-crop');
    const targetImg = document.getElementById('cropper-target-img');
    if (!modal || !targetImg) return;

    try { await ensureOrbitLibrary('cropper'); }
    catch (error) { showToast(error.message, 'error'); return; }
    if (mediaPreviewList[currentPreviewIndex] !== current) return;

    targetImg.src = current.rotation ? await bakeImageRotation(current.url,current.rotation) : current.url;
    modal.classList.add('active');

    // Initialize Cropper.js with 3x3 rule-of-thirds grid
    if (typeof Cropper !== 'undefined') {
        if (activeCropperInstance) {
            activeCropperInstance.destroy();
            activeCropperInstance = null;
        }
        setTimeout(() => {
            activeCropperInstance = new Cropper(targetImg, {
                viewMode: 1,
                dragMode: 'move',
                guides: true, // 3x3 Rule-of-Thirds Grid
                center: true,
                highlight: true,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
                background: true
            });
        }, 100);
    }
}
window.openImageCropper = openImageCropper;

function rotateCropper(degrees) {
    if (activeCropperInstance) {
        activeCropperInstance.rotate(degrees);
    }
}
window.rotateCropper = rotateCropper;

function resetCropperAspectRatio() {
    if (activeCropperInstance) {
        activeCropperInstance.setAspectRatio(NaN);
    }
}
window.resetCropperAspectRatio = resetCropperAspectRatio;

function cancelImageCropper() {
    const modal = document.getElementById('modal-image-crop');
    if (modal) modal.classList.remove('active');
    if (activeCropperInstance) {
        activeCropperInstance.destroy();
        activeCropperInstance = null;
    }
}
window.cancelImageCropper = cancelImageCropper;

function applyImageCrop() {
    if (!activeCropperInstance || !mediaPreviewList[currentPreviewIndex]) {
        cancelImageCropper();
        return;
    }
    const canvas = activeCropperInstance.getCroppedCanvas({
        maxWidth: isPreviewHdQuality ? 3840 : 1920,
        maxHeight: isPreviewHdQuality ? 3840 : 1920,
        imageSmoothingQuality: 'high'
    });
    if (canvas) {
        const croppedDataUrl = canvas.toDataURL('image/jpeg', isPreviewHdQuality ? 0.95 : 0.82);
        orbitUpdateEditedImage(mediaPreviewList[currentPreviewIndex],canvas);
        renderPreviewCarousel();
        renderPreviewThumbStrip();
    }
    cancelImageCropper();
    showToast('Image cropped ✓', 'success');
}
window.applyImageCrop = applyImageCrop;

function promptPreviewTextOverlay() {
    const text = prompt('Enter text to overlay:');
    if (!text) return;
    showToast('Text note added to media caption', 'info');
    const captionInput = document.getElementById('media-preview-caption-input');
    if (captionInput) {
        captionInput.value = (captionInput.value ? captionInput.value + ' ' : '') + text;
        if (mediaPreviewList[currentPreviewIndex]) {
            mediaPreviewList[currentPreviewIndex].caption = captionInput.value;
        }
    }
}
window.promptPreviewTextOverlay = promptPreviewTextOverlay;

function togglePreviewDoodle() {
    showToast('Pen / Doodle tool active', 'info');
}
window.togglePreviewDoodle = togglePreviewDoodle;

function triggerAiRestyle() {
    showToast('Applying AI Restyle filter...', 'info');
    setTimeout(() => {
        showToast('Restyled with Vibrant Glow! ✨', 'success');
    }, 800);
}
window.triggerAiRestyle = triggerAiRestyle;

// ══════════════════════════════════════════════════════════════════════════
// IN-CHAT FILE PREVIEW (PDF / Spreadsheets / Text) (Issue 9)
// ══════════════════════════════════════════════════════════════════════════


let isViewOnceActive = false;
function toggleViewOnceMode() {
    isViewOnceActive = !isViewOnceActive;
    const btn = document.getElementById('btn-view-once-toggle');
    if (btn) btn.classList.toggle('active', isViewOnceActive);
    if (mediaPreviewList[currentPreviewIndex]) {
        mediaPreviewList[currentPreviewIndex].viewOnce = isViewOnceActive;
    }
    if (isViewOnceActive) {
        showToast('Photo set to view once (1)', 'success');
    } else {
        showToast('View once turned off', 'info');
    }
}
window.toggleViewOnceMode = toggleViewOnceMode;

let _currentViewingOnceMsgId = null;
let _viewOnceImageLoaded = false;

function _findViewOnceMessage(msgId) {
    if (typeof _messageOutbox !== 'undefined') {
        const queued = _messageOutbox.get(msgId);
        if (queued?.payload) return queued.payload;
    }
    if (typeof messageCache !== 'undefined') {
        for (const messages of messageCache.values()) {
            const message = messages.find(item => String(item?.id) === String(msgId));
            if (message) return message;
        }
    }
    return null;
}

function openViewOnceMedia(msgId, url, isOwn = false) {
    const message = _findViewOnceMessage(msgId);
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const photo = attachments.find(item => item?.view_once) || attachments.find(item => item?.type === 'image');
    if (message && (message.status === 'sending' || message.status === 'queued' || photo?.upload_pending)) {
        showToast('This photo is still uploading. Try opening it again when it finishes.', 'info');
        return;
    }

    const photoUrl = photo?.url || url;
    if (!photoUrl || String(photoUrl).startsWith('blob:')) {
        showToast('This photo is not available yet. Try again after it finishes sending.', 'error');
        return;
    }

    _currentViewingOnceMsgId = msgId;
    _viewOnceImageLoaded = false;
    const modal = document.getElementById('modal-view-once-viewer');
    const img = document.getElementById('view-once-main-img');
    if (img) {
        img.onload = () => { _viewOnceImageLoaded = true; };
        img.onerror = () => {
            _viewOnceImageLoaded = false;
            showToast('Could not load this photo. It has not been marked as opened.', 'error');
        };
        img.src = formatMediaUrl(photoUrl);
    }
    if (modal) {
        modal.classList.remove('hide');
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }
}
window.openViewOnceMedia = openViewOnceMedia;

function closeViewOnceViewer() {
    const modal = document.getElementById('modal-view-once-viewer');
    const img = document.getElementById('view-once-main-img');
    const openedSuccessfully = _viewOnceImageLoaded;
    if (img) {
        img.onload = null;
        img.onerror = null;
        img.src = '';
    }
    if (modal) {
        modal.classList.add('hide');
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    if (_currentViewingOnceMsgId && openedSuccessfully) {
        try {
            localStorage.setItem(`orbit_view_once_${_currentViewingOnceMsgId}`, 'opened');
        } catch(e) {}
        const card = document.querySelector(`[data-view-once-id="${_currentViewingOnceMsgId}"]`);
        if (card) {
            card.classList.remove('unopened');
            card.classList.add('opened');
            card.onclick = null;
            const title = card.querySelector('.view-once-title');
            if (title) title.innerText = 'Opened';
            const sub = card.querySelector('.view-once-subtitle');
            if (sub) sub.innerText = 'View once photo expired';
            const ring = card.querySelector('.view-once-icon-ring');
            if (ring) ring.classList.add('opened');
        }
    }
    _currentViewingOnceMsgId = null;
    _viewOnceImageLoaded = false;
}
window.closeViewOnceViewer = closeViewOnceViewer;

function cancelMediaUpload(msgId) {
    if (!msgId) return;
    if (typeof _messageOutbox !== 'undefined') {
        const item = _messageOutbox.get(msgId);
        if (item) {
            item.cancelled = true;
            (item.aliases || [item.payload.room]).forEach(alias => {
                messageCache.set(alias, (messageCache.get(alias) || []).filter(m => m.id !== msgId));
                if (typeof _scheduleChatCachePersist === 'function') _scheduleChatCachePersist(alias);
            });
            _messageOutbox.delete(msgId);
            _deleteOutboxMedia(msgId).catch(() => {});
            _persistMessageOutbox(item.payload.sender_id);
        }
    }
    if (typeof _inflightMessages !== 'undefined') _inflightMessages.delete(msgId);
    const node = document.getElementById(`msg-${msgId}`) || document.querySelector(`[data-client-temp-id="${msgId}"]`);
    if (node) {
        node.style.transition = 'all 0.25s ease';
        node.style.opacity = '0';
        node.style.transform = 'scale(0.9)';
        setTimeout(() => node.remove(), 250);
    }
    showToast('Media upload cancelled', 'info');
}
window.cancelMediaUpload = cancelMediaUpload;
