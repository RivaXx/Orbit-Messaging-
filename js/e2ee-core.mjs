// Signed OpenPGP content and account-bound encrypted recovery backups.
export function createOrbitCryptoEngine(pgp, crypto = globalThis.crypto) {
  const cfg = {v6Keys:true,aeadProtect:true,preferredAEADAlgorithm:pgp.enums.aead.gcm,preferredSymmetricAlgorithm:pgp.enums.symmetric.aes256,preferredCompressionAlgorithm:pgp.enums.compression.uncompressed,allowUnauthenticatedStream:false,maxDecompressedMessageSize:49*1024*1024};
  const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true}),keys=new Map();
  let identity=null;
  const fail=message=>{throw new Error(message);};
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
  const unb64=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))fail('Invalid encrypted data');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
  function requireIdentity(){if(!identity)fail('Unlock encrypted chats first');return identity;}
  function context(value){if(!value||!uuid(value.id)||!uuid(value.sender_id)||typeof value.room!=='string'||value.room.length>256||!Number.isSafeInteger(value.revision)||value.revision<1)fail('Invalid encryption context');return {id:value.id,room:value.room,sender_id:value.sender_id,revision:value.revision};}
  function textBytes(value,max=131072){const bytes=enc.encode(JSON.stringify(value));if(bytes.length>max)fail('Encrypted content is too large');return bytes;}
  async function publicKey(record){
    if(!record||!uuid(record.user_id)||typeof record.public_key!=='string'||record.public_key.length>20000||!/^[a-f0-9]{64}$/i.test(record.fingerprint||''))fail('Invalid account encryption key');
    const cached=keys.get(record.fingerprint);if(cached)return cached;
    const key=await pgp.readKey({armoredKey:record.public_key});
    if(key.getFingerprint()!==record.fingerprint.toLowerCase()||key.keyPacket.version!==6||key.getAlgorithmInfo().algorithm!=='ed25519')fail('Unsupported or substituted encryption key');
    if((await key.getEncryptionKey()).getAlgorithmInfo().algorithm!=='x25519')fail('Unsupported encryption subkey');
    if(keys.size>200)keys.clear();keys.set(record.fingerprint,key);return key;
  }
  async function backupKey(passphrase,salt,usage){
    if(typeof passphrase!=='string'||passphrase.length<20||passphrase.length>256)fail('Use a recovery passphrase of 20 to 256 characters');
    const bytes=enc.encode(passphrase);
    try{const material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:600000,salt},material,{name:'AES-GCM',length:256},false,[usage]);}
    finally{bytes.fill(0);}
  }
  const backupAAD=(userId,fingerprint)=>enc.encode('orbit-e2ee-backup-v1|'+userId+'|'+fingerprint);
  async function makeBackup(privateKey,userId,fingerprint,passphrase){
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await backupKey(passphrase,salt,'encrypt'),plain=textBytes({schema:'orbit-private-key-v1',user_id:userId,fingerprint,private_key:privateKey.armor()},50000);
    try{const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:backupAAD(userId,fingerprint),tagLength:128},key,plain));return {version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)};}
    finally{plain.fill(0);}
  }
  async function generate(userId,passphrase){
    if(!uuid(userId))fail('Invalid account');
    const pair=await pgp.generateKey({type:'curve25519',userIDs:[{name:'Orbit account '+userId}],format:'object',config:cfg});
    const fingerprint=pair.publicKey.getFingerprint(),backup=await makeBackup(pair.privateKey,userId,fingerprint,passphrase);
    identity={userId,fingerprint,privateKey:pair.privateKey,publicKey:pair.publicKey};
    return {user_id:userId,fingerprint,public_key:pair.publicKey.armor(),backup};
  }
  async function unlock(userId,record,backup,passphrase){
    identity=null;if(record.user_id!==userId||!uuid(userId))fail('Wrong backup account');
    const pub=await publicKey(record);
    if(!backup||backup.version!==1||backup.kdf!=='PBKDF2-SHA256'||backup.iterations!==600000||backup.cipher!=='AES-256-GCM'||typeof backup.ciphertext!=='string'||backup.ciphertext.length>80000)fail('Unsupported encrypted backup');
    const salt=unb64(backup.salt),iv=unb64(backup.iv);if(salt.length!==16||iv.length!==12)fail('Invalid encrypted backup');
    const key=await backupKey(passphrase,salt,'decrypt');let plain;
    try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:backupAAD(userId,record.fingerprint),tagLength:128},key,unb64(backup.ciphertext)));}
    catch{fail('Recovery passphrase is incorrect or the backup was altered');}
    try{const saved=JSON.parse(dec.decode(plain));if(saved.schema!=='orbit-private-key-v1'||saved.user_id!==userId||saved.fingerprint!==record.fingerprint)fail('Backup identity mismatch');
      const privateKey=await pgp.readPrivateKey({armoredKey:saved.private_key});
      if(!privateKey.isDecrypted()||privateKey.getFingerprint()!==pub.getFingerprint())fail('Backup identity mismatch');
      identity={userId,fingerprint:record.fingerprint,privateKey,publicKey:pub};return {user_id:userId,fingerprint:identity.fingerprint};
    }finally{plain.fill(0);}
  }
  async function recipientKeys(records){
    const me=requireIdentity();if(!Array.isArray(records)||records.length<1||records.length>100)fail('Invalid recipient list');
    const ids=records.map(r=>r.user_id);if(new Set(ids).size!==ids.length||!ids.includes(me.userId)||records.find(r=>r.user_id===me.userId)?.fingerprint!==me.fingerprint)fail('The encrypted copy must include your account');
    return Promise.all(records.map(publicKey));
  }
  async function encrypt(contextValue,content,records){
    const me=requireIdentity(),ctx=context(contextValue);if(ctx.sender_id!==me.userId)fail('Wrong signing account');
    const encryptionKeys=await recipientKeys(records),plain=textBytes({schema:'orbit-message-v1',context:ctx,content});
    try{return {ciphertext:await pgp.encrypt({message:await pgp.createMessage({binary:plain}),encryptionKeys,signingKeys:me.privateKey,config:cfg}),fingerprint:me.fingerprint,recipients:records.map(r=>r.user_id).sort()};}
    finally{plain.fill(0);}
  }
  async function verifyResult(result){if(result.signatures.length!==1)fail('A valid sender signature is required');await result.signatures[0].verified;}
  async function decrypt(contextValue,ciphertext,sender){
    const me=requireIdentity(),ctx=context(contextValue);if(sender.user_id!==ctx.sender_id||typeof ciphertext!=='string'||ciphertext.length>250000)fail('Invalid encrypted message');
    const verificationKeys=await publicKey(sender),message=await pgp.readMessage({armoredMessage:ciphertext});
    const result=await pgp.decrypt({message,decryptionKeys:me.privateKey,verificationKeys,expectSigned:true,format:'binary',config:{...cfg,maxDecompressedMessageSize:131072}});
    await verifyResult(result);
    try{if(result.data.length>131072)fail('Encrypted content is too large');const value=JSON.parse(dec.decode(result.data));
      if(value.schema!=='orbit-message-v1'||JSON.stringify(context(value.context))!==JSON.stringify(ctx))fail('Encrypted message identity does not match this conversation');return value.content;
    }finally{result.data.fill(0);}
  }
  async function encryptFile(bytes,records){
    const me=requireIdentity();if(!(bytes instanceof Uint8Array)||bytes.length>49*1024*1024)fail('Encrypted files must be under 49 MB');
    const ciphertext=await pgp.encrypt({message:await pgp.createMessage({binary:bytes,filename:'orbit-attachment'}),encryptionKeys:await recipientKeys(records),signingKeys:me.privateKey,format:'binary',config:cfg});
    return {ciphertext,digest:hex(new Uint8Array(await crypto.subtle.digest('SHA-256',ciphertext)))};
  }
  async function decryptFile(bytes,digest,sender){
    const me=requireIdentity();if(!(bytes instanceof Uint8Array)||bytes.length>51*1024*1024||!/^[a-f0-9]{64}$/.test(digest||''))fail('Invalid encrypted file');
    if(hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==digest)fail('Encrypted attachment was replaced or altered');
    const result=await pgp.decrypt({message:await pgp.readMessage({binaryMessage:bytes}),decryptionKeys:me.privateKey,verificationKeys:await publicKey(sender),expectSigned:true,format:'binary',config:cfg});
    await verifyResult(result);if(result.data.length>49*1024*1024)fail('Decrypted attachment exceeds the size limit');return result.data;
  }
  function lock(){identity=null;keys.clear();}
  return {generate,unlock,encrypt,decrypt,encryptFile,decryptFile,lock,publicKey,status:()=>identity?{user_id:identity.userId,fingerprint:identity.fingerprint}:null};
}
