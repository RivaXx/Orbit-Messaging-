const OrbitNotePortability = (() => {
    const loaded = new Map();
    const MAX = 30 * 1024 * 1024;
    const mimeBySuffix = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',
        webm:'audio/webm',ogg:'audio/ogg',mp4:'audio/mp4',m4a:'audio/mp4'};
    const enc = new TextEncoder(), dec = new TextDecoder();
    function load(name) {
        if (!loaded.has(name)) loaded.set(name,new Promise((resolve,reject) => {
            const tag = document.createElement('script');
            tag.src = 'assets/vendor/notes-' + name + '.js';
            tag.onload = resolve;tag.onerror = () => reject(Error('The Notes ' + name + ' module could not load.'));
            document.head.append(tag);
        }).catch(error => {loaded.delete(name);throw error;}));
        return loaded.get(name);
    }
    const text = (rows,md = false) => rows.map(row => {
        const title = row.title || 'Untitled';
        const labels = row.tags?.length ? '\n\n' + row.tags.map(label => '#' + label).join(' ') : '';
        return (md ? '# ' : '') + title + '\n\n' + (row.content || '') + labels;
    }).join('\n\n──────────\n\n');
    const formats = {txt:'text/plain',md:'text/markdown',json:'application/json',pdf:'application/pdf',zip:'application/zip'};
    const cleanRow = row => Object.fromEntries(['title','content','tags','color','folder','pinned','archived','is_template','reminder_at','reminder_rule','deleted_at']
        .map(key => [key,row[key]]));
    async function pdf(rows) {
        await load('jspdf');
        const Writer = globalThis.jspdf.jsPDF, pdf = new Writer({unit:'pt',format:'a4',compress:true});
        const canvas = document.createElement('canvas');
        canvas.width = 1190;canvas.height = 1684;
        const draw = canvas.getContext('2d');
        const left = 104, maxWidth = canvas.width - 2 * left, lastLine = 1550;
        let y, page = 0;
        const begin = () => {
            draw.fillStyle = '#ffffff';draw.fillRect(0,0,canvas.width,canvas.height);
            draw.fillStyle = '#1d2635';draw.font = '600 23px system-ui';draw.fillText('Orbit Notes',left,82);
            y = 150;
        };
        const flush = () => {
            if (page >= 100) throw Error('PDF export is limited to 100 pages. Select fewer notes.');
            if (page++) pdf.addPage();
            pdf.addImage(canvas.toDataURL('image/jpeg',.88),'JPEG',0,0,595,842);
        };
        function line(content,heading) {
            const height = heading ? 48 : 39;
            const font = (heading ? '700 36px' : '400 28px') + ' system-ui,sans-serif';
            draw.font = font;
            let part = '';
            for (const token of [...content]) {
                if (part && draw.measureText(part + token).width > maxWidth) {
                    if (y > lastLine) {flush();begin();draw.font = font;}
                    draw.fillText(part,left,y);
                    y += height;
                    part = '';
                }
                part += token;
            }
            if (y > lastLine) {flush();begin();draw.font = font;}
            draw.fillText(part,left,y);y += height;
        }
        begin();
        for (const row of rows) {
            line(row.title || 'Untitled',true);
            for (const paragraph of (row.content || '').split('\n')) line(paragraph,false);
            if (row.tags?.length) line(row.tags.map(tag => '#' + tag).join('  '),false);
            y += 36;
        }
        flush();
        return pdf.output('blob');
    }
    async function archive(rows,readAsset) {
        await load('fflate');
        const result = {}, existing = new Set();
        const notes = [];
        let size = 0;
        for (const row of rows) {
            const sources = [];
            for (const asset of OrbitNoteMedia.assetList(row)) {
                const path = 'media/' + asset.id;
                if (!existing.has(path)) {
                    const blob = await readAsset(asset,row);
                    size += blob.size;
                    if (size > MAX) throw Error('This ZIP exceeds 30 MB. Export fewer notes.');
                    result[path] = [new Uint8Array(await blob.arrayBuffer()),{level:0}];
                    existing.add(path);
                }
                sources.push({...asset,path});
            }
            notes.push({...cleanRow(row),attachments:sources});
        }
        const manifest = enc.encode(JSON.stringify({version:3,notes}));
        if (size + manifest.length > MAX) throw Error('This ZIP exceeds 30 MB. Export fewer notes.');
        return new Blob([globalThis.fflate.zipSync({...result,'orbit-notes.json':manifest},{level:3})],{type:formats.zip});
    }
    async function exportFile(format,rows,readAsset) {
        if (!rows.length) throw Error('Choose at least one note to export.');
        if (format === 'pdf') return pdf(rows);
        if (format === 'zip') return archive(rows,readAsset);
        const content = format === 'json' ? JSON.stringify({version:3,notes:rows.map(cleanRow)},null,2) : text(rows,format === 'md');
        return new Blob([content],{type:formats[format]});
    }
    const suffix = name => name.split('.').at(-1).toLowerCase();
    function keepNote(raw) {
        if (!raw || (!('textContent' in raw) && !Array.isArray(raw.listContent) && !Array.isArray(raw.attachments))) return null;
        const rows = Array.isArray(raw.listContent) ? raw.listContent.map(item =>
            '- [' + (item.isChecked ? 'x' : ' ') + '] ' + String(item.text || '')) : [];
        return {title:String(raw.title || 'Untitled'),content:[String(raw.textContent || ''),...rows].filter(Boolean).join('\n'),
            tags:Array.isArray(raw.labels) ? raw.labels.map(item => item.name).filter(Boolean) : [],
            color:({RED:'rose',ORANGE:'amber',YELLOW:'amber',GREEN:'green',BLUE:'blue',TEAL:'blue'})[raw.color] || 'default',
            pinned:!!raw.isPinned,archived:!!raw.isArchived,deleted_at:raw.isTrashed ? new Date().toISOString() : null,
            files:Array.isArray(raw.attachments) ? raw.attachments.map(item => {
                const {filePath} = item;
                const mime = typeof filePath === 'string' && mimeBySuffix[suffix(filePath)];
                return mime ? {path:filePath,kind:mime.startsWith('audio/') ? 'voice' : mime === 'image/gif' ? 'gif' : 'photo',mime} : null;
            }).filter(Boolean) : []};
    }
    async function extractPackage(file) {
        if (file.size > MAX) throw Error('Choose an import under 30 MB.');
        if (suffix(file.name) !== 'zip') return {docs:[JSON.parse(await file.text())],files:new Map()};
        await load('fflate');
        const binary = new Uint8Array(await file.arrayBuffer());
        let limit = 0, count = 0;
        const accepted = /(?:\.json|\.png|\.jpe?g|\.webp|\.gif|\.webm|\.ogg|\.m4a|\.mp4|\/media\/[a-f0-9-]+|^media\/[a-f0-9-]+)$/i;
        const files = new Map(Object.entries(globalThis.fflate.unzipSync(binary,{filter(entry) {
            if (!accepted.test(entry.name) || entry.name.split('/').includes('..')) return false;
            limit += entry.originalSize;
            if (limit > MAX || ++count > 3000) throw Error('The archive exceeds the Notes import limits.');
            return true;
        }})));
        const docs = [];
        const manifest = files.get('orbit-notes.json');
        if (manifest) docs.push(JSON.parse(dec.decode(manifest)));
        else for (const [name,content] of files) {
            if (!name.toLowerCase().endsWith('.json')) continue;
            try {
                const candidate = JSON.parse(dec.decode(content));
                if (keepNote(candidate)) docs.push({keep:candidate,folder:name.slice(0,name.lastIndexOf('/') + 1)});
            } catch (_) {}
        }
        return {docs,files};
    }
    async function importFile(file) {
        const {docs,files} = await extractPackage(file);
        const rows = [];
        for (const doc of docs) {
            if ([1,2,3].includes(doc.version) && Array.isArray(doc.notes)) rows.push(...doc.notes.map(row => ({...row,files:row.attachments || []})));
            else {
                const row = keepNote(doc.keep || doc);
                if (row) rows.push({...row,relative:doc.folder || ''});
            }
        }
        if (!rows.length || rows.length > 3000) throw Error('Choose an Orbit export or Google Keep JSON or ZIP.');
        return rows.map(row => ({...row,files:row.files.slice(0,10).map(asset => {
            const data = files.get((row.relative || '') + asset.path) || files.get(asset.path);
            return data && typeof asset.mime === 'string' ? {...asset,blob:new Blob([data],{type:asset.mime})} : null;
        }).filter(Boolean)}));
    }
    return {exportFile,importFile,formats,text};
})();
