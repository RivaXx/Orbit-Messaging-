const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function setup(){
 const nodes=new Map(),events={},queued=[],toasts=[];
 function element(){const classes=new Set();return {children:[],dataset:{},style:{setProperty(){},removeProperty(){}},value:'',textContent:'',innerHTML:'',scrollTop:0,
  classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);}},
  attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items.flatMap(x=>x.fragment?x.children:[x]);},
  querySelectorAll:()=>[],querySelector:()=>null,remove(){},addEventListener(){},focus(){},click(){this.clicked=true;}};}
 const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const c=vm.createContext({document:{readyState:'loading',getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,createElement:element,createDocumentFragment:()=>Object.assign(element(),{fragment:true}),addEventListener:(name,fn)=>events['document:'+name]=fn},
  window:{location:{search:'',pathname:'/'},addEventListener:(name,fn)=>events[name]=fn},console,Date,File,Blob,crypto,URLSearchParams,AbortController,
  URL:{createObjectURL:()=>`blob:${Math.random()}`,revokeObjectURL(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
  localStorage:{getItem:()=>null,setItem(){}},currentRoom:'room',currentUser:{id:'me'},userProfile:{},myFriendsSet:new Set(),myOutgoingRequestsSet:new Set(),ADMIN_EMAIL:'rivaldo.a.rodrigues@gmail.com',
  escapeHtml:s=>String(s).replaceAll('<','&lt;'),formatMediaUrl:s=>s,formatSmartActivity:()=> 'Last seen yesterday',getVerifiedBadgeHtml:()=>'<b>Verified</b>',
  showToast:message=>toasts.push(message),queueMediaMessage:async(...args)=>queued.push(args),formatFileSize:()=> '4 B'});
 // Match the actual page: the editor used to override these handlers and split
 // albums after the isolated preview tests had already passed.
 for(const file of ['js/actions/media-lightbox.js','js/actions/media-preview.js','js/actions/file-viewer.js','js/orbit-media-editor.js'])vm.runInContext(read(file),c);
 return {c,node,queued,toasts,events};
}
const photo=n=>new File(['photo bytes'],`${n}.png`,{type:'image/png'});

test('album gallery swipes navigate the complete batch and do not navigate during zoom or thumbnail scrolling',()=>{
 const {c,node,events}=setup();c.openBatchMediaLightbox(['https://example.com/1.jpg','https://example.com/2.jpg','https://example.com/3.jpg','https://example.com/4.jpg'],1);
 const start=(x,interactive=false)=>events['document:touchstart']({target:{closest:()=>interactive?{}:null},touches:[{clientX:x,clientY:200}]});
 const end=x=>events['document:touchend']({changedTouches:[{clientX:x,clientY:205}]});
 start(200);end(80);assert.equal(node('lightbox-counter').innerText,'3 / 4');
 start(80);end(200);assert.equal(node('lightbox-counter').innerText,'2 / 4');
 start(200,true);end(80);assert.equal(node('lightbox-counter').innerText,'2 / 4');
 vm.runInContext('lightboxZoomLevel=2',c);start(200);end(80);assert.equal(node('lightbox-counter').innerText,'2 / 4');
});

test('typed draft becomes the album caption and survives cancel or a failed queue',async()=>{
 const {c,node,queued}=setup();node('msg-input').value='Photos from our trip';
 await c.handleMediaSelection({files:[photo(1),photo(2)],value:''});
 assert.equal(node('media-preview-caption-input').value,'Photos from our trip');
 c.closeMediaPreviewScreen();assert.equal(node('msg-input').value,'Photos from our trip');
 await c.handleMediaSelection({files:[photo(3),photo(4)],value:''});
 c.queueMediaMessage=async()=>{throw Error('Storage unavailable');};await c.sendPreviewMediaBatch();
 assert.equal(node('msg-input').value,'Photos from our trip');assert.equal(vm.runInContext('mediaPreviewList.length',c),2);
 c.queueMediaMessage=async(...args)=>queued.push(args);await c.sendPreviewMediaBatch();
 assert.equal(queued[0][1],'Photos from our trip');assert.equal(queued[0][0].length,2);
});

test('forward target clicks stay open; failed destinations retry without duplicating successful sends',async()=>{
 const {c,node}=setup();vm.runInContext(read('js/chat-share.js'),c);
 c.orbitIsViewOnceMessage=()=>false;c.orbitCopyForwardAttachments=async()=>[];c.ensureSupabase=async()=>({});
 c.localStorage.getItem=key=>key.includes('recent_chats')?JSON.stringify([{roomId:'a',title:'Alex'},{roomId:'b',title:'Beth'}]):null;
 const share=c.window.OrbitShare,modal=node('modal-forward-msg');
 share.openForwardModal({id:'message',text:'Hello',type:'text'});
 share.toggleForwardTarget('a');share.closeForwardModal({target:node('some-child'),currentTarget:modal});
 assert.equal(modal.classList.contains('active'),true);
 share.toggleForwardTarget('b');const sends=[];let fail=true;
 c.window.executeResilientMessageInsert=async payload=>{sends.push(payload);return {error:payload.room==='b'&&fail?{message:'Offline'}:null};};
 await share.executeForwardMessage();assert.equal(modal.classList.contains('active'),true);
 assert.equal(sends[0].reply_to.forwarded,true);assert.equal('is_forwarded' in sends[0],false);
 fail=false;await share.executeForwardMessage();
 assert.deepEqual(sends.map(row=>row.room),['a','b','b']);assert.equal(modal.classList.contains('active'),false);
});

test('visible Select and Select all support bulk deletion across legacy room aliases',()=>{
 const {c,node}=setup(),storage=new Map();
 c.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const cards=['a','b'].map(room=>{const card=node(room);card.dataset.roomId=room;card.remove=()=>card.removed=true;return card;});
 c.document.querySelectorAll=selector=>selector.includes('main-chats-list')?cards:[];
 c.resolveRoomAliases=room=>[room,room+'-legacy'];c.confirm=()=>true;c.messageCache=new Map([['a',[]],['a-legacy',[]],['b',[]]]);c.unreadRoomsSet=new Set(['a','b']);
 vm.runInContext(read('js/chat-select.js'),c);
 c.window.beginChatSelection();c.window.selectAllChats();assert.equal(node('context-selection-count').innerText,'2 selected');
 c.window.handleContextDeleteForMe();
 assert.deepEqual(JSON.parse(storage.get('orbit_hidden_rooms_me')),['a','a-legacy','b','b-legacy']);
 assert.equal(cards.every(card=>card.removed),true);assert.equal(c.messageCache.size,0);assert.equal(c.window.isInChatSelectionMode(),false);
});

test('offline directory sorts by most recent last seen after fresh online people',()=>{
 const {c,node}=setup();vm.runInContext(read('js/ui/ui-modals.js'),c);
 c.renderGlobalUsersDOM([{user_id:'old',display_name:'A',last_seen:'2020-01-01'},
  {user_id:'recent',display_name:'Z',last_seen:new Date(Date.now()-120000).toISOString()},
  {user_id:'now',display_name:'Now',last_seen:new Date().toISOString(),is_online:true},{user_id:'unknown',display_name:'Unknown'}]);
 assert.deepEqual(node('global-list').children.map(row=>row.dataset.userId),['now','recent','old','unknown']);
});
test('Gallery stages four original files, then sends exactly one album',async()=>{
 const {c,node,queued}=setup(),files=[1,2,3,4].map(photo),input={files,value:'selected'};
 await c.handleMediaSelection(input);
 assert.equal(queued.length,0);assert.equal(input.value,'');assert.equal(node('media-preview-counter').textContent,'1 of 4 · Album');
 assert.equal(node('preview-send-button').attributes['aria-label'],'Send album of 4 items');
 await c.sendPreviewMediaBatch();assert.equal(queued.length,1);assert.equal(queued[0][0].length,4);
 queued[0][0].forEach((item,i)=>assert.equal(item.file,files[i]));assert.equal(queued[0][3].roomId,'room');
 assert.equal(node('modal-media-preview').classList.contains('active'),false);
});
test('Add photos appends to the same album and retains caption, edits and quality',async()=>{
 const {c,node,queued}=setup();await c.handleMediaSelection({files:[photo(1)],value:''});
 node('media-preview-caption-input').value='Trip';vm.runInContext('mediaPreviewList[0].originalQuality=true;mediaPreviewList[0].rotation=90;',c);
 c.addMorePreviewMedia();assert.equal(node('inp-gallery').clicked,true);
 await c.handleMediaSelection({files:[photo(2),photo(3)],value:''});
 assert.equal(node('media-preview-counter').textContent,'2 of 3 · Album');await c.sendPreviewMediaBatch();
 assert.equal(queued.length,1);assert.equal(queued[0][0].length,3);assert.equal(queued[0][1],'Trip');
 assert.equal(queued[0][0][0].originalQuality,true);assert.equal(queued[0][0][0].rotation,90);
});
test('failed queue keeps the album for retry; another chat starts a fresh selection',async()=>{
 const {c,node,toasts}=setup();await c.handleMediaSelection({files:[photo(1),photo(2)],value:''});
 c.queueMediaMessage=async()=>{throw Error('Queue unavailable');};await c.sendPreviewMediaBatch();
 assert.equal(node('modal-media-preview').classList.contains('active'),true);assert.match(toasts.at(-1),/Queue unavailable/);
 c.currentRoom='other';await c.handleMediaSelection({files:[photo(3)],value:''});
 assert.equal(vm.runInContext('mediaPreviewList.length',c),1);assert.equal(vm.runInContext('mediaPreviewTargetRoom',c),'other');
});
test('paste and drop use the album composer without losing original files',()=>{
 const {c,node,events,queued}=setup();vm.runInContext(read('js/chat-share.js'),c);events['document:DOMContentLoaded']();node('screen-chat').classList.add('active');
 const a=photo(1),b=photo(2);events.paste({clipboardData:{files:[a,b]},preventDefault(){}});
 assert.equal(vm.runInContext('mediaPreviewList.length',c),2);assert.equal(vm.runInContext('mediaPreviewList[0].file',c),a);
 events.drop({dataTransfer:{files:[photo(3)]},preventDefault(){}});
 assert.equal(vm.runInContext('mediaPreviewList.length',c),3);assert.equal(queued.length,0);
});
test('directory separates identity, presence and actions, deduplicates and prioritizes fresh online people',()=>{
 const {c,node}=setup();vm.runInContext(read('js/ui/ui-modals.js'),c);
 const now=new Date().toISOString(),stale=new Date(Date.now()-120000).toISOString();
 c.renderGlobalUsersDOM([{user_id:'a',display_name:'A stale',is_online:true,last_seen:stale},{user_id:'b',display_name:'<img onerror=evil>',email:'b@example.com',is_online:true,last_seen:now},{user_id:'b'},
  {user_id:'admin',display_name:'Admin',email:c.ADMIN_EMAIL,last_seen:stale},{user_id:'other',display_name:'Other',email:'rivacolony@gmail.com'}]);
 const rows=node('global-list').children;assert.equal(rows.length,4);assert.equal(rows[0].dataset.userId,'b');assert.equal(node('global-online-count').textContent,'1 online');
 const [avatar,identity,action]=rows[0].children;assert.equal(avatar.classList.contains('is-online'),true);
 assert.equal(identity.children[0].children[0].textContent,'<img onerror=evil>');assert.equal(identity.children[0].children[0].innerHTML,'');
 assert.equal(identity.children[1].textContent,'@b');assert.equal(identity.children[2].textContent,'Online');assert.equal(action.textContent,'Add friend');
 assert.equal(rows.find(x=>x.dataset.userId==='admin').children[1].children[0].children.length,2);
 assert.equal(rows.find(x=>x.dataset.userId==='other').children[1].children[0].children.length,1);
});
