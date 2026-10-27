// Chat archives and OS share reception. Nothing restores deleted server history.
(()=>{
 'use strict';
 let active=null,archive=null,urls=[],busy=false,shareOpened=false;
 const account=()=>typeof currentUser!=='undefined'?currentUser?.id:null;
 const check=id=>{if(account()!==id)throw Error('The signed-in account changed. Please start again.');};
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const button=(label,fn)=>{const node=el('button',label);node.type='button';node.onclick=fn;return node;};
 function close(){active?.remove();active=null;archive=null;urls.forEach(URL.revokeObjectURL);urls=[];}
 function panel(title){
  if(busy)return null;close();
  const overlay=el('div',undefined,'orbit-data-overlay'),dialog=el('section',undefined,'orbit-data-dialog');
  overlay.append(dialog);dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);
  const head=el('header');head.append(el('h2',title),button('Close',close));dialog.append(head);
  document.body.append(overlay);active=overlay;dialog.tabIndex=-1;dialog.focus();return dialog;
 }
 const status=(box,text)=>{box.textContent=text;};
 function targets(){
  const rows=new Map();
  if(typeof allRoomsMap!=='undefined')allRoomsMap.forEach(room=>{
   if(!room?.participants?.includes(account()))return;
   const peer=room.is_direct?room.participants.find(id=>id!==account()):null;
   const user=typeof globalUsersMap!=='undefined'?globalUsersMap.get(peer):null;
   rows.set(room.id,{id:room.id,title:user?.display_name||room.name||room.title||'Conversation',peer});
  });
  if(typeof myFriendsSet!=='undefined'&&typeof globalUsersMap!=='undefined')myFriendsSet.forEach(id=>{
   const user=globalUsersMap.get(id);if(!user||[...rows.values()].some(r=>r.peer===id))return;
   rows.set('dm_'+id,{id:'dm_'+id,title:user.display_name||'Contact',peer:id});
  });
  return [...rows.values()].sort((a,b)=>a.title.localeCompare(b.title));
 }
 function saveBlob(blob,name){
  const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=name.replace(/[\\/:*?"<>|]/g,'_');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 function attachments(row){return (row.attachments||[]).map(a=>{if(typeof a==='string'){try{return JSON.parse(a);}catch{return {url:a};}}return a;}).filter(a=>a&&typeof a==='object');}
 async function mediaBlob(a,row,client){
  if(a.encrypted){const r=await client.storage.from(a.storage_bucket).download(a.storage_path);if(r.error)throw r.error;return window.OrbitCrypto.decryptAttachment(r.data,a,row.sender_id);}
  const url=await resolveMediaUrlForAccess(a.url||a.storage_path);
  if(!url||!/^https:\/\//.test(url))throw Error('An attachment is unavailable. Retry or export without media.');
  const response=await fetch(url,{signal:AbortSignal.timeout(45000),credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw Error('An attachment could not be downloaded. Retry or export without media.');
  return response.blob();
 }
 async function* records(owner,scope,withMedia,progress,core){
  const client=await ensureSupabase(),snapshot=new Date().toISOString();check(owner);
  yield {kind:'manifest',created_at:snapshot,scope:scope||'all',media:withMedia,rooms:targets().map(({id,title})=>({id,title}))};
  let cursor=null,count=0,bytes=0;
  while(true){
   check(owner);if(!progress.isConnected)throw Error('Backup cancelled.');let q=client.from('messages').select('*').lt('created_at',snapshot).order('created_at').order('id').limit(100);
   if(scope)q=q.eq('room',scope);
   if(cursor)q=q.or('created_at.gt.'+cursor.created_at+',and(created_at.eq.'+cursor.created_at+',id.gt.'+cursor.id+')');
   const answer=await q;if(answer.error)throw answer.error;check(owner);
   const rows=answer.data||[];if(!rows.length)break;
   for(const row of rows){
    cursor={created_at:row.created_at,id:row.id};if(typeof orbitIsMessageHidden==='function'&&orbitIsMessageHidden(row.id))continue;
    if(row._e2ee_locked&&!row.deleted_at&&!row.is_deleted)throw Error('Unlock Chat security, then retry the backup. Unverified messages cannot be exported.');
    if(++count>10000)throw Error('Select one chat for backups larger than 10,000 messages.');
    const expired=row.type==='location'&&Date.parse(row.location_expires_at||row.expires_at)<=Date.now();
    const saved={id:row.id,room:row.room,sender_id:row.sender_id,username:row.username||'Orbit user',created_at:row.created_at,type:row.type,text:expired?'Location expired':String(row.text||''),deleted:!!(row.deleted_at||row.is_deleted),attachments:[]};
    if(row.reply_to&&!saved.deleted){let reply=row.reply_to;try{if(typeof reply==='string')reply=JSON.parse(reply);}catch{reply=null;}if(reply)saved.quote={username:reply.username||'Orbit user',text:reply.type==='location'||/geo:|Location \(GPS\)/i.test(reply.text||'')?'Location shared':String(reply.text||'').slice(0,10000)};}
    if(saved.deleted)saved.text='This message was deleted';
    for(const [index,a]of attachments(row).entries()){
     // View-once and expired coordinates are deliberately not retained in archives.
     if(a.view_once||row.type==='view_once'||expired||saved.deleted)continue;
     const fileId=row.id+':'+index,meta={id:fileId,name:String(a.name||'Attachment').slice(0,250),type:a.type||row.type,mime:a.mime||'',included:false};
     if(a.poll||a.contact)meta.detail=a.poll||a.contact;
     if(withMedia&&(a.url||a.storage_path)&&['image','video','file','document','xlsx','audio','voice'].includes(a.type||row.type)){
      progress.textContent='Backing up message '+count+' · downloading '+meta.name;
      let blob=await mediaBlob(a,row,client);check(owner);
      bytes+=blob.size;if(blob.size>49*1024*1024||bytes>110*1024*1024)throw Error('Media exceeds this archive’s limit. Select one chat or export without media.');
      meta.included=true;meta.mime=blob.type||meta.mime;meta.size=blob.size;
      yield {kind:'file',...meta};
      for(let offset=0;offset<blob.size;offset+=core.CHUNK_SIZE){check(owner);yield {kind:'chunk',id:fileId,offset,data:core.backupBase64(new Uint8Array(await blob.slice(offset,offset+core.CHUNK_SIZE).arrayBuffer()))};}
      blob=null;
     }
     saved.attachments.push(meta);
    }
    yield {kind:'message',message:saved};progress.textContent='Encrypting '+count+' messages…';
   }
   if(rows.length<100)break;
  }
  yield {kind:'summary',messages:count,media_bytes:bytes};
 }
 async function openBackup(){
  const owner=account();if(!owner){showToast('Sign in before backing up chats.','info');return;}
  const box=panel('Chat backup & restore');if(!box)return;
  box.append(el('p','Save a private, encrypted copy of chats you can access. Keep its passphrase: Orbit cannot reset it. Restore opens an archive on this device and never republishes messages.'));
  const scope=el('select');scope.setAttribute('aria-label','Backup conversation');scope.append(new Option('All my chats',''));targets().forEach(t=>scope.append(new Option(t.title,t.id)));box.append(scope);
  const media=el('input');media.type='checkbox';media.checked=true;const mediaLabel=el('label','Include photos, videos and files ');mediaLabel.prepend(media);box.append(mediaLabel);
  const pass=el('input');pass.type='password';pass.autocomplete='new-password';pass.placeholder='Separate backup passphrase (20+ characters)';pass.setAttribute('aria-label','Backup passphrase');pass.maxLength=256;box.append(pass);
  const repeat=el('input');repeat.type='password';repeat.autocomplete='new-password';repeat.placeholder='Repeat passphrase for a new backup';repeat.setAttribute('aria-label','Repeat backup passphrase');box.append(repeat);
  const note=el('p','Up to 10,000 messages and 110 MB of media per archive. For larger histories, export individual chats. View-once media and expired locations are excluded.','orbit-data-muted');box.append(note);
  const progress=el('p','', 'orbit-data-status');progress.setAttribute('role','status');box.append(progress);
  const exportBtn=button('Create encrypted backup',async()=>{
   if(busy)return;let password=pass.value;
   if(password!==repeat.value){status(progress,'The passphrases do not match.');return;}
   busy=true;exportBtn.disabled=restoreBtn.disabled=true;
   try{check(owner);const core=await import('./chat-backup-core.mjs');status(progress,'Preparing encrypted archive…');const stream=records(owner,scope.value,media.checked,progress,core);
    const blob=await core.createBackup(stream,password,owner);check(owner);if(!box.isConnected)throw Error('Backup cancelled.');saveBlob(blob,'Orbit-'+new Date().toISOString().slice(0,10)+'.orbitbackup');status(progress,'Backup created. Keep the downloaded file and passphrase somewhere safe.');
   }catch(e){status(progress,e.message);}finally{password='';pass.value=repeat.value='';busy=false;exportBtn.disabled=restoreBtn.disabled=false;}
  });
  const input=el('input');input.type='file';input.accept='.orbitbackup,application/vnd.orbit.backup';input.hidden=true;
  const restoreBtn=button('Open a backup',()=>input.click());
  input.onchange=async()=>{
   const file=input.files?.[0];if(!file||busy)return;busy=true;exportBtn.disabled=restoreBtn.disabled=true;let password=pass.value;
   try{
    check(owner);const core=await import('./chat-backup-core.mjs'),messages=[],files=new Map();let manifest=null,summary=null,lastFile=null;
    await core.readBackup(file,password,owner,record=>{
     check(owner);if(!box.isConnected)throw Error('Restore cancelled.');
     if(record.kind==='manifest'){if(manifest||messages.length||files.size)throw Error('Invalid archive manifest');manifest=record;return;}
     if(!manifest)throw Error('Missing archive manifest');
     if(record.kind==='file'){if(files.has(record.id)||record.size>49*1024*1024)throw Error('Invalid archived file');lastFile={...record,parts:[],received:0};files.set(record.id,lastFile);}
     else if(record.kind==='chunk'){const f=files.get(record.id);if(!f||f!==lastFile||record.offset!==f.received)throw Error('Incomplete archived file');const bytes=core.backupBytes(record.data);f.received+=bytes.length;if(f.received>f.size)throw Error('Invalid file size');f.parts.push(bytes);}
     else if(record.kind==='message'){if(messages.length>=10000||!record.message||typeof record.message.text!=='string')throw Error('Invalid archived message');messages.push(record.message);}
     else if(record.kind==='summary'){if(summary)throw Error('Duplicate archive summary');summary=record;}
     else throw Error('Unknown archive record');
    },n=>status(progress,'Verifying archive record '+n+'…'));
    check(owner);if(!manifest||!summary||summary.messages!==messages.length)throw Error('Incomplete archive summary');
    for(const f of files.values())if(f.received!==f.size)throw Error('An archived attachment is incomplete');
    archive={owner,messages,files,manifest};busy=false;renderArchive(box);
   }catch(e){status(progress,e.message);}finally{password='';pass.value=repeat.value='';input.value='';busy=false;exportBtn.disabled=restoreBtn.disabled=false;}
  };
  box.append(exportBtn,restoreBtn,input);
 }
 function renderArchive(box){
  const data=archive;if(!data||data.owner!==account())return close();
  while(box.children.length>1)box.lastChild.remove();
  box.append(el('p','Restored locally · '+data.messages.length+' message'+(data.messages.length===1?'':'s')+'. No messages or files were uploaded.'));
  const search=el('input');search.type='search';search.placeholder='Search restored messages';search.setAttribute('aria-label','Search restored messages');
  const scope=el('select');scope.setAttribute('aria-label','Restored conversation');scope.append(new Option('All restored chats',''));
  const roomIds=[...new Set(data.messages.map(m=>m.room))];roomIds.forEach(id=>scope.append(new Option(data.manifest.rooms?.find(r=>r.id===id)?.title||id,id)));box.append(scope,search);
  const list=el('div',undefined,'orbit-archive-list'),paging=el('div'),previous=button('Previous',()=>{page--;render();}),next=button('Next',()=>{page++;render();}),count=el('span');paging.append(previous,count,next);box.append(list,paging);let page=0;
  function render(){
   check(data.owner);list.replaceChildren();urls.forEach(URL.revokeObjectURL);urls=[];
   const rows=data.messages.filter(m=>(!scope.value||m.room===scope.value)&&(!search.value||(m.text+' '+m.username).toLowerCase().includes(search.value.toLowerCase())));
   page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));
   for(const m of rows.slice(page*50,page*50+50)){
    const card=el('article',undefined,'orbit-archive-message');card.append(el('small',String(m.username)+' · '+new Date(m.created_at).toLocaleString()));if(m.quote)card.append(el('blockquote',String(m.quote.username)+': '+String(m.quote.text)));card.append(el('p',m.text));
    for(const a of m.attachments||[]){
     if(a.detail){card.append(el('p',JSON.stringify(a.detail)));continue;}const f=data.files.get(a.id);if(!f){card.append(el('small',a.name+' · media not included'));continue;}
     const safeMime=/^(image\/(png|jpe?g|webp|gif|avif)|video\/(mp4|webm)|audio\/[a-z0-9.+-]+)$/i.test(f.mime||'')?f.mime:'application/octet-stream';
     const blob=new Blob(f.parts,{type:safeMime}),url=URL.createObjectURL(blob);urls.push(url);
     if(safeMime.startsWith('image/')){const img=el('img');img.src=url;img.alt=f.name;img.loading='lazy';card.append(img);}
     const link=el('a','Download '+f.name);link.href=url;link.download=String(f.name).replace(/[\\/:*?"<>|]/g,'_');card.append(link);
    }
    list.append(card);
   }
   previous.disabled=page===0;next.disabled=(page+1)*50>=rows.length;count.textContent=' '+(rows.length?page*50+1:0)+'–'+Math.min((page+1)*50,rows.length)+' of '+rows.length+' ';
  }
  search.oninput=scope.onchange=()=>{page=0;render();};render();
 }
 async function receiveShare(){
  const id=new URL(location.href).searchParams.get('orbitShare');if(!id||!account()||shareOpened||busy)return;
  const owner=account();shareOpened=true;
  try{
   const payload=await OrbitShareInbox.receive(id,owner);check(owner);
   const box=panel('Share into Orbit');if(!box){shareOpened=false;return;}
   box.append(el('p',payload.files.length?payload.files.length+' shared attachment(s). Choose a chat, then review before sending.':'Choose a chat for the shared text.'));
   const text=[payload.title,payload.text,payload.url].filter(Boolean).join('\n').slice(0,20000);if(text)box.append(el('p',text.slice(0,300),'orbit-data-muted'));
   const search=el('input');search.type='search';search.placeholder='Search chats';search.setAttribute('aria-label','Find a recipient');box.append(search);
   const list=el('div',undefined,'orbit-share-targets');box.append(list);
   const select=async target=>{
    if(busy)return;busy=true;
    try{
     check(owner);
     if(document.getElementById('modal-media-preview')?.classList.contains('active'))throw Error('Finish or cancel the current attachment preview first.');
     let room=target.id;if(target.peer)room=await resolveCanonicalRoomId(target.peer,target.title);check(owner);
     if(!room)throw Error('Could not open that conversation.');
     await openChatRoom(room,target.title,null,false,target.peer);check(owner);
     if(currentRoom!==room)throw Error('The selected chat could not open.');
     const composer=document.getElementById('msg-input');if(composer&&text){composer.value=[composer.value,text].filter(Boolean).join('\n');composer.dispatchEvent(new Event('input',{bubbles:true}));}
     if(payload.files.length)openMediaPreviewScreen(payload.files.map(file=>({file,url:URL.createObjectURL(file),name:file.name,type:file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'file'})));
     await OrbitShareInbox.remove(id);const url=new URL(location.href);url.searchParams.delete('orbitShare');history.replaceState({},'',url.pathname+url.search+url.hash);close();
    }catch(e){showToast(e.message,'error');}finally{busy=false;}
   };
   const render=()=>{list.replaceChildren();const rows=targets().filter(t=>t.title.toLowerCase().includes(search.value.toLowerCase()));rows.forEach(t=>list.append(button(t.title,()=>select(t))));if(!rows.length)list.append(el('p','No matching chats. Open or add your contact in Orbit, then share again.'));};
   search.oninput=render;render();box.append(button('Discard this share',async()=>{await OrbitShareInbox.remove(id);const url=new URL(location.href);url.searchParams.delete('orbitShare');history.replaceState({},'',url.pathname+url.search+url.hash);close();}));
  }catch(e){shareOpened=false;showToast(e.message,'error');}
 }
 window.OrbitChatData={openBackup,receiveShare,close};
 document.addEventListener('orbit-encryption-locked',()=>{close();shareOpened=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
})();

