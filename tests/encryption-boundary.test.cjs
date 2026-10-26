const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/orbit-encryption.js'),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',ROOM='dm_'+A+'_'+B;
const pass='synthetic-only separate recovery passphrase 2026';
let pgp,createOrbitCryptoEngine,a,b,c,database;
class Element{
 constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.textContent='';this.value='';this.classList={add(){},remove(){}};this.dataset={};}
 append(...items){for(const item of items){this.children.push(item);if(item.id)this.doc.ids.set(item.id,item);}}
 addEventListener(){} remove(){this.doc.ids.delete(this.id);} showModal(){} close(){} querySelector(){return null;}
}
function mockClient(db,id){
 const from=table=>{
  const filters=[];let mutation=null,one=false,cap=Infinity;
  const q={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,v){filters.push(r=>v.includes(r[k]));return this;},limit(n){cap=n;return this;},order(){return this;},abortSignal(){return this;},single(){one=true;return this;},maybeSingle(){one=true;return this;},insert(rows){mutation=Array.isArray(rows)?rows:[rows];return this;},
   then(resolve,reject){return Promise.resolve().then(()=>{
    const map=db.tables[table]||(db.tables[table]=new Map());
    if(mutation){for(const row of mutation){if(table==='messages'&&(row.type!=='encrypted'||row.e2ee_version!==1))throw Error('Plaintext rejected by synthetic server');map.set(row.id,structuredClone(row));}return {data:null,error:null};}
    let rows=[...map.values()].filter(r=>filters.every(fn=>fn(r))).slice(0,cap);
    if(table==='orbit_encryption_backups')rows=rows.filter(r=>r.user_id===id);
    return {data:structuredClone(one?rows[0]||null:rows),error:null};
   }).then(resolve,reject);}};return q;
 };
 return {from,rpc:async(name,args)=>{
  if(name==='orbit_encryption_members')return {data:args.chat_room.startsWith('self_')?[id]:db.members||[A,B],error:null};
  if(name==='orbit_register_encryption'){
   if(db.tables.orbit_encryption_keys.has(id))return {error:Error('Identity already registered')};
   db.tables.orbit_encryption_keys.set(id,{user_id:id,fingerprint:args.key_fingerprint,public_key:args.key_public});db.tables.orbit_encryption_backups.set(id,{user_id:id,backup:args.key_backup});return {data:null,error:null};
  }
  if(name==='orbit_e2ee_schedule'){db.schedules.push(args);return {data:args.envelope.id,error:null};}
  if(name==='orbit_e2ee_event'){
   const previous=db.tables.orbit_encrypted_events.get(args.event_key);if((previous?.revision||0)!==args.expected_revision)return {error:Error('Event changed')};
   const event={id:args.event_key,message_key:args.parent_message,kind:args.event_kind,actor:id,revision:args.expected_revision+1,ciphertext:args.body,fingerprint:args.key_fingerprint,recipients:args.key_recipients};db.tables.orbit_encrypted_events.set(event.id,event);return {data:event,error:null};
  }
  throw Error('Unexpected RPC '+name);
 },channel(){return {on(){return this;},send:async()=>{},subscribe(){return this;}};},removeChannel:async()=>{},auth:{onAuthStateChange(){}},storage:{from:()=>({download:async path=>({data:db.files.get(path),error:null})})}};
}
function account(id,db,storage=new Map()){
 const doc={ids:new Map(),createElement(tag){return new Element(tag,this);},getElementById(id){return this.ids.get(id)||null;},querySelectorAll(){return [];},addEventListener(){},dispatchEvent(){}};doc.body=new Element('body',doc);
 const client=mockClient(db,id),toasts=[];
 class CryptoWorker{
  constructor(){this.engine=createOrbitCryptoEngine(pgp);this.closed=false;this.lane=Promise.resolve();}
  postMessage(request){this.lane=this.lane.then(async()=>{try{const result=await this.engine[request.method](...request.args);if(!this.closed)this.onmessage({data:{id:request.id,result}});}catch(e){if(!this.closed)this.onmessage({data:{id:request.id,error:e.message}});}});}
  terminate(){this.closed=true;this.engine.lock();}
 }
 const sandbox={console,Map,Set,Proxy,Promise,JSON,Date,Error,Object,Array,String,Number,Uint8Array,TextEncoder,Blob,File,URL,crypto:globalThis.crypto,Worker:CryptoWorker,setTimeout,clearTimeout,currentUser:{id},document:doc,CustomEvent:class{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},getSupabase:()=>client,messageCache:new Map(),showToast:(...args)=>toasts.push(args),addEventListener(){}};
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const elements=()=>{const all=[];function visit(e){all.push(e);for(const child of e.children)visit(child);}visit(doc.body);return all;};
 async function unlock(password=pass){await sandbox.OrbitCrypto.open();const modal=doc.getElementById('orbit-security-modal'),children=[];function visit(e){children.push(e);for(const child of e.children)visit(child);}visit(modal);for(const input of children.filter(e=>e.tagName==='input'))input.value=password;const submit=children.find(e=>e.tagName==='button'&&/Create encrypted backup|Unlock chats/.test(e.textContent));await submit.onclick();return sandbox.OrbitCrypto.isUnlocked();}
 return {id,client,crypto:sandbox.OrbitCrypto,unlock,sandbox,storage,toasts,elements};
}
const message=(id,text='Private boundary test')=>({id,room:ROOM,sender_id:A,username:'Alice',type:'text',text,attachments:[],created_at:new Date().toISOString()});
before(async()=>{pgp=await import('../assets/vendor/openpgp.min.mjs');({createOrbitCryptoEngine}=await import('../js/e2ee-core.mjs'));database={tables:{messages:new Map(),orbit_encryption_keys:new Map(),orbit_encryption_backups:new Map(),orbit_encrypted_events:new Map()},files:new Map(),schedules:[]};a=account(A,database);b=account(B,database);c=account(C,database);assert.equal(await a.unlock(),true);assert.equal(await b.unlock(),true);assert.equal(await c.unlock(),true);});
test('actual application insert boundary stores signed ciphertext and recipient reads plaintext only after verification',async()=>{
 const id=crypto.randomUUID(),result=await a.client.from('messages').insert([message(id)]);assert.equal(result.error,null);
 const wire=database.tables.messages.get(id);assert.equal(wire.type,'encrypted');assert.equal(wire.e2ee_version,1);assert.ok(!JSON.stringify(wire).includes('Private boundary test'));assert.equal(wire.reply_to,null);
 const received=await b.client.from('messages').select('id,text').eq('id',id).single();assert.equal(received.data.text,'Private boundary test');assert.equal(received.data.sender_id,A);
 const outsider=await c.client.from('messages').select('*').eq('id',id).single();assert.equal(outsider.data._e2ee_locked,true);assert.ok(!outsider.data.text.includes('Private boundary test'));
});
test('recovery backups and local outbox persistence contain neither private key armor nor plaintext',async()=>{
 const item={payload:message(crypto.randomUUID(),'secret offline draft'),mediaUploadInfo:[{name:'private-file-name.jpg'}]};
 const sealed=await a.crypto.sealQueue([item],A),json=JSON.stringify(sealed);assert.ok(!json.includes('secret offline draft'));assert.ok(!json.includes('private-file-name'));
 const restored=await a.crypto.openQueue(sealed);assert.equal(restored[0].payload.text,'secret offline draft');
 const backups=JSON.stringify([...database.tables.orbit_encryption_backups.values()]);assert.ok(!backups.includes('PRIVATE KEY'));assert.ok(!backups.includes(pass));
});
test('tampered ciphertext never becomes readable and transport identity cannot be overwritten by signed content',async()=>{
 const id=crypto.randomUUID();await a.client.from('messages').insert(message(id));
 const wire=database.tables.messages.get(id),tampered=wire.text.replace(/\n([A-Za-z0-9+/]{40,})/,(_,s)=>'\n'+(s[0]==='A'?'B':'A')+s.slice(1));wire.text=tampered;
 const result=await b.client.from('messages').select('*').eq('id',id).single();assert.equal(result.data._e2ee_locked,true);assert.equal(result.data.text,'Encrypted message could not be verified');
 const engine=createOrbitCryptoEngine(pgp),record=database.tables.orbit_encryption_keys.get(A),backup=database.tables.orbit_encryption_backups.get(A).backup;await engine.unlock(A,record,backup,pass);
 const forgedId=crypto.randomUUID(),encrypted=await engine.encrypt({id:forgedId,room:ROOM,sender_id:A,revision:1},{type:'text',text:'signed by Alice',sender_id:C,username:'Impersonated',attachments:[]},[record,database.tables.orbit_encryption_keys.get(B)]);
 database.tables.messages.set(forgedId,{...message(forgedId),type:'encrypted',text:encrypted.ciphertext,e2ee_version:1,e2ee_revision:1,e2ee_sender_fingerprint:record.fingerprint,e2ee_recipients:[A,B]});
 const received=await b.client.from('messages').select('*').eq('id',forgedId).single();assert.equal(received.data.sender_id,A);assert.equal(received.data.username,'Alice');
});
test('attachment bytes and names are encrypted; only a verified parent enables decryption',async()=>{
 const original=new Blob(['private image bytes'],{type:'image/jpeg'}),encrypted=await a.crypto.encryptAttachment(original,ROOM);
 assert.notEqual(await encrypted.body.text(),await original.text());const id=crypto.randomUUID(),path='encrypted/'+A+'/'+id+'.bin';database.files.set(path,encrypted.body);
 await a.client.from('messages').insert({...message(id,'photo caption'),type:'image',attachments:[{encrypted:true,digest:encrypted.digest,recipient_keyset:encrypted.recipientKeyset,storage_bucket:'chat-assets',storage_path:path,name:'private-photo.jpg',mime:'image/jpeg',type:'image',size:original.size,url:'blob:local-preview'}]});
 const wire=database.tables.messages.get(id);assert.ok(!JSON.stringify(wire).includes('private-photo.jpg'));assert.ok(!JSON.stringify(wire).includes('photo caption'));assert.ok(!wire.text.includes('blob:local-preview'));
 const received=(await b.client.from('messages').select('*').eq('id',id).single()).data;assert.equal(received._e2ee_media_pending,true);
 const opened=await b.crypto.materialize(received);assert.equal(await (await fetch(opened.attachments[0].url)).text(),'private image bytes');
 const bad={...received,attachments:[{...received.attachments[0],digest:'0'.repeat(64)}]};await assert.rejects(b.crypto.materialize(bad));
});
test('local media and drafts use encrypted storage and remain recoverable',async()=>{
 const file=new File(['private queued file'],'private.txt',{type:'text/plain'}),saved=await a.crypto.sealLocalFile(file,crypto.randomUUID(),0);
 assert.ok(!(await saved.ciphertext.text()).includes('private queued file'));assert.ok(!JSON.stringify(saved).includes('private.txt'));
 assert.equal(await (await a.crypto.openLocalFile(saved)).text(),'private queued file');
 await a.crypto.saveDraft(ROOM,'private saved draft');assert.ok(!JSON.stringify([...a.storage]).includes('private saved draft'));assert.equal(await a.crypto.readDraft(ROOM),'private saved draft');
});
test('plaintext attachments fail closed; scheduling crosses the same encryption boundary',async()=>{
 const result=await a.client.from('messages').insert({...message(crypto.randomUUID()),type:'image',attachments:[{url:'https://example.test/plain.jpg'}]});assert.equal(result.data,null);assert.equal(result.error.code,'ORBIT_ENCRYPTION');
 const id=crypto.randomUUID();const scheduled=await a.client.rpc('orbit_schedule_message',{request_id:id,chat_room:ROOM,body:'private future message',send_at:new Date(Date.now()+3600000).toISOString()});assert.equal(scheduled.error,null);assert.ok(!JSON.stringify(database.schedules).includes('private future message'));assert.equal(database.schedules.at(-1).envelope.id,id);
});
test('group membership changes block media prepared for a different recipient key set',async()=>{
 const encrypted=await a.crypto.encryptAttachment(new Blob(['group photo']),ROOM),id=crypto.randomUUID();database.members=[A,B,C];
 try{const sent=await a.client.from('messages').insert({...message(id),type:'image',attachments:[{encrypted:true,digest:encrypted.digest,recipient_keyset:encrypted.recipientKeyset,storage_bucket:'chat-assets',storage_path:'encrypted/'+A+'/photo.bin',mime:'image/jpeg'}]});assert.match(sent.error.message,/membership changed/);assert.equal(database.tables.messages.has(id),false);}
 finally{delete database.members;}
});
test('reactions and poll votes are separately signed encrypted state; authors cannot prefill other users votes',async()=>{
 const id=crypto.randomUUID();await a.client.from('messages').insert(message(id));
 assert.equal((await b.client.rpc('orbit_security_react',{message_key:id,emoji:'👍'})).error,null);
 let received=(await a.client.from('messages').select('*').eq('id',id).single()).data;assert.deepEqual(Array.from(received.reactions['👍']),[B]);
 assert.ok(!JSON.stringify([...database.tables.orbit_encrypted_events.values()]).includes('👍'));
 await b.client.rpc('orbit_security_react',{message_key:id,emoji:'👍'});received=(await a.client.from('messages').select('*').eq('id',id).single()).data;assert.equal(Object.keys(received.reactions).length,0);
 const pollId=crypto.randomUUID();await a.client.from('messages').insert({...message(pollId,'Private question'),type:'poll',attachments:[{type:'poll',poll:{question:'Private question',options:[{text:'Option one',votes:999,voters:[C]},{text:'Option two',votes:0,voters:[]}]}}]});
 let poll=(await b.client.from('messages').select('*').eq('id',pollId).single()).data;assert.equal(poll.attachments[0].poll.options[0].votes,0);
 const vote=await b.client.rpc('orbit_security_vote',{message_key:pollId,option_index:1});assert.equal(vote.error,null);
 poll=(await a.client.from('messages').select('*').eq('id',pollId).single()).data;assert.equal(poll.attachments[0].poll.options[1].votes,1);assert.deepEqual(Array.from(poll.attachments[0].poll.options[1].voters),[B]);
});
test('recipient roster changes require a visible participant review before text can send',async()=>{
 database.members=[A,B,C];a.sandbox.currentRoom=ROOM;
 try{
  const blocked=await a.client.from('messages').insert(message(crypto.randomUUID()));assert.match(blocked.error.message,/Review the participant list/);
  await a.crypto.open();const approve=a.elements().find(e=>e.textContent==='Approve these participants');assert.ok(approve);approve.onclick();
  const id=crypto.randomUUID();assert.equal((await a.client.from('messages').insert(message(id))).error,null);assert.ok(database.tables.messages.get(id).e2ee_recipients.includes(C));
  delete database.members;await a.crypto.open();const removal=a.elements().find(e=>e.textContent==='Approve these participants');assert.ok(removal);removal.onclick();
 }finally{delete database.members;delete a.sandbox.currentRoom;}
});
test('signed five-minute location expiry survives manipulated server expiry metadata',async()=>{
 const id=crypto.randomUUID();await a.client.from('messages').insert({...message(id,'geo:15.56986,73.86357'),type:'location',attachments:['https://maps.google.com/?q=15.56986,73.86357']});
 const location=(await b.client.from('messages').select('*').eq('id',id).single()).data;assert.equal(location.type,'location');assert.ok(Date.parse(location.expires_at)<=Date.now()+300000);
 const now=Date.now();class LaterDate extends Date{static now(){return now+300100;}}b.sandbox.Date=LaterDate;
 database.tables.messages.get(id).expires_at=new Date(now+86400000).toISOString();
 try{const expired=(await b.client.from('messages').select('*').eq('id',id).single()).data;assert.equal(expired.is_deleted,true);assert.ok(!expired.text.includes('15.56986'));assert.equal(expired.attachments.length,0);}
 finally{b.sandbox.Date=Date;}
});
test('fresh device decrypts persisted drafts and detects a replaced contact key',async()=>{
 await a.crypto.saveDraft(ROOM,'saved encrypted recovery draft');const fresh=account(A,database,a.storage);assert.equal(await fresh.unlock(),true);assert.equal(await fresh.crypto.readDraft(ROOM),'saved encrypted recovery draft');fresh.crypto.lock();
 const old=database.tables.orbit_encryption_keys.get(A),replacement=database.tables.orbit_encryption_keys.get(C),id=crypto.randomUUID();await a.client.from('messages').insert(message(id));
 database.tables.orbit_encryption_keys.set(A,{...replacement,user_id:A});
 try{const freshBob=account(B,database,b.storage);assert.equal(await freshBob.unlock(),true);const received=(await freshBob.client.from('messages').select('*').eq('id',id).single()).data;assert.equal(received._e2ee_locked,true);freshBob.crypto.lock();}
 finally{database.tables.orbit_encryption_keys.set(A,old);}
});
test('the actual dispatcher preserves encrypted pending sends while locked and restores them after recovery',async()=>{
 const storage=new Map(),device=account(A,database,storage);assert.equal(await device.unlock(),true);
 device.sandbox.navigator={onLine:false};device.sandbox.deduplicateAndSort=rows=>rows;
 const code=fs.readFileSync(require('node:path').join(__dirname,'../js/chat/chat-dispatcher.js'),'utf8');vm.runInContext(code,device.sandbox);
 const id=crypto.randomUUID(),room='self_'+A,body='private pending send survives locking';
 vm.runInContext(`_outboxHydratedForUser=${JSON.stringify(A)};_messageOutbox.set(${JSON.stringify(id)},${JSON.stringify({payload:{...message(id,body),room},aliases:[room],status:'queued'})});`,device.sandbox);
 await device.sandbox._persistMessageOutbox(A);const key='orbit_message_outbox_v1_'+A,saved=storage.get(key);assert.ok(saved);assert.ok(!saved.includes(body));
 device.crypto.lock();await device.sandbox._persistMessageOutbox(A);assert.equal(storage.get(key),saved);
 const delivered=[];device.sandbox._deliverOutboxMessage=async id=>delivered.push(id);
 assert.equal(await device.unlock(),true);assert.ok(delivered.includes(id));assert.equal(vm.runInContext(`_messageOutbox.get(${JSON.stringify(id)}).payload.text`,device.sandbox),body);
 device.crypto.lock();
});
test('lock removes access and a separate recovery passphrase unlocks the same history on another device',async()=>{
 const id=crypto.randomUUID();await a.client.from('messages').insert(message(id,'recoverable history'));
 const another=account(B,database);assert.equal(await another.unlock('wrong synthetic recovery passphrase'),false);assert.equal(another.crypto.isUnlocked(),false);
 assert.equal(await another.unlock(pass),true);assert.equal((await another.client.from('messages').select('*').eq('id',id).single()).data.text,'recoverable history');
 another.crypto.lock();assert.equal((await another.client.from('messages').select('*').eq('id',id).single()).data._e2ee_locked,true);
 const pendingItem={payload:{id:'pending'}};a.sandbox._messageOutbox=new Map([['pending',pendingItem]]);a.sandbox._outboxHydratedForUser=A;a.sandbox._inflightMessages=new Map([['pending',{text:'private inflight draft'}]]);
 a.crypto.lock();assert.equal(pendingItem.cancelled,true);assert.equal(a.sandbox._outboxHydratedForUser,null);assert.equal(a.sandbox._inflightMessages.size,0);b.crypto.lock();c.crypto.lock();
});
