const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function setup(rpc) {
 const storage=new Map(),toasts=[],deleted=[],rows=new Map(),elements=new Map();
 for(const id of ['message-selection-bar','message-selection-count','message-delete-everyone','message-delete-me','screen-chat','chat-bubble-style'])elements.set(id,{dataset:{},value:'',textContent:'',hidden:true});
 const message={id:'one',room:'room',sender_id:'me',text:'hello',type:'text',attachments:[{url:'private.jpg'}],created_at:new Date().toISOString()};
 const c=vm.createContext({console,Date,Set,Map,JSON,Number,String,Array,Promise,Error,setInterval(){},
  currentUser:{id:'me'},currentRoom:'room',messageCache:new Map([['room',[message]],['alias',[{...message}]]]),
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{hidden:false,addEventListener(){},getElementById:id=>elements.get(id)||rows.get(id),querySelectorAll:()=>[]},
  confirm:()=>true,showToast:(...v)=>toasts.push(v),ensureSupabase:async()=>({rpc}),handleMessageDeleted:id=>deleted.push(id),closeChatOptionsMenu(){}});
 vm.runInContext(fs.readFileSync(path.join(root,'js/chat/message-controls.js'),'utf8'),c);
 return {c,storage,toasts,deleted,message,elements,run:s=>vm.runInContext(s,c)};
}
test('delete for everyone waits for server confirmation; a rejected request never hides the message',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const a=setup(()=>pending);
 const request=a.run("orbitDeleteMessagesForEveryone(['one'])");await Promise.resolve();await Promise.resolve();
 assert.equal(a.deleted.length,0);assert.equal(a.toasts.length,0);
 finish({error:{code:'42501',message:'Not allowed'}});await request;
 assert.equal(a.deleted.length,0);assert.equal(a.run("messageCache.get('room')[0].text"),'hello');
 assert.match(a.toasts[0][0],/not confirmed/);
});
test('confirmed deletion scrubs every alias and survives stale history and account changes',async()=>{
 const a=setup(async()=>({data:[{id:'one',room:'room',deleted_at:new Date().toISOString(),text:'🚫 This message was deleted',attachments:[],type:'text'}]}));
 assert.equal((await a.run("orbitDeleteMessagesForEveryone(['one'])")).length,1);
 assert.equal(a.run("messageCache.get('alias')[0].attachments.length"),0);
 assert.equal(a.run("orbitNormalizeMessage({id:'one',text:'stale',attachments:['secret']}).text"),'🚫 This message was deleted');
 a.run("orbitDeletionLedger.clear(); orbitRestoreDeletionLedger()");
 assert.equal(a.run("orbitNormalizeMessage({id:'one',text:'old'}).is_deleted"),true);
 a.run("currentUser={id:'other'}");assert.equal(a.run("orbitNormalizeMessage({id:'one',text:'other account'}).text"),'other account');
});
test('bulk deletion rejects another sender and pending uploads; partial confirmation never reports success',async()=>{
 let calls=0;const a=setup(async()=>{calls++;return {data:[]};});
 a.run("messageCache.get('room')[0].sender_id='other'");await a.run("orbitDeleteMessagesForEveryone(['one'])");assert.equal(calls,0);
 a.run("messageCache.get('room')[0].sender_id='me';messageCache.get('room')[0].status='sending'");await a.run("orbitDeleteMessagesForEveryone(['one'])");assert.equal(calls,0);
 a.run("delete messageCache.get('room')[0].status");await a.run("orbitDeleteMessagesForEveryone(['one'])");assert.equal(calls,1);
 assert.ok(a.toasts.every(t=>t[1]!=='success'));
});
test('delete for me persists on the device without deleting messages for other accounts',()=>{
 const a=setup(()=>{throw Error('must not reach server');});
 assert.equal(a.run("orbitDeleteMessagesForMe(['one'])"),true);
 assert.equal(a.run("orbitIsMessageHidden('one')"),true);assert.equal(a.run("messageCache.get('alias').length"),0);
 a.run("currentUser={id:'other'}");assert.equal(a.run("orbitIsMessageHidden('one')"),false);
});
test('location coordinates disappear at exactly five minutes, including legacy shares',()=>{
 const a=setup();const now=Date.now();a.c.now=now;
 assert.equal(a.run("orbitLocationExpired({type:'location',created_at:new Date(now-299999).toISOString()},now)"),false);
 assert.equal(a.run("orbitLocationExpired({type:'location',created_at:new Date(now-300000).toISOString()},now)"),true);
 assert.equal(a.run("orbitLocationExpired({type:'text',created_at:new Date(now-999999).toISOString()},now)"),false);
 assert.equal(a.run("orbitNormalizeMessage({id:'gps',type:'location',text:'geo:12,13',attachments:['map'],reply_to:{text:'coordinates'},created_at:new Date(now-300001).toISOString()}).attachments.length"),0);
});
test('selection stays scoped to the opened conversation; bubble appearance validates and restores safely',()=>{
 const a=setup();a.run("orbitStartMessageSelection('one')");assert.equal(a.elements.get('message-selection-bar').hidden,false);
 assert.equal(a.elements.get('message-delete-everyone').disabled,false);
 a.run("currentRoom='another';orbitOpenMessageControls()");assert.equal(a.elements.get('message-selection-bar').hidden,true);
 a.run("orbitSetBubbleStyle('green')");assert.equal(a.elements.get('screen-chat').dataset.bubbleStyle,'green');
 a.run("orbitApplyBubbleStyle('invalid')");assert.equal(a.elements.get('screen-chat').dataset.bubbleStyle,'balanced');
 a.run("orbitOpenMessageControls()");assert.equal(a.elements.get('screen-chat').dataset.bubbleStyle,'green');
});
test('selection intercepts media actions, supports keyboard input and limits a batch to 100',()=>{
 const a=setup(),handlers={};let prevented=0;
 const row={dataset:{},classList:{add(){},toggle(){}},setAttribute(){},addEventListener:(type,fn)=>handlers[type]=fn};
 a.c.row=row;a.run("orbitStartMessageSelection();orbitBindMessageSelection(row,{id:'one'})");
 const event={preventDefault(){prevented++;},stopImmediatePropagation(){prevented++;}};
 handlers.click(event);assert.equal(a.run('orbitMessageSelection.size'),1);assert.equal(prevented,2);
 handlers.keydown({...event,key:'Enter'});assert.equal(a.run('orbitMessageSelection.size'),0);
 a.run("for(let i=0;i<100;i++)orbitMessageSelection.add('id'+i)");handlers.click(event);
 assert.equal(a.run('orbitMessageSelection.size'),100);assert.match(a.toasts.at(-1)[0],/up to 100/);
});
test('partial confirmations remove only confirmed selections and preserve the rest for retry',async()=>{
 const a=setup(async()=>({data:[{id:'one',room:'room',deleted_at:new Date().toISOString(),text:'🚫 This message was deleted',attachments:[]}]}));
 a.run("messageCache.get('room').push({id:'two',room:'room',sender_id:'me',text:'keep'});orbitStartMessageSelection('one');orbitMessageSelection.add('two')");
 await a.run('orbitDeleteSelected(true)');assert.equal(a.run("orbitMessageSelection.has('one')"),false);
 assert.equal(a.run("orbitMessageSelection.has('two')"),true);assert.equal(a.run("orbitNormalizeMessage({id:'two',text:'keep'}).text"),'keep');
 assert.ok(a.toasts.every(t=>t[1]!=='success'));
});
test('a late deletion response never clears selection in a different conversation',async()=>{
 let finish,started;const ready=new Promise(resolve=>started=resolve);const a=setup(()=>new Promise(resolve=>{finish=resolve;started();}));
 a.run("orbitStartMessageSelection('one')");const pending=a.run('orbitDeleteSelected(true)');await ready;
 a.run("currentRoom='another';orbitStartMessageSelection('new-selection')");
 finish({data:[{id:'one',room:'room',deleted_at:new Date().toISOString()}]});await pending;
 assert.equal(a.run("orbitMessageSelection.has('new-selection')"),true);
});
test('recipient realtime deletion persists across aliases and rejects a later stale update',()=>{
 const a=setup();a.c.window=a.c;a.c.resolveRoomAliases=()=>['room','alias'];
 a.c.document.querySelector=()=>null;a.c.renderMessageFeed=()=>{};
 vm.runInContext(fs.readFileSync(path.join(root,'js/chat/chat-realtime.js'),'utf8'),a.c);
 a.c.update={...a.message,deleted_at:new Date().toISOString(),text:'🚫 This message was deleted',attachments:[]};
 a.run("handleRealtimeUpdate({new:update},'room',['room','alias'])");
 a.c.update={...a.message,text:'Late stale message',attachments:['old.jpg']};
 a.run("handleRealtimeUpdate({new:update},'room',['room','alias'])");
 assert.equal(a.run("messageCache.get('alias')[0].text"),'🚫 This message was deleted');
 assert.equal(a.run("messageCache.get('room')[0].attachments.length"),0);
 assert.equal(JSON.parse(a.storage.get('orbit_cache_msgs_room'))[0].attachments.length,0);
});
