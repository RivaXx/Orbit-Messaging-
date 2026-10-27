// Account-key E2EE boundary. Plaintext is confined to this tab and its worker.
// The backend authenticates membership; signed ciphertext authenticates content.
(()=>{
 'use strict';
 const VERSION=1,contentFields=new Set(['text','type','attachments','reply_to','metadata']);
 const wires=new Map(),records=new Map(),blobs=new Map(),decoded=new Map(),pending=new Map(),drafts=new Map();
 let worker=null,sequence=0,epoch=0,owner=null,unlocked=false,rawClient=null,rawFrom=null,rawRpc=null,modalBusy=false,eventChannel=null;
 const uid=()=>typeof currentUser!=='undefined'?currentUser?.id:null;
 const error=message=>Object.assign(new Error(message),{code:'ORBIT_ENCRYPTION'});
 const checkOwner=id=>{if(!id||id!==uid()||id!==owner)throw error('The signed-in account changed. Unlock encrypted chats again.');};
 const digestText=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
 const keyset=keys=>digestText(keys.map(k=>k.user_id+':'+k.fingerprint).sort().join('|'));
 function rememberWire(row){const known=wires.get(row.id);if(known&&(known.deleted_at||Number(known.e2ee_revision)>Number(row.e2ee_revision)))return known;if(wires.size>1500)wires.delete(wires.keys().next().value);wires.set(row.id,row);return row;}
 function reset(){
  epoch++;unlocked=false;owner=null;modalBusy=false;worker?.terminate();worker=null;
  document.getElementById('orbit-security-modal')?.remove();
  if(eventChannel&&rawClient)rawClient.removeChannel(eventChannel).catch(()=>{});eventChannel=null;
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(error('Encrypted chats were locked'));}pending.clear();
  for(const value of blobs.values())URL.revokeObjectURL(value);blobs.clear();wires.clear();records.clear();decoded.clear();
  if(typeof messageCache!=='undefined')messageCache.clear();
  document.querySelectorAll('[data-e2ee-message]').forEach(el=>el.remove());
  document.querySelectorAll('[src^="blob:"]').forEach(el=>el.removeAttribute('src'));
  document.querySelectorAll('.c-last-msg').forEach(el=>{el.textContent='Unlock chats to view previews';});
  const composer=document.getElementById('msg-input');if(composer)composer.value='';
  for(const close of ['closeMediaLightbox','closeChatMediaGallery','closePdfViewer','closeXlsxViewer','closeViewOnceViewer'])try{if(typeof window[close]==='function')window[close]();}catch(_){/* Some viewers are not mounted yet. */}
  drafts.clear();
  if(typeof _messageOutbox!=='undefined'){_messageOutbox.forEach(item=>{item.cancelled=true;});_messageOutbox.clear();}
  if(typeof _outboxHydratedForUser!=='undefined')_outboxHydratedForUser=null;
  if(typeof _inflightMessages!=='undefined')_inflightMessages.clear();
  if(typeof _mediaOutboxMemory!=='undefined')_mediaOutboxMemory.clear();
  document.dispatchEvent(new CustomEvent('orbit-encryption-locked'));
 }
 function syncOwner(){const id=uid();if(owner&&owner!==id)reset();owner=id;return id;}
 async function call(method,...args){
  const idOwner=syncOwner();if(!idOwner)throw error('Sign in before opening encrypted chats');
  if(!worker){
   worker=new Worker('js/e2ee-worker.mjs',{type:'module',name:'Orbit encryption'});
   worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);
    if(task.epoch!==epoch||task.owner!==uid())task.reject(error('The account changed'));
    else data.error?task.reject(error(data.error)):task.resolve(data.result);};
   worker.onerror=()=>{reset();showToast('Encryption could not start. Update your browser and reload Orbit.','error');};
  }
  const id=++sequence,requestEpoch=epoch;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(id);reject(error('Encryption timed out. Retry with a smaller attachment.'));},60000);
   pending.set(id,{resolve,reject,timer,owner:idOwner,epoch:requestEpoch});worker.postMessage({id,method,args});
  });
 }
 async function mustUnlock(){syncOwner();if(!unlocked){void open();throw error('Unlock encrypted chats before sending. Your draft is still here.');}return owner;}
 async function result(query){const r=await query;if(r.error)throw r.error;return r.data;}
 async function keyFor(id,refresh=false){
  if(!refresh&&records.has(id))return records.get(id);
  const account=uid();
  const record=await result(rawFrom('orbit_encryption_keys').select('*').eq('user_id',id).maybeSingle());
  checkOwner(account);
  if(!record)throw error('A conversation member has not set up encrypted chats yet. Ask them to open Chat security.');
  // Pinning detects a later directory substitution. First contact must still be
  // verified out of band; it is never described as a verified identity by default.
  const pinKey=`orbit_key_pin_${uid()}_${id}`,saved=localStorage.getItem(pinKey);
  if(saved&&saved!==record.fingerprint)throw error('An encryption identity changed. Sending is blocked. Verify the contact before continuing.');
  if(!saved)localStorage.setItem(pinKey,record.fingerprint);
  records.set(id,record);return record;
 }
 async function recipients(room){
  const id=await mustUnlock(),members=await result(rawRpc('orbit_encryption_members',{chat_room:room}));
  if(!Array.isArray(members)||!members.includes(id)||members.length>100)throw error('Invalid encrypted conversation membership');
  const rosterKey=`orbit_recipient_roster_${id}_${room}`,roster=JSON.stringify([...members].sort()),previous=localStorage.getItem(rosterKey);
  if(previous&&previous!==roster)throw error('Conversation membership changed. Review the participant list in Chat security before sending.');
  if(!previous)localStorage.setItem(rosterKey,roster);
  const missing=members.filter(member=>!records.has(member));
  if(missing.length){
   const rows=await result(rawFrom('orbit_encryption_keys').select('*').in('user_id',missing));
   for(const row of rows||[]){
    const pinKey=`orbit_key_pin_${id}_${row.user_id}`,pin=localStorage.getItem(pinKey);
    if(pin&&pin!==row.fingerprint)throw error('An encryption identity changed. Verify your contact before sending.');
    if(!pin)localStorage.setItem(pinKey,row.fingerprint);records.set(row.user_id,row);
   }
  }
  const list=await Promise.all(members.map(member=>keyFor(member)));checkOwner(id);return list;
 }
 const context=(row,revision=row.e2ee_revision||1)=>({id:row.id,room:row.room,sender_id:row.sender_id,revision});
 function logical(row){
  let reply=row.reply_to||null;if(typeof reply==='string'){try{reply=JSON.parse(reply);}catch{reply=null;}}
  if(reply&&(reply.type==='location'||/^geo:/i.test(reply.text||'')))reply={id:reply.id,username:reply.username,type:'location',text:'Location shared for 5 minutes'};
  return {type:row.type||'text',text:row.text||'',attachments:row.attachments||[],reply_to:reply,metadata:row.metadata||{},is_forwarded:!!row.is_forwarded};
 }
 function parseAttachments(value){if(!Array.isArray(value))return [];return value.map(a=>{if(typeof a==='string'){try{return JSON.parse(a);}catch{return a;}}return a;});}
 async function seal(row){
  const id=await mustUnlock();if(row.sender_id!==id)throw error('A message cannot be signed for another account');
  if(!row.id)row.id=crypto.randomUUID();
  if(row.e2ee_version===1&&row.type==='encrypted')return row;
  const recipientRecords=await recipients(row.room),recipientKeyset=await keyset(recipientRecords);
  const content={...logical(row),attachments:parseAttachments(row.attachments)},refs=[];
  if(content.type==='location'){content.location_issued_at=new Date().toISOString();content.location_expires_at=new Date(Date.now()+300000).toISOString();}
  if(['image','video','file','audio','voice'].includes(content.type)&&!content.attachments.length)throw error('Attach the original file so it can be encrypted before sending.');
  content.attachments=content.attachments.map(a=>a?.encrypted?{...a,url:''}:a);
  for(const attachment of content.attachments){
   if(['image','video','file','audio','voice'].includes(content.type)&&(attachment?.url||attachment?.storage_path)){
    if(!attachment.encrypted||!attachment.digest||!attachment.storage_path)throw error('This attachment must be encrypted before it can send. Attach the original file again.');
    if(attachment.recipient_keyset!==recipientKeyset)throw error('Conversation membership changed after media encryption. Attach the original files again so every current member can open them.');
    refs.push({encrypted:true,storage_bucket:attachment.storage_bucket,storage_path:attachment.storage_path,digest:attachment.digest,...(attachment.view_once?{view_once:true}:{})});
   }
  }
  const encrypted=await call('encrypt',context(row),content,recipientRecords);checkOwner(id);
  const wire={id:row.id,room:row.room,sender_id:id,username:row.username||'Orbit user',created_at:row.created_at||new Date().toISOString(),type:'encrypted',text:encrypted.ciphertext,attachments:refs,
   reply_to:null,metadata:{},e2ee_expires:content.type==='location',e2ee_version:VERSION,e2ee_revision:row.e2ee_revision||1,e2ee_sender_fingerprint:encrypted.fingerprint,e2ee_recipients:encrypted.recipients};
  rememberWire(wire);return wire;
 }
 async function decode(row){
  if(!row||row.e2ee_version!==1)return row;
  const wire=rememberWire(row._e2ee_wire||row);row=wire;
  if(row.deleted_at||row.is_deleted)return {...row,text:'🚫 This message was deleted',attachments:[],reply_to:null,reactions:{},_e2ee_wire:wire};
  const placeholder={...wire,text:unlocked?'Encrypted message could not be verified':'🔒 Unlock encrypted chats to read this message',type:'text',attachments:[],reply_to:null,metadata:{},_e2ee_wire:wire,_e2ee_locked:true};
  if(!unlocked||owner!==uid())return placeholder;
  const cacheKey=row.id+':'+row.e2ee_revision+':'+await digestText(row.text);
  if(decoded.has(cacheKey)){
   const cached=decoded.get(cacheKey);if(cached.type==='location'&&Date.now()>=Date.parse(cached.expires_at))return {...placeholder,text:'Location expired',is_deleted:true};
   return {...cached,read_by:row.read_by,delivered_to:row.delivered_to,pinned:row.pinned};
  }
  try{
   const id=owner,sender=await keyFor(row.sender_id);
   if(sender.fingerprint!==row.e2ee_sender_fingerprint)throw error('Sender encryption key does not match');
   const content=await call('decrypt',context(row),row.text,sender);checkOwner(id);
   if(!content||!['text','image','video','file','audio','voice','poll','contact','location'].includes(content.type)||typeof content.text!=='string'||content.text.length>10000||!Array.isArray(content.attachments)||content.attachments.length>100)throw error('Unsupported encrypted message content');
   const attachments=parseAttachments(content.attachments);
   if(['image','video','file','audio','voice'].includes(content.type)&&attachments.some(a=>!a?.encrypted))throw error('An encrypted media message cannot contain a plaintext attachment');
   // The signed parent binds each ciphertext digest and storage reference.
   const refs=parseAttachments(wire.attachments);
   for(const a of attachments.filter(a=>a?.encrypted))if(!refs.some(r=>r.digest===a.digest&&r.storage_path===a.storage_path&&r.storage_bucket===a.storage_bucket))throw error('Encrypted attachment identity mismatch');
   const value={...wire,type:content.type,text:content.text,reply_to:content.reply_to||null,metadata:content.metadata||{},is_forwarded:!!content.is_forwarded,attachments,_e2ee_wire:wire,_e2ee_locked:false,_e2ee_media_pending:attachments.some(a=>a?.encrypted&&!a.view_once),e2ee_version:1};
   if(content.type==='location'){
    const issued=Date.parse(content.location_issued_at),expires=Date.parse(content.location_expires_at);
    if(!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued||expires-issued>300100)throw error('Invalid signed location expiry');
    value.expires_at=new Date(Math.min(expires,Date.parse(wire.created_at)+300000)).toISOString();
    if(Date.parse(value.expires_at)<=Date.now())return {...placeholder,text:'Location expired',is_deleted:true};
   }
   if(decoded.size>300)decoded.delete(decoded.keys().next().value);decoded.set(cacheKey,value);return value;
  }catch(e){console.warn('[Orbit encryption] A message failed authentication');return {...placeholder,_e2ee_error:true};}
 }
 async function eventContent(event){
  const sender=await keyFor(event.actor);if(sender.fingerprint!==event.fingerprint)throw error('Event identity changed');
  const value=await call('decrypt',{id:event.id,room:'event:'+event.message_key,sender_id:event.actor,revision:event.revision},event.ciphertext,sender);
  if(value.parent!==event.message_key||value.purpose!==event.kind)throw error('Event does not belong to this message');return value;
 }
 async function applyEvents(rows){
  const eligible=rows.filter(row=>row?.e2ee_version===1&&!row._e2ee_locked&&!row.deleted_at);
  if(!eligible.length||!unlocked)return rows;
  const events=await result(rawFrom('orbit_encrypted_events').select('*').in('message_key',eligible.map(row=>row.id)).limit(5000));
  const byMessage=new Map(eligible.map(row=>[row.id,{...row,reactions:{}}]));
  for(const row of byMessage.values())if(row.type==='poll'){
   row.attachments=JSON.parse(JSON.stringify(row.attachments));
   for(const option of row.attachments?.[0]?.poll?.options||[]){option.voters=[];option.votes=0;}
  }
  for(const event of events||[]){
   const row=byMessage.get(event.message_key);if(!row)continue;
   try{const value=await eventContent(event);
    if(event.kind==='reaction'&&typeof value.value==='string'&&value.value.length>0&&value.value.length<=32){(row.reactions[value.value]||(row.reactions[value.value]=[])).push(event.actor);}
    if(event.kind==='vote'&&row.type==='poll'&&Array.isArray(value.value)){
   const poll=row.attachments?.[0]?.poll;if(!poll||!Array.isArray(poll.options))continue;
     const choices=[...new Set(value.value)];if(choices.length>(poll.multiple_answers?poll.options.length:1)||choices.some(i=>!Number.isInteger(i)||i<0||i>=poll.options.length))continue;
     for(const i of choices){const option=poll.options[i];option.voters=Array.isArray(option.voters)?option.voters:[];if(!option.voters.includes(event.actor))option.voters.push(event.actor);option.votes=option.voters.length;}
    }
   }catch{console.warn('[Orbit encryption] An unauthenticated reaction or vote was ignored');}
  }
  return rows.map(row=>{const merged=byMessage.get(row?.id);if(!merged)return row;return {...merged,reply_to:{...merged.reply_to,reactions:merged.reactions}};});
 }
 async function mapData(value){
  const rows=await Promise.all((Array.isArray(value)?value:[value]).map(decode));
  const merged=await applyEvents(rows);return Array.isArray(value)?merged:merged[0];
 }
 async function eventAction(messageId,kind,choice){
  await mustUnlock();const wire=await result(rawFrom('messages').select('*').eq('id',messageId).single());
  if(wire.e2ee_version!==1)return result(rawRpc(kind==='reaction'?'orbit_security_react':'orbit_security_vote',kind==='reaction'?{message_key:messageId,emoji:choice}:{message_key:messageId,option_index:choice}));
  const row=await decode(wire);if(row._e2ee_locked)throw error('Unlock and verify this message first');
  const saved=await result(rawFrom('orbit_encrypted_events').select('*').eq('message_key',messageId).eq('actor',owner).eq('kind',kind).maybeSingle());
  let value=kind==='reaction'?'':[];if(saved)value=(await eventContent(saved)).value;
  if(kind==='reaction'){if(typeof choice!=='string'||choice.length>32)throw error('Invalid reaction');value=value===choice?'':choice;}
  else{
   const poll=row.attachments?.[0]?.poll;if(row.type!=='poll'||!Array.isArray(poll?.options)||!Number.isInteger(choice)||choice<0||choice>=poll.options.length)throw error('Invalid poll choice');
   const old=Array.isArray(value)?value:[];value=old.includes(choice)?old.filter(i=>i!==choice):poll.multiple_answers?[...old,choice]:[choice];
  }
  const eventId=saved?.id||crypto.randomUUID(),revision=(saved?.revision||0)+1;
  const encrypted=await call('encrypt',{id:eventId,room:'event:'+messageId,sender_id:owner,revision},{purpose:kind,parent:messageId,value},await recipients(wire.room));
  await result(rawRpc('orbit_e2ee_event',{event_key:eventId,parent_message:messageId,event_kind:kind,expected_revision:revision-1,body:encrypted.ciphertext,key_fingerprint:encrypted.fingerprint,key_recipients:encrypted.recipients}));
  const updated=(await applyEvents([row]))[0];return kind==='reaction'?updated.reactions:null;
 }
 function query(table){
  if(!['messages','orbit_scheduled_messages'].includes(table))return rawFrom(table);
  const operations=[];let promise;
  const execute=()=>promise||(promise=(async()=>{
   const id=syncOwner();let builder=rawFrom(table);
   for(const [method,args] of operations){
    let next=args;
    if(table==='messages'&&(method==='insert'||method==='upsert')){
     const rows=Array.isArray(args[0])?args[0]:[args[0]],encrypted=[];
     for(const row of rows)encrypted.push(await seal(row));next=[Array.isArray(args[0])?encrypted:encrypted[0],...args.slice(1)];
    }else if(table==='messages'&&method==='update'&&Object.keys(args[0]||{}).some(k=>contentFields.has(k))){
     throw error('Use the signed encrypted edit operation to change a message');
    }else if(method==='select'&&typeof args[0]==='string'&&/\b(text|attachments|type)\b|\*/.test(args[0])){
     next=['*',...args.slice(1)];
    }
    builder=builder[method](...next);
   }
   const answer=await builder;if(id!==uid())return {...answer,data:null,error:error('The account changed')};
   if(answer.error||answer.data==null)return answer;
   if(table==='orbit_scheduled_messages'){
    const unwrap=async row=>row.e2ee_envelope?{...row,text:(await decode(row.e2ee_envelope)).text}:row;
    return {...answer,data:Array.isArray(answer.data)?await Promise.all(answer.data.map(unwrap)):await unwrap(answer.data)};
   }
   return {...answer,data:await mapData(answer.data)};
  })().catch(e=>({data:null,error:e})));
  const proxy=new Proxy({}, {get(_target,name){
   if(name==='then')return (resolve,reject)=>execute().then(resolve,reject);
   if(name==='catch')return reject=>execute().catch(reject);
   if(name==='finally')return finish=>execute().finally(finish);
   if(name==='__orbit')return true;
   return (...args)=>{if(promise)throw error('Query already executed');operations.push([name,args]);return proxy;};
  }});return proxy;
 }
 async function edit(id,text){
  await mustUnlock();const wire=await result(rawFrom('messages').select('*').eq('id',id).single());
  if(wire.e2ee_version!==1)throw error('Legacy messages cannot be edited into encrypted messages. Send a new encrypted message instead.');
  const message=await decode(wire);if(message._e2ee_locked||message.type!=='text'||message.attachments.length)throw error('This message cannot be edited');
  const encrypted=await call('encrypt',context(wire,wire.e2ee_revision+1),{...logical(message),text},await recipients(wire.room));
  const updated=await result(rawRpc('orbit_e2ee_edit',{message_key:id,expected_revision:wire.e2ee_revision,ciphertext:encrypted.ciphertext,fingerprint:encrypted.fingerprint,recipients:encrypted.recipients}));
  return decode(updated);
 }
 function install(client){
  if(!client||client.__orbitEncrypted)return;rawClient=client;rawFrom=client.from.bind(client);rawRpc=client.rpc.bind(client);
  client.from=query;client.rpc=(name,args,...rest)=>{
   if(name==='orbit_edit_message')return edit(args.message_key,args.new_text).then(data=>({data,error:null}),e=>({data:null,error:e}));
   if(name==='orbit_schedule_message')return schedule(args).then(data=>({data,error:null}),e=>({data:null,error:e}));
   if(name==='orbit_security_react'||name==='orbit_security_vote')return eventAction(args.message_key,name==='orbit_security_react'?'reaction':'vote',name==='orbit_security_react'?args.emoji:args.option_index).then(data=>({data,error:null}),e=>({data:null,error:e}));
   return rawRpc(name,args,...rest);
  };
  const channel=client.channel.bind(client);
  client.channel=(...args)=>{
   const ch=channel(...args),on=ch.on.bind(ch),send=ch.send.bind(ch);let lane=Promise.resolve();
   ch.on=(kind,filter,callback)=>on(kind,filter,kind==='postgres_changes'&&filter.table==='messages'?(payload=>{
    const account=uid();lane=lane.then(async()=>{const next=payload.new?.id?await mapData(payload.new):payload.new;if(account===uid())callback({...payload,new:next});}).catch(()=>{});
   }):callback);
   ch.send=event=>send(event?.type==='broadcast'&&event.event==='new_message'?{...event,payload:{id:event.payload?.id,room:event.payload?.room}}:event);return ch;
  };
  client.__orbitEncrypted=true;
  client.auth.onAuthStateChange((_event,session)=>{if(owner&&owner!==session?.user?.id)reset();});
 }
 async function encryptAttachment(body,room){
  const id=await mustUnlock(),fileBytes=new Uint8Array(await body.arrayBuffer()),recipientRecords=await recipients(room);
  try{const value=await call('encryptFile',fileBytes,recipientRecords);checkOwner(id);return {body:new Blob([value.ciphertext],{type:'application/octet-stream'}),digest:value.digest,recipientKeyset:await keyset(recipientRecords)};}
  finally{fileBytes.fill(0);}
 }
 async function schedule(args){
  const id=await mustUnlock();
  const envelope=await seal({id:args.request_id,room:args.chat_room,sender_id:id,text:args.body,type:'text',attachments:[]});
  return result(rawRpc('orbit_e2ee_schedule',{envelope,send_at:args.send_at}));
 }
 async function decryptAttachment(blob,attachment,senderId){
  const id=await mustUnlock(),bytes=await call('decryptFile',new Uint8Array(await blob.arrayBuffer()),attachment.digest,await keyFor(senderId));checkOwner(id);
  const mime=/html|javascript|svg|xml/i.test(attachment.mime||'')?'application/octet-stream':attachment.mime||'application/octet-stream';
  return new Blob([bytes],{type:mime});
 }
 async function materialize(message){
  await mustUnlock();const account=uid();
  const attachments=[];let totalBytes=0;
  for(const attachment of message.attachments){
   if(!attachment?.encrypted||attachment.view_once){attachments.push(attachment);continue;}
   const cacheKey=account+':'+attachment.digest;let url=blobs.get(cacheKey);
   if(!url){
    const {data:blob,error:failure}=await rawClient.storage.from(attachment.storage_bucket).download(attachment.storage_path);if(failure)throw failure;
    totalBytes+=blob.size;if(blob.size>51*1024*1024||totalBytes>100*1024*1024)throw error('This media batch is too large to open safely on this device.');
    const plain=await decryptAttachment(blob,attachment,message.sender_id);checkOwner(account);url=URL.createObjectURL(plain);blobs.set(cacheKey,url);
   }
   attachments.push({...attachment,url});
  }
  const next={...message,attachments,_e2ee_media_pending:false};
  if(typeof messageCache!=='undefined')messageCache.forEach((rows,room)=>{messageCache.set(room,rows.map(row=>row.id===next.id?next:row));});
  for(const [key,row]of decoded)if(row.id===next.id)decoded.set(key,next);
  return next;
 }
 async function loadMedia(id,button){
  const message=typeof orbitFindMessage==='function'?orbitFindMessage(id):null;if(!message)return;
  if(button)button.disabled=true;
  try{const next=await materialize(message),node=document.getElementById('msg-'+id);if(node)node.replaceWith(createMessageDOMNode(next,node.classList.contains('grouped-consecutive')));}
  catch(e){if(button){button.disabled=false;button.textContent='Retry encrypted attachment';}showToast(e.message,'error');}
 }
 function mediaNode(message,consecutive){
  const shell=createMessageDOMNode({...message,type:'text',attachments:[],text:message.text||'Encrypted attachments',_e2ee_media_pending:false},consecutive);
  const button=document.createElement('button');button.type='button';button.className='glass-btn-primary';button.textContent=`Open ${message.attachments.length} encrypted attachment${message.attachments.length===1?'':'s'}`;
  button.onclick=()=>loadMedia(message.id,button);(shell.querySelector('.msg-bubble-card')||shell).append(button);
  if(typeof IntersectionObserver!=='undefined'&&message.attachments.every(a=>a.type==='image'&&!a.view_once)){
   const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();void loadMedia(message.id,button);}},{rootMargin:'120px'});observer.observe(button);
  }
  shell.dataset.e2eeMessage='true';shell.oncontextmenu=e=>{e.preventDefault();showToast('Open the encrypted attachments before forwarding or downloading.');};return shell;
 }
 async function selfSeal(id,room,content){await mustUnlock();return {id,room,sender_id:owner,...await call('encrypt',{id,room,sender_id:owner,revision:1},content,[await keyFor(owner)])};}
 async function selfOpen(record){await mustUnlock();return call('decrypt',{id:record.id,room:record.room,sender_id:record.sender_id,revision:1},record.ciphertext,await keyFor(owner));}
 async function saveDraft(room,text){
  const id=uid(),version=crypto.randomUUID();drafts.set(id+':'+room,{text,version});
  if(!unlocked)return;
  const sealed=await selfSeal(version,'local-draft:'+room,{purpose:'draft',text});checkOwner(id);
  if(drafts.get(id+':'+room)?.version===version){localStorage.setItem(`orbit_encrypted_draft_${id}_${room}`,JSON.stringify(sealed));localStorage.removeItem(`orbit_draft_${room}`);}
 }
 async function readDraft(room){
  const saved=drafts.get(uid()+':'+room);if(saved)return saved.text;
  if(!unlocked)return '';
  const raw=localStorage.getItem(`orbit_encrypted_draft_${uid()}_${room}`);
  if(raw){try{const value=await selfOpen(JSON.parse(raw));if(value.purpose==='draft')return value.text;}catch{return '';}}
  return localStorage.getItem(`orbit_draft_${room}`)||'';
 }
 function clearDraft(room){drafts.set(uid()+':'+room,{text:'',version:crypto.randomUUID()});localStorage.removeItem(`orbit_encrypted_draft_${uid()}_${room}`);localStorage.removeItem(`orbit_draft_${room}`);}
 async function sealLocalFile(file,messageId,index){
  await mustUnlock();const encrypted=await call('encryptFile',new Uint8Array(await file.arrayBuffer()),[await keyFor(owner)]);
  return {version:1,ciphertext:new Blob([encrypted.ciphertext],{type:'application/octet-stream'}),digest:encrypted.digest,owner,
   metadata:await selfSeal(messageId,'local-file:'+index,{purpose:'local-file',mime:file.type||'application/octet-stream',name:file.name||''})};
 }
 async function openLocalFile(saved){
  if(saved instanceof Blob)return saved; // Legacy queued files migrate on their next write.
  if(saved?.version!==1||saved.owner!==uid())throw error('This queued file belongs to another account');
  const meta=await selfOpen(saved.metadata);if(meta.purpose!=='local-file')throw error('Invalid queued media');
  const bytes=await call('decryptFile',new Uint8Array(await saved.ciphertext.arrayBuffer()),saved.digest,await keyFor(owner));
  return new File([bytes],meta.name||'Attachment',{type:meta.mime});
 }
 async function sealQueue(items,account){
  const id=await mustUnlock();if(id!==account)throw error('The queue belongs to another account');
  return Promise.all(items.map(item=>selfSeal(item.payload.id,'local-outbox:'+id,{purpose:'outbox',item})));
 }
 async function openQueue(items){
  const opened=[];for(const saved of items){if(saved.ciphertext){const value=await selfOpen(saved);if(value.purpose==='outbox')opened.push(value.item);}else opened.push(saved);}return opened;
 }
 function safeStorage(key,value){
  if(key.startsWith('orbit_cache_msgs_')){
   try{return JSON.stringify(JSON.parse(value).map(row=>{
    const wire=row._e2ee_wire||wires.get(row.id);
    if(row.deleted_at&&wire)return {...wire,deleted_at:row.deleted_at,text:'🚫 This message was deleted',attachments:[],reply_to:null};
    if(['queued','sending','failed','error'].includes(row.status)||String(row.id).startsWith('opt_'))return null;
    return wire||(row.e2ee_version===1?null:row);
   }).filter(Boolean));}catch{return '[]';}
  }
  if(key.startsWith('orbit_recent_chats_v27_')){try{return JSON.stringify(JSON.parse(value).map(row=>({...row,msgPreview:'🔒 Open chat to read messages'})));}catch{return '[]';}}
  return value;
 }
 function addText(parent,tag,text){const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;}
 function watchEvents(){
  if(eventChannel)rawClient.removeChannel(eventChannel).catch(()=>{});const account=uid();
  eventChannel=rawClient.channel('orbit_encrypted_events_'+account).on('postgres_changes',{event:'*',schema:'public',table:'orbit_encrypted_events'},async event=>{
   try{if(account!==uid()||!unlocked)return;const id=event.new?.message_key;if(!id)return;
    const wire=await result(rawFrom('messages').select('*').eq('id',id).maybeSingle());if(!wire)return;const row=await mapData(wire);
    if(account!==uid())return;
    if(typeof handleRealtimeUpdate==='function')handleRealtimeUpdate({new:row},row.room,typeof resolveRoomAliases==='function'?resolveRoomAliases(row.room):[row.room]);
   }catch{ /* Reopening the chat reloads confirmed encrypted events. */ }
  }).subscribe();
 }
 async function open(){
  if(modalBusy)return;
  syncOwner();if(!owner){showToast('Sign in first.');return;}
  document.getElementById('orbit-security-modal')?.remove();
  const dialog=document.createElement('dialog');dialog.id='orbit-security-modal';dialog.className='orbit-security-modal';
  dialog.setAttribute?.('aria-label','Chat security');
  dialog.addEventListener('cancel',event=>{if(modalBusy)event.preventDefault();});
  addText(dialog,'h2','Chat security');const close=document.createElement('button');close.type='button';close.className='orbit-security-close';close.textContent='Close';close.onclick=()=>{if(!modalBusy){dialog.close();dialog.remove();}};dialog.append(close);
  const status=addText(dialog,'p','Checking your encryption identity…');document.body.append(dialog);dialog.showModal();
  try{
   const id=owner,record=await result(rawFrom('orbit_encryption_keys').select('*').eq('user_id',id).maybeSingle());checkOwner(id);
   status.textContent=unlocked?'Encrypted chats are unlocked on this tab.':record?'Unlock your encrypted chats with your separate recovery passphrase.':'Set up end-to-end encrypted chats. Choose a separate recovery passphrase of at least 20 characters.';
   if(record){addText(dialog,'small','Your identity fingerprint');addText(dialog,'code',record.fingerprint.match(/.{1,8}/g).join(' '));}
   if(typeof activeChatPeerId!=='undefined'&&activeChatPeerId&&activeChatPeerId!==id){
    try{const peer=await keyFor(activeChatPeerId,true);checkOwner(id);
     addText(dialog,'small','Contact fingerprint · compare with your contact over another trusted channel');
     addText(dialog,'code',peer.fingerprint.match(/.{1,8}/g).join(' '));
     addText(dialog,'p','An encrypted connection does not by itself verify who owns a first-contact key. Compare both full fingerprints before sharing sensitive information.');
    }catch(e){addText(dialog,'p',e.message);}
   }
   if(unlocked&&typeof currentRoom!=='undefined'&&currentRoom){
    const room=currentRoom,memberIds=await result(rawRpc('orbit_encryption_members',{chat_room:room}));checkOwner(id);
    const rosterKey=`orbit_recipient_roster_${id}_${room}`,roster=JSON.stringify([...memberIds].sort()),previous=localStorage.getItem(rosterKey);
    addText(dialog,'h3','Conversation participants');
    addText(dialog,'p','Compare this list and the fingerprints with the people you intend to message. Membership changes block sending until you review them.');
    for(const member of memberIds){
     const contact=typeof globalUsersMap!=='undefined'?globalUsersMap.get(member):null;
     addText(dialog,'small',(member===id?'You':contact?.display_name||'Account')+' · '+member);
     try{const key=await keyFor(member,true);addText(dialog,'code',key.fingerprint.match(/.{1,8}/g).join(' '));}catch(e){addText(dialog,'small',e.message);}
    }
    if(previous&&previous!==roster){const approve=document.createElement('button');approve.type='button';approve.textContent='Approve these participants';approve.onclick=()=>{checkOwner(id);localStorage.setItem(rosterKey,roster);approve.disabled=true;approve.textContent='Participant list approved';};dialog.append(approve);}
   }
   addText(dialog,'p','Keep the recovery passphrase safe. Orbit cannot recover encrypted history if you lose it. Your login password is separate. Old chat history remains server-readable.');
   if(unlocked){const lock=document.createElement('button');lock.type='button';lock.textContent='Lock encrypted chats';lock.onclick=async()=>{
    const input=document.getElementById('msg-input');if(input?.value&&typeof currentRoom!=='undefined'&&currentRoom)await saveDraft(currentRoom,input.value);
    if(typeof _persistMessageOutbox==='function')await _persistMessageOutbox(id);reset();dialog.close();dialog.remove();
   };dialog.append(lock);return;}
   const label=addText(dialog,'label','Recovery passphrase');const input=document.createElement('input');input.type='password';input.autocomplete=record?'current-password':'new-password';input.minLength=20;input.maxLength=256;label.append(input);
   let confirmInput;if(!record){const confirmLabel=addText(dialog,'label','Confirm recovery passphrase');confirmInput=document.createElement('input');confirmInput.type='password';confirmInput.autocomplete='new-password';confirmLabel.append(confirmInput);}
   const submit=document.createElement('button');submit.type='button';submit.textContent=record?'Unlock chats':'Create encrypted backup';dialog.append(submit);
   submit.onclick=async()=>{
    if(modalBusy)return;const passphrase=input.value;if(passphrase.length<20||passphrase.length>256){status.textContent='Use a recovery passphrase of 20 to 256 characters.';return;}
    if(confirmInput&&passphrase!==confirmInput.value){status.textContent='The recovery passphrases do not match.';return;}
    const operationEpoch=epoch;
    modalBusy=true;submit.disabled=true;close.disabled=true;input.value='';if(confirmInput)confirmInput.value='';status.textContent='Protecting your encryption identity…';
    try{
     if(record){const backup=await result(rawFrom('orbit_encryption_backups').select('backup').eq('user_id',id).single());await call('unlock',id,record,backup.backup,passphrase);records.set(id,record);}
     else{const saved=await call('generate',id,passphrase);checkOwner(id);await result(rawRpc('orbit_register_encryption',{key_fingerprint:saved.fingerprint,key_public:saved.public_key,key_backup:saved.backup}));records.set(id,{user_id:id,fingerprint:saved.fingerprint,public_key:saved.public_key});}
     checkOwner(id);unlocked=true;dialog.close();dialog.remove();watchEvents();
     if(typeof messageCache!=='undefined')messageCache.clear();document.dispatchEvent(new CustomEvent('orbit-encryption-unlocked'));
     if(typeof _hydrateAndResumeMessageOutbox==='function')await _hydrateAndResumeMessageOutbox(id);
     if(typeof currentRoom!=='undefined'&&currentRoom&&typeof fetchFreshRoomMessages==='function')fetchFreshRoomMessages(currentRoom);
     if(typeof loadMainChats==='function')loadMainChats();showToast('Encrypted chats unlocked.','success');
    }catch(e){if(operationEpoch!==epoch)return;unlocked=false;await call('lock').catch(()=>{});status.textContent=e.message||'Could not unlock encrypted chats.';submit.disabled=false;close.disabled=false;}
    finally{if(operationEpoch===epoch)modalBusy=false;}
   };
  }catch(e){status.textContent=e.message||'Chat security could not load.';}
 }
 function setupUI(){
  for(const [id,cls]of [['user-dropdown','dropdown-item'],['chat-options-dropdown','chat-option-item']]){const menu=document.getElementById(id);if(menu){const button=document.createElement('button');button.type='button';button.className=cls;button.textContent='🔒 Chat security';button.onclick=()=>{menu.classList.add('hide');void open();};menu.append(button);}}
 }
 function forgetBefore(cutoff){for(const [id,row]of wires)if(Date.parse(row.created_at)<cutoff)wires.delete(id);for(const [key,row]of decoded)if(Date.parse(row.created_at)<cutoff)decoded.delete(key);for(const url of blobs.values())URL.revokeObjectURL(url);blobs.clear();}
 window.OrbitCrypto={install,open,lock:reset,requireUnlocked:mustUnlock,seal,decode,decodeMany:mapData,encryptAttachment,decryptAttachment,materialize,mediaNode,selfSeal,selfOpen,saveDraft,readDraft,clearDraft,sealQueue,openQueue,sealLocalFile,openLocalFile,safeStorage,forgetBefore,wireFor:id=>wires.get(id),isUnlocked:()=>unlocked&&owner===uid()};
 install(typeof getSupabase==='function'?getSupabase():null);
 document.addEventListener('DOMContentLoaded',setupUI);
 window.addEventListener('pagehide',reset);
})();
