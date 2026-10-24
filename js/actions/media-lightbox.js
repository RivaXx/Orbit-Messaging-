// ORBIT CHAT ACTIONS - MEDIA LIGHTBOX MODULE (js/actions/media-lightbox.js)
// Fullscreen photo/bunch gallery lightbox viewer, pinch/wheel zoom, batch navigation, and media gallery.
let currentLightboxUrl = '';
let lightboxZoomLevel = 1.0;
let currentLightboxIndex = 0;
let _batchLightboxUrls = [];

function orbitPhotoQualityBadge(photo) {
    const label = {hd:'HD',sd:'SD',original:'Original'}[photo?.quality];
    // Older messages did not record quality. Do not invent a label for them.
    return label ? `<span class="orbit-photo-quality" aria-label="Photo quality: ${label}">${label}</span>` : '';
}

// ZIP STORE: photos are already compressed. No dependency download or recompression.
async function orbitBuildPhotoZip(files) {
    const parts=[],directory=[]; let offset=0;
    const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
    for(let i=0;i<files.length;i++) {
        const file=files[i],bytes=new Uint8Array(await file.blob.arrayBuffer());
        let crc=0xffffffff;
        for(let p=0;p<bytes.length;p++){crc=table[(crc^bytes[p])&255]^(crc>>>8);if(p>0&&p%1048576===0)await new Promise(resolve=>setTimeout(resolve,0));}
        crc=(crc^0xffffffff)>>>0;
        const safe=String(file.name||'photo.jpg').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').slice(-160);
        const name=new TextEncoder().encode(String(i+1).padStart(3,'0')+'-'+safe);
        const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
        h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);
        h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);
        const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
        c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
        parts.push(header,file.blob);directory.push(central);offset+=header.length+bytes.length;
        // Yield between images so progress and chat controls continue to paint.
        await new Promise(resolve=>setTimeout(resolve,0));
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);
    e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,directory.reduce((n,b)=>n+b.length,0),true);e.setUint32(16,offset,true);
    return new Blob([...parts,...directory,end],{type:'application/zip'});
}
async function orbitDownloadAlbum(photos,button) {
    if(!Array.isArray(photos)||!photos.length||photos.length>100||button.disabled)return;
    if(photos.some(p=>p.view_once||p.storage_bucket==='orbit-view-once'))return;
    const owner=currentUser?.id,room=currentRoom,originalLabel=button.textContent;
    const current=()=>currentUser?.id===owner&&currentRoom===room&&button.isConnected;
    const files=[];let total=0;button.disabled=true;
    try {
        for(let i=0;i<photos.length;i++) {
            if(!current())throw new Error('Chat changed. Open the album and try again.');
            button.textContent=`Preparing ${i+1} of ${photos.length}…`;
            let url=photos[i].url||photos[i];
            if(typeof resolveMediaUrlForAccess==='function')url=await resolveMediaUrlForAccess(url)||url;
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
            try {
                const response=await fetch(url,{signal:controller.signal,credentials:'omit'});
                if(!response.ok)throw new Error('A photo could not be downloaded. Please retry.');
                if(total+Number(response.headers.get('content-length')||0)>100*1024*1024)throw new Error('This album is over 100 MB. Download its photos individually.');
                const reader=response.body.getReader(),chunks=[];let size=0;
                while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;total+=value.length;if(total>100*1024*1024){await reader.cancel();throw new Error('This album is over 100 MB. Download its photos individually.');}chunks.push(value);}
                files.push({name:photos[i].name||`photo-${i+1}.jpg`,blob:new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'})});
            }finally{clearTimeout(timer);}
        }
        const zip=await orbitBuildPhotoZip(files);
        if(!current())throw new Error('Chat changed. Open the album and try again.');
        const url=URL.createObjectURL(zip),link=document.createElement('a');
        link.href=url;link.download=`Orbit-photos-${new Date().toISOString().slice(0,10)}.zip`;link.className='orbit-album-download';link.textContent=`Save ZIP · ${files.length} photos`;link.onclick=e=>{e.stopPropagation();if(currentUser?.id!==owner||currentRoom!==room){e.preventDefault();URL.revokeObjectURL(url);link.remove();}};
        button.replaceWith(link);
        // A separate Save tap retains a user gesture on mobile browsers.
        setTimeout(()=>{URL.revokeObjectURL(url);if(link.isConnected)link.replaceWith(button);},300000);
    }catch(error){if(current())showToast(error.name==='AbortError'?'Photo download timed out. Please retry.':error.message,'error');}
    finally{button.disabled=false;button.textContent=originalLabel;}
}

function openMediaLightbox(url, title = 'Media') {
    currentLightboxUrl = url;
    currentLightboxIndex = 0;
    _batchLightboxUrls = [url];
    lightboxZoomLevel = 1.0;
    const modal = document.getElementById('modal-media-lightbox');
    const img = document.getElementById('lightbox-img');
    const counter = document.getElementById('lightbox-counter');
    const batchScroll = document.getElementById('lightbox-batch-scroll');
    const thumbStrip = document.getElementById('lightbox-thumbnail-strip');
    if (batchScroll) { batchScroll.style.display = 'none'; batchScroll.innerHTML = ''; }
    if (thumbStrip) { thumbStrip.style.display = 'none'; thumbStrip.innerHTML = ''; }
    if (img) {
        img.style.display = 'block';
        img.style.transform = 'scale(1)';
        img.onerror = () => retryMediaPreview(img);
        img.src = url;
    }
    if (counter) counter.innerText = '1 / 1';
    updateLightboxNavButtons();
    if (modal) {
        modal.classList.add('active');
        if (typeof initLightboxGestures === 'function' && img) {
            initLightboxGestures(modal, img);
        }
    }
}

function openBatchMediaLightbox(urlsArray, startIdx = 0) {
    if (!Array.isArray(urlsArray) || urlsArray.length === 0) return;
    _batchLightboxUrls = urlsArray.map(item => formatMediaUrl(typeof item === 'string' ? item : item.url));
    urlsArray = _batchLightboxUrls;
    currentLightboxIndex = (startIdx >= 0 && startIdx < urlsArray.length) ? startIdx : 0;
    currentLightboxUrl = _batchLightboxUrls[currentLightboxIndex];
    lightboxZoomLevel = 1.0;

    const modal = document.getElementById('modal-media-lightbox');
    if (!modal) return;

    const singleImg = document.getElementById('lightbox-img');
    if (singleImg) {
        singleImg.style.display = 'block';
        singleImg.style.transform = 'scale(1)';
        singleImg.onerror = () => retryMediaPreview(singleImg);
        singleImg.src = currentLightboxUrl;
    }

    // Thumbnail filmstrip
    const thumbStrip = document.getElementById('lightbox-thumbnail-strip');
    if (thumbStrip) {
        if (urlsArray.length > 1) {
            thumbStrip.style.display = 'flex';
            thumbStrip.innerHTML = urlsArray.map((u, i) => `
                <img src="${u}" onerror="retryMediaPreview(this)" class="lightbox-thumb-item ${i === currentLightboxIndex ? 'active' : ''}"
                     id="lb-thumb-${i}" alt="Thumb ${i + 1}"
                     onclick="showLightboxImageAtIndex(${i}); event.stopPropagation();">
            `).join('');
        } else {
            thumbStrip.style.display = 'none';
            thumbStrip.innerHTML = '';
        }
    }

    const counter = document.getElementById('lightbox-counter');
    if (counter) counter.innerText = `${currentLightboxIndex + 1} / ${urlsArray.length}`;
    updateLightboxNavButtons();

    modal.classList.add('active');
    if (typeof initLightboxGestures === 'function' && singleImg) {
        initLightboxGestures(modal, singleImg);
    }
}

function openBatchLightbox(urlsArray, startIdx = 0) {
    openBatchMediaLightbox(urlsArray, startIdx);
}
window.openBatchLightbox = openBatchLightbox;
window.openBatchMediaLightbox = openBatchMediaLightbox;

function showLightboxImageAtIndex(idx) {
    if (!_batchLightboxUrls || !_batchLightboxUrls[idx]) return;
    currentLightboxIndex = idx;
    currentLightboxUrl = _batchLightboxUrls[idx];
    lightboxZoomLevel = 1.0;

    const singleImg = document.getElementById('lightbox-img');
    if (singleImg) {
        singleImg.style.transform = 'scale(1)';
        singleImg.onerror = () => retryMediaPreview(singleImg);
        singleImg.src = currentLightboxUrl;
    }

    const counter = document.getElementById('lightbox-counter');
    if (counter) counter.innerText = `${currentLightboxIndex + 1} / ${_batchLightboxUrls.length}`;
    updateLightboxNavButtons();

    // Update active thumbnail
    const thumbs = document.querySelectorAll('.lightbox-thumb-item');
    thumbs.forEach((t, i) => {
        if (i === idx) {
            t.classList.add('active');
            t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            t.classList.remove('active');
        }
    });
}

function nextLightboxImage(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!_batchLightboxUrls || _batchLightboxUrls.length <= 1) return;
    currentLightboxIndex = (currentLightboxIndex + 1) % _batchLightboxUrls.length;
    showLightboxImageAtIndex(currentLightboxIndex);
}

function prevLightboxImage(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!_batchLightboxUrls || _batchLightboxUrls.length <= 1) return;
    currentLightboxIndex = (currentLightboxIndex - 1 + _batchLightboxUrls.length) % _batchLightboxUrls.length;
    showLightboxImageAtIndex(currentLightboxIndex);
}

function updateLightboxNavButtons() {
    const prevBtn = document.getElementById('lightbox-prev-btn');
    const nextBtn = document.getElementById('lightbox-next-btn');
    const isMulti = _batchLightboxUrls && _batchLightboxUrls.length > 1;
    if (prevBtn) prevBtn.style.display = isMulti ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = isMulti ? 'flex' : 'none';
}

function zoomLightboxIn(e) {
    if (e) e.stopPropagation();
    lightboxZoomLevel = Math.min(3.0, lightboxZoomLevel + 0.3);
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = `scale(${lightboxZoomLevel})`;
}

function zoomLightboxOut(e) {
    if (e) e.stopPropagation();
    lightboxZoomLevel = Math.max(0.5, lightboxZoomLevel - 0.3);
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = `scale(${lightboxZoomLevel})`;
}

function closeMediaLightbox(e) {
    if (e && e.target && e.target.closest('button')) return;
    const modal = document.getElementById('modal-media-lightbox');
    if (modal) modal.classList.remove('active');
    currentLightboxUrl = '';
    lightboxZoomLevel = 1.0;
    _batchLightboxUrls = [];
    const singleImg = document.getElementById('lightbox-img');
    if (singleImg) singleImg.style.display = 'block';
    const batchScroll = document.getElementById('lightbox-batch-scroll');
    if (batchScroll) { batchScroll.style.display = 'none'; batchScroll.innerHTML = ''; }
}

function downloadCurrentLightboxMedia() {
    if (!currentLightboxUrl) return;
    const ext = currentLightboxUrl.startsWith('data:image/png') ? '.png' : '.jpg';
    downloadFile(currentLightboxUrl, `Orbit_Image_${Date.now()}${ext}`);
}

// Global Keyboard & Touch Listeners for Lightbox
document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modal-media-lightbox');
    if (!modal || !modal.classList.contains('active')) return;
    if (e.key === 'ArrowRight') nextLightboxImage(e);
    if (e.key === 'ArrowLeft') prevLightboxImage(e);
    if (e.key === 'Escape') closeMediaLightbox();
});

let _lbTouchStartX = 0;
let _lbTouchStartY = 0;
let _lbSwipeAllowed = false;
document.addEventListener('touchstart', (e) => {
    const modal = document.getElementById('modal-media-lightbox');
    if (!modal || !modal.classList.contains('active') || !e.touches || e.touches.length === 0) return;
    _lbSwipeAllowed = e.touches.length === 1 && lightboxZoomLevel <= 1.05 && !e.target.closest('button,input,a,#lightbox-thumbnail-strip');
    _lbTouchStartX = e.touches[0].clientX;
    _lbTouchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', e => {if(e.touches?.length>1)_lbSwipeAllowed=false;}, {passive:true});
document.addEventListener('touchcancel', () => {_lbSwipeAllowed=false;}, {passive:true});
document.addEventListener('touchend', (e) => {
    const modal = document.getElementById('modal-media-lightbox');
    if (!modal || !modal.classList.contains('active') || !e.changedTouches || e.changedTouches.length === 0) return;
    if (!_lbSwipeAllowed || lightboxZoomLevel > 1.05) return;
    _lbSwipeAllowed = false;
    const deltaX = e.changedTouches[0].clientX - _lbTouchStartX;
    const deltaY = e.changedTouches[0].clientY - _lbTouchStartY;
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (deltaX < 0) nextLightboxImage();
        else prevLightboxImage();
    }
}, { passive: true });

// ══════════════════════════════════════════════════════════════════════════

function resetLightboxZoom(event) {
    if (event) event.stopPropagation();
    lightboxZoomLevel = 1.0;
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = 'scale(1)';
}

function handleLightboxWheel(event) {
    if (!event) return;
    event.preventDefault();
    if (event.deltaY < 0) zoomLightboxIn(event);
    else zoomLightboxOut(event);
}

function toggleLightboxZoom(event) {
    if (event) event.stopPropagation();
    lightboxZoomLevel = lightboxZoomLevel === 1.0 ? 2.0 : 1.0;
    const img = document.getElementById('lightbox-img');
    if (img) img.style.transform = `scale(${lightboxZoomLevel})`;
}


// LIGHTBOX EXTERNAL SHARE & CHAT MEDIA GALLERY
// ══════════════════════════════════════════════════════════════════════════
function shareCurrentLightboxMedia() {
    if (!currentLightboxUrl) return;
    if (typeof shareMediaExternal === 'function') {
        shareMediaExternal(currentLightboxUrl, 'Orbit Media');
    } else if (navigator.share) {
        navigator.share({ title: 'Orbit Media', url: currentLightboxUrl }).catch(() => {});
    }
}
window.shareCurrentLightboxMedia = shareCurrentLightboxMedia;

function openChatMediaGallery() {
    if (!currentRoom) return;
    const modal = document.getElementById('modal-chat-media-gallery');
    const grid = document.getElementById('chat-media-grid');
    const countEl = document.getElementById('chat-gallery-count');
    if (!modal || !grid) return;

    let mediaItems = [];
    if (typeof messageCache !== 'undefined' && messageCache.has(currentRoom)) {
        const msgs = messageCache.get(currentRoom) || [];
        msgs.forEach(m => {
            if(orbitIsViewOnceMessage(m))return;
            if (Array.isArray(m.attachments) && m.attachments.length > 0) {
                m.attachments.forEach(att => {
                    const u = typeof att === 'string' ? att : (att.url || att.file_url);
                    if (u) mediaItems.push({ url: formatMediaUrl(u), created_at: m.created_at });
                });
            } else if (m.type === 'image' && m.text && m.text.startsWith('http')) {
                mediaItems.push({ url: formatMediaUrl(m.text), created_at: m.created_at });
            }
        });
    }

    if (countEl) countEl.innerText = `${mediaItems.length} item${mediaItems.length === 1 ? '' : 's'}`;

    if (mediaItems.length === 0) {
        grid.innerHTML = '<div style="grid-column:span 3; text-align:center; padding:40px 20px; color:var(--text-muted); font-size:13px;">No media shared in this chat yet.</div>';
    } else {
        const allUrls = mediaItems.map(m => m.url);
        if (!window._orbitBatches) window._orbitBatches = {};
        window._orbitBatches['gallery_' + currentRoom] = allUrls;

        grid.innerHTML = mediaItems.map((item, idx) => `
            <div class="media-gallery-grid-item" onclick="closeChatMediaGallery(); openBatchLightbox(window._orbitBatches['gallery_${currentRoom}'], ${idx});">
                <img src="${item.url}" alt="Media" loading="lazy">
            </div>
        `).join('');
    }

    modal.classList.add('active');
}
window.openChatMediaGallery = openChatMediaGallery;

function closeChatMediaGallery() {
    const modal = document.getElementById('modal-chat-media-gallery');
    if (modal) modal.classList.remove('active');
}
window.closeChatMediaGallery = closeChatMediaGallery;

// ══════════════════════════════════════════════════════════════════════════
// COPY CURRENT LIGHTBOX IMAGE TO CLIPBOARD (Issue 7)
// ══════════════════════════════════════════════════════════════════════════
async function copyCurrentLightboxMedia() {
    if (!currentLightboxUrl) {
        showToast('No image to copy');
        return;
    }
    showToast('Copying image...', 'info');
    try {
        // Try Blob copy to system clipboard
        const resp = await fetch(currentLightboxUrl);
        const blob = await resp.blob();
        
        let pngBlob = blob;
        if (blob.type !== 'image/png') {
            // Convert to PNG via canvas for maximum browser clipboard compatibility
            pngBlob = await new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(b => resolve(b), 'image/png');
                };
                img.onerror = () => resolve(blob);
                img.src = currentLightboxUrl;
            });
        }

        if (navigator.clipboard && navigator.clipboard.write) {
            await navigator.clipboard.write([
                new ClipboardItem({ [pngBlob.type]: pngBlob })
            ]);
            showToast('Image copied to clipboard! ✓', 'success');
            return;
        }
        throw new Error('ClipboardItem not supported');
    } catch(err) {
        // Fallback: copy media URL to clipboard
        try {
            await navigator.clipboard.writeText(currentLightboxUrl);
            showToast('Image link copied to clipboard! ✓', 'success');
        } catch(fallbackErr) {
            showToast('Unable to copy image');
        }
    }
}
window.copyCurrentLightboxMedia = copyCurrentLightboxMedia;

// ══════════════════════════════════════════════════════════════════════════
// HD / STANDARD QUALITY TOGGLE (Issue 8)
// ══════════════════════════════════════════════════════════════════════════

// MEDIA GALLERY TAB SWITCHING (Issue 6)
// ══════════════════════════════════════════════════════════════════════════
let currentGalleryTab = 'media';

function switchGalleryTab(tab) {
    currentGalleryTab = tab;
    document.querySelectorAll('.gallery-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === `gallery-tab-${tab}`);
    });
    renderFilteredGallery(tab);
}
window.switchGalleryTab = switchGalleryTab;

function renderFilteredGallery(tab) {
    if (!currentRoom) return;
    const grid = document.getElementById('chat-media-grid');
    const countEl = document.getElementById('chat-gallery-count');
    if (!grid) return;

    const msgs = (typeof messageCache !== 'undefined' && messageCache.get(currentRoom)) || [];
    let items = [];

    if (tab === 'media') {
        msgs.forEach(m => {
            if(orbitIsViewOnceMessage(m))return;
            if (Array.isArray(m.attachments)) {
                m.attachments.forEach(att => {
                    const u = typeof att === 'string' ? att : (att.url || att.file_url);
                    const isImg = att.type === 'image' || (!att.type && typeof u === 'string' && u.match(/\.(jpeg|jpg|png|gif|webp)/i));
                    const isVid = att.type === 'video' || (!att.type && typeof u === 'string' && u.match(/\.(mp4|webm|mov)/i));
                    if (u && (isImg || isVid)) items.push({ url: formatMediaUrl(u), isVid });
                });
            } else if (m.type === 'image' && m.text && m.text.startsWith('http')) {
                items.push({ url: formatMediaUrl(m.text), isVid: false });
            }
        });
        if (countEl) countEl.innerText = `${items.length} item${items.length === 1 ? '' : 's'}`;
        if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column:span 3; text-align:center; padding:40px 20px; color:var(--text-muted); font-size:13px;">No photos or videos shared yet.</div>';
        } else {
            const allUrls = items.map(i => i.url);
            if (!window._orbitBatches) window._orbitBatches = {};
            window._orbitBatches['gallery_' + currentRoom] = allUrls;
            grid.innerHTML = items.map((item, idx) => `
                <div class="media-gallery-grid-item" onclick="closeChatMediaGallery(); openBatchLightbox(window._orbitBatches['gallery_${currentRoom}'], ${idx});">
                    ${item.isVid ? `<video src="${item.url}" muted></video>` : `<img src="${item.url}" alt="Media" loading="lazy">`}
                </div>
            `).join('');
        }
    } else if (tab === 'docs') {
        msgs.forEach(m => {
            if(orbitIsViewOnceMessage(m))return;
            if (Array.isArray(m.attachments)) {
                m.attachments.forEach(att => {
                    const u = typeof att === 'string' ? att : (att.url || att.file_url);
                    const isDoc = att.type === 'document' || att.type === 'file' || (typeof u === 'string' && u.match(/\.(pdf|xlsx|xls|doc|docx|txt)/i));
                    if (u && isDoc) items.push({ url: formatMediaUrl(u), name: att.name || 'Document' });
                });
            }
        });
        if (countEl) countEl.innerText = `${items.length} doc${items.length === 1 ? '' : 's'}`;
        if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column:span 3; text-align:center; padding:40px 20px; color:var(--text-muted); font-size:13px;">No documents shared yet.</div>';
        } else {
            grid.innerHTML = items.map(item => `
                <div class="contact-glass-card touch-fix" style="grid-column:span 3; margin-bottom:4px; padding:10px 12px; cursor:pointer;" onclick="handleDocumentFilePreview('${item.url}', ${escapeHtml(JSON.stringify(item.name))})">
                    <div class="doc-card-icon" style="background:rgba(127,87,255,0.2); color:#7F57FF;"><i class="fa-solid fa-file-lines"></i></div>
                    <div class="doc-card-info">
                        <div class="doc-card-name">${escapeHtml(item.name)}</div>
                        <div class="doc-card-meta">Document · Tap to preview</div>
                    </div>
                </div>
            `).join('');
        }
    } else if (tab === 'links') {
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
        msgs.forEach(m => {
            if(orbitIsViewOnceMessage(m))return;
            if (m.text && typeof m.text === 'string') {
                const matches = m.text.match(urlRegex);
                if (matches) {
                    matches.forEach(u => items.push({ url: u, text: m.text }));
                }
            }
        });
        if (countEl) countEl.innerText = `${items.length} link${items.length === 1 ? '' : 's'}`;
        if (items.length === 0) {
            grid.innerHTML = '<div style="grid-column:span 3; text-align:center; padding:40px 20px; color:var(--text-muted); font-size:13px;">No web links shared yet.</div>';
        } else {
            grid.innerHTML = items.map(item => `
                <div class="contact-glass-card touch-fix" style="grid-column:span 3; margin-bottom:4px; padding:10px 12px;" onclick="window.open(${escapeHtml(JSON.stringify(item.url))}, '_blank', 'noopener,noreferrer')">
                    <div class="doc-card-icon" style="background:rgba(0,176,255,0.2); color:#00B0FF;"><i class="fa-solid fa-link"></i></div>
                    <div class="doc-card-info">
                        <div class="doc-card-name" style="color:var(--accent);">${escapeHtml(item.url)}</div>
                        <div class="doc-card-meta">Shared Link · Tap to open</div>
                    </div>
                </div>
            `).join('');
        }
    }
}
window.renderFilteredGallery = renderFilteredGallery;
