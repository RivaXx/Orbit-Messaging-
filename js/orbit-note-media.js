/* Note attachments and recurrence helpers, shared with the Android WebView. */
const OrbitNoteMedia = (() => {
    const types = {photo:['image/jpeg','image/png','image/webp'], drawing:['image/png'],
        sticker:['image/webp','image/png'], gif:['image/gif','image/webp'],
        voice:['audio/webm','audio/mp4','audio/ogg'], sealed:['application/octet-stream']};
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const maxSize = 12 * 1024 * 1024;
    const path = (owner,id) => owner + '/' + id;
    const valid = asset => uuid.test(asset?.id || '') && types[asset.kind]?.includes(asset.mime);
    const assetList = row => Array.isArray(row?.attachments) ? row.attachments.filter(valid) : [];
    const bucket = client => client.storage.from('orbit-note-attachments');
    const mime = value => value.split(';')[0].toLowerCase();

    async function add(owner, kind, blob, locked) {
        const format = mime(blob.type);
        if (!types[kind]?.includes(format)) throw Error('This file format is unavailable for ' + kind + '.');
        if (blob.size < 1 || blob.size > maxSize) throw Error('Choose a file between 1 byte and 12 MB.');
        const asset = {id:OrbitNoteStore.id(),kind,mime:format};
        const normalized = blob.slice(0,blob.size,format);
        await OrbitNoteStore.putBlob(owner,asset.id,locked ? await OrbitNoteLock.encryptBlob(locked,asset.id,normalized) : normalized);
        return asset;
    }
    async function upload(owner, row, client) {
        for (const asset of assetList(row)) {
            const cached = await OrbitNoteStore.getBlob(owner,asset.id);
            if (!cached || cached.synced) continue;
            const key = path(owner,asset.id);
            const {error} = await bucket(client).upload(key,cached.blob,{upsert:false,contentType:asset.mime});
            if (error && !['409','Duplicate','ResourceAlreadyExists'].includes(String(error.statusCode || error.code))) throw error;
            await OrbitNoteStore.putBlob(owner,asset.id,cached.blob,true);
        }
    }
    async function read(owner,asset,client,locked) {
        if (!valid(asset)) throw Error('Invalid attachment.');
        const cached = await OrbitNoteStore.getBlob(owner,asset.id);
        if (cached) return locked ? OrbitNoteLock.decryptBlob(locked,asset,cached.blob) : cached.blob;
        const {data,error} = await bucket(await client()).download(path(owner,asset.id));
        if (error) throw error;
        if (!data || data.size > maxSize + 28) throw Error('Attachment exceeds the download limit.');
        const blob = data.slice(0,data.size,locked ? "application/octet-stream" : asset.mime);
        try {await OrbitNoteStore.putBlob(owner,asset.id,blob,true);} catch (_) {}
        return locked ? OrbitNoteLock.decryptBlob(locked,asset,blob) : blob;
    }
    let ocrScript;
    async function recognize(blob,onProgress) {
        ocrScript ||= new Promise((resolve,reject) => {
            const script = document.createElement('script');
            script.src = 'assets/notes-ocr/tesseract.min.js';
            script.onload = resolve;
            script.onerror = () => reject(Error('The offline OCR engine could not load.'));
            document.head.append(script);
        }).catch(error => {ocrScript = null; throw error;});
        await ocrScript;
        const base = new URL('assets/notes-ocr/',location.href).href;
        const worker = await globalThis.Tesseract.createWorker('eng',1,{
            workerPath:base + 'worker.min.js',corePath:base + 'tesseract-core-lstm.wasm.js',
            langPath:base,gzip:!window.OrbitDevice,workerBlobURL:false,logger:update => onProgress(update)
        });
        try {return (await worker.recognize(blob)).data.text.trim();}
        finally {await worker.terminate();}
    }
    const recurrence = rule => ['daily','weekly'].includes(rule?.repeat) ? rule.repeat : 'none';
    function calendarParts(time, zone) {
        const format = new Intl.DateTimeFormat('en-CA',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'numeric',
            day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
        const parts = Object.fromEntries(format.formatToParts(time).map(({type,value}) => [type,Number(value)]));
        return Date.UTC(parts.year,parts.month - 1,parts.day,parts.hour,parts.minute,parts.second);
    }
    function occurrence(row, now = Date.now()) {
        const anchor = Date.parse(row.reminder_at), snoozed = Date.parse(row.reminder_rule?.snooze);
        if (!Number.isFinite(anchor)) return null;
        if (snoozed > now) return snoozed;
        const repeat = recurrence(row.reminder_rule);
        if (repeat === 'none') return Number.isFinite(snoozed) ? snoozed : anchor;
        if (anchor >= now) return anchor;
        try {
            const zone = row.reminder_rule.zone || 'UTC';
            const step = 86400000 * (repeat === 'weekly' ? 7 : 1);
            const first = calendarParts(anchor,zone);
            const wallTime = first + Math.max(0,Math.ceil((calendarParts(now,zone) - first) / step)) * step;
            const convert = wall => {
                const candidate = probe => wall - (calendarParts(probe,zone) - probe);
                const before = candidate(wall - 86400000), after = candidate(wall + 86400000);
                return calendarParts(after,zone) === wall ? after : before;
            };
            const due = convert(wallTime);
            return due < now ? convert(wallTime + step) : due;
        } catch (_) {return anchor;}
    }

    function links(text) {
        const urls = [];
        for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/ig)) {
            try {
                const link = new URL(match[0].replace(/[.,;!?)]*$/,''));
                if (link.username || link.password || urls.some(value => value.href === link.href)) continue;
                urls.push(link);
                if (urls.length === 3) break;
            } catch (_) {}
        }
        return urls;
    }
    return {add,read,upload,assetList,recognize,recurrence,occurrence,links,maxSize};
})();
