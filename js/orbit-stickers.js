(() => {
    const pack = ['👋','😂','❤️','🎉','👍','🔥','🙌','🤩','😎','🥳','💯','🚀'];
    const valid = sticker => sticker?.version === 1 && (pack.includes(sticker.emoji) ||
        (typeof sticker.image === 'string' && sticker.image.length <= 60000 && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(sticker.image)));
    const markup = sticker => pack.includes(sticker.emoji)
        ? `<span class="orbit-sticker-art" role="img" aria-label="${sticker.emoji} sticker">${sticker.emoji}</span>`
        : `<img class="orbit-sticker-art" src="${sticker.image}" alt="Custom sticker" width="144" height="144" loading="lazy" decoding="async">`;
    const libraryKey = account => `orbit_stickers_v1_${account}`;
    function readLibrary(account) {
        try { return JSON.parse(localStorage.getItem(libraryKey(account)) || '[]'); } catch { return []; }
    }
    function button(label, action) {
        const node = document.createElement('button');
        node.type = 'button';node.textContent = label;node.onclick = action;
        return node;
    }
    async function createSticker(file) {
        if (!/^(image\/(png|jpeg|webp|gif|avif|heic|heif))$/i.test(file.type) || file.size > 12*1024*1024) {
            throw new Error('Choose a supported image under 12 MB.');
        }
        const bitmap = await createImageBitmap(file);
        try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 256;
            const scale = Math.min(256/bitmap.width, 256/bitmap.height);
            const width = Math.round(bitmap.width*scale), height = Math.round(bitmap.height*scale);
            canvas.getContext('2d').drawImage(bitmap, (256-width)/2, (256-height)/2, Math.max(1,width), Math.max(1,height));
            for (const quality of [.86, .68, .5, .32]) {
                const sticker = {version:1,image:canvas.toDataURL('image/webp',quality)};
                if (valid(sticker)) return sticker;
            }
            throw new Error('This image could not be made into a compact WebP sticker.');
        } finally { bitmap.close(); }
    }
    function open() {
        if (!currentUser?.id || !currentRoom) return;
        const account = currentUser.id, room = currentRoom;
        const dialog = document.getElementById('orbit-sticker-picker');
        const grid = dialog.querySelector('.orbit-sticker-grid');
        const status = dialog.querySelector('[role=status]');
        const input = dialog.querySelector('input');
        let sending = false;
        const contextMatches = () => dialog.open && currentUser?.id === account && currentRoom === room;
        function add(sticker) {
            if (!valid(sticker)) return;
            const item = button('', async () => {
                if (sending || !contextMatches()) return;
                sending = true;
                try { if (await sendMessage(sticker)) dialog.close(); }
                finally { sending = false; }
            });
            item.setAttribute('aria-label', sticker.emoji ? `Send ${sticker.emoji} sticker` : 'Send custom sticker');
            item.innerHTML = markup(sticker);
            grid.append(item);
        }
        grid.replaceChildren();status.textContent = '';dialog.showModal();
        pack.forEach(emoji => add({version:1,emoji}));
        if (OrbitCrypto.isUnlocked()) for (const entry of readLibrary(account)) {
            OrbitCrypto.selfOpen(entry).then(record => {if(contextMatches())add(record.sticker);}).catch(()=>{});
        }
        dialog.querySelector('[data-create-sticker]').onclick = () => {
            if (OrbitCrypto.isUnlocked()) input.click();
            else { dialog.close(); OrbitCrypto.open(); }
        };
        input.onchange = async () => {
            const file = input.files[0];input.value = '';
            if (!file || input.disabled || !contextMatches()) return;
            input.disabled = true;status.textContent = 'Creating sticker…';
            try {
                const sticker = await createSticker(file);
                if (!contextMatches()) return;
                const entry = await OrbitCrypto.selfSeal(crypto.randomUUID(), 'local-stickers', {sticker});
                if (!contextMatches()) return;
                const library = readLibrary(account);
                localStorage.setItem(libraryKey(account), JSON.stringify([entry,...library].slice(0,12)));
                add(sticker);status.textContent = 'Sticker saved. Tap it to send.';
            } catch (error) { if (contextMatches()) status.textContent = error.message; }
            finally { input.disabled = false; }
        };
    }
    window.OrbitStickers = {open,valid,markup};
    document.addEventListener('orbit-encryption-locked', () => {
        const dialog = document.getElementById('orbit-sticker-picker');
        if (dialog?.open) dialog.close();
        dialog?.querySelector('.orbit-sticker-grid').replaceChildren();
    });
})();
