// Messaging experience: explicit user controls, no animation render loops.
const ORBIT_ORIGINAL_UNLIMITED = new Set(['rivaldo.a.rodrigues@gmail.com','rivacolony@gmail.com']);
let orbitEditingMessage = null, orbitEditSaving = false, orbitEditDeadlineTimer = null;
let orbitOriginalAllowance = null;

function orbitFormatMessageTime(value) {
    const date=new Date(value), now=new Date();
    if(!Number.isFinite(date.getTime()))return '';
    return date.toDateString()===now.toDateString()
        ?date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
        :date.toLocaleDateString([], {month:'short',day:'numeric'});
}
function orbitChatPresence(peer) {
    if(localStorage.getItem('orbit_privacy_last_seen')==='nobody')return '';
    const user=globalUsersMap.get(peer);
    if(!user)return '';
    // Never substitute the latest message time for a user's last-seen time.
    const age=Date.now()-Date.parse(user.last_seen);
    return user.is_online===true && age>=0 && age<65000?'Online':formatSmartActivity(user.last_seen,false);
}
function orbitCanEditMessage(msg, now=Date.now()) {
    const age=now-Date.parse(msg?.created_at);
    return !!currentUser && msg?.sender_id===currentUser.id && (!msg.type || msg.type==='text') &&
        !msg.is_deleted && !msg.attachments?.length && !!msg.text && age>=0 && age<600000 &&
        !['sending','queued','failed','error'].includes(msg.status);
}
function orbitBeginEdit(msg) {
    if(!orbitCanEditMessage(msg)){showToast('Messages can be edited for 10 minutes.','info');return;}
    orbitCancelEdit();
    orbitEditingMessage={...msg,owner:currentUser.id,viewRoom:currentRoom};
    const input=document.getElementById('msg-input');
    orbitEditingMessage.draft=input.value;
    const bar=document.createElement('div');bar.id='orbit-edit-bar';bar.className='orbit-edit-bar';
    const label=document.createElement('span');label.textContent='Editing message · 10-minute window';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=orbitCancelEdit;
    bar.append(label,cancel);document.getElementById('chat-standard-input-row')?.before(bar);
    if(!bar.isConnected) input.parentElement.before(bar);
    input.value=msg.text;input.focus();handleChatInputText(input);
    orbitEditDeadlineTimer=setTimeout(()=>{orbitCancelEdit();showToast('The edit window has ended.','info');},Math.max(0,600000-(Date.now()-Date.parse(msg.created_at))));
}
function orbitCancelEdit() {
    clearTimeout(orbitEditDeadlineTimer);orbitEditDeadlineTimer=null;
    if(orbitEditingMessage){const input=document.getElementById('msg-input');if(input){input.value=currentRoom===orbitEditingMessage.viewRoom?orbitEditingMessage.draft||'':'';handleChatInputText(input);}}
    orbitEditingMessage=null;document.getElementById('orbit-edit-bar')?.remove();
}
async function orbitSaveEdit() {
    if(orbitEditSaving)return;
    const msg=orbitEditingMessage,text=document.getElementById('msg-input')?.value.trim();
    if(!msg||!orbitCanEditMessage(msg)||currentUser?.id!==msg.owner||currentRoom!==msg.viewRoom){orbitCancelEdit();showToast('Reopen a recent message in its original chat to edit.','info');return;}
    if(!text){showToast('The edited message cannot be empty.','info');return;}
    if(text===msg.text){orbitCancelEdit();return;}
    orbitEditSaving=true;
    try {
        const client=await ensureSupabase();
        const {data,error}=await client.rpc('orbit_edit_message',{message_key:msg.id,new_text:text});
        if(error)throw error;
        if(currentUser?.id!==msg.owner)return;
        messageCache.forEach((messages,room)=>{const index=messages.findIndex(row=>row.id===msg.id);if(index>=0){messages[index]={...messages[index],...data};try{localStorage.setItem(`orbit_cache_msgs_${room}`,JSON.stringify(messages.slice(-200)));}catch(_){}}});
        const node=document.getElementById(`msg-${msg.id}`);
        if(node)node.replaceWith(createMessageDOMNode({...msg,...data},node.classList.contains('grouped-consecutive')));
        orbitCancelEdit();showToast('Message updated.','success');
    }catch(error){showToast(error.message||'Could not save the edit.','error');}
    finally{orbitEditSaving=false;}
}

async function orbitCopyForwardAttachments(attachments, messageType = null, targetRoom = null) {
    const copies=[];
    const owner=currentUser?.id;
    if(typeof attachments==='string'){try{attachments=JSON.parse(attachments);}catch(_){throw new Error('Unsupported legacy attachment.');}}
    if(!Array.isArray(attachments))throw new Error('Unsupported attachment list.');
    for(const rawAttachment of attachments){
        if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
        let attachment=rawAttachment;
        if(messageType==='location' && typeof attachment==='string' && /^https:\/\/maps\.google\.com\//.test(attachment)){copies.push(attachment);continue;}
        if(typeof attachment==='string'){try{attachment=JSON.parse(attachment);}catch(_){if(/^https?:\/\//.test(attachment))attachment={url:attachment,type:messageType||'file'};else throw new Error('Unsupported legacy attachment. Download and attach it again.');}}
        if(messageType==='contact' && attachment && !attachment.url){copies.push({name:String(attachment.name||'Orbit contact'),username:String(attachment.username||''),phone:String(attachment.phone||''),avatar:String(attachment.avatar||'')});continue;}
        if(messageType==='poll' && attachment?.poll?.options){const poll=attachment.poll;copies.push({type:'poll',poll:{question:String(poll.question||'Poll'),multiple_answers:!!poll.multiple_answers,options:poll.options.map(option=>({text:String(option.text||''),votes:0,voters:[]}))}});continue;}
        if(!attachment || attachment.view_once || attachment.upload_pending || !attachment.url || /^data:/.test(attachment.url) || (attachment.url.startsWith('blob:')&&!attachment.encrypted))throw new Error('Open the original encrypted attachment before forwarding.');
        const raw=formatMediaUrl(attachment.url);
        const url=typeof resolveMediaUrlForAccess==='function'?await resolveMediaUrlForAccess(raw):raw;
        const response=await fetch(url);if(!response.ok)throw new Error('The original attachment is unavailable.');
        const file=await response.blob();
        if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
        // Own the forwarded copy so deleting/restricting the original cannot break another chat.
        if(!targetRoom)throw new Error('Choose the destination chat before forwarding.');
        const encrypted=await OrbitCrypto.encryptAttachment(file,targetRoom);
        const copyUrl=await uploadMediaToStorage(encrypted.body,'attachment.bin','application/octet-stream','encrypted');
        if(currentUser?.id!==owner)throw new Error('The signed-in account changed.');
        copies.push({name:attachment.name||'Attachment',type:attachment.type||'file',size:file.size,url:'',encrypted:true,digest:encrypted.digest,recipient_keyset:encrypted.recipientKeyset,mime:file.type,storage_path:getOrbitStorageObjectPath(copyUrl),storage_bucket:'chat-assets'});
    }
    return copies;
}
async function orbitLoadOriginalAllowance() {
    const owner=currentUser?.id;if(!owner)return;
    try{const client=await ensureSupabase(),{data,error}=await client.rpc('orbit_original_photo_allowance');if(error)throw error;if(currentUser?.id===owner){orbitOriginalAllowance=Number.isFinite(data?.remaining)?data:null;orbitRenderQualityControls();}}
    catch(_){orbitOriginalAllowance=null;}
}
function orbitRenderQualityControls() {
    const modal=document.getElementById('modal-media-preview');if(!modal)return;
    let panel=document.getElementById('orbit-quality-controls');
    if(!panel){
        panel=document.createElement('div');panel.id='orbit-quality-controls';panel.className='orbit-quality-controls';
        const current=document.createElement('button');current.type='button';current.id='orbit-original-current';current.onclick=()=>orbitSetOriginalQuality(false);
        const all=document.createElement('button');all.type='button';all.id='orbit-original-all';all.onclick=()=>orbitSetOriginalQuality(true);
        const note=document.createElement('small');note.id='orbit-original-note';panel.append(current,all,note);
        modal.querySelector('.media-preview-top-bar')?.after(panel);
        orbitLoadOriginalAllowance();
    }
    const photo=mediaPreviewList[currentPreviewIndex],images=mediaPreviewList.filter(item=>item.type==='image');
    panel.hidden=!images.length;
    const current=document.getElementById('orbit-original-current'),all=document.getElementById('orbit-original-all');
    current.disabled=photo?.type!=='image';current.textContent=photo?.originalQuality?'Original ✓ · this photo':'Original · this photo';current.setAttribute('aria-pressed',String(!!photo?.originalQuality));
    all.textContent=images.length&&images.every(item=>item.originalQuality)?'Use standard for all':'All photos · original';
    const count=images.filter(item=>item.originalQuality).length;
    const unlimited=ORBIT_ORIGINAL_UNLIMITED.has(String(currentUser?.email||'').toLowerCase());
    document.getElementById('orbit-original-note').textContent=`${count} original${count===1?'':'s'} selected · ${unlimited?'Unlimited':orbitOriginalAllowance?`${orbitOriginalAllowance.remaining}/10 remaining today (UTC)`:'10 per day · checked when sending'}. Other photos use your Standard / HD setting.`;
}
function orbitSetOriginalQuality(all) {
    const selected=all?mediaPreviewList.filter(item=>item.type==='image'):[mediaPreviewList[currentPreviewIndex]].filter(item=>item?.type==='image');
    const enabled=!selected.every(item=>item.originalQuality);
    selected.forEach(item=>item.originalQuality=enabled);orbitRenderQualityControls();
}

// HEAD bypasses the GET-only service-worker cache, so cached pages cannot
// falsely report internet access. One check per minute while visible.
let orbitConnectivityRequest=null,orbitConnectivityEpoch=0;
async function orbitProbeConnectivity() {
    if(typeof fetch!=='function'||!navigator.onLine)return;
    const epoch=++orbitConnectivityEpoch;
    orbitConnectivityRequest?.abort();
    const controller=new AbortController();orbitConnectivityRequest=controller;
    const timeout=setTimeout(()=>controller.abort(),5000);
    const badge=document.getElementById('orbit-connectivity');
    try {
        const response=await fetch(new URL('./manifest.json',location.href),{method:'HEAD',cache:'no-store',credentials:'omit',signal:controller.signal});
        if(!response.ok)throw new Error('Unreachable');
        if(epoch!==orbitConnectivityEpoch||!navigator.onLine)return;
        badge.className='is-online';badge.textContent='Online';badge.title='Orbit is reachable over the internet';
        clearTimeout(orbitUpdateConnectivity.timer);orbitUpdateConnectivity.timer=setTimeout(()=>badge.classList.add('is-quiet'),3500);
    }catch(_){if(epoch===orbitConnectivityEpoch&&navigator.onLine){badge.className='is-offline';badge.textContent='Retrying…';badge.title='Orbit could not be reached. Queued messages will retry.';}}
    finally{clearTimeout(timeout);if(orbitConnectivityRequest===controller)orbitConnectivityRequest=null;}
}
function orbitUpdateConnectivity() {
    let badge=document.getElementById('orbit-connectivity');
    if(!badge){badge=document.createElement('div');badge.id='orbit-connectivity';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');document.body.append(badge);}
    const online=navigator.onLine;
    badge.className=online?'is-online':'is-offline';
    badge.textContent=online?(typeof fetch==='function'?'Connecting…':'Online'):'Offline · messages will wait';badge.title=online?'Checking the connection to Orbit':'Device has no network connection';
    clearTimeout(orbitUpdateConnectivity.timer);
    if(online){orbitUpdateConnectivity.timer=setTimeout(()=>badge.classList.add('is-quiet'),3500);orbitProbeConnectivity();}
    else {orbitConnectivityEpoch++;orbitConnectivityRequest?.abort();}
}
window.addEventListener('online',orbitUpdateConnectivity);window.addEventListener('offline',orbitUpdateConnectivity);orbitUpdateConnectivity();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)orbitProbeConnectivity();});
setInterval(()=>{if(!document.hidden&&navigator.onLine)orbitProbeConnectivity();},60000);

// A shared, gesture-unlocked audio context avoids creating an audio engine per ring.
let orbitToneContext=null,orbitAlarmRingTimer=null,orbitAlarmStopTimer=null,orbitActiveAlarm=null;
function orbitUnlockAudio() {
    try{const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return null;
        orbitToneContext=orbitToneContext||new Context();if(orbitToneContext.state==='suspended')orbitToneContext.resume().catch(()=>{});return orbitToneContext;
    }catch(_){return null;}
}
document.addEventListener('pointerdown',()=>orbitUnlockAudio(),{once:true,passive:true});
document.addEventListener('keydown',()=>orbitUnlockAudio(),{once:true});
const orbitCallToneNodes=new Set();
function orbitStopCallTones(){
    for(const node of orbitCallToneNodes){try{node.stop();node.disconnect();}catch(_){}}
    orbitCallToneNodes.clear();
}
function orbitPlayTone(kind='orbit',volume=.16,channel='general') {
    if(volume<=0)return;
    const context=orbitUnlockAudio();if(!context||context.state!=='running')return;
    const notes={orbit:[659,830,988,830],gentle:[523,659,784],classic:[880,880,660,880],ringback:[440,480]}[kind]||[659,830,988,830];
    notes.forEach((frequency,index)=>{const start=context.currentTime+index*.17,osc=context.createOscillator(),gain=context.createGain();
        osc.type='sine';osc.frequency.value=frequency;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.015);gain.gain.exponentialRampToValueAtTime(.001,start+.15);osc.connect(gain);gain.connect(context.destination);if(channel==='call')orbitCallToneNodes.add(osc);osc.start(start);osc.stop(start+.17);osc.onended=()=>{orbitCallToneNodes.delete(osc);osc.disconnect();gain.disconnect();};});
}
async function orbitEnableClockNotifications() {
    orbitUnlockAudio();
    if(!('Notification' in window)){showToast('This browser does not support system notifications.','info');return;}
    const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
    showToast(permission==='granted'?'Clock notifications enabled. Keep Orbit open for alarms.':'Allow notifications in your browser settings to enable clock alerts.','info');
}
async function orbitClockNotify(title,body) {
    showToast(`${title}: ${body}`,'info');
    if(!document.hidden||!('Notification' in window)||Notification.permission!=='granted')return;
    const options={body,tag:'orbit-clock',icon:'./orbit-icon.svg',data:{url:location.origin}};
    try{const registration=await navigator.serviceWorker?.getRegistration();if(registration)await registration.showNotification(title,options);else new Notification(title,options);}catch(_){}
}
function orbitMusicUrl(value) {
    try{const url=new URL(value);return url.protocol==='https:'&&['music.youtube.com','www.youtube.com','youtube.com','youtu.be'].includes(url.hostname)?url.href:'';}catch(_){return '';}
}
function orbitRingAlarm(alarm) {
    orbitStopAlarm();orbitActiveAlarm=alarm;
    let panel=document.getElementById('orbit-ringing-alarm');
    if(!panel){panel=document.createElement('section');panel.id='orbit-ringing-alarm';panel.className='orbit-ringing-alarm';panel.setAttribute('role','alert');document.body.append(panel);}
    panel.replaceChildren();
    const title=document.createElement('strong');title.textContent=alarm.label||'Timer finished';
    const note=document.createElement('span');note.textContent='Orbit Clock';panel.append(note,title);
    for(const [label,action]of [['Stop',orbitStopAlarm],['Snooze 5 min',()=>orbitSnoozeAlarm()]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;panel.append(button);}
    const music=orbitMusicUrl(alarm.musicUrl);if(music){const link=document.createElement('a');link.href=music;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open YouTube Music';panel.append(link);}
    panel.hidden=false;
    orbitPlayTone(alarm.tone);orbitAlarmRingTimer=setInterval(()=>orbitPlayTone(alarm.tone),1800);
    orbitAlarmStopTimer=setTimeout(orbitStopAlarm,120000);
    orbitClockNotify('Alarm',alarm.label||'Time is up');
}
function orbitStopAlarm() {clearInterval(orbitAlarmRingTimer);clearTimeout(orbitAlarmStopTimer);orbitAlarmRingTimer=null;orbitAlarmStopTimer=null;orbitActiveAlarm=null;const panel=document.getElementById('orbit-ringing-alarm');if(panel)panel.hidden=true;}
function orbitSnoozeAlarm() {
    if(!orbitActiveAlarm)return;
    const alarm={...orbitActiveAlarm,id:crypto.randomUUID(),snoozeAt:Date.now()+300000,enabled:true};orbitStopAlarm();userAlarms.push(alarm);
    localStorage.setItem('orbit_alarms',JSON.stringify(userAlarms));renderAlarmsList();orbitClockNotify('Alarm snoozed','Rings again in 5 minutes.');
}
function orbitInitClockControls() {
    const label=document.getElementById('alarm-label-inp');if(!label)return;
    const controls=document.createElement('div');controls.className='orbit-clock-controls';
    controls.innerHTML='<label>Ringtone<select id="orbit-alarm-tone" class="glass-input"><option value="orbit">Orbit</option><option value="gentle">Gentle</option><option value="classic">Classic</option></select></label><button type="button" id="orbit-alarm-preview">Preview tone</button><label>YouTube Music link (optional)<input id="orbit-alarm-music" type="url" class="glass-input" placeholder="https://music.youtube.com/…"></label><small>A link opens when you tap it. Built-in tones ring while Orbit is open; sleeping or closed browsers cannot reliably run alarms.</small><button type="button" id="orbit-clock-permission">Enable clock notifications</button>';
    label.after(controls);document.getElementById('orbit-alarm-preview').onclick=()=>orbitPlayTone(document.getElementById('orbit-alarm-tone').value);
    document.getElementById('orbit-clock-permission').onclick=orbitEnableClockNotifications;
}
orbitInitClockControls();
if(typeof initClockSuite==='function')initClockSuite();

let orbitCallReconnectTimer=null,orbitCallNotificationTag=null,orbitFallbackCallNotification=null;
function orbitPrepareCallPanel(incoming) {
    const panel=document.querySelector('.call-modal-box');if(!panel)return;
    if(!panel.querySelector('.orbit-call-eyebrow')){
        const title=document.createElement('div');title.className='orbit-call-eyebrow';title.textContent='ORBIT · VOICE';panel.prepend(title);
        const controls=document.createElement('div');controls.className='orbit-call-sound';
        controls.innerHTML='<label>Incoming ringtone<select id="orbit-call-ringtone"><option value="orbit">Orbit</option><option value="gentle">Gentle</option><option value="classic">Classic</option><option value="silent">Silent</option></select></label><label>Ring volume<input id="orbit-call-volume" type="range" min="0" max="0.3" step="0.01" aria-label="Ring volume"></label>';
        panel.append(controls);
        const tone=document.getElementById('orbit-call-ringtone'),volume=document.getElementById('orbit-call-volume');
        tone.value=localStorage.getItem('orbit_call_ringtone')||'orbit';volume.value=localStorage.getItem('orbit_call_volume')||'.12';
        tone.onchange=()=>{localStorage.setItem('orbit_call_ringtone',tone.value);if(typeof syncOrbitAlertPreferences==='function')syncOrbitAlertPreferences();if(tone.value!=='silent')orbitPlayTone(tone.value,Number(volume.value));};
        volume.oninput=()=>localStorage.setItem('orbit_call_volume',volume.value);
        const hint=document.createElement('p');hint.className='orbit-call-hint';hint.textContent='Audio stays on your selected speaker or headphones. Use device controls when audio switching is unavailable.';panel.append(hint);
        document.getElementById('call-status-label').setAttribute('role','status');
        document.getElementById('call-status-label').setAttribute('aria-live','polite');
        const mini=document.querySelector('#orbit-call-mini button');
        if(mini){const status=document.createElement('span');status.id='orbit-call-mini-status';status.textContent='Voice call';mini.append(' · ',status);}
    }
    const peer=globalUsersMap.get(_activeCallPeerId),avatar=document.getElementById('call-avatar-wrap');
    avatar.replaceChildren();avatar.classList.remove('is-connected');
    if(peer?.dp_url){const img=document.createElement('img');img.src=formatMediaUrl(peer.dp_url);img.alt='';avatar.append(img);}
    else {const icon=document.createElement('i');icon.className='fa-solid fa-user';avatar.append(icon);}
    document.getElementById('call-btn-mute').setAttribute('aria-label','Mute microphone');
    document.getElementById('call-btn-answer').setAttribute('aria-label','Answer call');
    const end=document.querySelector('.call-btn.end');end.setAttribute('aria-label',incoming?'Decline call':'End call');end.title=incoming?'Decline call':'End call';
}
function orbitCallPanelCleanup() {
    clearTimeout(orbitCallReconnectTimer);orbitCallReconnectTimer=null;
    orbitFallbackCallNotification?.close();orbitFallbackCallNotification=null;
    const closingTag=orbitCallNotificationTag;
    if(closingTag)navigator.serviceWorker?.getRegistration().then(async registration=>{for(const alert of await registration?.getNotifications({tag:closingTag})||[])alert.close();}).catch(()=>{});
    orbitCallNotificationTag=null;
}
async function orbitNotifyIncomingCall(row) {
    if(!('Notification' in window)||Notification.permission!=='granted'||!notificationPreference('orbit_device_notifications',true))return;
    const previews=notificationPreference('orbit_notification_previews',true);
    orbitCallNotificationTag=`orbit-call-${row.id}`;
    const options={body:previews?'Incoming voice call':'Incoming Orbit call',tag:orbitCallNotificationTag,requireInteraction:true,renotify:false,silent:localStorage.getItem('orbit_call_ringtone')==='silent',timestamp:Date.parse(row.created_at),icon:'./orbit-icon.svg',actions:[{action:'open',title:'Open call'},{action:'dismiss',title:'Dismiss alert'}],data:{url:location.origin,roomId:row.room,callId:row.id}};
    try{const registration=await navigator.serviceWorker?.getRegistration();if(_activeCallId!==row.id||orbitCallRow?.state!=='ringing')return;if(registration){await registration.showNotification(previews?row.caller_name:'Orbit',options);if(_activeCallId!==row.id||orbitCallRow?.state!=='ringing'){for(const alert of await registration.getNotifications({tag:options.tag}))alert.close();}}else{delete options.actions;orbitFallbackCallNotification=new Notification(previews?row.caller_name:'Orbit',options);orbitFallbackCallNotification.onclick=()=>{if(_activeCallId===row.id)restoreOrbitCall();orbitFallbackCallNotification?.close();};}}catch(_){}
}

// Keep an edit from carrying into a different chat or account.
document.addEventListener('click',()=>{if(orbitEditingMessage&&(currentRoom!==orbitEditingMessage.viewRoom||currentUser?.id!==orbitEditingMessage.owner))orbitCancelEdit();},true);

// Ringtone preferences are available before a call, in Settings > Alerts.
function orbitInitRingtoneSettings() {
 const section=document.getElementById('settings-notifications');if(!section)return;
 const panel=document.createElement('div');panel.className='orbit-clock-controls';panel.style.marginTop='16px';
 panel.innerHTML='<label>Voice call ringtone<select id="orbit-settings-call-tone" class="glass-input"><option value="orbit">Orbit</option><option value="gentle">Gentle</option><option value="classic">Classic</option><option value="silent">Silent</option></select></label><label>Call ring volume<input id="orbit-settings-call-volume" type="range" min="0" max="0.3" step="0.01"></label><button type="button" id="orbit-settings-call-preview">Preview ringtone</button>';
 section.append(panel);const tone=document.getElementById('orbit-settings-call-tone'),volume=document.getElementById('orbit-settings-call-volume');
 tone.value=localStorage.getItem('orbit_call_ringtone')||'orbit';volume.value=localStorage.getItem('orbit_call_volume')??'.12';
 tone.onchange=()=>{localStorage.setItem('orbit_call_ringtone',tone.value);const modal=document.getElementById('orbit-call-ringtone');if(modal)modal.value=tone.value;};
 volume.oninput=()=>{localStorage.setItem('orbit_call_volume',volume.value);const modal=document.getElementById('orbit-call-volume');if(modal)modal.value=volume.value;};
 document.getElementById('orbit-settings-call-preview').onclick=()=>{if(tone.value!=='silent')orbitPlayTone(tone.value,Number(volume.value));};
}
orbitInitRingtoneSettings();
