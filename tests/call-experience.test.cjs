const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),id='11111111-1111-4111-8111-111111111111';
function setup(){const nodes=new Map(),store=new Map(),events={},timers=[],toasts=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',title:'',value:'',hidden:false,checked:true,disabled:false,dataset:{},volume:1,muted:false,attrs:{},classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this.attrs[k]=v;},querySelector(sel){return node(id+sel);},removeAttribute(){},addEventListener(){},pause(){},play:async()=>{}});return nodes.get(id);};
 const c=vm.createContext({console,URL,Date,AbortController,setInterval:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearInterval(){},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},
 document:{hidden:false,getElementById:node,querySelector:sel=>node(sel),addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{onLine:true,mediaDevices:{addEventListener(){}}},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))},
 currentUser:{id:'owner'},_activeCallId:id,_activeCallRole:'caller',_activeCallPeerId:'peer',_activeCallRoom:'room',peerConnection:null,localAudioStream:null,_pendingCallOffer:null,_pendingCallCandidates:[],callNoAnswerTimer:null,callDurationTimer:null,callStartTime:0,
 showToast:msg=>toasts.push(msg),restoreOrbitCall(){},receiveOrbitCall:async()=>{},ensureSupabase:async()=>({}),getSupabase:()=>null,orbitCallPanelCleanup(){},orbitCallRing(){}});
 vm.runInContext(read('js/call-experience.js'),c);return {c,node,store,events,timers,toasts};}
test('quality uses packet deltas, RTT and jitter, with unknown before measurable audio',()=>{
 const {c}=setup();let stats=[{type:'inbound-rtp',kind:'audio',packetsReceived:1000,packetsLost:10,jitter:.01},{type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:.1}];
 let a=c.orbitCallQuality(stats,null);assert.equal(a.level,'good');assert.equal(a.rtt,100);
 stats[0]={...stats[0],packetsReceived:1010,packetsLost:20};a=c.orbitCallQuality(stats,a);assert.equal(a.loss,50);assert.equal(a.level,'poor');
 assert.equal(c.orbitCallQuality([],null).level,'unknown');
 assert.equal(c.orbitCallQuality([{type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:.3}],null).level,'fair');
});
test('listening mute never mutes microphone and volume rejects invalid values',()=>{
 const {c,node}=setup();const track={enabled:true};c.localAudioStream={getAudioTracks:()=>[track]};c.orbitToggleCallListening();assert.equal(node('remote-call-audio').muted,true);assert.equal(track.enabled,true);assert.equal(node('orbit-call-listen').attrs['aria-pressed'],'true');c.orbitToggleCallListening();assert.equal(node('remote-call-audio').muted,false);
 c.orbitSetCallVolume('.35');assert.equal(node('remote-call-audio').volume,.35);c.orbitSetCallVolume('bad');assert.equal(node('remote-call-audio').volume,.35);c.orbitSetCallVolume(3);assert.equal(node('remote-call-audio').volume,1);
});
test('noise failure preserves preference and a stale track completion cannot change a later call',async()=>{
 const {c,node,store}=setup();store.set('orbit_call_noise','true');const track={applyConstraints:async()=>{throw Error('unsupported');}};c.localAudioStream={getAudioTracks:()=>[track]};await c.orbitSetCallNoise(false);assert.equal(store.get('orbit_call_noise'),'true');assert.equal(node('orbit-call-noise').checked,true);
 let finish;track.applyConstraints=()=>new Promise(resolve=>finish=resolve);const pending=c.orbitSetCallNoise(false);c.localAudioStream=null;finish();await pending;assert.equal(store.get('orbit_call_noise'),'true');
 assert.equal(c.orbitCallAudioConstraints().echoCancellation,true);
});
test('late wake-lock grants release immediately after call cleanup',async()=>{
 const {c,node}=setup();let grant,released=0;c.navigator.wakeLock={request:()=>new Promise(resolve=>grant=resolve)};const pending=c.orbitToggleCallAwake();c.orbitAdvancedCallCleanup();grant({release:async()=>released++,addEventListener(){}});await pending;assert.equal(released,1);assert.equal(node('orbit-call-awake').attrs['aria-pressed'],'false');
});
test('stats arriving after hangup cannot repaint the next call',async()=>{
 const {c,node}=setup();let finish;const pc={getStats:()=>new Promise(resolve=>finish=resolve)};c.peerConnection=pc;const pending=c.orbitMeasureCallQuality(pc);c.peerConnection=null;node('orbit-call-quality').textContent='New call';finish([]);await pending;assert.equal(node('orbit-call-quality').textContent,'New call');
});
test('call links validate identity, expiry and membership without automatically answering',async()=>{
 const {c,toasts}=setup();c._activeCallId=null;let receives=0,queries=0;let row={id,callee_id:'other',state:'ringing',created_at:new Date().toISOString()};c.ensureSupabase=async()=>({from:()=>{queries++;return {select(){return this;},eq(){return this;},single:async()=>({data:row})};}});c.receiveOrbitCall=async()=>receives++;
 await c.orbitOpenCallNotification('bad');assert.equal(queries,0);await c.orbitOpenCallNotification(id);assert.equal(receives,0);
 row={...row,callee_id:'owner',created_at:new Date(Date.now()-60000).toISOString()};await c.orbitOpenCallNotification(id);assert.equal(receives,0);
 row.created_at=new Date().toISOString();await c.orbitOpenCallNotification(id);assert.equal(receives,1);assert.equal(toasts.length,2);
});
test('hangup releases microphone and peer immediately while the end RPC is pending',async()=>{
 const {c,node}=setup();vm.runInContext(read('js/orbit-chat-services.js'),c);let stopped=0,closed=0,reports=0;
 c.orbitCallRing=()=>{};c.orbitReportCallEnd=()=>{reports++;return new Promise(()=>{});};c.localAudioStream={getTracks:()=>[{stop(){stopped++;}}]};c.peerConnection={close(){closed++;}};
 await c.endVoiceCall(true);assert.equal(stopped,1);assert.equal(closed,1);assert.equal(reports,1);assert.equal(c._activeCallId,null);assert.equal(node('remote-call-audio').muted,false);
});
test('end-of-call queue retries failed updates and keeps other accounts isolated',async()=>{
 const {c,store}=setup();c.navigator.onLine=false;c.orbitReportCallEnd(id,'ended','owner');assert.equal(c.orbitPendingCallEnds('owner').length,1);assert.equal(c.orbitPendingCallEnds('another').length,0);
 c.navigator.onLine=true;let fail=true;c.ensureSupabase=async()=>({rpc:()=>({abortSignal:async()=>({error:fail?{message:'offline'}:null})})});await c.orbitRetryCallEnds();assert.equal(c.orbitPendingCallEnds('owner').length,1);fail=false;await c.orbitRetryCallEnds();assert.equal(c.orbitPendingCallEnds('owner').length,0);
 store.set('orbit_call_ends_owner','not json');assert.equal(c.orbitPendingCallEnds('owner').length,0);
});
test('failed microphone replacement stops new tracks and keeps the original stream',async()=>{
 const {c}=setup();vm.runInContext(read('js/orbit-chat-services.js'),c);let stopped=0;const old={getAudioTracks:()=>[{enabled:false}],getTracks:()=>[]};c.localAudioStream=old;c.peerConnection={getSenders:()=>[{track:{kind:'audio'},replaceTrack:async()=>{throw Error('switch failed');}}]};c.navigator.mediaDevices.getUserMedia=async()=>({getAudioTracks:()=>[{stop(){stopped++;}}],getTracks:()=>[{stop(){stopped++;}}]});await c.changeOrbitCallDevice('input','new');assert.equal(stopped,1);assert.equal(c.localAudioStream,old);
});
function worker(){const handlers={},shown=[],opened=[],messages=[];const c=vm.createContext({console,Date,URL,Response,setTimeout,clearTimeout,self:{location:{origin:'https://orbit.example'},registration:{scope:'https://orbit.example/',getNotifications:async()=>[],showNotification:async(title,options)=>shown.push({title,...options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},addEventListener:(name,fn)=>handlers[name]=fn},caches:{}});vm.runInContext(read('sw.js'),c);return {c,handlers,shown,opened,messages};}
test('push calls use a call tag, call actions and call ID; expired call pushes are discarded',async()=>{
 const {handlers,shown}=worker();let pending;handlers.push({data:{json:()=>({isCall:true,msgId:id,timestamp:Date.now()-60000})},waitUntil:p=>pending=p});assert.equal(pending,undefined);
 handlers.push({data:{json:()=>({isCall:true,msgId:id,roomId:'room',timestamp:Date.now(),title:'Caller'})},waitUntil:p=>pending=p});await pending;assert.equal(shown.length,1);assert.equal(shown[0].tag,'orbit-call-'+id);assert.equal(shown[0].data.callId,id);assert.equal(shown[0].actions[0].title,'View call');
});
test('notification dismiss does not navigate and call links always stay on Orbit origin',async()=>{
 const {handlers,opened}=worker();let pending,closed=0;const notification={close:()=>closed++,data:{url:'https://evil.example',callId:id,roomId:'room'}};
 handlers.notificationclick({notification,action:'dismiss',waitUntil:p=>pending=p});assert.equal(pending,undefined);assert.equal(closed,1);
 handlers.notificationclick({notification,action:'open',waitUntil:p=>pending=p});await pending;const url=new URL(opened[0]);assert.equal(url.origin,'https://orbit.example');assert.equal(url.searchParams.get('callId'),id);
});
test('private in-app banners hide sender, avatar initials and message text',()=>{
 const {c,node}=setup();c.notificationPreference=()=>false;let src=read('js/actions/chat-extras.js');vm.runInContext(src.slice(src.indexOf('function showDynamicIslandNotification('),src.indexOf('function onDynamicIslandClick(')),c);c.dynamicIslandHideTimer=null;
 c.showDynamicIslandNotification({room:'room',username:'Private sender',text:'Private content'});assert.equal(node('island-sender-name').innerText,'Orbit Messenger');assert.equal(node('island-msg-preview').innerText,'You have a new message');assert.equal(node('island-avatar').innerText,'O');
});

test('visible clients suppress duplicate push, enforce private previews and silence messages during calls',async()=>{
 const {c,handlers,shown}=worker();let active=false;
 c.MessageChannel=class{constructor(){this.port1={close(){}};this.port2={postMessage:data=>this.port1.onmessage({data})};}};
 c.self.clients.matchAll=async()=>[{postMessage:(query,ports)=>ports[0].postMessage({active,previews:false,silent:true})}];
 let pending;const event={data:{json:()=>({title:'Private person',body:'Secret content',roomId:'r',msgId:'one',timestamp:Date.now()})},waitUntil:p=>pending=p};
 handlers.push(event);await pending;assert.equal(shown[0].title,'Orbit Messenger');assert.equal(shown[0].body,'You have a new message');assert.equal(shown[0].silent,true);
 active=true;handlers.push(event);await pending;assert.equal(shown.length,1);
 active=false;c.self.registration.getNotifications=async()=>[{}];handlers.push(event);await pending;assert.equal(shown.length,1);
});

test('a call answered on another device stops local ringing without ending the remote call',async()=>{
 const {c,toasts}=setup();vm.runInContext(read('js/orbit-chat-services.js'),c);c._activeCallRole='callee';let notifyPeer;
 c.endVoiceCall=async notify=>{notifyPeer=notify;c._activeCallId=null;};
 await c.receiveOrbitCall({id,caller_id:'peer',callee_id:'owner',state:'connecting',created_at:new Date().toISOString()});
 assert.equal(notifyPeer,false);assert.equal(c._activeCallId,null);assert.match(toasts[0],/another device/);
});

test('incoming call rings and notifies without waiting for the ICE network subscription',async()=>{
 const {c}=setup();vm.runInContext(read('js/orbit-chat-services.js'),c);c._activeCallId=null;c._activeCallRole=null;c.isUserBlocked=()=>false;const actions=[];
 c.orbitWatchIce=()=>new Promise(()=>{});c._showVoiceCallModal=()=>actions.push('paint');c._setVoiceCallStatus=()=>{};c.orbitCallRing=()=>actions.push('ring');c.orbitNotifyIncomingCall=()=>actions.push('notify');
 await c.receiveOrbitCall({id,caller_id:'peer',callee_id:'owner',room:'room',state:'ringing',created_at:new Date().toISOString(),offer:{}});assert.deepEqual(actions,['paint','ring','notify']);
});
test('call-stop push is silent and replaces ringing; note pushes open the note',async()=>{
 const {handlers,shown,opened}=worker();let pending;
 handlers.push({data:{json:()=>({isCall:true,ended:true,callId:id,timestamp:Date.now(),title:'Alex',body:'Missed voice call'})},waitUntil:p=>pending=p});await pending;
 assert.equal(shown[0].silent,true);assert.equal(shown[0].requireInteraction,false);assert.equal(shown[0].tag,'orbit-call-'+id);assert.equal(shown[0].body,'Missed voice call');
 handlers.push({data:{json:()=>({noteId:'19',title:'Note reminder',body:'Plan trip',timestamp:Date.now()})},waitUntil:p=>pending=p});await pending;assert.equal(shown[1].actions[0].title,'Open note');
 handlers.notificationclick({notification:{close(){},data:shown[1].data},action:'open',waitUntil:p=>pending=p});await pending;assert.equal(new URL(opened[0]).searchParams.get('noteId'),'19');
});

test('a stale ringing snapshot cannot resurrect a call after a terminal update',async()=>{
 const {c}=setup();vm.runInContext(read('js/orbit-chat-services.js'),c);c._activeCallId=null;c._activeCallRole=null;c.isUserBlocked=()=>false;let rings=0;c._showVoiceCallModal=()=>rings++;c._setVoiceCallStatus=()=>{};c.orbitCallRing=()=>{};c.orbitNotifyIncomingCall=()=>{};c.orbitWatchIce=async()=>{};
 const row={id,caller_id:'peer',callee_id:'owner',room:'room',created_at:new Date().toISOString()};await c.receiveOrbitCall({...row,state:'ended'});await c.receiveOrbitCall({...row,state:'ringing'});assert.equal(rings,0);assert.equal(c._activeCallId,null);
});
test('call inbox subscribes before a hanging block-list synchronization',async()=>{
 const {c}=setup();vm.runInContext(read('js/orbit-chat-services.js'),c);c._activeCallId=null;c._activeCallRole=null;c.blockedUsersSet=new Set();c.orbitRetryCallEnds=()=>{};c.recoverOrbitIncomingCall=async()=>{};let subscribed=false;
 c.ensureSupabase=async()=>({channel:()=>({on(){return this;},subscribe(){subscribed=true;return this;}}),from:()=>({select(){return this;},eq:()=>new Promise(()=>{})})});
 c.initOrbitChatServices();for(let n=0;n<5;n++)await Promise.resolve();assert.equal(subscribed,true);
});
test('closed-tab push honors stored device privacy and call sound preferences',async()=>{
 const {c,handlers,shown}=worker();let stored,pending;c.caches.open=async()=>({put:async(_key,response)=>{stored=await response.json();},match:async()=>stored?Response.json(stored):null});
 handlers.message({data:{type:'ORBIT_ALERT_PREFERENCES',preferences:{previews:false,callSilent:true}},waitUntil:p=>pending=p});await pending;
 handlers.push({data:{json:()=>({isCall:true,callId:id,title:'Private caller',timestamp:Date.now()})},waitUntil:p=>pending=p});await pending;assert.equal(shown[0].silent,true);assert.equal(shown[0].title,'Orbit Messenger');
});

test('already-granted notification permission repairs a missing subscription once',async()=>{
 const {c}=setup();vm.runInContext(read('js/messaging-notifications.js'),c);let subscriptions=0,saves=0;
 c.window.Notification={};c.Notification={permission:'granted'};c.window.PushManager={};c.atob=s=>Buffer.from(s,'base64').toString('binary');c.notificationPreference=()=>true;c.updateNotificationSettingsUI=()=>{};
 const registration={pushManager:{getSubscription:async()=>null,subscribe:async()=>{subscriptions++;return {toJSON:()=>({endpoint:'https://fcm.googleapis.com/test'})};}}};c.navigator.serviceWorker={ready:Promise.resolve(registration)};c.ensureSupabase=async()=>({rpc:async()=>({data:{publicKey:'AQID'}})});c.orbitPushApi=async()=>{saves++;};
 const one=c.enableOrbitBackgroundPush(),two=c.enableOrbitBackgroundPush();assert.equal(one,two);assert.equal(await one,true);assert.equal(subscriptions,1);assert.equal(saves,1);
});
