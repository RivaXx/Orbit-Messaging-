// Call controls are local to this device. Signaling stays in the authenticated call service.
let orbitCallStatsTimer=null,orbitCallStatsPrevious=null,orbitCallWakeLock=null,orbitCallKeepAwake=false,orbitCallWakePending=false;
let orbitCallListeningMuted=false,orbitCallAudioEpoch=0,orbitCallControlsEpoch=0,orbitCallNoiseEpoch=0,orbitCallDeviceEpoch=0,orbitPendingCallLink=null;
function orbitCallQuality(stats,previous) {
 let received=0,lost=0,rtt=null,jitter=null,hasAudio=false;
 stats.forEach(report=>{
  if(report.type==='inbound-rtp'&&(report.kind||report.mediaType)==='audio') {hasAudio=true;received+=report.packetsReceived||0;lost+=Math.max(0,report.packetsLost||0);if(Number.isFinite(report.jitter))jitter=Math.max(jitter||0,report.jitter*1000);}
  if(report.type==='candidate-pair'&&report.state==='succeeded'&&(report.nominated||report.selected)&&Number.isFinite(report.currentRoundTripTime))rtt=report.currentRoundTripTime*1000;
 });
 const dr=previous?Math.max(0,received-previous.received):received,dl=previous?Math.max(0,lost-previous.lost):lost;
 const loss=dr+dl?100*dl/(dr+dl):null;
 const level=!hasAudio&&rtt===null?'unknown':(rtt!==null&&rtt>500||loss!==null&&loss>8||jitter!==null&&jitter>80)?'poor':(rtt!==null&&rtt>250||loss!==null&&loss>3||jitter!==null&&jitter>40)?'fair':'good';
 return {received,lost,rtt,jitter,loss,level};
}
function orbitAdvancedPrepareCall() {
 const panel=document.querySelector('.call-modal-box');if(!panel)return;
 if(!document.getElementById('orbit-call-quality')) {
  const quality=document.createElement('div');quality.id='orbit-call-quality';quality.className='orbit-call-quality';quality.textContent='Secure voice connection';document.getElementById('call-timer-label').after(quality);
  const controls=document.createElement('div');controls.className='orbit-call-secondary-controls';
  controls.innerHTML='<button type="button" id="orbit-call-listen" aria-pressed="false" onclick="orbitToggleCallListening()"><i class="fa-solid fa-volume-high" aria-hidden="true"></i><span>Mute incoming audio</span></button><button type="button" id="orbit-call-awake" aria-pressed="false" onclick="orbitToggleCallAwake()"><i class="fa-solid fa-sun" aria-hidden="true"></i><span>Keep screen awake</span></button><button type="button" id="orbit-call-resume" hidden onclick="orbitResumeCallAudio()">Enable call audio</button>';
  document.querySelector('.call-action-btns').after(controls);
  const details=document.createElement('details');details.className='orbit-call-settings';details.innerHTML='<summary>Audio &amp; call settings</summary><div class="orbit-call-setting-fields"><label>Listening volume<input type="range" id="orbit-call-listening-volume" min="0" max="1" step="0.05" value="1" oninput="orbitSetCallVolume(this.value)"></label><label class="orbit-call-check"><input type="checkbox" id="orbit-call-noise" checked onchange="orbitSetCallNoise(this.checked)">Reduce background noise</label><p id="orbit-call-audio-note" role="status"></p></div>';
  panel.append(details);for(const selector of ['.orbit-call-devices','.orbit-call-sound']){const el=panel.querySelector(selector);if(el)details.append(el);}
  const hint=panel.querySelector('.orbit-call-hint');if(hint)details.append(hint);
 }
 const mini=document.querySelector('#orbit-call-mini button');if(mini)mini.title=document.getElementById('call-peer-name')?.textContent||'Return to call';
 document.getElementById('orbit-call-output').disabled=typeof document.getElementById('remote-call-audio').setSinkId!=='function';
 document.getElementById('orbit-call-awake').disabled=!navigator.wakeLock;
 document.getElementById('orbit-call-awake').title=navigator.wakeLock?'Keep this screen on for this call':'Screen wake lock is unavailable in this browser';
 for(const [selector,text] of [['#call-btn-answer','Answer'],['#call-btn-mute','Microphone'],['.call-btn.end',_activeCallRole==='callee'&&orbitCallRow?.state==='ringing'?'Decline':'End call']]){const button=document.querySelector(selector);if(button){let caption=button.querySelector('.orbit-call-button-caption');if(!caption){caption=document.createElement('span');caption.className='orbit-call-button-caption';caption.setAttribute('aria-hidden','true');button.append(caption);}caption.textContent=text;}}
 const supported=navigator.mediaDevices?.getSupportedConstraints?.();
 document.getElementById('orbit-call-noise').disabled=!supported?.noiseSuppression;
 document.getElementById('orbit-call-noise').checked=localStorage.getItem('orbit_call_noise')!=='false';
 document.getElementById('orbit-call-listening-volume').value=String(document.getElementById('remote-call-audio').volume);
}
function orbitCallAudioConstraints(deviceId) {
 const constraints={echoCancellation:true,noiseSuppression:localStorage.getItem('orbit_call_noise')!=='false',autoGainControl:true};
 if(deviceId&&deviceId!=='default')constraints.deviceId={exact:deviceId};return constraints;
}
function orbitSetCallVolume(value) {
 const volume=Number(value);if(!Number.isFinite(volume))return;
 document.getElementById('remote-call-audio').volume=Math.max(0,Math.min(1,volume));
}
function orbitToggleCallListening() {
 orbitCallListeningMuted=!orbitCallListeningMuted;
 document.getElementById('remote-call-audio').muted=orbitCallListeningMuted;
 const button=document.getElementById('orbit-call-listen');if(!button)return;
 button.setAttribute('aria-pressed',String(orbitCallListeningMuted));button.querySelector('span').textContent=orbitCallListeningMuted?'Unmute incoming audio':'Mute incoming audio';
 button.querySelector('i').className=orbitCallListeningMuted?'fa-solid fa-volume-xmark':'fa-solid fa-volume-high';
}
async function orbitResumeCallAudio() {
 const epoch=orbitCallAudioEpoch,audio=document.getElementById('remote-call-audio');
 try{await audio.play();if(epoch===orbitCallAudioEpoch)document.getElementById('orbit-call-resume').hidden=true;}
 catch(_){if(epoch===orbitCallAudioEpoch)document.getElementById('orbit-call-resume').hidden=false;}
}
async function orbitSetCallNoise(enabled) {
 const epoch=++orbitCallNoiseEpoch,track=localAudioStream?.getAudioTracks()[0],note=document.getElementById('orbit-call-audio-note');
 if(!track?.applyConstraints){if(note)note.textContent='Noise reduction will apply when the microphone connects.';localStorage.setItem('orbit_call_noise',String(enabled));return;}
 try{await track.applyConstraints({noiseSuppression:!!enabled});if(epoch!==orbitCallNoiseEpoch||track!==localAudioStream?.getAudioTracks()[0])return;localStorage.setItem('orbit_call_noise',String(enabled));if(note)note.textContent=enabled?'Noise reduction enabled.':'Noise reduction disabled.';}
 catch(_){if(epoch!==orbitCallNoiseEpoch||track!==localAudioStream?.getAudioTracks()[0])return;document.getElementById('orbit-call-noise').checked=localStorage.getItem('orbit_call_noise')!=='false';if(note)note.textContent='This device could not change noise reduction.';}
}
async function orbitToggleCallAwake() {
 orbitCallKeepAwake=!orbitCallKeepAwake;
 if(!orbitCallKeepAwake){await orbitReleaseCallWake();return;}
 await orbitAcquireCallWake();
}
async function orbitAcquireCallWake() {
 if(!orbitCallKeepAwake||!_activeCallId||document.hidden||orbitCallWakeLock||orbitCallWakePending)return;
 const id=_activeCallId,epoch=orbitCallControlsEpoch;orbitCallWakePending=true;
 try{const lock=await navigator.wakeLock.request('screen');if(epoch!==orbitCallControlsEpoch||!orbitCallKeepAwake||_activeCallId!==id){await lock.release();return;}orbitCallWakeLock=lock;document.getElementById('orbit-call-awake')?.setAttribute('aria-pressed','true');lock.addEventListener('release',()=>{if(orbitCallWakeLock===lock){orbitCallWakeLock=null;document.getElementById('orbit-call-awake')?.setAttribute('aria-pressed','false');}});}
 catch(_){if(epoch===orbitCallControlsEpoch){orbitCallKeepAwake=false;showToast('Your browser could not keep the screen awake.','info');}}
 finally{orbitCallWakePending=false;}
}
async function orbitReleaseCallWake(){const lock=orbitCallWakeLock;orbitCallWakeLock=null;document.getElementById('orbit-call-awake')?.setAttribute('aria-pressed','false');try{await lock?.release();}catch(_) {}}
async function orbitMeasureCallQuality(pc) {
 if(!pc?.getStats||peerConnection!==pc)return;
 try{const reports=await pc.getStats();if(peerConnection!==pc)return;const sample=orbitCallQuality(reports,orbitCallStatsPrevious);orbitCallStatsPrevious=sample;const badge=document.getElementById('orbit-call-quality');if(!badge)return;badge.dataset.quality=sample.level;badge.textContent={unknown:'Measuring connection…',good:'Good connection',fair:'Unstable connection',poor:'Poor connection'}[sample.level];badge.title=[sample.rtt===null?'':Math.round(sample.rtt)+' ms round-trip time',sample.loss===null?'':sample.loss.toFixed(1)+'% packet loss',sample.jitter===null?'':Math.round(sample.jitter)+' ms jitter'].filter(Boolean).join(' · ');}
 catch(_) {if(peerConnection!==pc)return;const badge=document.getElementById('orbit-call-quality');if(badge)badge.textContent='Connection details unavailable';}
}
function orbitAdvancedCallConnected(pc) {
 const end=document.querySelector('.call-btn.end');if(end){end.setAttribute('aria-label','End call');end.title='End call';const caption=end.querySelector('.orbit-call-button-caption');if(caption)caption.textContent='End call';}
 orbitAcquireCallWake();if(orbitCallStatsTimer)return;orbitCallStatsPrevious=null;orbitMeasureCallQuality(pc);orbitCallStatsTimer=setInterval(()=>orbitMeasureCallQuality(pc),5000);
}
function orbitAdvancedCallCleanup() {
 clearInterval(orbitCallStatsTimer);orbitCallStatsTimer=null;orbitCallStatsPrevious=null;orbitCallAudioEpoch++;orbitCallControlsEpoch++;orbitCallNoiseEpoch++;orbitCallDeviceEpoch++;
 orbitCallKeepAwake=false;orbitReleaseCallWake();orbitCallListeningMuted=false;
 const audio=document.getElementById('remote-call-audio');if(audio){audio.muted=false;audio.volume=1;}
 const input=document.getElementById('orbit-call-input');if(input)input.disabled=false;
 const listen=document.getElementById('orbit-call-listen');if(listen){listen.setAttribute('aria-pressed','false');listen.querySelector('span').textContent='Mute incoming audio';listen.querySelector('i').className='fa-solid fa-volume-high';}
 const quality=document.getElementById('orbit-call-quality');if(quality){quality.textContent='Secure voice connection';delete quality.dataset.quality;quality.title='';}
 const resume=document.getElementById('orbit-call-resume');if(resume)resume.hidden=true;
 document.querySelector('.orbit-call-settings')?.removeAttribute('open');
}
async function orbitOpenCallNotification(id) {
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
 if(!currentUser){orbitPendingCallLink=id;return;}
 orbitPendingCallLink=null;if(_activeCallId===id){restoreOrbitCall();return;}
 const owner=currentUser.id,client=await ensureSupabase();
 try{const {data,error}=await client.from('orbit_calls').select('*').eq('id',id).single();if(currentUser?.id!==owner)return;
 if(error||!data||data.callee_id!==owner||data.state!=='ringing'||!Number.isFinite(Date.parse(data.created_at))||Date.parse(data.created_at)<Date.now()-45000){showToast('This call has ended. Open the chat to call back.','info');return;}
 if(_activeCallId&&_activeCallId!==id){showToast('You are already on another call.','info');return;}await receiveOrbitCall(data);
 }catch(_){showToast('Could not load the call. Check your connection.','error');}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){orbitAcquireCallWake();orbitRetryCallEnds();}});
navigator.mediaDevices?.addEventListener?.('devicechange',()=>{if(_activeCallId)refreshOrbitAudioDevices();});

// Stop media immediately, and retry only the authenticated end-of-call update after reconnecting.
let orbitCallEndSyncOwner=null;
function orbitPendingCallEnds(owner){try{const rows=JSON.parse(localStorage.getItem('orbit_call_ends_'+owner)||'[]');return Array.isArray(rows)?rows.filter(row=>/^[0-9a-f-]{36}$/i.test(row.id)&&['ended','declined','missed','failed'].includes(row.state)&&row.at>Date.now()-86400000).slice(-20):[];}catch(_){return [];}}
function orbitReportCallEnd(id,state,owner){
 if(!owner)return;const rows=orbitPendingCallEnds(owner).filter(row=>row.id!==id);rows.push({id,state,at:Date.now()});
 try{localStorage.setItem('orbit_call_ends_'+owner,JSON.stringify(rows.slice(-20)));}catch(_){}
 orbitRetryCallEnds();
}
async function orbitRetryCallEnds(){
 const owner=currentUser?.id;if(!owner||orbitCallEndSyncOwner===owner||navigator.onLine===false)return;
 orbitCallEndSyncOwner=owner;
 try{for(const row of orbitPendingCallEnds(owner)){
  if(currentUser?.id!==owner)return;
  try{const client=await ensureSupabase();if(currentUser?.id!==owner)return;
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
   let result;try{result=await client.rpc('orbit_update_call',{call_key:row.id,next_state:row.state}).abortSignal(controller.signal);}finally{clearTimeout(timeout);}
   if(result.error)break;
   const remaining=orbitPendingCallEnds(owner).filter(item=>item.id!==row.id);localStorage.setItem('orbit_call_ends_'+owner,JSON.stringify(remaining));
  }catch(_){break;}
 }}finally{if(orbitCallEndSyncOwner===owner)orbitCallEndSyncOwner=null;}
}
window.addEventListener('online',()=>{orbitRetryCallEnds();if(_activeCallId)recoverOrbitIncomingCall();});
window.addEventListener('offline',()=>{if(_activeCallId)_setVoiceCallStatus('Network unavailable · reconnecting…');});

window.addEventListener('keydown',event=>{
 const modal=document.getElementById('modal-voice-call');if(!modal?.classList.contains('active'))return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();const settings=document.querySelector('.orbit-call-settings');if(settings?.open){settings.open=false;settings.querySelector('summary').focus();}else minimizeOrbitCall();return;}
 if(event.key==='Tab'){const focusable=[...modal.querySelectorAll('button,summary,input,select,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=focusable[0],last=focusable[focusable.length-1];if(!first)return;if(!modal.contains(document.activeElement)){event.preventDefault();first.focus();return;}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 if(event.key.toLowerCase()==='m'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)&&localAudioStream){event.preventDefault();toggleCallMute();}
},true);
