/* Durable Notes repository shared by the browser and Android WebView. */
const OrbitNoteStore = (() => {
    const fields = ['title', 'content', 'tags', 'color', 'pinned', 'archived', 'deleted_at',
        'reminder_at', 'folder', 'is_template', 'document', 'sort_rank', 'attachments', 'reminder_rule', 'lockbox'];
    const defaults = {title:'Untitled', content:'', tags:[], color:'default', pinned:false,
        archived:false, deleted_at:null, reminder_at:null, folder:'', is_template:false,
        document:null, sort_rank:null, attachments:[], reminder_rule:null, lockbox:null};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const id = () => crypto.randomUUID();
    const taskPattern = /^(\s*)[-*] \[([ xX])\] (.*)$/;

    function documentFor(content, previous = []) {
        const lines = content.split('\n');
        const byText = new Map();
        for (const block of previous) {
            const list = byText.get(block.text) || [];
            list.push(block);
            byText.set(block.text, list);
        }
        const used = new Set();
        const matches = lines.map(line => {
            const block = byText.get(line)?.shift();
            if (block) used.add(block.id);
            return block;
        });
        return lines.map((line, index) => {
            const atIndex = previous[index];
            const block = matches[index] || (!used.has(atIndex?.id) && atIndex);
            if (block) used.add(block.id);
            return {id:block?.id || id(), text:line};
        });
    }
    function blocks(row) {
        if (Array.isArray(row?.document) && row.document.map(b => b.text).join('\n') === row.content) return row.document;
        return (row?.content || '').split('\n').map((text, index) => ({id:'legacy-' + index, text}));
    }
    function mergeBlocks(base, local, remote) {
        const original = blocks(base), ours = blocks(local), theirs = blocks(remote);
        const originalIds = original.map(b => b.id);
        if (!same(originalIds, ours.map(b => b.id)) || !same(originalIds, theirs.map(b => b.id))) return null;
        const merged = [];
        for (let index = 0; index < original.length; index++) {
            const before = original[index], a = ours[index], b = theirs[index];
            if (a.text === b.text || b.text === before.text) merged.push(a);
            else if (a.text === before.text) merged.push(b);
            else {
                const old = taskPattern.exec(before.text), left = taskPattern.exec(a.text), right = taskPattern.exec(b.text);
                if (!old || !left || !right) return null;
                const values = old.slice(1).map((value, i) => left[i + 1] === value ? right[i + 1] : left[i + 1]);
                if (values.some((_, i) => left[i + 1] !== old[i + 1] && right[i + 1] !== old[i + 1] && left[i + 1] !== right[i + 1])) return null;
                merged.push({id:before.id, text:values[0] + '- [' + values[1] + '] ' + values[2]});
            }
        }
        return merged;
    }
    function merge(base, local, remote) {
        if (!base || !remote) return {row:remote, conflict:local};
        const row = {...remote};
        let conflict = false;
        const protectedFields = ['title','content','tags','color','folder','attachments','document','lockbox'];
        const covered = base.lockbox || local.lockbox || remote.lockbox;
        if (covered) {
            const differs = (a,b) => protectedFields.some(field => !same(a[field],b[field]));
            if (differs(local,base)) {
                if (!differs(remote,base) || local.lockbox && !base.lockbox && !remote.lockbox) {
                    for (const field of protectedFields) row[field] = local[field];
                }
                else if (differs(local,remote) && local.lockbox) conflict = true;
            }
        }
        for (const key of fields) {
            if (key === 'document' || covered && protectedFields.includes(key) || same(local[key], base[key])) continue;
            if (same(remote[key], base[key]) || same(remote[key], local[key])) {
                row[key] = local[key];
                if (key === 'content') row.document = local.document;
            } else if (key === 'content') {
                const combined = mergeBlocks(base, local, remote);
                if (!combined) conflict = true;
                else {
                    row.document = combined;
                    row.content = combined.map(b => b.text).join('\n');
                }
            } else if (key === 'attachments') {
                const before = new Map((base.attachments || []).map(item => [item.id,item]));
                const ours = new Map((local.attachments || []).map(item => [item.id,item]));
                const theirs = new Map((remote.attachments || []).map(item => [item.id,item]));
                for (const [assetId,item] of ours) {
                    if (before.has(assetId) && !theirs.has(assetId)) continue;
                    const original = before.get(assetId), remoteItem = theirs.get(assetId);
                    if (!original || same(remoteItem,original)) theirs.set(assetId,item);
                    else if (!same(item,original) && !same(item,remoteItem)) conflict = true;
                }
                for (const assetId of before.keys()) if (!ours.has(assetId)) theirs.delete(assetId);
                if (theirs.size > 10) conflict = true;
                else row.attachments = [...theirs.values()];
            } else if (key === 'tags') {
                const before = base.tags || [], ours = local.tags || [], theirs = remote.tags || [];
                row.tags = [...new Set([...theirs.filter(tag => !before.includes(tag) || ours.includes(tag)), ...ours.filter(tag => !before.includes(tag))])];
            } else conflict = true;
        }
        if (remote.deleted_at && !local.deleted_at && !same(local, base)) conflict = true;
        return {row, conflict:conflict && (!row.lockbox || local.lockbox) ? local : null};
    }
    function canonical(row) {
        return {...defaults,...row,id:String(row.id),title:typeof row.title === 'string' ? row.title : 'Untitled',
            content:typeof row.content === 'string' ? row.content : '',tags:Array.isArray(row.tags) ? row.tags.filter(tag => typeof tag === 'string') : []};
    }
    let connection;
    function database() {
        if (!connection) connection = new Promise((resolve, reject) => {
            if (!globalThis.indexedDB) return reject(Error('Local Notes storage is unavailable.'));
            const request = indexedDB.open('orbit-notes', 3);
            request.onupgradeneeded = event => {
                if (event.oldVersion < 1) {
                    const records = request.result.createObjectStore('records', {keyPath:['owner', 'id']});
                    records.createIndex('owner', 'owner');
                    request.result.createObjectStore('metadata', {keyPath:'owner'});
                }
                if (event.oldVersion < 2) request.result.createObjectStore('blobs',{keyPath:['owner','id']});
                if (event.oldVersion < 3) {
                    const versions = request.result.createObjectStore('versions',{keyPath:['owner','note','id']});
                    versions.createIndex('note',['owner','note']);
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {db.close(); connection = null;};
                resolve(db);
            };
            request.onerror = () => reject(request.error);
        }).catch(error => {connection = null; throw error;});
        return connection;
    }
    async function transaction(names, mode, work) {
        const db = await database();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(names, mode);
            let result, failure;
            const read = (request, callback) => {
                request.onsuccess = () => {
                    try { callback(request.result); }
                    catch (error) {failure = error; tx.abort();}
                };
            };
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => reject(failure || tx.error || Error('Notes transaction was interrupted.'));
            try {work(tx, read, value => {result = value;});}
            catch (error) {failure = error; tx.abort();}
        });
    }
    const list = owner => transaction(['records'], 'readonly', (tx, read, result) =>
        read(tx.objectStore('records').index('owner').getAll(owner), result));
    const metadata = owner => transaction(['metadata'], 'readonly', (tx, read, result) =>
        read(tx.objectStore('metadata').get(owner), value => result(value || {owner, cursor:'0'})));
    const queued = (owner, row, base) => ({owner, id:row.id, row, base, op:id()});
    function copy(row) {
        return {...row, id:id(), pinned:false, deleted_at:null, trash_expires_at:null, title:row.lockbox ? 'Locked note' : (row.title + ' (conflict copy)').slice(0,180)};
    }
    function persist(owner, store, current, noteId, patch, expected) {
        const prior = expected || current?.row;
        const row = canonical({...prior, ...patch, id:noteId, user_id:owner, updated_at:new Date().toISOString()});
        if ('content' in patch && !row.lockbox) row.document = documentFor(row.content, blocks(prior));
        if ('deleted_at' in patch) row.trash_expires_at = row.deleted_at ? new Date(Date.parse(row.deleted_at) + 30 * 86400000).toISOString() : null;
        let next = row;
        if (expected && current?.row && !same(expected, current.row)) {
            const merged = merge(expected, row, current.row);
            next = merged.row;
            if (merged.conflict) {
                const conflict = copy(merged.conflict);
                store.put(queued(owner, conflict, null));
            }
        } else if (expected?.revision && !current) {
            const record = queued(owner,copy(row),null);
            store.put(record);
            return record;
        }
        const baseline = current?.base && next.lockbox && !current.base.lockbox ? scrub(current.base) : current?.base;
        const record = {...queued(owner,next,baseline || null),sent:current?.sent};
        store.put(record);
        return record;
    }
    function scrub(row) {return {...row,title:'Locked note',content:'',tags:[],color:'default',folder:'',document:null,attachments:[]};}
    function snapshot(tx,read,owner,current,next) {
        if (!current || !next) return;
        const versions = tx.objectStore('versions');
        read(versions.index('note').getAll([owner,current.id]), prior => {
            if (next.row.lockbox && !current.row.lockbox) {
                for (const entry of prior) versions.delete([owner,current.id,entry.id]);
                return;
            }
            if (fields.every(field => same(current.row[field],next.row[field]))) return;
            const now = Date.now();
            if (prior.some(entry => now - entry.at < 15000)) return;
            versions.put({owner,note:current.id,id:id(),at:now,row:current.row});
            prior.sort((a,b) => b.at - a.at).slice(29).forEach(entry => versions.delete([owner,current.id,entry.id]));
        });
    }
    function save(owner,noteId,patch,expected) {
        return transaction(['records','versions'],'readwrite',(tx,read,result) => {
            const store = tx.objectStore('records');
            read(store.get([owner,noteId]), current => {
                if (patch.lockbox && current?.sent && !current.row.lockbox) throw Error('Wait for the current sync to finish before locking this note.');
                const next = persist(owner,store,current,noteId,patch,expected);
                snapshot(tx,read,owner,current,next);
                result(next);
            });
        });
    }
    function saveMany(owner,entries) {
        return transaction(['records'],'readwrite',(tx,read) => {
            const store = tx.objectStore('records');
            for (const {id:noteId,patch,guard} of entries) {
                read(store.get([owner,noteId]), current => {
                    if (!guard || current && Object.keys(guard).every(key => same(current.row[key],guard[key]))) {
                        persist(owner,store,current,noteId,patch);
                    }
                });
            }
        });
    }
    function editTask(owner,noteId,blockId,checked) {
        return transaction(['records'],'readwrite',(tx,read) => {
            const store = tx.objectStore('records');
            read(store.get([owner,noteId]), current => {
                if (!current || current.row.deleted_at) return;
                const list = blocks(current.row);
                const index = typeof blockId === 'number' ? blockId : list.findIndex(block => block.id === blockId);
                const task = taskPattern.exec(list[index]?.text || '');
                if (!task) return;
                const text = task[1] + '- [' + (checked ? 'x' : ' ') + '] ' + task[3];
                if (text === list[index].text) return;
                const content = list.map((block,i) => i === index ? text : block.text).join('\n');
                persist(owner,store,current,noteId,{content});
            });
        });
    }
    function beginPush(owner,noteId) {
        return transaction(['records'],'readwrite',(tx,read,result) => {
            const store = tx.objectStore('records');
            read(store.get([owner,noteId]), current => {
                if (!current?.op || current.base && !current.base.revision) return;
                if (current.sent) return result(current.sent);
                const {owner:ownerId,id:recordId,row,base,op} = current;
                const sent = {owner:ownerId,id:recordId,row,base,op};
                store.put({...current,sent});
                result(sent);
            });
        });
    }
    // A push acknowledgement can race with a more recent autosave in this or another tab.
    function reconcile(owner, store, current, remote, noteId, acknowledged) {
        if (!current?.op || current.op === acknowledged) {
            if (remote) store.put({owner, id:noteId, row:remote, base:remote});
            else store.delete([owner, noteId]);
            return;
        }
        if (!remote && !current.base) {store.put({...current,sent:undefined});return;}
        if (remote && current.base?.revision === remote.revision) {store.put({...current,sent:undefined});return;}
        const {row, conflict} = merge(current.base, current.row, remote);
        if (conflict) {
            const duplicate = copy(conflict);
            store.put(queued(owner, duplicate, null));
        }
        if (!row) store.delete([owner, noteId]);
        else if (fields.every(field => same(row[field], remote[field]))) store.put({owner, id:noteId, row:remote, base:remote});
        else store.put(queued(owner,row,row.lockbox && !remote.lockbox ? scrub(remote) : remote));
    }
    function releasePush(owner,sent) {
        return transaction(['records'],'readwrite',(tx,read) => {
            const store = tx.objectStore('records');
            read(store.get([owner,sent.id]), current => {
                if (current?.sent?.op === sent.op) store.put({...current,sent:undefined});
            });
        });
    }
    function acknowledge(owner,sent,remote,applied,receiptRevision) {
        return transaction(['records'],'readwrite',(tx,read) => {
            const store = tx.objectStore('records');
            read(store.get([owner,sent.id]), current => {
                if (!current || current.sent?.op !== sent.op) return;
                const committed = applied || !!receiptRevision;
                if (committed && current.op !== sent.op) {
                    reconcile(owner,store,{...current,base:{...sent.row,revision:null},sent:undefined},remote,sent.id,null);
                    return;
                }
                reconcile(owner,store,{...current,sent:undefined},remote,sent.id,committed ? sent.op : null);
            });
        });
    }
    function pull(owner, entries) {
        return transaction(['records', 'metadata','versions'], 'readwrite', (tx, read) => {
            const store = tx.objectStore('records');
            const meta = tx.objectStore('metadata');
            read(meta.get(owner), previous => {
                let cursor = previous?.cursor || '0';
                for (const entry of entries) {
                    if (BigInt(entry.cursor) <= BigInt(cursor)) continue;
                    cursor = entry.cursor;
                    read(store.get([owner, entry.note_id]), current => {
                        if (current?.sent || current?.base?.revision && BigInt(current.base.revision) > BigInt(entry.cursor)) return;
                        if (entry.note?.lockbox && current && !current.row.lockbox) {
                            const versions = tx.objectStore('versions');
                            read(versions.index('note').getAllKeys([owner,entry.note_id]), keys => keys.forEach(key => versions.delete(key)));
                        }
                        reconcile(owner, store, current, entry.note ? canonical(entry.note) : null, entry.note_id, entry.mutation_id);
                    });
                }
                meta.put({...previous, owner, cursor});
            });
        });
    }
    async function migrate(owner, snapshot, drafts, preferences) {
        return transaction(['records', 'metadata'], 'readwrite', (tx, read) => {
            const store = tx.objectStore('records'), meta = tx.objectStore('metadata');
            read(meta.get(owner), previous => {
                if (previous?.migrated) return;
                const originals = new Map(snapshot.filter(row => row.user_id === owner || !row.user_id).map(row => [String(row.id), canonical(row)]));
                for (const row of originals.values()) store.put({owner,id:row.id,row,base:row});
                for (const [rank,noteId] of (Array.isArray(preferences?.order) ? preferences.order : []).entries()) {
                    const row = originals.get(noteId);
                    if (row) store.put(queued(owner,{...row,sort_rank:rank},row));
                }
                for (const draft of drafts) {
                    const values = draft.values;
                    if (!values || (!values.title?.trim() && !values.content?.trim())) continue;
                    const original = originals.get(String(draft.id));
                    const sameVersion = original && original.updated_at === draft.version;
                    const noteId = sameVersion ? original.id : id();
                    const reminder = values.reminder && new Date(values.reminder);
                    const row = canonical({...original, sort_rank:preferences?.order?.includes(original?.id) ? preferences.order.indexOf(original.id) : original?.sort_rank ?? null, ...values, id:noteId, user_id:owner, title:values.title || 'Untitled',
                        reminder_at:reminder && Number.isFinite(+reminder) ? reminder.toISOString() : null,
                        updated_at:new Date().toISOString(), document:documentFor(values.content || '', blocks(original))});
                    if (draft.id && !sameVersion) row.title = (row.title + ' (recovered draft)').slice(0,180);
                    // A legacy snapshot has no revision. Retain the original for three-way merge on first pull.
                    store.put(queued(owner, row, sameVersion ? original : null));
                }
                meta.put({...previous, owner, cursor:previous?.cursor || '0', migrated:true});
            });
        });
    }
    function finishBootstrap(owner) {
        return transaction(['records','metadata'],'readwrite',(tx,read) => {
            const store = tx.objectStore('records'), meta = tx.objectStore('metadata');
            read(meta.get(owner), previous => {
                if (previous?.bootstrapped) return;
                read(store.index('owner').getAll(owner), records => {
                    for (const record of records) {
                        if (!record.base || record.base.revision) continue;
                        reconcile(owner,store,record,null,record.id,null);
                    }
                    meta.put({...previous,owner,cursor:previous?.cursor || "0",bootstrapped:true});
                });
            });
        });
    }
    const getBlob = (owner,id) => transaction(['blobs'],'readonly',(tx,read,result) =>
        read(tx.objectStore('blobs').get([owner,id]),result));
    const putBlob = (owner,id,blob,synced = false) => transaction(['blobs'],'readwrite',tx =>
        tx.objectStore('blobs').put({owner,id,blob,synced}));
    const history = (owner,note) => transaction(['versions'],'readonly',(tx,read,result) =>
        read(tx.objectStore('versions').index('note').getAll([owner,note]),result));
    const payload = row => Object.fromEntries(fields.map(field => [field, row[field]]));
    return {id, same, blocks, canonical, merge, documentFor, taskPattern, list, metadata, save, saveMany, editTask, beginPush, releasePush, migrate, finishBootstrap, pull, acknowledge, getBlob, putBlob, history, payload};
})();
