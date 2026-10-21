// Personal notes: confirmed cloud saves, local drafts and one source for calendar reminders.
const OrbitNotes=(()=>{
 const state={owner:null,rows:[],filter:'all',query:'',editing:null,saving:false,loadEpoch:0,dirty:false,draftTimer:null,channel:null,editVersion:null,operations:new Map()};
 const colors=['default','blue','green','rose','amber'];
 const el=id=>document.getElementById(id),esc=value=>escapeHtml(String(value??''));
 const key=()=>`orbit_note_draft_${currentUser?.id||'guest'}`;
 const validId=id=>typeof id==='string'&&/^[a-z0-9_-]{1,80}$/i.test(id);
 function normalized(row){return {...row,id:String(row.id),title:String(row.title||'Untitled'),content:String(row.content||''),tags:Array.isArray(row.tags)?row.tags:[],color:colors.includes(row.color)?row.color:'default',pinned:!!row.pinned,archived:!!row.archived};}
 function init(){
  if(!el('notes-toolbar')){
   const toolbar=document.createElement('div');toolbar.id='notes-toolbar';toolbar.className='notes-toolbar';
   toolbar.innerHTML='<label class="notes-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input id="notes-search" type="search" placeholder="Search notes and tags" aria-label="Search notes"></label><div class="notes-filters" role="group" aria-label="Note folders">'+[['all','All notes'],['pinned','Pinned'],['archived','Archive'],['trash','Trash']].map(([id,name])=>`<button type="button" data-note-filter="${id}" aria-pressed="${id==='all'}">${name}</button>`).join('')+'</div><p id="notes-sync-status" role="status"></p>';
   el('notes-list').before(toolbar);el('notes-search').addEventListener('input',event=>{state.query=event.target.value;render();});
   toolbar.querySelectorAll('[data-note-filter]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.noteFilter;render();}));
  }
  if(!el('note-reminder')){
   el('modal-note').querySelector('.glass-modal-box').classList.add('note-editor');
   const extra=document.createElement('div');extra.className='note-editor-options';
   extra.innerHTML='<div class="note-format-tools"><button type="button" id="note-insert-checklist">+ Checklist item</button><span id="note-word-count"></span></div><label>Tags<input id="note-tags" class="glass-input" placeholder="Work, ideas, personal" maxlength="160"></label><div class="note-editor-row"><label>Colour<select id="note-color" class="glass-input">'+colors.map(c=>`<option value="${c}">${c[0].toUpperCase()+c.slice(1)}</option>`).join('')+'</select></label><label class="note-check"><input type="checkbox" id="note-pinned"> Pin note</label></div><label>Remind me · also appears in Calendar<input id="note-reminder" type="datetime-local" class="glass-input"></label><small>Reminders use this device’s time zone. Background alerts require connected system notifications.</small><div class="note-editor-row"><button type="button" id="note-enable-alerts">Enable reminder notifications</button><span id="note-draft-status" role="status"></span><button type="button" id="note-discard-draft" hidden>Use saved version</button></div>';
   el('note-body-inp').after(extra);
   el('note-insert-checklist').onclick=()=>{const input=el('note-body-inp'),at=input.selectionStart??input.value.length;input.value=input.value.slice(0,at)+(at&&input.value[at-1]!=='\n'?'\n':'')+'- [ ] '+input.value.slice(at);input.focus();draft();};
   el('note-enable-alerts').onclick=()=>requestNotificationPermission();
   el('note-discard-draft').onclick=()=>{if(confirm('Replace this local draft with the latest saved note?')){try{localStorage.removeItem(key());}catch(_){}open(state.editing);}};
   for(const id of ['note-title-inp','note-body-inp','note-tags','note-color','note-pinned','note-reminder'])el(id).addEventListener('input',draft);
   el('modal-note').querySelector('.glass-btn-primary').id='note-save-button';
   el('modal-note').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();save();}});
  }
 }
 function resetOwner(){
  const owner=currentUser?.id;if(state.owner===owner)return;
  state.channel&&getSupabase()?.removeChannel(state.channel);state.channel=null;state.owner=owner;state.rows=[];state.editing=null;state.dirty=false;state.query='';state.filter='all';
  // Remove previous account's derived reminders before rendering another account.
  if(typeof userCalendarEvents!=='undefined')userCalendarEvents=userCalendarEvents.filter(row=>!row.noteId);
 }
 async function load(){
  if(!currentUser?.id)return;resetOwner();init();const owner=state.owner,epoch=++state.loadEpoch;
  try{const cached=JSON.parse(localStorage.getItem('orbit_notes_'+owner)||'[]');if(!state.rows.length&&Array.isArray(cached))state.rows=cached.map(normalized);}catch(_){}
  render();syncCalendar();el('notes-sync-status').textContent='Syncing…';
  try{
   const client=await ensureSupabase();const {data,error}=await client.from('secure_notes').select('*').eq('user_id',owner).order('updated_at',{ascending:false});if(error)throw error;
   if(currentUser?.id!==owner||epoch!==state.loadEpoch)return;state.rows=(data||[]).map(normalized);
   try{localStorage.setItem('orbit_notes_'+owner,JSON.stringify(state.rows));}catch(_){}
   el('notes-sync-status').textContent='Synced to your account';render();syncCalendar();
   if(!state.channel&&client.channel)state.channel=client.channel('orbit-notes-'+owner).on('postgres_changes',{event:'*',schema:'public',table:'secure_notes',filter:'user_id=eq.'+owner},()=>load()).subscribe();
  }catch(error){if(currentUser?.id===owner&&epoch===state.loadEpoch)el('notes-sync-status').textContent=state.rows.length?'Saved copy · reconnect to sync':'Could not load notes. Reconnect and retry.';}
 }
 function render(){
  if(!el('notes-list'))return;
  const query=state.query.toLocaleLowerCase();const rows=state.rows.filter(n=>state.filter==='trash'?!!n.deleted_at:!n.deleted_at&&(state.filter==='archived'?n.archived:!n.archived)&&(state.filter!=='pinned'||n.pinned)).filter(n=>(n.title+' '+n.content+' '+n.tags.join(' ')).toLocaleLowerCase().includes(query)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0));
  document.querySelectorAll('[data-note-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.noteFilter===state.filter)));
  el('notes-list').innerHTML=rows.length?rows.map(n=>{
   const lines=n.content.split('\n'),tasks=lines.filter(line=>/^- \[[ x]\] /i.test(line)),done=tasks.filter(line=>/^- \[x\] /i.test(line)).length;
   return `<article class="orbit-note-card" data-color="${n.color}" data-note-id="${esc(n.id)}"><button type="button" class="note-open" data-action="open"><span class="note-card-title">${n.pinned?'📌 ':''}${esc(n.title)}</span><span class="note-excerpt">${esc(n.content.slice(0,240))}</span></button>${tasks.length?`<div class="note-progress">${done}/${tasks.length} completed</div>`:''}${tasks.length&&!n.deleted_at?`<div class="note-checklist">${lines.map((line,index)=>/^- \[[ x]\] /i.test(line)?`<label><input type="checkbox" data-task="${index}" ${/^- \[x\]/i.test(line)?'checked':''}><span>${esc(line.slice(6))}</span></label>`:'').filter(Boolean).slice(0,6).join('')}</div>`:''}<div class="note-tags">${n.tags.map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div>${n.reminder_at?`<small class="note-reminder-label">🔔 ${esc(new Date(n.reminder_at).toLocaleString())}</small>`:''}<footer><small>${esc(new Date(n.updated_at||Date.now()).toLocaleDateString())}</small><div>${n.deleted_at?'<button type="button" data-action="restore">Restore</button>':`<button type="button" data-action="pin">${n.pinned?'Unpin':'Pin'}</button><button type="button" data-action="archive">${n.archived?'Unarchive':'Archive'}</button><button type="button" data-action="trash">Trash</button>`}</div></footer></article>`;
  }).join(''):'<div class="notes-empty"><i class="fa-regular fa-note-sticky" aria-hidden="true"></i><h3>'+ (query?'No matching notes':state.filter==='trash'?'Trash is empty':'A little space for your thoughts')+'</h3><p>'+(query?'Try a different word or tag.':'Create a note, checklist or reminder to get started.')+'</p></div>';
  el('notes-list').querySelectorAll('[data-note-id]').forEach(card=>{
   const id=card.dataset.noteId;card.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>action(id,button.dataset.action));card.querySelectorAll('[data-task]').forEach(input=>input.onchange=()=>task(id,Number(input.dataset.task),input.checked));
  });
 }
 function values(){return {title:el('note-title-inp').value.trim(),content:el('note-body-inp').value,tags:[...new Set(el('note-tags').value.split(',').map(x=>x.trim()).filter(Boolean))].slice(0,12),color:el('note-color').value,pinned:el('note-pinned').checked,reminder:el('note-reminder').value};}
 function draft(){
  state.dirty=true;clearTimeout(state.draftTimer);const owner=currentUser?.id,draftId=state.editing,draftVersion=state.editVersion,draftKey=key(),valuesNow=values();el('note-word-count').textContent=valuesNow.content.trim()?valuesNow.content.trim().split(/\s+/).length+' words':'0 words';
  state.draftTimer=setTimeout(()=>{if(currentUser?.id!==owner||state.owner!==owner)return;try{localStorage.setItem(draftKey,JSON.stringify({id:draftId,version:draftVersion,values:valuesNow,at:Date.now()}));el('note-draft-status').textContent='Draft saved on this device';}catch(_){el('note-draft-status').textContent='Unsaved draft · keep this window open';}},400);
 }
 function localTime(iso){if(!iso)return '';const date=new Date(iso);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 function open(id=null){
  if(state.saving)return;resetOwner();init();const row=id?state.rows.find(n=>n.id===id):null;if(id&&!row)return;if(row?.deleted_at){showToast('Restore this note from Trash before editing.','info');return;}
  state.editing=id;state.editVersion=row?.updated_at||null;el('note-discard-draft').hidden=true;let value=row?{...row,reminder:localTime(row.reminder_at)}:{title:'',content:'',tags:[],color:'default',pinned:false,reminder:''};
  try{const saved=JSON.parse(localStorage.getItem(key())||'null');if(saved&&saved.id===id){value=saved.values;state.editVersion=saved.version||state.editVersion;el('note-discard-draft').hidden=false;el('note-draft-status').textContent=saved.version&&row?.updated_at!==saved.version?'Cloud note changed. Copy your draft or use the saved version.':'Recovered unsaved draft';}else el('note-draft-status').textContent='';}catch(_){}
  el('note-title-inp').value=value.title;el('note-body-inp').value=value.content;el('note-tags').value=Array.isArray(value.tags)?value.tags.join(', '):'';el('note-color').value=value.color;el('note-pinned').checked=value.pinned;el('note-reminder').value=value.reminder||'';state.dirty=false;el('note-word-count').textContent=value.content.trim()?value.content.trim().split(/\s+/).length+' words':'0 words';
  el('modal-note').classList.add('active');el('note-title-inp').focus();
 }
 function close(){if(state.saving)return;if(state.dirty){clearTimeout(state.draftTimer);try{localStorage.setItem(key(),JSON.stringify({id:state.editing,version:state.editVersion,values:values(),at:Date.now()}));}catch(_){showToast('This draft cannot be saved on your device. Copy it before closing.','error');return;}}el('modal-note').classList.remove('active');}
 async function write(id,patch,expectedVersion){
  const owner=currentUser?.id,client=await ensureSupabase(),row=state.rows.find(n=>n.id===id);if(!owner||state.owner!==owner)throw Error('Sign in again to save this note.');
  let query=id?client.from('secure_notes').update(patch).eq('id',id).eq('user_id',owner):client.from('secure_notes').insert({...patch,user_id:owner});
  const version=expectedVersion||row?.updated_at;if(id&&version)query=query.eq('updated_at',version);
  const {data,error}=await query.select('*').single();if(error)throw Error(error.code==='PGRST116'?'This note changed on another device. Reload before saving.':/column|schema cache/i.test(error.message)?'The notes server upgrade is not installed yet. Your draft is kept.':error.message);if(!data)throw Error('This note changed on another device. Reload before saving.');if(currentUser?.id!==owner)throw Error('Your account changed.');
  state.rows=[normalized(data),...state.rows.filter(n=>n.id!==String(data.id))];try{localStorage.setItem('orbit_notes_'+owner,JSON.stringify(state.rows));}catch(_){}render();syncCalendar();return data;
 }
 async function save(){
  if(state.saving)return;const v=values();if(!v.title&&!v.content.trim()){showToast('Write a title or note first.','info');return;}if(v.content.length>50000||v.title.length>180){showToast('Keep titles under 180 characters and notes under 50,000 characters.','info');return;}
  const reminder=v.reminder?new Date(v.reminder):null,old=state.rows.find(n=>n.id===state.editing);if(reminder&&(!Number.isFinite(reminder.getTime())||(+reminder<=Date.now()&&+reminder!==Date.parse(old?.reminder_at)))){showToast('Choose a future reminder time.','error');return;}
  state.saving=true;el('note-save-button').disabled=true;el('modal-note').querySelectorAll('input,textarea,select,button').forEach(input=>input.disabled=true);
  try{await write(state.editing,{title:v.title||'Untitled',content:v.content,tags:v.tags,color:v.color,pinned:v.pinned,reminder_at:reminder?.toISOString()||null,updated_at:new Date().toISOString()},state.editVersion);clearTimeout(state.draftTimer);try{localStorage.removeItem(key());}catch(_){}state.dirty=false;el('modal-note').classList.remove('active');showToast(reminder?'Note saved · reminder added to Calendar':'Note saved','success');}
  catch(error){showToast(error.message||'Could not save. Your draft is kept.','error');draft();}
  finally{state.saving=false;el('note-save-button').disabled=false;el('modal-note').querySelectorAll('input,textarea,select,button').forEach(input=>input.disabled=false);}
 }
 function change(id,operation){const owner=currentUser?.id;const pending=(state.operations.get(id)||Promise.resolve()).catch(()=>{}).then(()=>{if(currentUser?.id===owner)return operation();});state.operations.set(id,pending);pending.finally(()=>{if(state.operations.get(id)===pending)state.operations.delete(id);}).catch(()=>{});return pending;}
 function action(id,kind){if(kind==='open'){open(id);return Promise.resolve();}return change(id,()=>applyAction(id,kind));}
 async function applyAction(id,kind){
  const row=state.rows.find(n=>n.id===id);if(!row)return;if(kind==='open'){open(id);return;}
  const patch=kind==='pin'?{pinned:!row.pinned}:kind==='archive'?{archived:!row.archived}:kind==='trash'?{deleted_at:new Date().toISOString()}:{deleted_at:null};
  try{await write(id,{...patch,updated_at:new Date().toISOString()});showToast(kind==='trash'?'Moved to Trash. You can restore it.':'Note updated','success');}catch(error){showToast(error.message,'error');}
 }
 function task(id,index,checked){return change(id,()=>applyTask(id,index,checked));}
 async function applyTask(id,index,checked){const row=state.rows.find(n=>n.id===id);if(!row||row.deleted_at)return;const lines=row.content.split('\n');if(!/^- \[[ x]\] /i.test(lines[index]||''))return;lines[index]='- ['+(checked?'x':' ')+'] '+lines[index].slice(6);try{await write(id,{content:lines.join('\n'),updated_at:new Date().toISOString()});}catch(error){render();showToast(error.message,'error');}}
 function syncCalendar(){
  if(typeof userCalendarEvents==='undefined')return;
  userCalendarEvents=userCalendarEvents.filter(row=>!row.noteId);
  for(const note of state.rows.filter(n=>n.reminder_at&&!n.deleted_at&&!n.archived)){
   const date=localTime(note.reminder_at);userCalendarEvents.push({id:'note_'+note.id,noteId:note.id,title:'📝 '+note.title,date:date.slice(0,10),time:date.slice(11,16),color:'#5c8dff',desc:'Note reminder · edit in Notes'});
  }
  if(el('tab-calendar')&&!el('tab-calendar').classList.contains('hide')&&typeof renderCalendarMonth==='function'){renderCalendarMonth();if(calViewMode==='agenda')renderCalendarAgendaView();else renderCalendarEvents(calSelectedDateStr);}
 }
 async function openLink(id){if(!validId(id))return;if(!currentUser?.id){window.orbitPendingNote=id;return;}await load();switchTab('notes');open(id);window.orbitPendingNote=null;}
 window.addEventListener('online',()=>{if(currentUser?.id)load();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentUser?.id&&el('tab-notes')&&!el('tab-notes').classList.contains('hide'))load();});
 function stop(){clearTimeout(state.draftTimer);state.loadEpoch++;state.channel&&getSupabase()?.removeChannel(state.channel);state.channel=null;state.rows=[];state.owner=null;state.dirty=false;if(el('notes-list'))el('notes-list').innerHTML='';if(typeof userCalendarEvents!=='undefined')userCalendarEvents=userCalendarEvents.filter(row=>!row.noteId);}
 return {load,open,close,save,openLink,syncCalendar,action,task,stop,state};
})();
window.orbitOpenNoteLink=id=>OrbitNotes.openLink(id);
