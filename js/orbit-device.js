// Android exposes this endpoint only to the bundled Orbit document.
(() => {
    const bridge = window.OrbitDevicePort;
    if (!bridge) return;
    const waiting = new Map();
    let sequence = 0;
    bridge.onmessage = ({data}) => {
        const reply = JSON.parse(data);
        const request = waiting.get(reply.id);
        if (!request) return;
        waiting.delete(reply.id);
        clearTimeout(request.timer);
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.value);
    };
    window.OrbitDevice = (method, args = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
            waiting.delete(id);
            reject(new Error('Android did not respond. Try again.'));
        }, method==='requestNotifications'?120000:10000);
        waiting.set(id, {resolve, reject, timer});
        bridge.postMessage(JSON.stringify({id, method, args}));
    });
    document.documentElement.classList.add('orbit-android');
    window.orbitAndroidBack = () => {
        const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
        if (dialog) {
            if (dialog.dispatchEvent(new Event('cancel', {cancelable:true}))) dialog.close();
            return true;
        }
        if (window.OrbitRichInput?.cancel()) return true;
        if (document.querySelector('.orbit-data-overlay')) { window.OrbitChatData?.close(); return true; }
        if (document.querySelector('#modal-share-app.active')) { window.closeShareAppModal(); return true; }
        if (document.querySelector('#modal-orbit-weather.active')) { closeOrbitWeatherConsent(); return true; }
        if (document.querySelector('#modal-orbit-editor.active')) { closeOrbitMediaEditor(); return true; }
        if (document.querySelector('#modal-media-preview.active')) { closeMediaPreviewScreen(); return true; }
        if (document.querySelector('.glass-modal-overlay.active, #screen-chat.active, #screen-profile.active, #user-dropdown.open')) {
            window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
            return true;
        }
        return false;
    };
})();

(() => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const encoder = new TextEncoder();
    let database;
    function openDatabase() {
        return database ||= new Promise((resolve, reject) => {
            const request = indexedDB.open('orbit-trusted-browser-v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('accounts');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => { database = null; reject(request.error); };
        });
    }
    async function storage(account, action, value) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('accounts', action === 'get' ? 'readonly' : 'readwrite');
            const store = transaction.objectStore('accounts');
            const request = action === 'put' ? store.put(value, account) : store[action](account);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    window.OrbitTrustedDevice = {
        async remember(account, record, backup, passphrase) {
            const key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const bytes = encoder.encode(passphrase);
            try {
                const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode(account)}, key, bytes);
                const createdAt = Date.now();
                await storage(account, 'put', {record, backup, key, iv, ciphertext, createdAt});
            } finally { bytes.fill(0); }
        },
        async restore(account) {
            if (window.OrbitDevice) return OrbitDevice('restore', {account});
            const saved = await storage(account, 'get');
            if (!saved) return null;
            const age = Date.now()-saved.createdAt;
            if (!Number.isFinite(age) || age < 0 || age >= week) { await this.forget(account); return null; }
            const bytes = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:saved.iv, additionalData:encoder.encode(account)}, saved.key, saved.ciphertext));
            try { return {record:saved.record, backup:saved.backup, passphrase:new TextDecoder().decode(bytes)}; }
            finally { bytes.fill(0); }
        },
        forget(account) {
            if (!account) return Promise.resolve();
            return window.OrbitDevice ? OrbitDevice('forget', {account}) : storage(account, 'delete');
        }
    };
})();
