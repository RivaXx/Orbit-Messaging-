// Temporary share inbox used by the service worker and the app. Never uploads.
// Each share is encrypted at rest with a non-extractable, local CryptoKey and
// expires in 15 minutes. This is local staging, not protection against same-origin XSS.
(()=>{
 const DB='orbit-share-inbox-v1',TTL=15*60000,MAX_BYTES=100*1024*1024;
 const enc=new TextEncoder();
 function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('shares',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Device storage is unavailable. Open Orbit and attach the file instead.'));});}
 async function transaction(mode,work){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('shares',mode),store=tx.objectStore('shares');let value;tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=tx.onabort=()=>{db.close();reject(Error('Could not save the shared items. Device storage may be full.'));};work(store,v=>value=v);});}
 const list=()=>transaction('readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>done(r.result);});
 const remove=id=>transaction('readwrite',(s)=>s.delete(id));
 async function prune(){for(const row of await list())if(row.expires<=Date.now())await remove(row.id);}
 async function save(form){
  await prune();if((await list()).length>=3)throw Error('Open or discard the previous shares in Orbit before sharing more.');
  const files=form.getAll('files').filter(f=>f instanceof Blob&&f.size>0);
  if(files.length>20||files.some(f=>f.size>49*1024*1024)||files.reduce((n,f)=>n+f.size,0)>MAX_BYTES)throw Error('Share up to 20 files, 49 MB each and 100 MB total.');
  const meta={title:String(form.get('title')||'').slice(0,1000),text:String(form.get('text')||'').slice(0,16000),url:String(form.get('url')||'').slice(0,4000),files:files.map(f=>({name:String(f.name||'Attachment').slice(0,250),type:f.type,size:f.size}))};
  if(!files.length&&!meta.text&&!meta.url&&!meta.title)throw Error('Nothing was shared.');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),id=crypto.randomUUID(),payload=[];
  for(const [index,blob] of [new Blob([JSON.stringify(meta)]),...files].entries()){
   const iv=crypto.getRandomValues(new Uint8Array(12)),plain=await blob.arrayBuffer();
   payload.push({iv,ciphertext:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(id+':'+index)},key,plain)});
  }
  await transaction('readwrite',s=>s.add({id,key,payload,expires:Date.now()+TTL,owner:null}));return id;
 }
 async function receive(id,owner){
  if(!/^[0-9a-f-]{36}$/i.test(id||'')||!owner)throw Error('Sign in to receive shared items.');
  const row=await transaction('readwrite',(s,done)=>{const r=s.get(id);r.onsuccess=()=>{const value=r.result;if(!value||value.expires<=Date.now()||value.owner&&value.owner!==owner){done(null);return;}value.owner=owner;s.put(value);done(value);};});
  if(!row)throw Error('This share expired or belongs to another signed-in account. Share it again from your gallery.');
  const plain=[];for(const [index,item]of row.payload.entries())plain.push(await crypto.subtle.decrypt({name:'AES-GCM',iv:item.iv,additionalData:enc.encode(id+':'+index)},row.key,item.ciphertext));
  const meta=JSON.parse(new TextDecoder().decode(plain[0]));
  return {...meta,files:plain.slice(1).map((bytes,i)=>new File([bytes],meta.files[i].name,{type:meta.files[i].type}))};
 }
 self.OrbitShareInbox={save,receive,remove,prune};
})();

