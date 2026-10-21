// Durable chat services. Database RPCs enforce membership and blocks.
let orbitServicesOwner = null, orbitCallsChannel = null, orbitIceChannel = null, orbitCallEpoch = 0;
let orbitCallRow = null, orbitCallClosing = false, orbitAnswerInProgress = false, orbitLocalIce = [], orbitSeenIce = new Set();
let orbitRingTimer = null, orbitRingAudio = null, orbitScheduleTarget = null, orbitScheduleRequest = null;
let orbitSchedules = [], orbitScheduleSaving = false;
let orbitCallsConnected = false, orbitCallRecoveryTimer = null, orbitCallRecoveryBusy = false;
const orbitClosedCallIds=new Map();
function orbitRememberClosedCall(id){if(!id)return;orbitClosedCallIds.set(id,Date.now());for(const [key,time] of orbitClosedCallIds)if(time<Date.now()-300000||orbitClosedCallIds.size>128)orbitClosedCallIds.delete(key);}
const orbitTerminalCalls = new Set(['ended','declined','missed','failed']);

async function orbitRpc(name,args) {
    const client = await ensureSupabase();
    const {data,error} = await client.rpc(name,args);
    if (error) throw new Error(error.message || 'Could not connect. Please try again.');
    return data;
}
async function initOrbitChatServices() {
    const owner = currentUser?.id;
    if (!owner || orbitServicesOwner === owner) return;
    await stopOrbitChatServices();
    const client = await ensureSupabase();
    if (currentUser?.id !== owner) return;
    orbitServicesOwner = owner;
    // Subscribe before migrations/profile work: a slow sync must never delay a call.
    orbitCallsChannel = client.channel(`orbit-call-inbox-${owner}`)
        .on('postgres_changes',{event:'*',schema:'public',table:'orbit_calls',filter:`callee_id=eq.${owner}`},event=>receiveOrbitCall(event.new))
        .on('postgres_changes',{event:'*',schema:'public',table:'orbit_calls',filter:`caller_id=eq.${owner}`},event=>receiveOrbitCall(event.new))
        .subscribe(status=>{orbitCallsConnected=status==='SUBSCRIBED';if(orbitCallsConnected)recoverOrbitIncomingCall().catch(()=>{});});
    recoverOrbitIncomingCall().catch(()=>{});
    orbitCallRecoveryTimer=setInterval(()=>{
        if(currentUser?.id===owner&&!document.hidden&&!orbitCallsConnected)recoverOrbitIncomingCall().catch(()=>{});
    },3000);
    orbitRetryCallEnds();
    if(typeof orbitPendingCallLink!=='undefined'&&orbitPendingCallLink)orbitOpenCallNotification(orbitPendingCallLink);
    try {
        const {data,error} = await client.from('orbit_user_blocks').select('blocked').eq('blocker',owner);
        if (error) throw error;
        const cached = localStorage.getItem(`orbit_blocks_migrated_${owner}`) ? [] : JSON.parse(localStorage.getItem(`orbit_blocked_${owner}`) || '[]');
        for (const id of cached) {
            if (!data.some(row=>row.blocked===id)) { const result=await client.from('orbit_user_blocks').upsert({blocker:owner,blocked:id},{onConflict:"blocker,blocked",ignoreDuplicates:true});if(result.error)throw result.error; }
        }
        if (currentUser?.id !== owner) return;
        blockedUsersSet = new Set([...data.map(row=>row.blocked),...cached]);
        localStorage.setItem(`orbit_blocked_${owner}`,JSON.stringify([...blockedUsersSet]));
        localStorage.setItem(`orbit_blocks_migrated_${owner}`,'true');
        updateChatOptionsMenuState(); updateVoiceCallButton();
    } catch (error) { console.warn('[Orbit] Block sync:',error.message); }
    await migrateOrbitLegacySchedules(owner);

}
async function stopOrbitChatServices() {
    if (_activeCallId || _activeCallRole || peerConnection || localAudioStream) await endVoiceCall(true);
    clearInterval(orbitCallRecoveryTimer);orbitCallRecoveryTimer=null;orbitCallsConnected=false;
    const client = getSupabase();
    if (orbitCallsChannel) await client?.removeChannel(orbitCallsChannel);
    if (orbitIceChannel) await client?.removeChannel(orbitIceChannel);
    orbitCallsChannel=null; orbitIceChannel=null; orbitServicesOwner=null;
    blockedUsersSet.clear(); orbitSchedules=[];
}
async function recoverOrbitIncomingCall() {
    if (!currentUser||orbitCallRecoveryBusy||navigator.onLine===false) return;
    orbitCallRecoveryBusy=true;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);
    const bounded=query=>typeof query.abortSignal==='function'?query.abortSignal(controller.signal):query;
    try {
    const owner=currentUser.id, client=await ensureSupabase();
    const activeId=_activeCallId;
    if(activeId){const {data:active}=await bounded(client.from('orbit_calls').select('*').eq('id',activeId).single());if(currentUser?.id===owner&&_activeCallId===activeId&&active)await receiveOrbitCall(active);return;}
    const {data,error}=await bounded(client.from('orbit_calls').select('*').eq('callee_id',owner).eq('state','ringing').gt('created_at',new Date(Date.now()-45000).toISOString()).order('created_at',{ascending:false}).limit(1));
    if (!error && currentUser?.id===owner && data?.[0]) receiveOrbitCall(data[0]);
    } finally {clearTimeout(timeout);orbitCallRecoveryBusy=false;}
}
async function migrateOrbitLegacySchedules(owner) {
    const key=`orbit_scheduled_${owner}`;
    let rows;try{rows=JSON.parse(localStorage.getItem(key)||'[]');}catch(_){return;}
    if(!Array.isArray(rows)||!rows.length)return;
    for(const item of rows){
        if(currentUser?.id!==owner)return;
        if(!item.room||!item.text)continue;
        item.serverId=item.serverId||crypto.randomUUID();
        item.serverTime=item.serverTime||new Date(Math.max(Number(item.scheduledAt)||0,Date.now()+60000)).toISOString();
        localStorage.setItem(key,JSON.stringify(rows));
        try{
            await orbitRpc('orbit_schedule_message',{chat_room:item.room,body:item.text,send_at:item.serverTime,request_id:item.serverId});
            if(currentUser?.id!==owner)return;
            rows=rows.filter(row=>row.id!==item.id);localStorage.setItem(key,JSON.stringify(rows));
        }catch(error){console.warn('[Orbit] Existing schedule not migrated:',error.message);}
    }
}
function isUserBlocked(uid) { return !!uid && blockedUsersSet.has(uid); }
async function toggleBlockCurrentPeer() {
    const peer=activeChatPeerId, owner=currentUser?.id;
    if (!peer || !owner || isGroupChat) return;
    try {
        const client=await ensureSupabase(), removing=blockedUsersSet.has(peer);
        const {error}=removing ? await client.from('orbit_user_blocks').delete().eq('blocker',owner).eq('blocked',peer) : await client.from('orbit_user_blocks').upsert({blocker:owner,blocked:peer},{onConflict:"blocker,blocked",ignoreDuplicates:true});
        if (error) throw error;
        if (currentUser?.id!==owner) return;
        if (removing) blockedUsersSet.delete(peer); else blockedUsersSet.add(peer);
        localStorage.setItem(`orbit_blocked_${owner}`,JSON.stringify([...blockedUsersSet]));
        if (!removing && _activeCallPeerId===peer) await endVoiceCall(true);
        closeChatOptionsMenu(); updateChatOptionsMenuState(); updateVoiceCallButton();
        showToast(removing?'User unblocked.':'User blocked. Messages and calls are stopped on the server.','success');
    } catch(error) {showToast(`Could not change blocking: ${error.message}`,'error');}
}

function orbitLocalDateTime(date) {
    const pad=n=>String(n).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function initScheduleButtonListener() {
    const button=document.getElementById('send-msg-btn');
    if (!button || button.dataset.scheduleReady) return;
    button.dataset.scheduleReady='true';
    let timer=null,held=false;
    button.addEventListener('pointerdown',event=>{if(event.button!==0)return;held=false;timer=setTimeout(()=>{held=true;openScheduleModal();},600);});
    for(const event of ['pointerup','pointercancel','pointerleave']) button.addEventListener(event,()=>clearTimeout(timer));
    button.addEventListener('click',event=>{if(held){event.preventDefault();event.stopImmediatePropagation();held=false;}},true);
    button.addEventListener('contextmenu',event=>{event.preventDefault();openScheduleModal();});
}
function openScheduleModal() {
    if (!currentUser || !currentRoom) return;
    if (isUserBlocked(activeChatPeerId)) {showToast('Unblock this person before scheduling messages.','error');return;}
    orbitScheduleTarget={room:currentRoom,owner:currentUser.id}; orbitScheduleRequest=null;
    document.getElementById('schedule-msg-text').value=document.getElementById('msg-input')?.value || '';
    setSchedulePreset(30);
    document.getElementById('modal-schedule-msg').classList.add('active');
}
function closeScheduleModal(){document.getElementById('modal-schedule-msg').classList.remove('active');}
function setSchedulePreset(value) {
    let date=new Date();
    if(value==='tomorrow_9am'||value==='tomorrow_6pm'){date.setDate(date.getDate()+1);date.setHours(value==='tomorrow_9am'?9:18,0,0,0);}
    else date=new Date(Date.now()+Number(value)*60000);
    const input=document.getElementById('schedule-datetime-inp');
    input.value=orbitLocalDateTime(date);input.min=orbitLocalDateTime(new Date());
}
async function confirmScheduleMessage() {
    if(orbitScheduleSaving)return;
    const target=orbitScheduleTarget,text=document.getElementById('schedule-msg-text').value.trim(),date=new Date(document.getElementById('schedule-datetime-inp').value);
    if(!text||!Number.isFinite(date.getTime())||date.getTime()<=Date.now()){showToast('Enter a message and a valid future time.','error');return;}
    if(!target||target.owner!==currentUser?.id||target.room!==currentRoom){showToast('Reopen scheduling from the original chat.','error');return;}
    const fingerprint=JSON.stringify([text,date.toISOString()]);
    if(orbitScheduleRequest?.fingerprint!==fingerprint)orbitScheduleRequest={fingerprint,id:crypto.randomUUID()};
    orbitScheduleSaving=true;
    const button=document.querySelector('#modal-schedule-msg .glass-btn-primary');button.disabled=true;
    try {
        await orbitRpc('orbit_schedule_message',{chat_room:target.room,body:text,send_at:date.toISOString(),request_id:orbitScheduleRequest.id});
        if(currentUser?.id!==target.owner)return;
        const input=document.getElementById('msg-input');
        if(currentRoom===target.room&&input.value.trim()===text){input.value='';input.style.height='auto';handleChatInputText(input);}
        closeScheduleModal(); await updateScheduledChipForCurrentRoom();
        showToast('Scheduled. Orbit will send it even when the app is closed.','success');
    } catch(error){showToast(error.message,'error');}
    finally{orbitScheduleSaving=false;button.disabled=false;}
}
async function loadOrbitSchedules() {
    const owner=currentUser?.id,room=currentRoom;if(!owner||!room)return [];
    const client=await ensureSupabase();
    const {data,error}=await client.from('orbit_scheduled_messages').select('*').eq('sender_id',owner).in('room',resolveRoomAliases(room,activeChatPeerId)).in('status',['pending','failed']).order('scheduled_at');
    if(error)throw new Error(error.message);
    if(currentUser?.id!==owner||currentRoom!==room)return [];
    orbitSchedules=data||[];return orbitSchedules;
}
async function updateScheduledChipForCurrentRoom() {
    try {
        const rows=await loadOrbitSchedules(),chip=document.getElementById('scheduled-msgs-chip');
        if(!chip)return;chip.classList.toggle('hide',!rows.length);
        const label=document.getElementById('scheduled-msgs-chip-text');if(label)label.textContent=`${rows.length} scheduled message${rows.length===1?'':'s'}`;
    }catch(error){console.warn('[Orbit] Scheduling:',error.message);}
}
async function openScheduledDrawer() {
    const feed=document.getElementById('scheduled-drawer-list');document.getElementById('modal-scheduled-drawer').classList.add('active');
    feed.textContent='Loading scheduled messages…';
    try {
        const rows=await loadOrbitSchedules();
        feed.innerHTML=rows.length?rows.map(row=>`<article class="scheduled-message-card"><div><p>${escapeHtml(row.text)}</p><small>${escapeHtml(new Date(row.scheduled_at).toLocaleString())} · ${escapeHtml(row.status)}</small>${row.error?`<small class="schedule-error">${escapeHtml(row.error)}</small>`:''}</div>${row.status==='pending'?`<button type="button" class="glass-icon-btn" aria-label="Cancel scheduled message" onclick="deleteScheduledMessage('${row.id}')"><i class="fa-solid fa-trash-can"></i></button>`:''}</article>`).join(''):'<p class="chat-empty-state">No pending messages in this chat.</p>';
    }catch(error){feed.textContent=`Could not load schedules: ${error.message}`;}
}
function closeScheduledDrawer(){document.getElementById('modal-scheduled-drawer').classList.remove('active');}
async function deleteScheduledMessage(id){try{const cancelled=await orbitRpc('orbit_cancel_schedule',{schedule_id:id});showToast(cancelled?'Schedule cancelled.':'This message has already been sent.');await openScheduledDrawer();await updateScheduledChipForCurrentRoom();}catch(error){showToast(error.message,'error');}}
// Browser timers never send scheduled messages; the database owns dispatch.
async function checkAndDispatchScheduledMessages(){await updateScheduledChipForCurrentRoom();}

function _canStartVoiceCall(){return !!currentUser && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection!=='undefined';}
function updateVoiceCallButton(){const b=document.getElementById('btn-chat-voice-call');if(b)b.classList.toggle('hide',!_canStartVoiceCall()||!activeChatPeerId||isGroupChat||isSelfChat||isUserBlocked(activeChatPeerId));}
function orbitCallRing(stop=false) {
    orbitStopCallTones();
    clearInterval(orbitRingTimer);orbitRingTimer=null;
    if(stop){if(orbitRingAudio){orbitRingAudio.close().catch(()=>{});orbitRingAudio=null;}return;}
    const beep=()=>{if(!_activeCallRole||!['ringing'].includes(orbitCallRow?.state))return;if(_activeCallRole==='callee'&&localStorage.getItem('orbit_call_ringtone')==='silent')return;orbitPlayTone(_activeCallRole==='caller'?'ringback':(localStorage.getItem('orbit_call_ringtone')||'orbit'),Number(localStorage.getItem('orbit_call_volume')??'.12'),'call');};
    beep();orbitRingTimer=setInterval(beep,_activeCallRole==='caller'?3000:2200);
}
function _showVoiceCallModal({incoming=false}={}) {
    window.OrbitIntroduction?.finish();
    const row=orbitCallRow;
    orbitPrepareCallPanel(incoming);
    orbitAdvancedPrepareCall();
    document.getElementById('call-peer-name').textContent=row?(_activeCallRole==='caller'?row.callee_name:row.caller_name):document.getElementById('chat-target-name')?.textContent||'Orbit user';
    document.getElementById('call-btn-answer').classList.toggle('hide',!incoming);
    document.getElementById('call-btn-mute').disabled=incoming;
    document.getElementById('call-timer-label').textContent='00:00';
    document.getElementById('modal-voice-call').classList.add('active');
    document.getElementById('orbit-call-mini').classList.add('hide');
}
function minimizeOrbitCall(){document.getElementById('modal-voice-call').classList.remove('active');document.getElementById('orbit-call-mini').classList.remove('hide');}
function restoreOrbitCall(){document.getElementById('modal-voice-call').classList.add('active');document.getElementById('orbit-call-mini').classList.add('hide');}
async function orbitWatchIce(row) {
    const client=await ensureSupabase(),id=row.id;
    if(orbitIceChannel)await client.removeChannel(orbitIceChannel);
    orbitSeenIce.clear();
    orbitIceChannel=client.channel(`orbit-ice-${id}-${currentUser.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'orbit_call_signals',filter:`call_id=eq.${id}`},event=>orbitReceiveIce(event.new)).subscribe(async status=>{
        if(status!=='SUBSCRIBED'||_activeCallId!==id)return;
        const {data}=await client.from('orbit_call_signals').select('*').eq('call_id',id).order('id');
        if(_activeCallId===id)for(const signal of data||[])orbitReceiveIce(signal);
    });
}
async function orbitReceiveIce(signal) {
    if(signal.call_id!==_activeCallId||signal.sender_id===currentUser?.id||orbitSeenIce.has(signal.id))return;
    orbitSeenIce.add(signal.id);
    if(peerConnection?.remoteDescription){try{await peerConnection.addIceCandidate(signal.candidate);}catch(_) {}}
    else _pendingCallCandidates.push(signal.candidate);
}
async function _sendVoiceCallSignal(type,extra={}) {
    if(!_activeCallId||!currentUser)return false;
    const callId=_activeCallId,owner=currentUser.id;
    try {
        if(type==='candidate'){const client=await ensureSupabase();if(_activeCallId!==callId||currentUser?.id!==owner)return false;const {error}=await client.from('orbit_call_signals').insert({call_id:callId,sender_id:owner,candidate:extra.candidate});if(error)throw error;}
        else if(type==='end')await orbitRpc('orbit_update_call',{call_key:_activeCallId,next_state:orbitCallRow?.state==='ringing'&&_activeCallRole==='callee'?'declined':'ended'});
        return true;
    }catch(error){console.warn('[Orbit Call]',error.message);return false;}
}
function _createVoicePeerConnection() {
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});peerConnection=pc;
    pc.onicecandidate=event=>{if(event.candidate){const candidate=event.candidate.toJSON();if(_activeCallId)_sendVoiceCallSignal('candidate',{candidate});else orbitLocalIce.push(candidate);}};
    pc.ontrack=event=>{const audio=document.getElementById('remote-call-audio');audio.srcObject=event.streams[0]||new MediaStream([event.track]);orbitResumeCallAudio();};
    pc.onconnectionstatechange=async()=>{
        if(peerConnection!==pc)return;
        if(pc.connectionState==='connected'){
            orbitCallRing(true);orbitCallPanelCleanup();document.getElementById('call-avatar-wrap')?.classList.add('is-connected');clearTimeout(callNoAnswerTimer);_setVoiceCallStatus('Connected · voice call');startCallTimer();orbitAdvancedCallConnected(pc);
            document.getElementById('call-btn-mute').disabled=false;
            try{await orbitRpc('orbit_update_call',{call_key:_activeCallId,next_state:'connected'});}catch(error){console.warn(error.message);}
            await refreshOrbitAudioDevices();
        }else if(pc.connectionState==='failed'){showToast('Could not connect this call. Try another network.','error');await endVoiceCall(true,'failed');}
        else if(pc.connectionState==='connecting'){_setVoiceCallStatus('Connecting…');clearTimeout(orbitCallReconnectTimer);orbitCallReconnectTimer=setTimeout(()=>{if(peerConnection===pc&&pc.connectionState!=='connected')endVoiceCall(true,'failed');},30000);}
        else if(pc.connectionState==='disconnected'){_setVoiceCallStatus('Reconnecting…');clearTimeout(orbitCallReconnectTimer);orbitCallReconnectTimer=setTimeout(()=>{if(peerConnection===pc&&pc.connectionState!=='connected')endVoiceCall(true,'failed');},20000);}
    };
    return pc;
}
async function startVoiceCall() {
    if(!_canStartVoiceCall()||!currentRoom||!activeChatPeerId||isGroupChat||isSelfChat){showToast('Open a direct chat on a device with microphone support.','error');return;}
    if(isUserBlocked(activeChatPeerId)){showToast('Unblock this person to call.','error');return;}
    if(_activeCallId||peerConnection||_activeCallRole)return;
    const epoch=++orbitCallEpoch;
    const owner=currentUser.id,room=currentRoom,peer=activeChatPeerId;
    _activeCallRole='caller';_activeCallRoom=room;_activeCallPeerId=peer;orbitCallRow=null;orbitLocalIce=[];
    _showVoiceCallModal();_setVoiceCallStatus('Requesting microphone…');
    try {
        const stream=await navigator.mediaDevices.getUserMedia({audio:orbitCallAudioConstraints()});
        if(currentUser?.id!==owner||_activeCallRoom!==room||epoch!==orbitCallEpoch){stream.getTracks().forEach(t=>t.stop());return;}
        localAudioStream=stream;
        const pc=_createVoicePeerConnection();localAudioStream.getTracks().forEach(track=>pc.addTrack(track,localAudioStream));
        await pc.setLocalDescription(await pc.createOffer());
        const row=await orbitRpc('orbit_start_call',{chat_room:room,peer_id:peer,description:pc.localDescription.toJSON()});
        if(currentUser?.id!==owner||_activeCallRoom!==room||epoch!==orbitCallEpoch){orbitReportCallEnd(row.id,'ended',owner);return;}
        orbitCallRow=row;_activeCallId=row.id;orbitWatchIce(row).catch(error=>console.warn('[Orbit Call] ICE subscription:',error.message));
        _showVoiceCallModal();_setVoiceCallStatus('Ringing…');orbitCallRing();
        Promise.allSettled(orbitLocalIce.splice(0).map(candidate=>_sendVoiceCallSignal('candidate',{candidate})));
        callNoAnswerTimer=setTimeout(()=>{if(orbitCallRow?.state==='ringing')endVoiceCall(true,'missed');},47000);
        const client=await ensureSupabase();const {data}=await client.from('orbit_calls').select('*').eq('id',row.id).single();if(data)receiveOrbitCall(data);
    }catch(error){if(epoch===orbitCallEpoch){showToast(error.message||'Could not start call.','error');await endVoiceCall(false);}}
}
async function receiveOrbitCall(row) {
    if(!row?.id||!currentUser||![row.caller_id,row.callee_id].includes(currentUser.id))return;
    if(orbitTerminalCalls.has(row.state))orbitRememberClosedCall(row.id);
    else if(orbitClosedCallIds.has(row.id))return;
    if(row.id!==_activeCallId){
        if(row.callee_id!==currentUser.id||row.state!=='ringing'||(!Number.isFinite(Date.parse(row.created_at))||Date.parse(row.created_at)<Date.now()-45000)||_activeCallId||peerConnection||isUserBlocked(row.caller_id))return;
        orbitCallRow=row;_activeCallId=row.id;_activeCallPeerId=row.caller_id;_activeCallRoom=row.room;_activeCallRole='callee';_pendingCallOffer=row.offer;_pendingCallCandidates=[];
        // Paint, ring and notify before any additional network round trip.
        _showVoiceCallModal({incoming:true});_setVoiceCallStatus('Incoming voice call');orbitCallRing();
        orbitNotifyIncomingCall(row);
        orbitWatchIce(row).catch(error=>console.warn('[Orbit Call] ICE subscription:',error.message));
        callNoAnswerTimer=setTimeout(()=>{if(orbitCallRow?.state==='ringing')endVoiceCall(true,'missed');},Math.max(1000,Date.parse(row.created_at)+47000-Date.now()));
        return;
    }
    orbitCallRow=row;
    if(_activeCallRole==='callee'&&!peerConnection&&!orbitAnswerInProgress&&['connecting','connected'].includes(row.state)){showToast('Call answered on another device.','info');await endVoiceCall(false);return;}
    if(orbitTerminalCalls.has(row.state)){if(!orbitCallClosing){showToast(row.state==='declined'?'Call declined.':row.state==='missed'?'Missed voice call.':'Call ended.');await endVoiceCall(false);}return;}
    if(row.answer&&_activeCallRole==='caller'&&peerConnection&&!peerConnection.remoteDescription){try{orbitCallRing(true);await peerConnection.setRemoteDescription(row.answer);await _applyPendingCallCandidates();_setVoiceCallStatus('Connecting…');}catch(error){showToast(error.message,'error');}}
}
async function answerVoiceCall() {
    if(_activeCallRole!=='callee'||!_pendingCallOffer||!_activeCallId||peerConnection||orbitAnswerInProgress)return;
    orbitAnswerInProgress=true;
    const id=_activeCallId,owner=currentUser.id,epoch=++orbitCallEpoch;orbitCallRing(true);orbitCallPanelCleanup();document.getElementById('call-btn-answer').classList.add('hide');_setVoiceCallStatus('Requesting microphone…');
    try {
        const stream=await navigator.mediaDevices.getUserMedia({audio:orbitCallAudioConstraints()});
        if(_activeCallId!==id||currentUser?.id!==owner||epoch!==orbitCallEpoch){stream.getTracks().forEach(t=>t.stop());return;}
        localAudioStream=stream;
        const pc=_createVoicePeerConnection();localAudioStream.getTracks().forEach(t=>pc.addTrack(t,localAudioStream));
        await pc.setRemoteDescription(_pendingCallOffer);await _applyPendingCallCandidates();await pc.setLocalDescription(await pc.createAnswer());
        const answered=await orbitRpc('orbit_update_call',{call_key:id,next_state:'connecting',description:pc.localDescription.toJSON()});
        if(_activeCallId!==id||epoch!==orbitCallEpoch)return;
        orbitCallRow=answered;
        if(orbitTerminalCalls.has(orbitCallRow?.state)){showToast('This call has expired.');await endVoiceCall(false);return;}
        _pendingCallOffer=null;clearTimeout(callNoAnswerTimer);_setVoiceCallStatus('Connecting…');
    }catch(error){if(epoch===orbitCallEpoch){showToast(error.message,'error');await endVoiceCall(true,'failed');}}
    finally{if(_activeCallId===id&&epoch===orbitCallEpoch)orbitAnswerInProgress=false;}
}
async function handleWebRTCSignal(){/* Legacy public broadcast signals are no longer accepted. */}
async function endVoiceCall(notifyPeer=true,outcome=null) {
    if(orbitCallClosing)return;orbitCallClosing=true;
    orbitCallEpoch++;
    const id=_activeCallId,row=orbitCallRow,role=_activeCallRole;
    orbitRememberClosedCall(id);
    try {
        if(notifyPeer&&id)orbitReportCallEnd(id,outcome||(row?.state==='ringing'&&role==='callee'?'declined':'ended'),row?(role==='caller'?row.caller_id:row.callee_id):currentUser?.id);
    }catch(error){console.warn('[Orbit Call] End:',error.message);}
    finally {
        orbitAdvancedCallCleanup();orbitCallRing(true);orbitCallPanelCleanup();clearTimeout(callNoAnswerTimer);clearInterval(callDurationTimer);callDurationTimer=null;callNoAnswerTimer=null;callStartTime=0;
        if(peerConnection){peerConnection.onconnectionstatechange=null;peerConnection.onicecandidate=null;peerConnection.close();peerConnection=null;}
        localAudioStream?.getTracks().forEach(track=>track.stop());localAudioStream=null;
        const audio=document.getElementById('remote-call-audio');audio.pause();audio.srcObject=null;
        document.getElementById('modal-voice-call').classList.remove('active');document.getElementById('orbit-call-mini').classList.add('hide');
        document.getElementById('call-btn-mute').classList.remove('active');document.querySelector('#call-btn-mute i').className='fa-solid fa-microphone';
        if(orbitIceChannel){getSupabase()?.removeChannel(orbitIceChannel).catch(()=>{});orbitIceChannel=null;}
        _activeCallId=null;_activeCallPeerId=null;_activeCallRoom=null;_activeCallRole=null;orbitCallRow=null;orbitAnswerInProgress=false;_pendingCallOffer=null;_pendingCallCandidates=[];orbitLocalIce=[];orbitCallClosing=false;
    }
}
async function refreshOrbitAudioDevices() {
    const output=document.getElementById('orbit-call-output'),input=document.getElementById('orbit-call-input');
    try {
        const connection=peerConnection;const devices=await navigator.mediaDevices.enumerateDevices();if(peerConnection!==connection)return;
        for(const [select,kind]of [[input,'audioinput'],[output,'audiooutput']]){
            select.innerHTML='<option value="default">Device default</option>'+devices.filter(d=>d.kind===kind&&d.deviceId!=='default').map((d,i)=>`<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label||`Audio device ${i+1}`)}</option>`).join('');
        }
        input.value=localAudioStream?.getAudioTracks()[0]?.getSettings?.().deviceId||'default';
        output.value=document.getElementById('remote-call-audio').sinkId||'default';
        output.disabled=typeof document.getElementById('remote-call-audio').setSinkId!=='function';
        document.getElementById('orbit-output-note').textContent=output.disabled?'Use your device audio controls to switch speaker or headphones.':'';
    }catch(_){output.disabled=true;}
}
async function changeOrbitCallDevice(kind,id) {
    const deviceEpoch=kind==='input'?++orbitCallDeviceEpoch:orbitCallDeviceEpoch;
    const input=document.getElementById('orbit-call-input');if(kind==='input'&&input)input.disabled=true;
    try {
        if(kind==='output'){await document.getElementById('remote-call-audio').setSinkId(id);return;}
        if(!peerConnection)return;
        const originalConnection=peerConnection;
        const stream=await navigator.mediaDevices.getUserMedia({audio:orbitCallAudioConstraints(id)});
        if(peerConnection!==originalConnection||deviceEpoch!==orbitCallDeviceEpoch){stream.getTracks().forEach(t=>t.stop());return;}
        const track=stream.getAudioTracks()[0],sender=peerConnection.getSenders().find(s=>s.track?.kind==='audio');
        if(!sender){track.stop();return;}track.enabled=localAudioStream?.getAudioTracks()[0]?.enabled!==false;try{await sender.replaceTrack(track);}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}if(peerConnection!==originalConnection||deviceEpoch!==orbitCallDeviceEpoch){stream.getTracks().forEach(t=>t.stop());return;}localAudioStream?.getTracks().forEach(t=>t.stop());localAudioStream=stream;
    }catch(error){showToast(`Could not switch audio device: ${error.message}`,'error');}
    finally{if(kind==='input'&&input&&deviceEpoch===orbitCallDeviceEpoch)input.disabled=false;}
}

function formatOrbitMessageText(raw) {
    const tokens=[];
    let text=String(raw).replace(/\u0000/g,'').replace(/`([^`\n]+)`|https?:\/\/[^\s<>]+/g,(value,code)=>{
        const index=tokens.length;
        tokens.push(code!==undefined?`<code>${escapeHtml(code)}</code>`:`<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer" class="msg-content-link">${escapeHtml(value)}</a>`);
        return `\u0000${index}\u0000`;
    });
    text=escapeHtml(text).replace(/\*([^*\n]+)\*/g,'<strong>$1</strong>').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:])/g,'$1<em>$2</em>').replace(/~([^~\n]+)~/g,'<del>$1</del>');
    text=text.replace(/@([a-zA-Z0-9_.-]+)/g,'<span class="mention-tag">@$1</span>');
    return text.replace(/\u0000(\d+)\u0000/g,(_,index)=>tokens[Number(index)]);
}
function formatOrbitCallDetail(raw) {
    const value=String(raw||'Voice call').replace(/^Voice call(?: · )?/,'');
    const match=value.match(/^(\d+) seconds$/);
    if(match){const seconds=Number(match[1]),minutes=Math.floor(seconds/60);return minutes?`${minutes} min${seconds%60?' '+seconds%60+' sec':''}`:`${seconds} sec`;}
    return {missed:'Missed call',declined:'Declined',ended:'Cancelled',failed:'Could not connect'}[value]||value||'Calling…';
}
function applyOrbitTextFormat(kind) {
    const input=document.getElementById('msg-input'),marker={bold:'*',italic:'_',strike:'~',code:'`'}[kind];if(!marker)return;
    const start=input.selectionStart,end=input.selectionEnd,selected=input.value.slice(start,end)||'text';
    input.setRangeText(marker+selected+marker,start,end,'select');input.focus();input.setSelectionRange(start+marker.length,start+marker.length+selected.length);handleChatInputText(input);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentUser)recoverOrbitIncomingCall();});
window.addEventListener('online',()=>{if(currentUser){initOrbitChatServices();recoverOrbitIncomingCall();}});
document.getElementById('msg-input')?.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&['b','i','e'].includes(event.key.toLowerCase())){event.preventDefault();applyOrbitTextFormat({b:'bold',i:'italic',e:'code'}[event.key.toLowerCase()]);}});
