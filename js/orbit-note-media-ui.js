function createOrbitNoteMediaUI({dialog,active,changed,client}) {
    const media = OrbitNoteMedia;
    const empty = '<span class="note-media-wait" role="status">Loading attachment…</span>';
    const labels = {photo:'Photo', voice:'Voice recording', drawing:'Drawing', sticker:'Sticker', gif:'GIF'};
    const values = new WeakMap();
    let observer;
    const report = error => showToast(error?.message || 'Notes could not load this attachment.','error');

    function unload(wrapper) {
        const state = values.get(wrapper);
        if (!state) return;
        state.generation++;
        if (state.url) URL.revokeObjectURL(state.url);
        if (state.url || state.loading) wrapper.innerHTML = empty;
        state.url = null;
        state.loading = false;
    }
    function clear(root) {
        if (!root) return;
        for (const wrapper of root.querySelectorAll('.note-media-view')) {
            observer?.unobserve(wrapper);
            unload(wrapper);
            values.delete(wrapper);
        }
    }
    async function mount(wrapper) {
        const state = values.get(wrapper);
        if (!state || state.url || state.loading) return;
        state.loading = true;
        const generation = ++state.generation;
        const {owner,asset,locked} = state;
        try {
            const blob = await media.read(owner,asset,client,locked);
            if (!wrapper.isConnected || state.generation !== generation) return;
            const node = document.createElement(asset.kind === 'voice' ? 'audio' : 'img');
            const url = URL.createObjectURL(blob);
            state.url = url;
            node.src = url;
            if (asset.kind === 'voice') {
                node.controls = true;
                node.preload = 'metadata';
                node.setAttribute('aria-label',labels[asset.kind]);
            } else {
                node.alt = labels[asset.kind];
                node.decoding = 'async';
            }
            wrapper.replaceChildren(node);
        } catch (_) {
            if (!wrapper.isConnected || state.generation !== generation) return;
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = 'Retry attachment';
            retry.onclick = () => {wrapper.innerHTML = empty; void mount(wrapper);};
            wrapper.replaceChildren(retry);
        } finally {
            if (state.generation === generation) state.loading = false;
        }
    }
    function register(wrapper,owner,asset,locked) {
        if (!wrapper || !asset) return;
        wrapper.classList.add('note-media-view','note-media-' + asset.kind);
        wrapper.innerHTML = empty;
        values.set(wrapper,{owner,asset,locked,generation:0,loading:false,url:null});
        if (typeof IntersectionObserver === 'undefined') void mount(wrapper);
        else {
            observer ||= new IntersectionObserver(entries => {
                for (const {target,isIntersecting} of entries) {
                    if (isIntersecting) void mount(target);
                    else if (['gif','sticker'].includes(values.get(target)?.asset.kind)) unload(target);
                }
            },{rootMargin:'100px'});
            observer.observe(wrapper);
        }
    }
    function render(current,root) {
        clear(root);
        root.replaceChildren();
        for (const asset of media.assetList(current.values)) {
            const figure = document.createElement('figure');
            const preview = document.createElement('div');
            const controls = document.createElement('figcaption');
            figure.append(preview,controls);
            root.append(figure);
            register(preview,current.owner,asset,current.lock);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label','Remove ' + labels[asset.kind].toLowerCase());
            remove.onclick = () => {
                if (!active(current)) return;
                current.values.attachments = media.assetList(current.values).filter(value => value.id !== asset.id);
                changed(current);
            };
            if (asset.kind === 'photo' || asset.kind === 'drawing') {
                const scan = document.createElement('button');
                scan.type = 'button';
                scan.textContent = 'Extract text';
                scan.onclick = async () => {
                    scan.disabled = true;
                    try {
                        const blob = await media.read(current.owner,asset,client,current.lock);
                        const text = await media.recognize(blob,update => {
                            if (update.status === 'recognizing text') scan.textContent = Math.round(update.progress * 100) + '%';
                        });
                        if (!active(current)) return;
                        if (!text) {showToast('No English text was found.','info');return;}
                        const input = document.getElementById('note-body-inp');
                        const next = [input.value.trimEnd(),text].filter(Boolean).join('\n\n');
                        if (next.length > input.maxLength) throw Error('The extracted text would exceed the note limit.');
                        input.value = next;
                        input.dispatchEvent(new Event('input'));
                        showToast('Extracted text added to the note.','success');
                    } catch (error) {if (active(current)) report(error);}
                    finally {scan.disabled = false;scan.textContent = 'Extract text';}
                };
                controls.append(scan);
            }
            controls.append(remove);
        }
    }
    async function attach(current,kind,blob) {
        if (!active(current)) return false;
        if (media.assetList(current.values).length >= 10) throw Error('A note can hold up to 10 attachments.');
        const asset = await media.add(current.owner,kind,blob,current.lock);
        if (!active(current)) return false;
        if (media.assetList(current.values).length >= 10) throw Error('A note can hold up to 10 attachments.');
        current.values.attachments = [...media.assetList(current.values),asset];
        changed(current);
        return true;
    }
    function uploadInput(sheet,current,kind) {
        const input = sheet.querySelector('input[type=file]');
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            input.disabled = true;
            try {if (await attach(current,kind,file) && sheet.open) sheet.close();}
            catch (error) {report(error);input.value = '';}
            finally {input.disabled = false;}
        };
    }
    const pickFile = (current,kind,accept,title) => {
        const sheet = dialog(title,'<label class="notes-file">Choose a file<input type="file" aria-label="Choose a file" accept="' + accept + '"></label>');
        uploadInput(sheet,current,kind);
    };
    function record(current) {
        const sheet = dialog('Voice note','<div class="notes-sheet-fields"><p role="status" data-recording-time>Ready to record</p><button type="button" data-record>Record</button><button type="button" data-record-stop disabled>Add recording</button></div>');
        const status = sheet.querySelector('[data-recording-time]');
        const start = sheet.querySelector('[data-record]');
        const stop = sheet.querySelector('[data-record-stop]');
        let stream, recorder, timer, keep = false;
        const release = () => {
            clearInterval(timer);
            stream?.getTracks().forEach(track => track.stop());
        };
        sheet.addEventListener('close',() => {
            if (recorder?.state === 'recording') recorder.stop();
            release();
        },{once:true});
        stop.onclick = () => {
            if (recorder?.state === 'recording') {keep = true;stop.disabled = true;recorder.stop();}
        };
        start.onclick = async () => {
            start.disabled = true;
            try {
                if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw Error('Voice recording is unavailable on this device.');
                const format = ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
                if (!format) throw Error('This device has no supported audio format.');
                stream = await navigator.mediaDevices.getUserMedia({audio:true});
                if (!sheet.open || !active(current)) {release();return;}
                recorder = new MediaRecorder(stream,{mimeType:format,audioBitsPerSecond:64000});
                const chunks = [];
                recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);};
                recorder.onerror = () => {release();start.disabled = false;report(Error('Recording stopped unexpectedly.'));};
                recorder.onstop = async () => {
                    release();
                    if (!keep || !active(current)) return;
                    try {if (await attach(current,'voice',new Blob(chunks,{type:recorder.mimeType || format}))) sheet.close();}
                    catch (error) {report(error);start.disabled = false;keep = false;}
                };
                recorder.start(1000);
                const started = Date.now();
                stop.disabled = false;
                status.textContent = 'Recording · 0 s';
                timer = setInterval(() => {
                    const seconds = Math.floor((Date.now() - started) / 1000);
                    status.textContent = 'Recording · ' + seconds + ' s';
                    if (seconds >= 120) stop.click();
                },1000);
            } catch (error) {
                release();start.disabled = false;
                report(error.name === 'NotAllowedError' ? Error('Allow microphone access to record audio.') : error);
            }
        };
    }
    function drawing(current) {
        const sheet = dialog('Draw','<div class="notes-sheet-fields"><canvas class="notes-drawing" width="640" height="480" aria-label="Drawing canvas"></canvas><label>Pen colour<input type="color" value="#f0bc00"></label><div class="notes-sheet-actions"><button type="button" data-clear-drawing>Clear</button><button type="button" class="notes-accent" data-add-drawing disabled>Add drawing</button></div></div>');
        const canvas = sheet.querySelector('canvas'), paint = canvas.getContext('2d');
        const color = sheet.querySelector('input'), addButton = sheet.querySelector('[data-add-drawing]');
        let pointer, previous;
        const point = event => {
            const area = canvas.getBoundingClientRect();
            return [(event.clientX - area.left) * canvas.width / area.width,(event.clientY - area.top) * canvas.height / area.height];
        };
        canvas.onpointerdown = event => {
            pointer = event.pointerId;
            previous = point(event);
            canvas.setPointerCapture(pointer);
            paint.fillStyle = color.value;
            paint.beginPath();paint.arc(previous[0],previous[1],3,0,2 * Math.PI);paint.fill();
            addButton.disabled = false;
        };
        canvas.onpointermove = event => {
            if (event.pointerId !== pointer) return;
            const position = point(event);
            paint.lineWidth = 6;paint.lineCap = 'round';paint.strokeStyle = color.value;
            paint.beginPath();paint.moveTo(...previous);paint.lineTo(...position);paint.stroke();
            previous = position;
        };
        canvas.onpointerup = canvas.onpointercancel = () => {pointer = null;};
        sheet.querySelector('[data-clear-drawing]').onclick = () => {paint.clearRect(0,0,canvas.width,canvas.height);addButton.disabled = true;};
        addButton.onclick = () => {
            addButton.disabled = true;
            canvas.toBlob(async blob => {
                try {if (blob && await attach(current,'drawing',blob)) sheet.close();}
                catch (error) {report(error);addButton.disabled = false;}
            },'image/png');
        };
    }
    function picker(current) {
        const sheet = dialog('Stickers and GIFs','<div class="notes-sheet-fields"><div class="notes-filters"><button type="button" data-asset-kind="sticker" aria-pressed="true">Stickers</button><button type="button" data-asset-kind="gif" aria-pressed="false">GIFs</button></div><div class="notes-art-picker"></div><label class="notes-file">Choose a file<input type="file" aria-label="Choose a sticker file" accept="image/webp,image/png"></label></div>');
        const grid = sheet.querySelector('.notes-art-picker');
        const tabs = [...sheet.querySelectorAll('[data-asset-kind]')];
        const file = sheet.querySelector('input');
        let selection = 'sticker';
        const show = async () => {
            const kind = selection;
            file.accept = kind === 'gif' ? 'image/gif,image/webp' : 'image/webp,image/png';
            uploadInput(sheet,current,kind);
            try {
                const loops = await fetch('assets/picker/loops.json').then(result => result.json());
                if (kind !== selection || !sheet.open) return;
                grid.replaceChildren();
                for (const {id,title} of loops) {
                    if (!/^[a-z]+$/.test(id)) continue;
                    const button = document.createElement('button'), image = document.createElement('img');
                    const path = 'assets/picker/' + id;
                    image.alt = title;
                    image.src = path + '.webp';
                    button.type = 'button';button.append(image);
                    button.onclick = async () => {
                        button.disabled = true;
                        try {
                            const response = await fetch(path + (kind === 'gif' ? '.gif' : '.webp'));
                            if (!response.ok) throw Error('The selected animation could not load.');
                            const blob = await response.blob();
                            if (sheet.open && await attach(current,kind,blob)) sheet.close();
                        } catch (error) {report(error);}
                        finally {button.disabled = false;}
                    };
                    grid.append(button);
                }
            } catch (_) {grid.textContent = 'Orbit media could not load. You can choose a file.';}
        };
        tabs.forEach(tab => tab.onclick = () => {
            selection = tab.dataset.assetKind;
            for (const button of tabs) button.setAttribute('aria-pressed',String(tab === button));
            void show();
        });
        void show();
    }
    return {register,clear,render,photo:current => pickFile(current,'photo','image/jpeg,image/png,image/webp','Add photo'),record,drawing,picker};
}
