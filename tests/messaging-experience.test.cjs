const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function context(){
 const nodes=new Map(),events={},store=new Map(),timers=[],toasts=[];
 const element=()=>({dataset:{},style:{},classList:{add(){},remove(){},contains(){return false;},toggle(){}},textContent:'',value:'',children:[],
  setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},before(){},after(){},remove(){},closest(){return null;},querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){},focus(){}});
 const document={hidden:false,body:{append(node){nodes.set(node.id,node);}},getElementById:id=>nodes.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[],createElement:element,addEventListener(){}};
 const c=vm.createContext({document,window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{onLine:true},location:{origin:'https://orbit.example',href:'https://orbit.example/'},AbortController,
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},console,crypto,Blob,File,URL,
  Date,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},setInterval:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearInterval(){},
  currentUser:{id:'me',email:'member@example.com'},currentRoom:'room',globalUsersMap:new Map(),userAlarms:[],messageCache:new Map(),
  showToast:msg=>toasts.push(msg),formatSmartActivity:(date,online)=>`${date}:${online}`,formatMediaUrl:x=>x,renderAlarmsList(){},handleChatInputText(){}});
 vm.runInContext(read('js/messaging-experience.js'),c);
 return {c,nodes,events,store,timers,toasts,element};
}
test('editing accepts only owned text before the exact 10-minute boundary',()=>{
 const {c}=context(),now=Date.now(),msg={sender_id:'me',text:'hello',type:'text',created_at:new Date(now-599999).toISOString()};
 assert.equal(c.orbitCanEditMessage(msg,now),true);
 for(const bad of [{sender_id:'other'},{created_at:new Date(now-600000).toISOString()},{created_at:new Date(now+1).toISOString()},{type:'call'},{attachments:[{}]},{status:'queued'},{is_deleted:true}])assert.equal(c.orbitCanEditMessage({...msg,...bad},now),false,JSON.stringify(bad));
});
test('network events update immediately and keep offline state visible',()=>{
 const {c,nodes,events,timers}=context(),badge=nodes.get('orbit-connectivity');assert.equal(badge.textContent,'Online');
 c.navigator.onLine=false;events.offline();assert.match(badge.textContent,/Offline/);assert.equal(badge.className,'is-offline');
 c.navigator.onLine=true;events.online();assert.equal(badge.textContent,'Online');assert.ok(timers.some(timer=>timer.delay===3500));
});
test('reachability probe bypasses cached pages and detects a network without internet access',async()=>{
 const {c,nodes}=context();let options;
 c.fetch=async(url,init)=>{options=init;return {ok:true};};await c.orbitProbeConnectivity();assert.equal(nodes.get('orbit-connectivity').textContent,'Online');assert.equal(options.method,'HEAD');assert.equal(options.cache,'no-store');
 c.fetch=async()=>{throw Error('Disconnected');};await c.orbitProbeConnectivity();assert.match(nodes.get('orbit-connectivity').textContent,/Retrying/);
});
test('presence uses peer presence and respects reciprocal privacy',()=>{
 const {c,store}=context();c.globalUsersMap.set('peer',{last_seen:'presence-time',is_online:false});
 assert.equal(c.orbitChatPresence('peer'),'presence-time:false');assert.equal(c.orbitChatPresence('unknown'),'');
 store.set('orbit_privacy_last_seen','nobody');assert.equal(c.orbitChatPresence('peer'),'');
 assert.equal(c.orbitFormatMessageTime('bad-date'),'');assert.doesNotMatch(c.orbitFormatMessageTime(new Date().toISOString()),/Last seen/);
});
test('forwarding makes an owned copy, parses legacy JSON and rejects inaccessible or pending media',async()=>{
 const {c}=context();c.fetch=async()=>({ok:true,blob:async()=>new Blob(['photo'],{type:'image/jpeg'})});
 let uploads=0;c.uploadMediaToStorage=async()=>{uploads++;return 'https://orbit.example/owned.jpg';};
 const copies=await c.orbitCopyForwardAttachments([JSON.stringify({url:'https://source/photo.jpg',type:'image',name:'photo.jpg'})]);
 assert.equal(uploads,1);assert.equal(copies[0].url,'https://orbit.example/owned.jpg');
 await assert.rejects(c.orbitCopyForwardAttachments([{url:'blob:pending',upload_pending:true}]),/finished uploading/);
 c.fetch=async()=>({ok:false});await assert.rejects(c.orbitCopyForwardAttachments([{url:'https://source/gone.jpg'}]),/unavailable/);
});
test('original-quality controls support one photo and whole batch without changing videos',()=>{
 const {c}=context();vm.runInContext("let mediaPreviewList=[{type:'image'},{type:'image'},{type:'video'}];let currentPreviewIndex=0;",c);
 c.orbitSetOriginalQuality(false);assert.equal(vm.runInContext('mediaPreviewList[0].originalQuality',c),true);
 c.orbitSetOriginalQuality(true);assert.equal(vm.runInContext('mediaPreviewList[1].originalQuality',c),true);assert.equal(vm.runInContext('mediaPreviewList[2].originalQuality',c),undefined);
 c.orbitSetOriginalQuality(true);assert.equal(vm.runInContext('mediaPreviewList[0].originalQuality',c),false);
});
test('alarm URLs allow YouTube destinations only; snooze persists a one-shot due time',()=>{
 const {c,nodes,store}=context();assert.equal(c.orbitMusicUrl('javascript:alert(1)'),'');assert.equal(c.orbitMusicUrl('https://music.youtube.com.evil.example/a'),'');
 assert.match(c.orbitMusicUrl('https://music.youtube.com/watch?v=test'),/^https:/);
 vm.runInContext("orbitActiveAlarm={label:'Wake up',tone:'gentle'}",c);const before=Date.now();c.orbitSnoozeAlarm();
 const alarm=JSON.parse(store.get('orbit_alarms'))[0];assert.ok(alarm.snoozeAt>=before+300000);assert.equal(alarm.tone,'gentle');
});
test('midnight alarm fires once per day and due snooze fires even in the same minute',()=>{
 const {c}=context();vm.runInContext(read('js/tools.js'),c);
 class Midnight extends Date{constructor(...args){super(...(args.length?args:[2026,9,16,0,0,0]));}}c.Date=Midnight;
 vm.runInContext("userAlarms=[{id:'one',enabled:true,time:'00:00'},{id:'two',enabled:true,snoozeAt:0}];",c);
 const calls=[];c.orbitRingAlarm=alarm=>calls.push(alarm.id);c.checkTriggerAlarms();c.checkTriggerAlarms();assert.deepEqual(calls,['one','two']);
});
test('original bytes skip compression while standard photos are compressed',async()=>{
 for(const original of [true,false]){
  const {c}=context();Object.assign(c,{activeChatPeerId:null,isGroupChat:false,userProfile:{},isPreviewHdQuality:false,replyTargetMessage:null,
   updateBubbleSendingProgress(){},updateChatMediaUploadProgress(){},hideChatMediaUploadProgress(){},getOrbitStorageObjectPath:()=> 'images/me/photo.jpg'});
  c.window.addEventListener=()=>{};vm.runInContext(read('js/chat/chat-dispatcher.js'),c);
  const file=new Blob(['original pixels'],{type:'image/jpeg'});let compressed=0,uploaded;
  c._getOutboxMedia=async()=>file;c._storeOutboxMedia=async()=>true;c._persistMessageOutbox=()=>{};c._updateOutboxMessage=()=>{};
  c.compressImageForUpload=async()=>{compressed++;return null;};c.uploadMediaToStorage=async body=>{uploaded=body;return 'https://storage/photo.jpg';};
  await c._uploadQueuedMedia({payload:{id:'msg',sender_id:'me',attachments:[{url:'https://preview',upload_pending:true}]},mediaUploadInfo:[{index:0,type:'image',name:'photo.jpg',mime:'image/jpeg',originalQuality:original}]});
  assert.equal(compressed,original?0:1);assert.equal(uploaded,file);
 }
});
test('quota rejection preserves the preview and never creates an optimistic message',async()=>{
 const {c}=context();Object.assign(c,{activeChatPeerId:null,isGroupChat:false,ensureSupabase:async()=>({rpc:async()=>({error:{message:'Daily limit reached'}})})});
 vm.runInContext(read('js/chat/chat-dispatcher.js'),c);
 await assert.rejects(c.queueMediaMessage([{file:new Blob(['pixels']),type:'image',originalQuality:true}]),/Daily limit/);
 assert.equal(vm.runInContext('_messageOutbox.size',c),0);
});
test('calls never render delivery ticks; sent text still does',()=>{
 const {c}=context();vm.runInContext(read('js/chat/chat-feed.js'),c);
 assert.equal(c.getTickIconHtml({type:'call',status:'sent'}),'');assert.notEqual(c.getTickIconHtml({type:'text',status:'sent'}),'');
});

test('forwarded text and media insert without a nonexistent forwarded column and render no false reply quote',async()=>{
 const {c,element}=context();vm.runInContext(read('js/chat/chat-dispatcher.js'),c);let inserted;
 c.ensureSupabase=async()=>({from:()=>({insert:payload=>{inserted=payload[0];return {abortSignal:async()=>({error:null})};}})});
 const msg={id:'forward',room:'r',sender_id:'me',text:'Caption',type:'image',is_forwarded:true,attachments:[{url:'https://example.com/photo.jpg',type:'image'}]};
 const result=await c.executeResilientMessageInsert(msg);assert.equal(result.error,null);assert.equal('is_forwarded' in inserted,false);assert.equal(inserted.reply_to.forwarded,true);assert.equal(inserted.attachments.length,1);
 Object.assign(c,{escapeHtml:x=>String(x||''),orbitIsViewOnceMessage:()=>false,formatOrbitMessageText:x=>x});
 vm.runInContext(read('js/chat/chat-feed.js'),c);const card=c.createMessageDOMNode({...inserted,created_at:new Date().toISOString()});
 assert.match(card.innerHTML,/Forwarded/);assert.doesNotMatch(card.innerHTML,/quoted-reply-box/);assert.match(card.innerHTML,/Caption/);
});
test('photo albums keep every URL while displaying four tiles and an accurate remainder',()=>{
 const {c}=context();Object.assign(c,{escapeHtml:x=>String(x||''),orbitIsViewOnceMessage:()=>false,formatOrbitCallDetail:x=>x,formatOrbitMessageText:x=>x});
 vm.runInContext(read('js/chat/chat-feed.js'),c);
 const msg={id:'album',sender_id:'me',type:'image',created_at:new Date().toISOString(),attachments:Array.from({length:7},(_,i)=>({url:`https://example.com/photo${i}.jpg`,type:'image'}))};
 const node=c.createMessageDOMNode(msg);assert.match(node.innerHTML,/bunch-4/);assert.match(node.innerHTML,/\+3/);
 assert.equal(c.window._orbitBatches.bunch_album.length,7);
 c.createMessageDOMNode(msg);assert.equal(Object.keys(c.window._orbitBatches).length,1);
 const call=c.createMessageDOMNode({...msg,id:'call',attachments:[],type:'call',text:'Voice call · 17 sec'});
 assert.match(call.innerHTML,/Voice call/);assert.doesNotMatch(call.innerHTML,/msg-status-tick/);
});
test('forwarded polls start fresh; contact cards and location links retain their content',async()=>{
 const {c}=context();c.fetch=()=>{throw Error('Cards must not fetch a media file');};
 const polls=await c.orbitCopyForwardAttachments([{type:'poll',poll:{question:'Where?',options:[{text:'Beach',votes:4,voters:['other']}],multiple_answers:true}}],'poll');
 assert.equal(polls[0].poll.options[0].votes,0);assert.equal(polls[0].poll.options[0].voters.length,0);
 const contacts=await c.orbitCopyForwardAttachments([{name:'Alex',phone:'123',username:'alex'}],'contact');assert.equal(contacts[0].phone,'123');
 const places=await c.orbitCopyForwardAttachments(['https://maps.google.com/?q=1,2'],'location');assert.equal(places[0],'https://maps.google.com/?q=1,2');
});
test('reopening a lightbox does not multiply its gesture listeners',()=>{
 const {c,element}=context();let listeners=0;const modal=element(),img=element();modal.addEventListener=()=>listeners++;
 vm.runInContext(read('js/chat-gestures.js'),c);c.window.initLightboxGestures(modal,img);c.window.initLightboxGestures(modal,img);assert.equal(listeners,3);
});
