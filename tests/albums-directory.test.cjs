const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function setup(){
 const nodes=new Map(),events={},queued=[],toasts=[];
 function element(){const classes=new Set();return {children:[],dataset:{},style:{setProperty(){},removeProperty(){}},value:'',textContent:'',innerHTML:'',scrollTop:0,
  classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);}},
  attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items.flatMap(x=>x.fragment?x.children:[x]);},
  querySelectorAll:()=>[],querySelector:()=>null,remove(){},addEventListener(){},click(){this.clicked=true;}};}
 const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const c=vm.createContext({document:{readyState:'loading',getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,createElement:element,createDocumentFragment:()=>Object.assign(element(),{fragment:true}),addEventListener:(name,fn)=>events['document:'+name]=fn},
  window:{location:{search:'',pathname:'/'},addEventListener:(name,fn)=>events[name]=fn},console,Date,File,Blob,URLSearchParams,AbortController,
  URL:{createObjectURL:()=>`blob:${Math.random()}`,revokeObjectURL(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
  localStorage:{getItem:()=>null,setItem(){}},currentRoom:'room',currentUser:{id:'me'},userProfile:{},myFriendsSet:new Set(),myOutgoingRequestsSet:new Set(),ADMIN_EMAIL:'rivaldo.a.rodrigues@gmail.com',
  escapeHtml:s=>String(s).replaceAll('<','&lt;'),formatMediaUrl:s=>s,formatSmartActivity:()=> 'Last seen yesterday',getVerifiedBadgeHtml:()=>'<b>Verified</b>',
  showToast:message=>toasts.push(message),queueMediaMessage:async(...args)=>queued.push(args),formatFileSize:()=> '4 B'});
 for(const file of ['js/actions/media-preview.js','js/actions/file-viewer.js'])vm.runInContext(read(file),c);
 return {c,node,queued,toasts,events};
}
const photo=n=>new File(['photo bytes'],`${n}.png`,{type:'image/png'});
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
