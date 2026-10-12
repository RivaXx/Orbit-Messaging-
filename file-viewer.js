// ORBIT CHAT ACTIONS - FILE VIEWER & ATTACHMENT HANDLERS (js/actions/file-viewer.js)
// File input handlers, formatFileSize, PDF.js viewer, SheetJS/XLSX viewer, rename & download modals.
// ── File Selection Handlers ──
async function handleMediaSelection(input) {
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files);
    const queuedItems = files.map(file => {
        const isImg = file.type.startsWith('image/');
        const isVid = file.type.startsWith('video/');
        const type = isImg ? 'image' : (isVid ? 'video' : 'file');
        return { file, name: file.name, type, size: file.size };
    });
    input.value = '';
    try {
        if (typeof queueMediaMessage !== 'function') throw new Error('Background media queue is unavailable.');
        await queueMediaMessage(queuedItems, '');
    } catch (error) {
        console.warn('[Orbit] Media queue error:', error);
        showToast(`Could not queue media: ${error.message || 'Please try again.'}`, 'error');
    }
}

async function handleDocSelection(input) {
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files);
    const selectionRoomId = currentRoom;
    const selectionUserId = currentUser?.id;
    if (!selectionRoomId || !selectionUserId || currentRoom !== selectionRoomId || currentUser?.id !== selectionUserId) {
        showToast('Open a chat before selecting files.', 'error');
        input.value = '';
        return;
    }
    const queuedItems = files.map(file => {
        const isXlsx = file.name.match(/\.(xlsx|xls|csv)$/i);
        const type = isXlsx ? 'xlsx' : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document';
        return { file, name: file.name, type, size: file.size };
    });
    try {
        if (typeof queueMediaMessage !== 'function') throw new Error('Background media queue is unavailable.');
        await queueMediaMessage(queuedItems, '');
    } catch(e) {
        console.warn('Doc queue error:', e);
        if (typeof showToast === 'function') showToast(`Could not queue file: ${e.message || 'Please try again.'}`, 'error');
    }
    input.value = '';
}

async function handleAudioSelection(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    try {
        if (typeof queueMediaMessage !== 'function') throw new Error('Background media queue is unavailable.');
        await queueMediaMessage([{ file, name: file.name || 'Voice message', type: 'audio', size: file.size }], '');
    } catch (error) {
        showToast(`Could not queue audio: ${error.message || 'Please try again.'}`, 'error');
    }
    input.value = '';
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}
window.formatFileSize = formatFileSize;

function updateMediaPreviewStrip() {
    const strip = document.getElementById('media-preview-strip');
    if (!strip) return;
    if (pendingAttachments.length === 0) {
        strip.classList.add('hide');
        strip.innerHTML = '';
        return;
    }
    strip.classList.remove('hide');
    strip.innerHTML = pendingAttachments.map((a, idx) => {
        const isImg = a.type === 'image' || (a.url && a.url.startsWith('data:image/'));
        const isVid = a.type === 'video' || (a.url && a.url.startsWith('data:video/'));
        const isAud = a.type === 'audio' || (a.url && a.url.startsWith('data:audio/'));
        const sizeStr = formatFileSize(a.size);
        const nameStr = (typeof escapeHtml === 'function') ? escapeHtml(a.name || 'Attachment') : (a.name || 'Attachment');
        const pct = (typeof a.upload_pct === 'number') ? Math.min(100, Math.max(0, a.upload_pct)) : null;

        let iconOrThumb = '';
        if (isImg) {
            iconOrThumb = `<img src="${a.url}" alt="" style="width:100%; height:100%; object-fit:cover;">`;
        } else if (isVid) {
            iconOrThumb = `<i class="fa-solid fa-film" style="color:var(--accent); font-size:15px;"></i>`;
        } else if (isAud) {
            iconOrThumb = `<i class="fa-solid fa-microphone" style="color:#00E676; font-size:15px;"></i>`;
        } else {
            iconOrThumb = `<i class="fa-solid fa-file" style="color:var(--accent); font-size:15px;"></i>`;
        }

        return `
            <div class="media-preview-chip">
                <div class="media-preview-chip-thumb">
                    ${iconOrThumb}
                </div>
                <div class="media-preview-chip-meta" style="flex:1; min-width:0;">
                    <span class="media-preview-chip-name">${nameStr}</span>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                        ${sizeStr ? `<span class="media-preview-chip-size">${sizeStr}</span>` : ''}
                        ${pct !== null ? `<span style="font-size:10px; font-weight:700; color:var(--accent);">${pct}%</span>` : ''}
                    </div>
                    ${pct !== null ? `
                        <div style="width:100%; height:3px; background:rgba(128,128,128,0.25); border-radius:2px; overflow:hidden; margin-top:3px;">
                            <div style="width:${pct}%; height:100%; background:var(--accent); border-radius:2px; transition:width 0.2s ease;"></div>
                        </div>
                    ` : ''}
                </div>
                <button type="button" class="btn-reset media-preview-chip-remove touch-fix" onclick="removePendingAttachment(${idx})" title="Remove">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    }).join('');
}

function removePendingAttachment(idx) {
    pendingAttachments.splice(idx, 1);
    updateMediaPreviewStrip();
}


// â”€â”€ Universal Spreadsheet (Excel / CSV) Viewer â”€â”€
async function openXlsxViewer(url, fileName) {
    const modal = document.getElementById('modal-xlsx-viewer');
    const container = document.getElementById('xlsx-table-container');
    const title = document.getElementById('xlsx-title');
    if (title) title.innerText = fileName || 'Spreadsheet';
    if (container) container.innerHTML = '<div style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> Parsing spreadsheet...</div>';
    if (modal) modal.classList.add('active');

    try { await ensureOrbitLibrary('xlsx'); }
    catch (error) { if (container) container.textContent = error.message; return; }
    // SheetJS parses native Excel files and quoted CSV cells correctly.
    fetch(url).then(async response => {
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        if (typeof XLSX !== 'undefined') {
            const workbook = XLSX.read(bytes, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).slice(0, 100);
        }
        return new TextDecoder().decode(bytes).split(/\r?\n/).filter(r => r.trim()).slice(0, 100).map(r => r.split(','));
    }).then(rows => {
        if (rows.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:#888;">Empty spreadsheet.</div>';
            return;
        }
        let html = '<table style="width:100%; border-collapse:collapse; font-size:12px; color:#fff;">';
        rows.forEach((row, rIdx) => {
            html += `<tr style="${rIdx === 0 ? 'background:rgba(255,255,255,0.1);font-weight:bold;' : 'border-bottom:1px solid #222;'}">`;
            row.forEach(c => {
                html += `<td style="padding:8px 12px; border:1px solid #333;">${escapeHtml(String(c ?? ''))}</td>`;
            });
            html += '</tr>';
        });
        html += '</table>';
        container.innerHTML = html;
    }).catch(e => {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:#FF453A;">Could not preview spreadsheet. Please download to view.</div>';
    });
}

function closeXlsxViewer() {
    const modal = document.getElementById('modal-xlsx-viewer');
    if (modal) modal.classList.remove('active');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function handleFileSelect(event, type) {
    const input = event.target;
    if (!input || !input.files || input.files.length === 0) return;
    if (type === 'document') {
        await handleDocSelection(input);
    } else if (type === 'audio') {
        await handleAudioSelection(input);
    } else {
        await handleMediaSelection(input);
    }
}

// ══════════════════════════════════════════════════════════════════════════

// IN-CHAT FILE PREVIEW (PDF / Spreadsheets / Text) (Issue 9)
// ══════════════════════════════════════════════════════════════════════════
let activePdfDocument = null;

async function handleDocumentFilePreview(url, fileName) {
    if (!url) return;
    if (typeof resolveMediaUrlForAccess === 'function') {
        url = await resolveMediaUrlForAccess(url) || url;
    }
    const lower = (fileName || url).toLowerCase();

    if (lower.endsWith('.pdf')) {
        openPdfViewer(url, fileName);
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
        if (typeof openXlsxViewer === 'function') {
            openXlsxViewer(url, fileName);
        } else {
            downloadWithCustomName(url, fileName);
        }
    } else if (/\.(txt|md|json|xml|html?|css|js|ts|log|ya?ml|ini|sql)$/i.test(lower)) {
        showInAppFilePreview(fileName, '<div style="padding:24px;color:#aaa;text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading preview…</div>');
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Preview failed (${response.status})`);
            const text = await response.text();
            const container = document.getElementById('xlsx-table-container');
            if (container) {
                const pre = document.createElement('pre');
                pre.textContent = text.slice(0, 1_000_000);
                pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;color:#eee;font:13px/1.55 ui-monospace,monospace;padding:16px;margin:0;';
                container.replaceChildren(pre);
            }
        } catch(e) {
            showInAppFilePreview(fileName, '<div style="padding:24px;color:#ddd;text-align:center;">Preview could not be loaded. Use the download button on the attachment.</div>');
        }
    } else if (/\.(zip|rar|7z|gz|tar|docx?|pptx?)$/i.test(lower)) {
        showInAppFilePreview(fileName, `<div style="padding:28px;color:#ddd;text-align:center;"><i class="fa-solid fa-file-lines" style="font-size:38px;color:var(--accent);"></i><p>This format needs a local preview reader that is not included in this app. Your file stays private; use Download on the attachment to open it.</p></div>`);
    } else {
        showInAppFilePreview(fileName, `<div style="padding:28px;color:#ddd;text-align:center;"><i class="fa-solid fa-file" style="font-size:38px;color:var(--accent);"></i><p>Preview is not supported for this file type yet. Use Download on the attachment.</p></div>`);
    }
}

function showInAppFilePreview(fileName, contentHtml) {
    const modal = document.getElementById('modal-xlsx-viewer');
    const title = document.getElementById('xlsx-title');
    const container = document.getElementById('xlsx-table-container');
    if (title) title.textContent = fileName || 'File preview';
    if (container) container.innerHTML = contentHtml;
    modal?.classList.add('active');
}
window.handleDocumentFilePreview = handleDocumentFilePreview;

async function openPdfViewer(url, fileName) {
    const modal = document.getElementById('modal-pdf-viewer');
    const title = document.getElementById('pdf-viewer-title');
    const canvas = document.getElementById('pdf-render-canvas');
    const dlBtn = document.getElementById('pdf-download-btn');
    if (!modal || !canvas) return;

    if (title) title.innerText = fileName || 'Document Preview';
    if (dlBtn) dlBtn.onclick = () => downloadWithCustomName(url, fileName);
    modal.classList.add('active');

    try { await ensureOrbitLibrary('pdf'); }
    catch (error) { showToast(error.message, 'error'); return; }
    if (typeof pdfjsLib !== 'undefined') {
        try {
            showToast('Loading PDF preview...', 'info');
            const loadingTask = pdfjsLib.getDocument(url);
            const pdf = await loadingTask.promise;
            activePdfDocument = pdf;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1.4 });
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            const renderCtx = {
                canvasContext: canvas.getContext('2d'),
                viewport: viewport
            };
            await page.render(renderCtx).promise;
            const pageCountEl = document.getElementById('pdf-page-count');
            if (pageCountEl) pageCountEl.innerText = `Page 1 of ${pdf.numPages}`;
        } catch(pdfErr) {
            console.warn('[Orbit] PDF render error:', pdfErr);
            showToast('Preview unavailable, downloading...', 'info');
            downloadWithCustomName(url, fileName);
            closePdfViewer();
        }
    } else {
        downloadWithCustomName(url, fileName);
        closePdfViewer();
    }
}
window.openPdfViewer = openPdfViewer;

function closePdfViewer() {
    const modal = document.getElementById('modal-pdf-viewer');
    if (modal) modal.classList.remove('active');
    activePdfDocument = null;
}
window.closePdfViewer = closePdfViewer;

// ══════════════════════════════════════════════════════════════════════════
// CUSTOM DOWNLOAD FILENAME PROMPT (Issue 9)
// ══════════════════════════════════════════════════════════════════════════
let pendingDownloadUrl = null;
let pendingDownloadName = null;

function downloadWithCustomName(url, defaultName) {
    if (!url) return;
    pendingDownloadUrl = url;
    pendingDownloadName = defaultName || 'Orbit_Download';

    const modal = document.getElementById('modal-rename-download');
    const input = document.getElementById('rename-download-input');
    if (modal && input) {
        input.value = pendingDownloadName;
        modal.classList.add('active');
        setTimeout(() => { input.focus(); input.select(); }, 120);
    } else {
        // Direct download fallback
        executeDownload(url, pendingDownloadName);
    }
}
window.downloadWithCustomName = downloadWithCustomName;

function closeRenameDownloadModal() {
    const modal = document.getElementById('modal-rename-download');
    if (modal) modal.classList.remove('active');
    pendingDownloadUrl = null;
    pendingDownloadName = null;
}
window.closeRenameDownloadModal = closeRenameDownloadModal;

function confirmRenameDownload() {
    const input = document.getElementById('rename-download-input');
    const chosenName = input?.value.trim() || pendingDownloadName || 'Orbit_Download';
    const url = pendingDownloadUrl;
    closeRenameDownloadModal();
    if (url) {
        executeDownload(url, chosenName);
    }
}
window.confirmRenameDownload = confirmRenameDownload;

function executeDownload(url, filename) {
    showToast('Downloading file...', 'info');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Map global downloadFile to downloadWithCustomName for universal user renaming
async function downloadFile(url, filename) {
    if (typeof resolveMediaUrlForAccess === 'function') {
        url = await resolveMediaUrlForAccess(url) || url;
    }
    downloadWithCustomName(url, filename);
}
window.downloadFile = downloadFile;

// ══════════════════════════════════════════════════════════════════════════
// MEDIA GALLERY TAB SWITCHING (Issue 6)
// ══════════════════════════════════════════════════════════════════════════
