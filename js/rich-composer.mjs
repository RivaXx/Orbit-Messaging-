import {describeRichImage, limit} from './rich-image.mjs';

const input = document.getElementById('msg-input');
const preview = document.getElementById('orbit-rich-preview');
const screen = document.getElementById('screen-chat');
const image = preview.querySelector('img');
const caption = preview.querySelector('input');
const send = preview.querySelector('[data-send-rich]');
const sticker = preview.querySelector('[data-send-sticker]');
const info = preview.querySelector('[role=status]');
let focus = null, draft = null, opening = false;
const snapshot = () => ({account:currentUser?.id,room:currentRoom,epoch:_chatViewEpoch});
const same = data => {
    const now = snapshot();
    return !!data?.account && !!data.room && data.account === now.account && data.room === now.room && data.epoch === now.epoch && screen.classList.contains('active');
};

function cancel() {
    if (!draft) return false;
    URL.revokeObjectURL(draft.url);
    draft = null; image.removeAttribute('src'); caption.value = '';
    preview.hidden = true;
    return true;
}

function announceFocus() {
    if (!window.OrbitDevice) return;
    const state = snapshot();
    if (document.activeElement === input && same(state)) {
        if (same(focus) && focus.connected) return;
        focus = {...state,token:crypto.randomUUID(),connected:true};
        OrbitDevice('richComposerFocus',{token:focus.token}).catch(()=>{});
    } else if (focus?.connected) {
        focus.connected = false;
        OrbitDevice('richComposerFocus').catch(()=>{});
    }
}

async function validate(file, original) {
    if (!file.size || file.size > limit) throw new Error('Choose media under 12 MB.');
    const details = describeRichImage(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
    const normalized = new File([file], 'Keyboard media.'+({gif:'gif',webp:'webp',jpeg:'jpg',png:'png'}[details.mime.split('/')[1]]), {type:details.mime});
    const url = URL.createObjectURL(normalized);
    const probe = new Image(); probe.src = url;
    try {
        await probe.decode();
        if (!same(original)) throw new Error('The chat changed before the media was ready.');
        cancel();
        draft = {...original,file:normalized,url,details};
        image.src = url;
        info.textContent = (details.animated ? 'Animation' : 'Image')+' · '+details.width+' × '+details.height;
        send.textContent = details.animated ? 'Send as GIF' : 'Send image';
        preview.hidden = false;
    } catch (error) {
        URL.revokeObjectURL(url);
        throw new Error(same(original) ? 'This image could not be decoded.' : error.message);
    }
}

async function receive({id, token}) {
    if (!/^orbit-ime-[a-f0-9-]{36}$/.test(id)) return;
    const original = focus;
    let owned = false;
    try {
        if (original?.token !== token || !same(original) || opening) return;
        owned = opening = true;
        const response = await fetch('/_orbit-composer-media/'+id,{cache:'no-store'});
        if (!response.ok) throw new Error('The keyboard media expired. Choose it again.');
        await validate(await response.blob(), original);
    } catch (error) {
        if (same(original)) showToast(error.message,'error');
    } finally {
        if (owned) opening = false;
        window.OrbitDevice?.('discardRichContent',{id}).catch(()=>{});
    }
}

async function queue(data,file,mode) {
    if (draft !== data || !same(data)) throw new Error('Open the original chat before sending this media.');
    const captionText = caption.value;
    const dimensions = mode === 'sticker' ? {width:512,height:512} : {width:data.details.width,height:data.details.height};
    await queueMediaMessage([{file,name:file.name,type:'image',dimensions}],captionText,'image',{
        roomId:data.room,userId:data.account,pickerMedia:mode,preserveDraft:true
    });
    if (draft === data) cancel();
}

send.onclick = async () => {
    const data = draft;
    if (!data || send.disabled) return;
    send.disabled = sticker.disabled = true;
    try { await queue(data,data.file,data.details.animated?'gif':null); }
    catch (error) { showToast(error.message,'error'); }
    finally { send.disabled = sticker.disabled = false; }
};
sticker.onclick = async () => {
    const data = draft;
    if (!data || !same(data) || sticker.disabled) return;
    sticker.disabled = true;
    try {
        const {openStickerEditor} = await import('./sticker-editor.mjs?v=orbit-1.4.0');
        if (draft === data && same(data)) await openStickerEditor(data.file, file=>queue(data,file,'sticker'),'Send sticker');
    } catch (error) { showToast(error.message,'error'); }
    finally { sticker.disabled = false; }
};
preview.querySelector('[data-cancel-rich]').onclick = cancel;
input.addEventListener('focus',announceFocus);
input.addEventListener('blur',announceFocus);
input.addEventListener('paste', async event => {
    const clipboard = event.clipboardData;
    const files = clipboard?.files?.length ? Array.from(clipboard.files) :
        Array.from(clipboard?.items || []).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
    if (files.length !== 1 || !/^image\/(gif|png|webp|jpeg)$/i.test(files[0].type)) return;
    const original = snapshot();
    if (!same(original)) return;
    event.preventDefault();
    event.stopPropagation();
    if (opening) { showToast('Wait for the current image to load.','info'); return; }
    opening = true;
    try { await validate(files[0],original); }
    catch (error) { if(same(original))showToast(error.message,'error'); }
    finally { opening = false; }
});
new MutationObserver(() => {
    if (!screen.classList.contains('active')) { cancel(); announceFocus(); }
}).observe(screen,{attributes:true,attributeFilter:['class']});
function reset() {
    if (focus?.connected) window.OrbitDevice?.('richComposerFocus').catch(()=>{});
    focus = null;
    cancel();
}
document.addEventListener('orbit-encryption-locked',reset);
window.OrbitRichInput = {receive,cancel,reset};
