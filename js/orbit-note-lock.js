/* Note locks use a random per-note key and an independently recoverable envelope. */
const OrbitNoteLock = (() => {
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const bytes = length => crypto.getRandomValues(new Uint8Array(length));
    const encode = value => {
        const input = new Uint8Array(value);
        let result = '';
        for (let i = 0; i < input.length; i += 8192) result += String.fromCharCode(...input.subarray(i,i + 8192));
        return btoa(result);
    };
    const decode = value => Uint8Array.from(atob(value),character => character.charCodeAt(0));
    const importKey = raw => crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
    const params = (iv,scope) => ({name:'AES-GCM',iv,additionalData:encoder.encode(scope)});
    const scope = (owner,id,purpose) => 'orbit-note-v1:' + owner + ':' + id + ':' + purpose;
    async function passKey(phrase,salt) {
        const secret = await crypto.subtle.importKey('raw',encoder.encode(phrase.normalize('NFKC')),'PBKDF2',false,['deriveKey']);
        return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},secret,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    }
    async function seal(key,contents,aad) {
        const iv = bytes(12);
        const data = await crypto.subtle.encrypt(params(iv,aad),key,contents);
        return {iv:encode(iv),data:encode(data)};
    }
    const unseal = (key,box,aad) => crypto.subtle.decrypt(params(decode(box.iv),aad),key,decode(box.data));
    function valid(box) {
        return box?.v === 1 && /^[a-f0-9-]{36}$/i.test(box.id || '') && /^[a-z0-9+/]{22}==$/i.test(box.salt || '') &&
            /^[a-z0-9+/]{16}$/i.test(box.iv || '') && /^[a-z0-9+/]{16}$/i.test(box.wrap?.iv || '') &&
            typeof box.data === 'string' && box.data.length <= 1200000 && typeof box.wrap?.data === 'string' && box.wrap.data.length === 64;
    }
    async function create(owner,phrase) {
        if (phrase.trim().length < 12 || phrase.length > 256) throw Error('Use a recovery passphrase with 12 to 256 characters.');
        const salt = bytes(16), raw = bytes(32), id = OrbitNoteStore.id();
        const wrap = await seal(await passKey(phrase,salt),raw,scope(owner,id,'key'));
        return {owner,raw,key:await importKey(raw),box:{v:1,id,salt:encode(salt),wrap}};
    }
    async function open(owner,box,{phrase,deviceKey}) {
        if (!valid(box)) throw Error('This note lock is invalid.');
        try {
            const raw = deviceKey ? decode(deviceKey) : new Uint8Array(await unseal(await passKey(phrase,decode(box.salt)),box.wrap,scope(owner,box.id,'key')));
            const key = await importKey(raw);
            const decoded = await unseal(key,box,scope(owner,box.id,'note'));
            return {owner,raw,key,box,values:JSON.parse(decoder.decode(decoded))};
        } catch (_) {throw Error('Could not unlock this note. Check the recovery passphrase.');}
    }
    async function pack(session,values) {
        const data = {title:values.title || 'Untitled',content:values.content || '',tags:values.tags || [],
            color:values.color || 'default',folder:values.folder || '',attachments:values.attachments || []};
        const encrypted = data.attachments.map(asset => ({id:asset.id,kind:'sealed',mime:'application/octet-stream'}));
        const lockbox = {...session.box,...await seal(session.key,encoder.encode(JSON.stringify(data)),scope(session.owner,session.box.id,'note'))};
        return {title:'Locked note',content:'',tags:[],color:'default',folder:'',attachments:encrypted,document:null,lockbox};
    }
    async function encryptBlob(session,id,blob) {
        const iv = bytes(12);
        const body = await crypto.subtle.encrypt(params(iv,scope(session.owner,session.box.id,'media:' + id)),session.key,await blob.arrayBuffer());
        return new Blob([iv,body],{type:'application/octet-stream'});
    }
    async function decryptBlob(session,asset,blob) {
        const binary = new Uint8Array(await blob.arrayBuffer());
        const plain = await crypto.subtle.decrypt(params(binary.subarray(0,12),scope(session.owner,session.box.id,'media:' + asset.id)),session.key,binary.subarray(12));
        return new Blob([plain],{type:asset.mime});
    }
    return {create,open,pack,encryptBlob,decryptBlob,deviceKey:session => encode(session.raw)};
})();
