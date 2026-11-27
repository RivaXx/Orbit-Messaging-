const OrbitNotes = (() => {
    const store = OrbitNoteStore;
    const media = typeof OrbitNoteMedia !== "undefined" ? OrbitNoteMedia : null;
    const attachments = row => media?.assetList(row) || [];
    const upcoming = row => media?.occurrence(row) ?? Date.parse(row.reminder_at);
    const locks = typeof OrbitNoteLock !== 'undefined' ? OrbitNoteLock : null;
    let nativeReminderRequest = "";
    const colors = ['default','blue','green','rose','amber'];
    const state = {owner:null, rows:[], filter:'all', query:'', layout:'list', sort:'updated', selected:new Set(), visible:60};
    const filters = {tasks:'Checklist order',tag:'Label', color:'Colour', type:'Type', date:'Updated', reminder:'Reminder', image:'Image', folder:'Folder', sort:'Sort', layout:'View'};
    const el = id => document.getElementById(id);
    const esc = value => escapeHtml(String(value ?? ''));
    const validId = id => typeof id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(id);
    const account = owner => owner && owner === state.owner && owner === currentUser?.id;
    const dateLabel = value => new Date(value).toLocaleDateString();
    const noteTime = value => {
        const date = new Date(value);
        return value && Number.isFinite(+date) ? new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
    };
    const option = (value, label) => '<option value="' + esc(value) + '">' + esc(label) + '</option>';
    let editor, session, searchTimer, undo, dragFrom, swipe, observer, refreshPromise, refreshAgain, tabChannel;

    const mediaUI = media ? createOrbitNoteMediaUI({dialog,active:current => editor === current && account(current.owner),
        changed:current => {renderEditorMedia(current);markDirty();},client:() => ensureSupabase()}) : null;
    function renderEditorMedia(current) {
        const root = el("notes-editor-media");
        if (root && mediaUI) mediaUI.render(current,root);
    }
    function readLegacy(owner) {
        const base = 'orbit_note_draft_' + owner;
        const read = key => {
            try {return JSON.parse(localStorage.getItem(key) || 'null');}
            catch (_) {return null;}
        };
        const drafts = new Map(), keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== base && key !== base + '_new' && !key.startsWith(base + '_note_')) continue;
            const draft = read(key);
            if (!draft) continue;
            keys.push(key);
            if (!drafts.has(draft.id) || drafts.get(draft.id).at < draft.at) drafts.set(draft.id, draft);
        }
        return {snapshot:read('orbit_notes_' + owner) || [], drafts:[...drafts.values()], keys,
            preferences:read('orbit_note_preferences_' + owner)};
    }
    function savePreferences() {
        try {
            localStorage.setItem('orbit-note-layout-' + state.owner,state.layout);
            localStorage.setItem('orbit-note-sort-' + state.owner,state.sort);
            localStorage.setItem('orbit-note-task-order-' + state.owner,state.tasks || '');
        } catch (_) {}
    }
    function setStatus(message) {
        if (el('notes-sync-status').textContent !== message) el('notes-sync-status').textContent = message;
    }
    function start(owner) {
        if (session?.owner === owner) return session;
        stop();
        init();
        state.owner = owner;
        const current = {owner, client:null, channel:null, syncing:null, timer:null, nextRetry:3000};
        session = current;
        const reset = Object.fromEntries(Object.keys(filters).map(key => [key,'']));
        Object.assign(state, reset, {query:'', filter:'all', sort:'updated', layout:'list', visible:60});
        el('notes-search').value = '';
        if (typeof BroadcastChannel !== 'undefined') {
            tabChannel = new BroadcastChannel('orbit-notes-' + owner);
            tabChannel.onmessage = () => { if (session === current) { void refresh(owner); schedule(current, 500); } };
        }
        current.ready = (async () => {
            const legacy = readLegacy(owner);
            if (legacy.preferences?.layout === 'grid') state.layout = 'grid';
            if (legacy.preferences?.checkedLast) state.tasks = 'unchecked';
            if (legacy.preferences?.order?.length) state.sort = 'manual';
            try {
                const preference = localStorage.getItem('orbit-note-layout-' + owner);
                if (['list','grid','masonry'].includes(preference)) state.layout = preference;
                const sort = localStorage.getItem('orbit-note-sort-' + owner);
                if (['updated','oldest','title','manual'].includes(sort)) state.sort = sort;
                const tasks = localStorage.getItem('orbit-note-task-order-' + owner);
                if (tasks !== null) state.tasks = tasks === 'unchecked' ? tasks : '';
            } catch (_) {}
            await store.migrate(owner, Array.isArray(legacy.snapshot) ? legacy.snapshot : [], legacy.drafts, legacy.preferences);
            if (!account(owner)) return;
            for (const key of legacy.keys) {try {localStorage.removeItem(key);} catch (_) {}}
            await refresh(owner);
        })();
        return current;
    }
    async function load() {
        const owner = currentUser?.id;
        if (!owner) return;
        const current = start(owner);
        try {
            await current.ready;
            if (!account(owner)) return;
            schedule(current, 0);
        } catch (_) {
            if (account(owner)) setStatus('Local Notes storage is unavailable. Your existing data is kept.');
        }
    }
    async function refresh(owner) {
        if (!account(owner)) return;
        if (refreshPromise) {
            refreshAgain = true;
            return refreshPromise.then(() => {
                if (refreshAgain && account(owner)) {
                    refreshAgain = false;
                    return refresh(owner);
                }
            });
        }
        refreshPromise = (async () => {
            const records = await store.list(owner);
            if (account(owner)) {
                state.rows = records.map(record => record.row);
                render();
                syncCalendar();
            }
            return records;
        })().finally(() => {refreshPromise = null;});
        return refreshPromise;
    }
    function schedule(current, delay = 800) {
        if (session !== current || !account(current.owner)) return;
        clearTimeout(current.timer);
        current.timer = setTimeout(() => void synchronize(current), delay);
    }
    function synchronize(current) {
        if (current.syncing || !account(current.owner) || session !== current) return current.syncing;
        const run = () => sync(current);
        current.syncing = (async () => {
            try {
                if (navigator.locks?.request) await navigator.locks.request('orbit-note-sync-' + current.owner, run);
                else await run();
                current.nextRetry = 3000;
            } catch (error) {
                if (!account(current.owner)) return;
                const upgrading = ['PGRST202','42883'].includes(error.code);
                setStatus(upgrading ? 'Saved on this device · waiting for the Notes server upgrade' : 'Saved on this device · sync will retry');
                schedule(current, current.nextRetry);
                current.nextRetry = Math.min(60000, current.nextRetry * 2);
            } finally {current.syncing = null;}
        })();
        return current.syncing;
    }
    async function sync(current) {
        const {owner} = current;
        await current.ready;
        if (!account(owner) || session !== current) return;
        const client = current.client ||= await ensureSupabase();
        if (!account(owner) || session !== current) return;
        if (!current.channel && client.channel) {
            current.channel = client.channel('orbit-notes-v2-' + owner)
                .on('postgres_changes',{event:'*',schema:'public',table:'secure_notes',filter:'user_id=eq.' + owner},() => schedule(current, 700))
                .subscribe(status => { if (status === 'SUBSCRIBED') schedule(current, 700); });
        }
        setStatus('Syncing notes…');
        async function push() {
            const records = await store.list(owner);
            for (const record of records) {
                if (!account(owner)) return;
                if (!record.op || (record.base && !record.base.revision)) continue;
                const entry = await store.beginPush(owner, record.id);
                if (!account(owner)) return;
                if (!entry) continue;
                if (media) await media.upload(owner,entry.row,client);
                if (!account(owner)) return;
                const {data,error} = await client.rpc('orbit_apply_note_v3',{expected_owner:owner,target_id:entry.id,mutation_id:entry.op,
                    base_revision:entry.base?.revision || null,patch:store.payload(entry.row)});
                if (error) {
                    if (['PGRST202','42883'].includes(error.code)) await store.releasePush(owner,entry);
                    throw error;
                }
                await store.acknowledge(owner, entry, data.note ? store.canonical(data.note) : null, data.applied, data.receipt_revision);
            }
        }
        await push();
        let cursor = (await store.metadata(owner)).cursor;
        while (account(owner)) {
            const {data,error} = await client.rpc('orbit_pull_notes',{expected_owner:owner,after_cursor:cursor});
            if (error) throw error;
            if (!data?.length || !account(owner)) break;
            await store.pull(owner, data);
            cursor = data.at(-1).cursor;
            if (data.length < 200) break;
        }
        if (!account(owner)) return;
        await store.finishBootstrap(owner);
        await push();
        const records = await refresh(owner);
        if (!account(owner)) return;
        const queued = records?.some(record => record.op);
        setStatus(queued ? 'Saved on this device · syncing changes' : 'Synced to your account');
        // Poll catches hard deletes and reconnects where Realtime may miss events.
        schedule(current, queued ? 2200 : 45000);
    }

    function init() {
        if (el('notes-toolbar')) return;
        const toolbar = document.createElement('div');
        toolbar.id = 'notes-toolbar';
        toolbar.className = 'notes-toolbar';
        toolbar.innerHTML = '<div class="notes-search-row"><label class="notes-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input id="notes-search" type="search" placeholder="Search notes" aria-label="Search notes"></label><button type="button" class="notes-icon" id="notes-open-filters" aria-label="Filters"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button><button type="button" class="notes-icon" id="notes-open-menu" aria-label="More Notes options"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button></div><div class="notes-filters" role="group" aria-label="Note collections">' +
            [['all','Notes'],['pinned','Pinned'],['archived','Archive'],['trash','Trash'],['templates','Templates']].map(([id,name]) => '<button type="button" data-note-filter="' + id + '">' + name + '</button>').join('') +
            '</div><div id="notes-chips" class="notes-filters" aria-label="Active filters"></div><div id="notes-selection" hidden></div><div id="notes-undo" hidden></div><p id="notes-sync-status" role="status"></p>';
        el('notes-list').before(toolbar);
        el('notes-search').oninput = event => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {state.query = event.target.value; resetWindow();}, 120);
        };
        toolbar.onclick = event => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.dataset.noteFilter) {
                state.filter = button.dataset.noteFilter;
                state.selected.clear();
                resetWindow();
            }
            if (button.dataset.clearNoteFilter) {state[button.dataset.clearNoteFilter] = ''; savePreferences(); resetWindow();}
            if (button.dataset.noteBatch) void batch(button.dataset.noteBatch);
            if (button.id === 'notes-undo-action') void undoAction();
        };
        el('notes-open-filters').onclick = filterSheet;
        el('notes-open-menu').onclick = menuSheet;
        el('notes-list').onclick = listClick;
        el('notes-list').onchange = listChange;
        el('notes-list').ondragstart = event => {
            dragFrom = event.target.closest('[data-note-id]')?.dataset.noteId;
            if (dragFrom) event.dataTransfer.setData('text/plain', dragFrom);
        };
        el('notes-list').ondragover = event => {if (dragFrom && event.target.closest('[data-note-id]')) event.preventDefault();};
        el('notes-list').ondragend = () => {dragFrom = null;};
        el('notes-list').ondrop = event => {
            const target = event.target.closest('[data-note-id]')?.dataset.noteId;
            if (dragFrom && target) {event.preventDefault(); void move(dragFrom, target);}
            dragFrom = null;
        };
        el('notes-list').onpointerdown = event => {
            const card = event.target.closest('[data-note-id]');
            if (event.pointerType !== 'touch' || !card) return;
            const handle = event.target.closest('[data-note-action=drag]');
            if (handle) {
                dragFrom = card.dataset.noteId;
                handle.setPointerCapture(event.pointerId);
                return;
            }
            if (event.target.closest('input,summary,footer')) return;
            swipe = {id:card.dataset.noteId, pointer:event.pointerId, x:event.clientX,y:event.clientY};
        };
        el('notes-list').onpointercancel = () => {swipe = null;dragFrom = null;};
        el('notes-list').onpointerup = event => {
            if (dragFrom && event.pointerType === 'touch') {
                const from = dragFrom;
                dragFrom = null;
                const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-note-id]')?.dataset.noteId;
                if (target && target !== from) {suppressClickUntil = Date.now() + 400;void move(from,target);}
                return;
            }
            if (!swipe || event.pointerId !== swipe.pointer) return;
            const {id,x,y} = swipe;
            swipe = null;
            const dx = event.clientX - x;
            if (Math.abs(dx) >= 85 && Math.abs(event.clientY - y) < 45 && state.filter !== 'trash') {
                suppressClickUntil = Date.now() + 400;
                void action(id, dx > 0 ? 'archive' : 'trash');
            }
        };
        initEditor();
    }
    let suppressClickUntil = 0;
    const unique = values => [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
    const collections = () => unique(state.rows.map(row => row.folder));
    const tags = () => unique(state.rows.flatMap(row => row.tags));
    function filterSheet() {
        const selections = {
            tasks:[['unchecked','Unchecked items first']],
            tag:tags().map(value => [value,value]), color:colors.map(color => [color,color]),
            type:[['text','Text'],['checklist','Checklist'],['link','Contains link']],
            date:[['today','Today'],['week','Past 7 days'],['month','Past 30 days']],
            reminder:[['yes','Has a reminder'],['no','No reminder']],
            image:[['yes','With image'],['no','Without image']], folder:collections().map(value => [value,value]),
            sort:[['updated','Recently edited'],['oldest','Oldest edited'],['title','Title'],['manual','Manual']],
            layout:[['list','List'],['grid','Grid'],['masonry','Masonry']]
        };
        const sheet = dialog('Filters','<form id="notes-filter-form"><div class="notes-sheet-fields">' +
            Object.entries(filters).map(([key,label]) => '<label>' + label + '<select aria-label="' + label + '" name="' + key + '">' +
                (['sort','layout'].includes(key) ? '' : option('','Any')) + selections[key].map(([value,name]) => option(value,name)).join('') + '</select></label>').join('') +
            '</div><div class="notes-sheet-actions"><button type="button" id="notes-reset-filters">Reset</button><button type="submit" class="notes-accent">Apply filters</button></div></form>');
        const form = sheet.querySelector('#notes-filter-form');
        for (const key of Object.keys(filters)) form.elements[key].value = state[key] || (key === 'sort' ? 'updated' : key === 'layout' ? 'list' : '');
        sheet.querySelector('#notes-reset-filters').onclick = () => {for (const input of form.querySelectorAll('select')) input.selectedIndex = 0;};
        form.onsubmit = event => {
            event.preventDefault();
            for (const key of Object.keys(filters)) state[key] = form.elements[key].value;
            savePreferences();
            sheet.close();
            resetWindow();
        };
    }
    function menuSheet() {
        const sheet = dialog('Notes options','<div class="notes-menu"><button type="button" data-menu="template">New template</button><button type="button" data-menu="labels">Manage labels</button><button type="button" data-menu="export">Export notes</button><label class="notes-file">Import Orbit or Google Keep<input type="file" accept=".json,.zip,application/json,application/zip" aria-label="Import Orbit or Google Keep"></label></div>');
        sheet.onclick = event => {
            const action = event.target.closest('button')?.dataset.menu;
            if (!action) return;
            sheet.close();
            if (action === 'template') open(null, {is_template:true});
            if (action === 'labels') labelsSheet();
            if (action === 'export') exportSheet();
        };
        sheet.querySelector('input').onchange = event => {
            const file = event.target.files[0];
            sheet.close();
            if (file) void importNotes(file);
        };
    }
    function dialog(title, content) {
        const element = document.createElement('dialog');
        element.className = 'notes-sheet';
        element.setAttribute('aria-label',title);
        element.innerHTML = '<div class="notes-sheet-heading"><h2>' + title + '</h2><form method="dialog"><button type="submit" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></form></div>' + content;
        element.onclose = () => element.remove();
        document.body.append(element);
        element.showModal();
        window.orbitUpdateNotesViewport();
        return element;
    }
    function labelsSheet() {
        el('notes-label-options').innerHTML = tags().map(value => option(value,value)).join('');
        const sheet = dialog('Manage labels','<form class="notes-sheet-fields"><label>Existing label<select name="from" required>' +
            tags().map(value => option(value,value)).join('') + '</select></label><label>Rename or merge into<input name="to" maxlength="60" list="notes-label-options" required></label><div class="notes-sheet-actions"><button class="notes-accent" type="submit">Update label</button></div></form>');
        const form = sheet.querySelector('.notes-sheet-fields');
        form.onsubmit = async event => {
            event.preventDefault();
            const previous = form.elements.from.value, next = form.elements.to.value.trim();
            if (!previous || !next || previous === next) return;
            const owner = state.owner;
            try {
                await store.saveMany(owner,state.rows.filter(row => row.tags.includes(previous)).map(row =>
                    ({id:row.id,patch:{tags:unique(row.tags.map(tag => tag === previous ? next : tag))}})));
                sheet.close();
                if (account(owner)) {if (state.tag === previous) state.tag = next; await changed(owner);}
            } catch (error) {showToast(error.message,'error');}
        };
    }
    function resetWindow() {state.visible = 60; render();}
    const cardIndex = new WeakMap();
    function cardData(row) {
        let data = cardIndex.get(row);
        if (!data) {
            data = {updated:Date.parse(row.updated_at) || 0};
            cardIndex.set(row,data);
        }
        return data;
    }
    function visibleRows() {
        const query = state.query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const now = new Date(), today = new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
        const lower = {today, week:+now - 7 * 86400000, month:+now - 30 * 86400000}[state.date];
        return state.rows.filter(row => {
            if (state.filter === 'trash') return !!row.deleted_at && (!row.trash_expires_at || Date.parse(row.trash_expires_at) > +now);
            if (row.deleted_at || (state.filter === 'archived') !== row.archived) return false;
            if (state.filter === 'templates') return row.is_template;
            return !row.is_template && (state.filter !== 'pinned' || row.pinned);
        }).filter(row => {
            if (state.tag && !row.tags.includes(state.tag) || state.color && row.color !== state.color || state.folder && row.folder !== state.folder) return false;
            if (state.reminder && !!row.reminder_at !== (state.reminder === 'yes')) return false;
            if (state.image && attachments(row).some(asset => asset.kind === 'photo' || asset.kind === 'drawing') !== (state.image === 'yes')) return false;
            if (lower && cardData(row).updated < lower) return false;
            if (state.type) {
                const hasTasks = /^\s*[-*] \[[ xX]\] /m.test(row.content);
                if (state.type === 'checklist' && !hasTasks || state.type === 'text' && hasTasks || state.type === 'link' && !/https?:\/\//i.test(row.content)) return false;
            }
            if (!query.length) return true;
            if (row.lockbox) return false;
            const data = cardData(row);
            data.search ??= [row.title,row.content,row.folder,...row.tags].join(' ').normalize('NFKC').toLocaleLowerCase();
            return query.every(word => data.search.includes(word));
        }).sort((a,b) => Number(b.pinned) - Number(a.pinned) ||
            (state.sort === 'manual' ? (a.sort_rank ?? Infinity) - (b.sort_rank ?? Infinity) : 0) ||
            (state.sort === 'title' ? a.title.localeCompare(b.title) : 0) ||
            (state.sort === 'oldest' ? 1 : -1) * (cardData(a).updated - cardData(b).updated) ||
            a.id.localeCompare(b.id));
    }
    function render() {
        if (!el('notes-toolbar')) return;
        const rows = visibleRows();
        el('notes-toolbar').querySelectorAll('[data-note-filter]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.noteFilter === state.filter)));
        el('notes-chips').innerHTML = Object.keys(filters).filter(key => !['layout','sort'].includes(key) && state[key]).map(key =>
            '<button type="button" data-clear-note-filter="' + key + '" aria-label="Clear ' + filters[key] + ' filter">' + filters[key] + ' · ' + esc(state[key]) + ' <span aria-hidden="true">×</span></button>').join('');
        const selection = el('notes-selection');
        selection.hidden = !state.selected.size;
        selection.innerHTML = state.selected.size ? '<span>' + state.selected.size + ' selected</span>' +
            (state.filter === 'trash' ? '<button type="button" data-note-batch="restore">Restore</button>' :
                '<button type="button" data-note-batch="archive">' + (state.filter === 'archived' ? 'Unarchive' : 'Archive') + '</button><button type="button" data-note-batch="trash">Trash</button>') +
            '<button type="button" data-note-batch="clear">Clear</button>' : '';
        observer?.disconnect();
        observer = null;
        const list = el('notes-list');
        const focused = list.contains(document.activeElement) && document.activeElement;
        const activeId = focused?.closest?.('[data-note-id]')?.dataset.noteId;
        const action = focused?.dataset?.noteAction;
        mediaUI?.clear(list);
        list.innerHTML = '';
        if (!rows.length) {
            const empty = document.createElement('div');
            empty.className = 'notes-empty';
            empty.innerHTML = '<i class="fa-regular fa-note-sticky" aria-hidden="true"></i><h3>' +
                (state.query || Object.keys(filters).some(key => !['layout','sort'].includes(key) && state[key]) ? 'No matching notes' :
                    state.filter === 'trash' ? 'Trash is empty' : state.filter === 'templates' ? 'No templates yet' : 'No notes here yet') + '</h3>';
            list.append(empty);
            return;
        }
        appendCards(list, rows.slice(0,state.visible));
        if (rows.length > state.visible) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'notes-load-more';
            more.textContent = 'Load more notes';
            more.onclick = () => {
                const start = state.visible;
                state.visible += 60;
                observer?.unobserve(more);
                more.remove();
                appendCards(list, rows.slice(start,state.visible));
                if (rows.length > state.visible) {list.append(more);observer?.observe(more);}
                else observer?.disconnect();
            };
            list.append(more);
            if (typeof IntersectionObserver !== 'undefined' && state.layout !== 'masonry') {
                observer = new IntersectionObserver(entries => {
                    if (entries.some(entry => entry.isIntersecting) && more.isConnected) more.click();
                },{rootMargin:'180px'});
                observer.observe(more);
            }
        }
        if (activeId && validId(activeId)) {
            const card = list.querySelector('[data-note-id="' + activeId + '"]');
            (action && card?.querySelector('[data-note-action="' + action + '"]') || card?.querySelector('.note-open'))?.focus({preventScroll:true});
        }
    }
    function appendCards(list, rows) {
        const showPinned = state.filter === 'all';
        for (const pinned of showPinned ? [true,false] : [false]) {
            const batch = showPinned ? rows.filter(row => row.pinned === pinned) : rows;
            if (!batch.length) continue;
            const sectionName = pinned ? 'pinned' : 'notes';
            let section = list.querySelector('[data-note-section="' + sectionName + '"]');
            if (!section) {
                section = document.createElement('section');
                section.dataset.noteSection = sectionName;
                section.innerHTML = (pinned || list.querySelector('[data-note-section="pinned"]') ? '<h3>' + (pinned ? 'Pinned' : 'Notes') + '</h3>' : '') +
                    '<div class="notes-cards notes-' + state.layout + '"></div>';
                list.append(section);
            }
            const container = section.querySelector('.notes-cards');
            const start = container.children.length;
            container.insertAdjacentHTML('beforeend',batch.map(card).join(''));
            if (mediaUI) batch.forEach((row,index) => {
                const cover = row.lockbox ? null : attachments(row).find(asset => asset.kind !== 'voice');
                mediaUI.register(container.children[start + index].querySelector('[data-note-cover]'),state.owner,cover);
            });
        }
    }
    function card(row) {
        const tasks = store.blocks(row).map(block => ({...block,task:store.taskPattern.exec(block.text)})).filter(block => block.task);
        if (state.tasks === 'unchecked') tasks.sort((a,b) => Number(!!a.task[2].trim()) - Number(!!b.task[2].trim()));
        const completed = tasks.filter(block => block.task[2].toLowerCase() === 'x').length;
        const selected = state.selected.has(row.id), color = colors.includes(row.color) ? row.color : 'default';
        const mediaItems = row.lockbox ? [] : attachments(row);
        const preview = row.content.split('\n').filter(line => !store.taskPattern.test(line)).join('\n').slice(0,220);
        return '<article class="orbit-note-card" data-color="' + color + '" data-note-id="' + esc(row.id) + '" data-selected="' + selected + '">' +
            '<header><button class="note-open" type="button" data-note-action="open" draggable="' + !row.deleted_at + '"><span class="note-card-title">' +
            (row.lockbox ? '<i class="fa-solid fa-lock" aria-label="Locked"></i> ' : '') + (row.pinned ? '<i class="fa-solid fa-thumbtack" aria-label="Pinned"></i> ' : '') + esc(row.title) + '</span>' +
            (preview ? '<span class="note-excerpt">' + esc(preview) + '</span>' : '') + '</button><button class="notes-select-card" type="button" data-note-action="select" aria-pressed="' + selected +
            '" aria-label="Select ' + esc(row.title) + '"><i class="fa-' + (selected ? 'solid fa-square-check' : 'regular fa-square') + '" aria-hidden="true"></i></button></header>' +
            (mediaItems.some(asset => asset.kind !== 'voice') ? '<div class="note-card-cover" data-note-cover></div>' : '') +
            (mediaItems.some(asset => asset.kind === 'voice') ? '<small class="note-reminder-label">Voice recording</small>' : '') +
            (tasks.length ? '<div class="note-progress"><progress value="' + completed + '" max="' + tasks.length + '" aria-label="Checklist progress"></progress> ' + completed + '/' + tasks.length + '</div>' : '') +
            (tasks.length && !row.deleted_at ? '<div class="note-checklist">' + tasks.slice(0,3).map(block => '<label><input type="checkbox" data-note-task="' + esc(block.id) + '" ' +
            (block.task[2].toLowerCase() === 'x' ? 'checked' : '') + '><span>' + esc(block.task[3]) + '</span></label>').join('') + '</div>' : '') +
            (row.tags.length || row.folder ? '<div class="note-tags">' + [...(row.folder ? [row.folder] : []),...row.tags].slice(0,6).map(tag => '<span>' + esc(tag) + '</span>').join('') + '</div>' : '') +
            (row.reminder_at ? '<small class="note-reminder-label"><i class="fa-regular fa-bell" aria-hidden="true"></i> ' + esc(new Date(upcoming(row)).toLocaleString()) + '</small>' : '') +
            (row.deleted_at && row.trash_expires_at ? '<small>Expires ' + esc(dateLabel(row.trash_expires_at)) + '</small>' : '') +
            '<footer><small>' + esc(row.updated_at ? dateLabel(row.updated_at) : '') + '</small>' +
            (row.deleted_at ? '<button type="button" data-note-action="restore">Restore</button>' :
                '<div class="notes-card-actions"><button type="button" class="notes-touch-reorder" data-note-action="drag" aria-label="Reorder ' + esc(row.title) + '"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button><button type="button" data-note-action="options" aria-label="Actions for ' + esc(row.title) + '"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button></div>') + '</footer></article>';
    }
    function listClick(event) {
        const button = event.target.closest('[data-note-action]');
        const card = button?.closest('[data-note-id]');
        if (!card || Date.now() < suppressClickUntil) return;
        const id = card.dataset.noteId, kind = button.dataset.noteAction;
        if (kind === 'select' || kind === 'open' && state.selected.size) {
            if (!state.selected.delete(id)) state.selected.add(id);
            render();
        } else if (kind === 'options' || kind === 'drag') noteActions(id);
        else void action(id,kind);
    }
    function listChange(event) {
        const input = event.target.closest('[data-note-task]');
        const card = input?.closest('[data-note-id]');
        if (card) void task(card.dataset.noteId,input.dataset.noteTask,input.checked);
    }
    function noteActions(id) {
        const row = state.rows.find(note => note.id === id);
        if (!row) return;
        const options = [['pin',row.pinned ? 'Unpin' : 'Pin'],['archive',row.archived ? 'Unarchive' : 'Archive'],
            ['duplicate',row.is_template ? 'Create note from template' : 'Duplicate'],['share','Share text'],
            ['up','Move up'],['down','Move down'],['trash','Move to Trash']];
        if (row.lockbox) {
            for (const kind of ['share','duplicate']) options.splice(options.findIndex(([key]) => key === kind),1);
        } else if (locks) options.splice(0,0,['lock','Lock note']);
        if (!row.lockbox && locks) options.splice(0,0,['history','Version history']);
        const sheet = dialog('Note actions','<div class="notes-menu">' + options.map(([type,label]) =>
            '<button type="button" data-kind="' + type + '">' + label + '</button>').join('') + '</div>');
        sheet.onclick = event => {
            const kind = event.target.closest('button')?.dataset.kind;
            if (kind) {sheet.close(); void action(id,kind);}
        };
    }
    async function changed(owner) {
        if (!account(owner)) return;
        setStatus('Saved on this device');
        tabChannel?.postMessage('change');
        schedule(session);
        await refresh(owner);
    }
    const actionPatch = (row, kind) => ({
        pin:{pinned:!row.pinned}, archive:{archived:!row.archived},
        trash:{deleted_at:new Date().toISOString()}, restore:{deleted_at:null}
    })[kind];
    async function applyRows(rows, kind) {
        const owner = state.owner;
        if (!rows.length || !account(owner)) return;
        const patches = rows.map(row => ({id:row.id,patch:actionPatch(row,kind)}));
        try {
            await store.saveMany(owner,patches);
            if (!account(owner)) return;
            state.selected.clear();
            undo = ['archive','trash','restore'].includes(kind) ? patches.map(({id,patch},index) =>
                ({id,patch:Object.fromEntries(Object.keys(patch).map(key => [key, rows[index][key]])),guard:patch})) : null;
            const area = el('notes-undo');
            area.hidden = !undo;
            area.innerHTML = undo ? '<span role="status">' + ({archive:'Archive updated',trash:'Moved to Trash',restore:'Restored from Trash'})[kind] +
                '</span><button id="notes-undo-action" type="button">Undo</button>' : '';
            await changed(owner);
        } catch (error) {showToast(error.message,'error');}
    }
    async function undoAction() {
        const owner = state.owner;
        try {
            await store.saveMany(owner,undo || []);
            if (!account(owner)) return;
            undo = null;
            el('notes-undo').hidden = true;
            await changed(owner);
        } catch (error) {showToast(error.message,'error');}
    }
    const batch = kind => {
        if (kind === 'clear') {state.selected.clear(); render(); return;}
        return applyRows(state.rows.filter(row => state.selected.has(row.id)),kind);
    };
    async function action(id, kind) {
        const row = state.rows.find(note => note.id === id);
        const owner = state.owner;
        if (!row || !account(owner)) return;
        if (kind === 'open') return open(id);
        if (kind === 'lock' && locks) return lockSheet(row);
        if (kind === 'history' && locks) return historySheet(row);
        if (row.lockbox && ['share','duplicate'].includes(kind)) return;
        if (kind === 'up' || kind === 'down') {
            const peers = visibleRows().filter(note => note.pinned === row.pinned);
            return move(id,peers[peers.indexOf(row) + (kind === 'up' ? -1 : 1)]?.id);
        }
        try {
            if (kind === 'duplicate') {
                await store.save(owner,store.id(),{title:row.is_template ? row.title : (row.title + ' (copy)').slice(0,180),
                    content:row.content,tags:row.tags,color:row.color,folder:row.folder,attachments:attachments(row)});
                await changed(owner);
            } else if (kind === 'share') {
                return exportSheet([row]);
            } else if (actionPatch(row,kind)) await applyRows([row],kind);
        } catch (error) {if (error.name !== 'AbortError') showToast(error.message,'error');}
    }
    async function move(from, to) {
        if (!to || from === to) return;
        const owner = state.owner;
        const source = state.rows.find(row => row.id === from), target = state.rows.find(row => row.id === to);
        if (!source || !target || source.pinned !== target.pinned) return;
        const rows = visibleRows().filter(row => row.pinned === source.pinned);
        const index = rows.findIndex(row => row.id === to);
        const previous = rows.indexOf(source);
        if (index < 0 || previous < 0) return;
        rows.splice(previous,1);
        rows.splice(index,0,source);
        try {
            await store.saveMany(owner, rows.flatMap((row, i) => row.sort_rank === i ? [] : [{id:row.id,patch:{sort_rank:i}}]));
            if (account(owner)) {state.sort = 'manual'; savePreferences(); await changed(owner);}
        } catch (error) {showToast(error.message,'error');}
    }
    async function task(id, blockId, checked) {
        const owner = state.owner;
        try {
            await store.editTask(owner,id,blockId,checked);
            await changed(owner);
        } catch (error) {showToast(error.message,'error'); render();}
    }
    async function saveExport(blob,format,owner) {
        if (!account(owner)) return;
        if (window.OrbitDevice) {
            if (blob.size > 35 * 1024 * 1024) throw Error('Choose a smaller export (35 MB maximum).');
            const id = await window.OrbitDevice('startStickerShare',{mime:blob.type,size:blob.size});
            try {
                for (let offset = 0; offset < blob.size; offset += 48 * 1024) {
                    if (!account(owner)) return;
                    const bytes = new Uint8Array(await blob.slice(offset,offset + 48 * 1024).arrayBuffer());
                    await window.OrbitDevice('writeStickerShare',{id,offset,data:btoa(String.fromCharCode(...bytes))});
                }
                if (account(owner)) await window.OrbitDevice('finishNotesExport',{id,mime:blob.type});
            } finally {await window.OrbitDevice('cancelStickerShare',{id}).catch(() => {});}
        } else {
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url;
            link.download = 'orbit-notes.' + format;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url),10000);
        }
    }
    async function shareNote(row) {
        const text = OrbitNotePortability.text([row]);
        if (window.OrbitDevice) await window.OrbitDevice('shareNoteText',{text});
        else if (navigator.share) await navigator.share({title:row.title,text:row.content});
        else {await navigator.clipboard.writeText(text);showToast('Note copied.','success');}
    }
    function exportSheet(rows,stateEditor = null) {
        const owner = state.owner;
        const choices = rows || state.rows.filter(row => !row.deleted_at && !row.lockbox);
        const sheet = dialog(rows ? 'Share or export note' : 'Export notes',
            '<div class="notes-menu">' + (stateEditor?.lock ? '<p>Exported copies can be read without your recovery passphrase.</p>' :
                !rows && state.rows.some(row => row.lockbox) ? '<p>To export a locked note, unlock it and open Share.</p>' : '') +
            (choices.length === 1 ? '<button type="button" data-note-export="share">Share text</button>' : '') +
            Object.entries({txt:'Text (TXT)',md:'Markdown (MD)',pdf:'PDF (print layout)',json:'JSON (note text and settings)',zip:'ZIP (notes and attachments)'})
                .map(([format,label]) => '<button type="button" data-note-export="' + format + '">' + label + '</button>').join('') +
            '<p data-export-status role="status"></p></div>');
        sheet.onclick = async event => {
            const format = event.target.closest('[data-note-export]')?.dataset.noteExport;
            if (!format || !account(owner) || stateEditor && stateEditor !== editor) return;
            const status = sheet.querySelector('[data-export-status]');
            const buttons = [...sheet.querySelectorAll('[data-note-export]')];
            buttons.forEach(button => button.disabled = true);
            status.textContent = 'Preparing export…';
            try {
                if (format === 'share') await shareNote(choices[0]);
                else {
                    const blob = await OrbitNotePortability.exportFile(format,choices,(asset) =>
                        media.read(owner,asset,() => ensureSupabase(),stateEditor?.lock));
                    if (!account(owner) || !sheet.open || stateEditor && stateEditor !== editor) return;
                    await saveExport(blob,format,owner);
                }
                if (sheet.open) sheet.close();
            } catch(error) {if (error.name !== 'AbortError') status.textContent = error.message;}
            finally {buttons.forEach(button => button.disabled = false);}
        };
    }
    async function importNotes(file) {
        const owner = state.owner;
        try {
            const rows = await OrbitNotePortability.importFile(file);
            const patches = [];
            for (const row of rows) {
                if (!account(owner)) return;
                if (typeof row.title !== 'string' || typeof row.content !== 'string' || row.title.length > 180 || row.content.length > 50000) {
                    throw Error('The export contains a note exceeding the title or text limit.');
                }
                const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
                const imported = [];
                for (const file of row.files) imported.push(await media.add(owner,file.kind,file.blob));
                patches.push({id:store.id(),patch:{title:row.title,content:row.content,
                    tags:unique((Array.isArray(row.tags) ? row.tags : []).filter(tag => typeof tag === 'string').map(tag => tag.slice(0,60))).slice(0,12),
                    folder:typeof row.folder === 'string' ? row.folder.slice(0,100) : '',
                    color:colors.includes(row.color) ? row.color : 'default',pinned:!!row.pinned,archived:!!row.archived,
                    deleted_at:time(row.deleted_at),reminder_at:time(row.reminder_at),is_template:!!row.is_template,
                    reminder_rule:normalizeRule(row.reminder_rule),attachments:imported}});
            }
            if (!account(owner)) return;
            await store.saveMany(owner,patches);
            await changed(owner);
            if (account(owner)) showToast(patches.length + ' notes imported.','success');
        } catch (error) {if (account(owner)) showToast(error.message,'error');}
    }

    function lockSheet(row) {
        const owner = state.owner;
        const sheet = dialog('Lock note','<form class="notes-sheet-fields"><p>Keep a recovery passphrase to open this note on other devices.</p><label>Recovery passphrase<input name="recovery" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>Confirm passphrase<input name="confirm" type="password" autocomplete="new-password" required></label>' +
            (window.OrbitDevice ? '<label class="note-check-option"><input name="device" type="checkbox"> Use biometrics on this phone</label>' : '') +
            '<div class="notes-sheet-actions"><button class="notes-accent" type="submit">Lock note</button></div><p role="status" data-note-auth-status></p></form>');
        const form = sheet.querySelector('.notes-sheet-fields');
        form.onsubmit = async event => {
            event.preventDefault();
            const phrase = form.elements.recovery.value;
            if (phrase !== form.elements.confirm.value) {form.querySelector('[data-note-auth-status]').textContent = 'Passphrases do not match.';return;}
            const button = form.querySelector('button[type=submit]');
            button.disabled = true;
            form.elements.recovery.value = '';form.elements.confirm.value = '';
            let lock;
            try {
                lock = await locks.create(owner,phrase);
                const protectedAssets = [];
                for (const asset of attachments(row)) {
                    const blob = await media.read(owner,asset,() => ensureSupabase());
                    if (!sheet.open || !account(owner)) return;
                    protectedAssets.push(await media.add(owner,asset.kind,blob,lock));
                }
                const sealed = await locks.pack(lock,{...row,attachments:protectedAssets});
                if (!sheet.open || !account(owner)) return;
                await store.save(owner,row.id,sealed,row);
                try {
                    const key = 'orbit_notes_' + owner;
                    const legacy = JSON.parse(localStorage.getItem(key) || '[]');
                    if (Array.isArray(legacy)) localStorage.setItem(key,JSON.stringify(legacy.filter(note => note.id !== row.id)));
                } catch (_) {}
                if (form.elements.device?.checked && account(owner)) {
                    try {await window.OrbitDevice('rememberNoteKey',{account:owner,id:sealed.lockbox.id,key:locks.deviceKey(lock)});}
                    catch (_) {showToast('Note locked. Use your recovery passphrase to open it.','info');}
                }
                if (sheet.open) sheet.close();
                await changed(owner);
            } catch (error) {if (sheet.open) form.querySelector('[data-note-auth-status]').textContent = error.message;}
            finally {lock?.raw.fill(0);button.disabled = false;}
        };
    }
    function unlockSheet(row) {
        if (!locks) return showToast('Update Orbit to unlock this note.','info');
        const owner = state.owner;
        const sheet = dialog('Unlock note','<form class="notes-sheet-fields"><label>Recovery passphrase<input name="recovery" type="password" autocomplete="off" maxlength="256" required></label>' +
            (window.OrbitDevice ? '<button type="button" data-unlock-bio>Unlock with biometrics</button><label class="note-check-option"><input name="device" type="checkbox"> Use biometrics next time</label>' : '') +
            '<div class="notes-sheet-actions"><button class="notes-accent" type="submit">Unlock</button></div><p role="status" data-note-auth-status></p></form>');
        const form = sheet.querySelector('.notes-sheet-fields');
        const perform = async useBiometric => {
            const controls = [...form.querySelectorAll('button')];
            const status = form.querySelector('[data-note-auth-status]');
            controls.forEach(button => button.disabled = true);
            let lock;
            try {
                const phrase = form.elements.recovery.value;
                form.elements.recovery.value = '';
                const deviceKey = useBiometric ? await window.OrbitDevice('unlockNoteKey',{account:owner,id:row.lockbox.id}) : null;
                lock = await locks.open(owner,row.lockbox,{phrase,deviceKey});
                if (!useBiometric && form.elements.device?.checked && sheet.open && account(owner)) {
                    try {await window.OrbitDevice('rememberNoteKey',{account:owner,id:row.lockbox.id,key:locks.deviceKey(lock)});}
                    catch (_) {showToast('Biometrics unavailable. Continue with your recovery passphrase.','info');}
                }
                if (sheet.open && account(owner)) {
                    const latest = state.rows.find(note => note.id === row.id);
                    if (!store.same(latest?.lockbox,row.lockbox)) throw Error('The note changed. Close this prompt and try again.');
                    sheet.close();
                    await open(row.id,{},lock);
                    if (editor?.lock === lock) lock = null;
                }
            } catch (error) {status.textContent = error.message || 'Unlock failed.';}
            finally {lock?.raw.fill(0);controls.forEach(button => button.disabled = false);}
        };
        form.onsubmit = event => {event.preventDefault();void perform(false);};
        const biometric = form.querySelector('[data-unlock-bio]');
        if (biometric) biometric.onclick = () => void perform(true);
    }
    async function historySheet(row,current = null) {
        const owner = state.owner;
        if (row.lockbox && !current?.lock) return;
        const sheet = dialog('Version history','<div class="notes-menu" data-note-versions><p role="status">Loading versions…</p></div>');
        const container = sheet.querySelector('[data-note-versions]');
        try {
            const stored = await store.history(owner,row.id);
            const renderVersions = rows => {
                if (!account(owner) || !sheet.open || current?.lock && editor !== current) return;
                const candidates = rows.filter(item => item.row && !!item.row.lockbox === !!row.lockbox).sort((a,b) => b.at - a.at);
                const seen = new Set();
                const versions = candidates.filter(item => {
                    const key = JSON.stringify(store.payload(item.row));
                    if (seen.has(key)) return false;
                    seen.add(key);return true;
                }).slice(0,30);
                container.innerHTML = versions.length ? '' : '<p>No previous versions yet.</p>';
                for (const item of versions) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = 'Restore version from ' + new Date(item.at).toLocaleString();
                    button.onclick = async () => {
                        if (!account(owner) || current && editor !== current) return;
                        try {
                            if (current?.lock) {
                                const recovered = await locks.open(owner,item.row.lockbox,{deviceKey:locks.deviceKey(current.lock)});
                                Object.assign(current.values,recovered.values);
                                recovered.raw.fill(0);
                                el('note-title-inp').value = current.values.title;
                                el('note-body-inp').value = current.values.content;
                                renderEditorMedia(current);
                                markDirty();
                                await persist(current);
                            } else {
                                if (current && !await close()) return;
                                const existing = state.rows.find(note => note.id === row.id);
                                if (!existing || existing.lockbox) throw Error('The note is now locked.');
                                const {title,content,tags,color,folder,attachments} = item.row;
                                await store.save(owner,row.id,{title,content,tags,color,folder,attachments},existing);
                                await changed(owner);
                            }
                            sheet.close();
                        } catch (error) {showToast(error.message,'error');}
                    };
                    container.append(button);
                }
            };
            renderVersions(stored);
            try {
                const client = await ensureSupabase();
                const {data,error} = await client.rpc('orbit_note_history',{expected_owner:owner,target_id:row.id});
                if (!error && Array.isArray(data)) renderVersions([...stored,...data.map(item => ({at:Date.parse(item.saved_at),row:item.note}))]);
            } catch (_) {}
        } catch (error) {if (sheet.open) container.textContent = error.message;}
    }

    async function saveChatMessage(message, text) {
        const owner = currentUser?.id;
        if (!owner || message?.deleted_at || message?._e2ee_locked || message?._e2ee_error ||
            (typeof orbitIsViewOnceMessage === 'function' && orbitIsViewOnceMessage(message)) || typeof text !== 'string' || !text.trim()) return;
        await load();
        if (!account(owner)) return;
        try {
            await store.save(owner,store.id(),{title:('Message from ' + (message.username || 'Orbit chat')).slice(0,180),content:text.slice(0,50000),tags:['Chat']});
            await changed(owner);
            showToast('Message saved to Notes.','success');
        } catch (error) {showToast(error.message,'error');}
    }

    const formats = [
        ['bold','Bold','fa-bold'],['italic','Italic','fa-italic'],['heading','Heading','fa-heading'],['list','Bullet list','fa-list-ul'],
        ['number','Numbered list','fa-list-ol'],['task','Checklist','fa-list-check'],['indent','Indent checklist','fa-indent'],
        ['outdent','Outdent checklist','fa-outdent'],['quote','Quote','fa-quote-left'],['code','Code','fa-code'],
        ['highlight','Highlight','fa-highlighter'],['undo','Undo','fa-rotate-left'],['redo','Redo','fa-rotate-right']
    ];
    function initEditor() {
        const modal = el('modal-note');
        modal.querySelector('.glass-modal-box').outerHTML = '<div class="note-editor" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">' +
            '<header class="note-editor-header"><button id="note-close" type="button" class="notes-icon" aria-label="Back to notes"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>' +
            '<div><h2 id="note-editor-title">New note</h2><p id="note-draft-status" role="status"></p></div><div class="note-editor-tools"><button id="note-history" type="button" aria-label="Version history">History</button><button id="note-export-single" type="button" aria-label="Share or export note">Share</button><button id="note-preview-toggle" type="button" aria-pressed="false">Preview</button></div></header>' +
            '<main class="note-editor-paper"><input id="note-title-inp" maxlength="180" placeholder="Title" aria-label="Note title">' +
            '<textarea id="note-body-inp" maxlength="50000" placeholder="Write a note…" aria-label="Note text"></textarea><div id="note-preview" hidden></div><div id="notes-editor-media" aria-label="Note attachments"></div></main>' +
            '<div id="note-format" aria-label="Note formatting" role="group">' + formats.map(([kind,label,icon]) => '<button type="button" data-format="' + kind + '" title="' + label +
                '" aria-label="' + label + '"><i class="fa-solid ' + icon + '" aria-hidden="true"></i></button>').join('') + '</div>' +
            '<div class="note-editor-actions" aria-label="Note options"><button type="button" data-settings="color">Colour</button><button type="button" data-settings="tags">Labels</button><button type="button" data-settings="folder">Folder</button><button type="button" data-settings="reminder">Reminder</button><button type="button" data-settings="photo">Photo</button><button type="button" data-settings="record">Voice</button><button type="button" data-settings="drawing">Draw</button><button type="button" data-settings="picker">Stickers &amp; GIFs</button><button type="button" id="note-pin" aria-pressed="false">Pin</button></div>' +
            '<datalist id="notes-label-options"></datalist><datalist id="notes-folder-options"></datalist></div>';
        el('note-close').onclick = () => void close();
        el('note-history').onclick = () => {if (editor?.base) void historySheet(editor.base,editor);};
        el('note-export-single').onclick = () => {if (editor) exportSheet([editor.values],editor);};
        el('note-preview-toggle').onclick = () => preview(el('note-preview').hidden);
        el('note-title-inp').oninput = markDirty;
        el('note-body-inp').oninput = () => {if (editor) {editor.redo = []; markDirty();}};
        el('note-body-inp').onbeforeinput = () => {if (editor) remember(editor);};
        el('note-format').onmousedown = event => {if (event.target.closest('button')) event.preventDefault();};
        el('note-format').onclick = event => {
            const kind = event.target.closest('[data-format]')?.dataset.format;
            if (kind) format(kind);
        };
        modal.querySelector('.note-editor-actions').onclick = event => {
            const kind = event.target.closest('button')?.dataset.settings;
            if (kind && editor && mediaUI && ["photo","record","drawing","picker"].includes(kind)) mediaUI[kind](editor);
            else if (kind && mediaUI) editorSettings(kind);
        };
        el('note-pin').onclick = () => {
            if (!editor) return;
            editor.values.pinned = !editor.values.pinned;
            el('note-pin').setAttribute('aria-pressed',String(editor.values.pinned));
            markDirty();
        };
        modal.onkeydown = event => {
            if (event.key === 'Tab' && editor) {
                const controls = [...modal.querySelectorAll('button,input,textarea')].filter(node => node.getClientRects().length && !node.disabled);
                const boundary = event.shiftKey ? controls[0] : controls.at(-1);
                if (event.target === boundary) {event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();}
            }
            if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();void close();}
            if ((event.ctrlKey || event.metaKey) && event.target === el('note-body-inp')) {
                const kind = {b:'bold',i:'italic',z:event.shiftKey ? 'redo' : 'undo',y:'redo'}[event.key.toLowerCase()];
                if (kind) {event.preventDefault();format(kind);}
            }
        };
    }
    function normalizeRule(rule) {
        if (!rule || typeof rule !== 'object') return null;
        const repeat = media?.recurrence(rule) || 'none';
        let zone = typeof rule.zone === 'string' ? rule.zone : 'UTC';
        try {new Intl.DateTimeFormat('en',{timeZone:zone});} catch (_) {zone = 'UTC';}
        const snooze = Number.isFinite(Date.parse(rule.snooze)) ? new Date(rule.snooze).toISOString() : null;
        return {repeat,zone,snooze};
    }
    function editorSettings(kind) {
        const current = editor;
        if (!current) return;
        el('notes-label-options').innerHTML = tags().map(value => option(value,value)).join('');
        el('notes-folder-options').innerHTML = collections().map(value => option(value,value)).join('');
        const html = {
            tags:'<label>Add a label<input name="label" maxlength="60" list="notes-label-options"></label><div id="note-edit-labels" class="notes-filters"></div>',
            folder:'<label>Folder<input name="folder" maxlength="100" list="notes-folder-options" value="' + esc(current.values.folder) + '"></label>',
            color:'<label>Colour<select name="color">' + colors.map(value => option(value,value)).join('') + '</select></label>',
            reminder:'<div class="notes-filters" aria-label="Quick reminder times"><button type="button" data-reminder-quick="hour">In 1 hour</button><button type="button" data-reminder-quick="tomorrow">Tomorrow</button><button type="button" data-reminder-quick="week">Next week</button></div>' +
                '<label>Remind me<input name="reminder" type="datetime-local" value="' + esc(noteTime(current.values.reminder_at)) + '"></label>' +
                '<label>Repeat<select name="repeat"><option value="none">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>' +
                '<button type="button" id="note-enable-alerts">Enable notifications</button>' +
                (current.values.reminder_at ? '<button type="button" data-reminder-quick="snooze">Snooze 10 minutes</button><button type="button" data-reminder-quick="clear">Remove reminder</button>' : '') +
                (window.OrbitDevice ? '<button type="button" id="note-precise-alarms">Precise alarm settings</button>' : '')
        }[kind];
        const sheet = dialog({tags:'Labels',folder:'Folder',color:'Colour',reminder:'Reminder'}[kind],
            '<form class="notes-sheet-fields">' + html + '<div class="notes-sheet-actions"><button class="notes-accent" type="submit">' +
            (kind === 'tags' ? 'Add label' : 'Apply') + '</button></div></form>');
        const form = sheet.querySelector('.notes-sheet-fields');
        if (kind === 'color') form.elements.color.value = current.values.color;
        if (kind === 'reminder') {
            form.elements.repeat.value = media?.recurrence(current.values.reminder_rule) || 'none';
            sheet.querySelector('#note-enable-alerts').onclick = () => requestNotificationPermission();
            const precise = sheet.querySelector('#note-precise-alarms');
            if (precise) precise.onclick = () => window.OrbitDevice('noteAlarmSettings',{}).catch(error => showToast(error.message,'error'));
            for (const button of form.querySelectorAll('[data-reminder-quick]')) button.onclick = () => {
                const kind = button.dataset.reminderQuick;
                if (kind === 'clear') {form.elements.reminder.value = ''; form.requestSubmit(); return;}
                if (kind === 'snooze') {
                    if (upcoming(current.values) > Date.now() + 600000) {showToast('Snooze is available within 10 minutes of the reminder.','info');return;}
                    current.values.reminder_rule = {...normalizeRule(current.values.reminder_rule || {}),snooze:new Date(Date.now() + 600000).toISOString()};
                    markDirty();sheet.close();return;
                }
                const date = new Date();
                if (kind === 'hour') date.setTime(+date + 3600000);
                else {date.setDate(date.getDate() + (kind === 'week' ? 7 : 1));date.setHours(9,0,0,0);}
                form.elements.reminder.value = noteTime(date);
            };
        }
        const redraw = () => {
            const chips = sheet.querySelector('#note-edit-labels');
            if (chips) chips.innerHTML = current.values.tags.map((tag,i) => '<button type="button" data-remove-label="' + i + '" aria-label="Remove ' + esc(tag) + '">' + esc(tag) + ' ×</button>').join('');
        };
        redraw();
        form.onclick = event => {
            const index = event.target.closest('button')?.dataset.removeLabel;
            if (index !== undefined && editor === current) {
                current.values.tags = current.values.tags.filter((_,i) => i !== Number(index));
                markDirty(); redraw();
            }
        };
        form.onsubmit = event => {
            event.preventDefault();
            if (editor !== current) return sheet.close();
            if (kind === 'tags') {
                const typed = form.elements.label.value.trim();
                const label = tags().find(tag => tag.toLocaleLowerCase() === typed.toLocaleLowerCase()) || typed;
                if (current.values.tags.length >= 12 && !current.values.tags.includes(label)) return showToast('A note can have up to 12 labels.','info');
                current.values.tags = unique([...current.values.tags,label]);
                form.elements.label.value = '';
                redraw();
                form.elements.label.focus();
            } else if (kind === 'reminder') {
                const value = form.elements.reminder.value;
                if (value && value !== noteTime(current.values.reminder_at) && Date.parse(value) <= Date.now()) return showToast('Choose a future reminder time.','info');
                const old = current.values.reminder_at;
                current.values.reminder_at = value ? (value === noteTime(old) ? old : new Date(value).toISOString()) : null;
                const previous = normalizeRule(current.values.reminder_rule);
                const sameTime = old === current.values.reminder_at;
                current.values.reminder_rule = value ? {repeat:form.elements.repeat.value,
                    zone:sameTime && previous?.zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    snooze:sameTime && previous?.snooze || null} : null;
                sheet.close();
            } else {
                current.values[kind] = form.elements[kind].value.trim();
                sheet.close();
            }
            markDirty();
        };
    }
    function remember(current) {
        const input = el('note-body-inp');
        if (current.undo.at(-1)?.text === input.value) return;
        current.undo.push({text:input.value,start:input.selectionStart,end:input.selectionEnd});
        if (current.undo.length > 50) current.undo.shift();
    }
    function format(kind) {
        const current = editor, input = el('note-body-inp');
        if (!current || !el('note-preview').hidden) return;
        let start = input.selectionStart, end = input.selectionEnd;
        if (kind === 'undo' || kind === 'redo') {
            const item = current[kind].pop();
            if (!item) return;
            current[kind === 'undo' ? 'redo' : 'undo'].push({text:input.value,start,end});
            input.value = item.text;
            input.focus();
            input.setSelectionRange(item.start,item.end);
        } else {
            remember(current);
            current.redo = [];
            const wrap = {bold:'**',italic:'_',code:'\u0060',highlight:'=='};
            if (wrap[kind]) {
                const marker = wrap[kind], selected = input.value.slice(start,end);
                input.setRangeText(marker + selected + marker,start,end,'select');
                input.setSelectionRange(start + marker.length,end + marker.length);
            } else {
                const lineStart = start ? input.value.lastIndexOf('\n',start - 1) + 1 : 0;
                const next = input.value.indexOf('\n',end), lineEnd = next === -1 ? input.value.length : next;
                const prefix = {heading:'# ',list:'- ',task:'- [ ] ',quote:'> ',indent:'  '}[kind];
                const lines = input.value.slice(lineStart,lineEnd).split('\n').map((line,index) =>
                    kind === 'outdent' ? line.replace(/^(?: {1,2}|\t)/,'') : (kind === 'number' ? (index + 1) + '. ' : prefix) + line);
                input.setRangeText(lines.join('\n'),lineStart,lineEnd,start === end ? 'end' : 'select');
            }
            input.focus();
        }
        markDirty();
    }
    function preview(enabled) {
        const input = el('note-body-inp'), target = el('note-preview');
        input.hidden = enabled;
        target.hidden = !enabled;
        el('note-format').hidden = enabled;
        el('note-preview-toggle').textContent = enabled ? 'Edit' : 'Preview';
        el('note-preview-toggle').setAttribute('aria-pressed',String(enabled));
        if (!enabled) return;
        const inline = line => esc(line).replace(/(\*\*([^*]+)\*\*|_([^_]+)_|==([^=]+)==|\x60([^\x60]+)\x60)/g,
            (_,token,bold,em,mark,code) => bold ? '<strong>' + bold + '</strong>' : em ? '<em>' + em + '</em>' :
                mark ? '<mark>' + mark + '</mark>' : '<code>' + code + '</code>');
        target.innerHTML = input.value.split('\n').map(line => {
            const checklist = store.taskPattern.exec(line);
            if (checklist) return '<div class="notes-preview-task" style="--indent:' + Math.min(4,Math.floor(checklist[1].length / 2)) +
                '"><span role="img" aria-label="' + (checklist[2].trim() ? 'Completed' : 'Incomplete') + '">' + (checklist[2].trim() ? '☑' : '☐') + '</span> ' + inline(checklist[3]) + '</div>';
            const heading = /^(#{1,3}) (.+)$/.exec(line);
            if (heading) return '<h' + (heading[1].length + 2) + '>' + inline(heading[2]) + '</h' + (heading[1].length + 2) + '>';
            if (line.startsWith('> ')) return '<blockquote>' + inline(line.slice(2)) + '</blockquote>';
            return '<div>' + inline(line.replace(/^- /,'• ')) + '<br></div>';
        }).join('');
        for (const link of media?.links(input.value) || []) {
            const anchor = document.createElement('a');
            anchor.className = 'note-link-preview';
            anchor.href = link.href;anchor.target = '_blank';anchor.rel = 'noopener noreferrer';
            const host = document.createElement('strong'), path = document.createElement('span');
            host.textContent = link.hostname;path.textContent = link.pathname === '/' ? link.href : link.pathname;
            anchor.append(host,path);target.append(anchor);
        }
    }
    async function open(id = null, options = {}, unlocked = null) {
        const owner = currentUser?.id;
        if (!owner) return;
        const current = start(owner);
        try {await current.ready;}
        catch (error) {showToast(error.message,'error');return;}
        if (!account(owner) || (editor && !(await close()))) return;
        if (!account(owner)) return;
        const row = id ? state.rows.find(note => note.id === id) : null;
        if (id && !row) return showToast('This note is not on this device yet.','info');
        if (row?.deleted_at) return showToast('Restore this note from Trash before editing.','info');
        if (row?.lockbox && !unlocked) return unlockSheet(row);
        editor = {owner,id:id || store.id(),base:row,lock:unlocked,values:store.canonical({...row,id:id || '',title:row?.title || '',...options,...unlocked?.values}),
            timer:null,lastValues:row && !unlocked ? store.payload(row) : null,queue:Promise.resolve(),dirty:false,undo:[],redo:[],previousFocus:document.activeElement};
        el('note-title-inp').value = editor.values.title;
        el('note-body-inp').value = editor.values.content;
        el('note-pin').setAttribute('aria-pressed',String(editor.values.pinned));
        el('modal-note').querySelector('[data-settings=reminder]').hidden = editor.values.is_template;
        el('note-editor-title').textContent = editor.values.is_template ? 'Template' : unlocked ? 'Locked note' : row ? 'Note' : 'New note';
        el('note-history').hidden = !row;
        el('note-export-single').hidden = !row;
        el('note-draft-status').textContent = '';
        preview(false);
        renderEditorMedia(editor);
        el('modal-note').classList.add('active');
        el('note-close').focus({preventScroll:true});
        window.orbitUpdateNotesViewport();
    }
    function markDirty() {
        if (!editor) return;
        editor.dirty = true;
        editor.values.title = el('note-title-inp').value.trim();
        editor.values.content = el('note-body-inp').value;
        clearTimeout(editor.timer);
        const draft = editor;
        el('note-draft-status').textContent = 'Saving on this device…';
        draft.timer = setTimeout(() => void persist(draft),250);
    }
    async function persist(current) {
        if (!current || !account(current.owner)) return false;
        clearTimeout(current.timer);
        if (!current.dirty) return current.queue;
        if (!current.base && !current.values.title && !current.values.content.trim() && !attachments(current.values).length && !current.values.reminder_at) {
            el('note-draft-status').textContent = '';
            return current.queue;
        }
        current.dirty = false;
        const values = store.payload({...current.values,title:current.values.title || 'Untitled'});
        current.queue = current.queue.then(async () => {
            if (!account(current.owner)) return false;
            try {
                const persisted = current.lock ? {...values,...await locks.pack(current.lock,values)} : values;
                const patch = Object.fromEntries(Object.entries(persisted).filter(([key,value]) => key !== 'document' &&
                    (!current.lastValues || !store.same(current.lastValues[key],value))));
                if (current.lock) patch.document = null;
                if (Object.keys(patch).length) {
                    const record = await store.save(current.owner,current.id,patch,current.base);
                    current.id = record.id;
                    current.base = record.row;
                    current.lastValues = persisted;
                }
                if (editor === current && !current.dirty) el('note-draft-status').textContent = 'Saved on this device';
                // Storage committed before rendering/sync. A presentation error cannot invalidate the save.
                void changed(current.owner).catch(error => console.error('Notes refresh',error));
                return true;
            } catch (error) {
                current.dirty = true;
                if (editor === current) el('note-draft-status').textContent = 'Storage failed. Retry before leaving this note.';
                return false;
            }
        });
        return current.queue;
    }
    async function close() {
        const current = editor;
        if (current && !(await persist(current))) return false;
        if (editor !== current) return true;
        editor = null;
        mediaUI?.clear(el('notes-editor-media'));
        if (current?.lock) {
            current.lock.raw.fill(0);
            el('note-title-inp').value = '';el('note-body-inp').value = '';el('note-preview').replaceChildren();
        }
        el('modal-note')?.classList.remove('active');
        if (current?.previousFocus?.isConnected) current.previousFocus.focus();
        else el('notes-search')?.focus();
        return true;
    }
    function updateNativeReminders() {
        if (!window.OrbitDevice || !account(state.owner)) return;
        const rows = state.rows.filter(note => note.reminder_at && !note.deleted_at && !note.archived && !note.is_template && Date.parse(note.reminder_at) > 0 && Date.parse(note.reminder_at) <= 9000000000000)
            .map(note => ({id:note.id,at:Date.parse(note.reminder_at),snooze:Date.parse(note.reminder_rule?.snooze) || 0,
                repeat:media?.recurrence(note.reminder_rule) || 'none',zone:note.reminder_rule?.zone || 'UTC'}));
        const args = {account:state.owner,rows};
        const request = JSON.stringify(args);
        if (request === nativeReminderRequest) return;
        nativeReminderRequest = request;
        void window.OrbitDevice('scheduleNoteReminders',args).catch(() => {if (nativeReminderRequest === request) nativeReminderRequest = '';});
    }
    function clearNativeReminders() {
        nativeReminderRequest = '';
        return window.OrbitDevice && account(state.owner) ? window.OrbitDevice('cancelNoteReminders',{account:state.owner}).catch(() => {}) : null;
    }
    function syncCalendar() {
        updateNativeReminders();
        if (typeof userCalendarEvents === 'undefined') return;
        userCalendarEvents = userCalendarEvents.filter(row => !row.noteId);
        for (const note of state.rows) {
            if (!note.reminder_at || note.deleted_at || note.archived || note.is_template) continue;
            const date = noteTime(upcoming(note));
            if (date) userCalendarEvents.push({id:'note_' + note.id,noteId:note.id,title:'📝 ' + note.title,date:date.slice(0,10),
                time:date.slice(11,16),color:'#5c8dff',desc:'Note reminder · edit in Notes'});
        }
        if (el('tab-calendar') && !el('tab-calendar').classList.contains('hide') && typeof renderCalendarMonth === 'function') {
            renderCalendarMonth();
            if (calViewMode === 'agenda') renderCalendarAgendaView();
            else renderCalendarEvents(calSelectedDateStr);
        }
    }
    async function openLink(id) {
        if (!validId(id)) return;
        if (!currentUser?.id) {window.orbitPendingNote = id; return;}
        await load();
        if (!state.rows.some(row => row.id === id) && session) await synchronize(session);
        switchTab('notes');
        await open(id);
        window.orbitPendingNote = null;
    }
    function stop() {
        clearTimeout(session?.timer);
        clearTimeout(editor?.timer);
        clearTimeout(searchTimer);
        if (session?.channel) void session.client?.removeChannel(session.channel);
        session = null;
        if (editor?.lock) {
            editor.lock.raw.fill(0);
            el('note-title-inp').value = '';el('note-body-inp').value = '';el('note-preview').replaceChildren();
        }
        editor = null;
        tabChannel?.close();
        tabChannel = null;
        observer?.disconnect();
        mediaUI?.clear(el('notes-list'));
        mediaUI?.clear(el('notes-editor-media'));
        nativeReminderRequest = '';
        state.rows = [];
        state.owner = null;
        state.selected.clear();
        undo = null;
        document.querySelectorAll('.notes-sheet[open]').forEach(sheet => sheet.close());
        if (el('notes-list')) el('notes-list').innerHTML = '';
        if (el('notes-undo')) el('notes-undo').hidden = true;
        if (el('notes-selection')) el('notes-selection').hidden = true;
        el('modal-note')?.classList.remove('active');
        if (typeof userCalendarEvents !== 'undefined') userCalendarEvents = userCalendarEvents.filter(row => !row.noteId);
    }
    let viewportFrame = 0;
    window.orbitUpdateNotesViewport = () => {
        if (!editor && !document.querySelector(".notes-sheet[open]")) return;
        if (viewportFrame) return;
        viewportFrame = requestAnimationFrame(() => {
            viewportFrame = 0;
            const viewport = window.visualViewport;
            const height = Math.floor(Math.min(innerHeight,viewport?.height || Infinity,Number(window.OrbitAndroidVisibleHeight) || Infinity));
            document.documentElement.style.setProperty("--notes-visible-height",height + "px");
        });
    };
    window.visualViewport?.addEventListener("resize",window.orbitUpdateNotesViewport);
    window.addEventListener("online", () => {if (session) schedule(session,0);});
    window.addEventListener('pagehide', () => {if (editor?.lock) void close();else if (editor) void persist(editor);});
    document.addEventListener('visibilitychange',() => {
        if (document.hidden) {if (editor?.lock) void close();else if (editor) void persist(editor);}
        else if (session) schedule(session,0);
    });
    return {load,open,close,save:() => editor ? persist(editor) : true,openLink,syncCalendar,action,task,stop,clearNativeReminders,saveChatMessage,state};
})();
window.orbitOpenNoteLink = id => OrbitNotes.openLink(id);
