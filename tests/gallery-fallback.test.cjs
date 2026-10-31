const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function setup(){
 const ids=new Map(),opened=[],previews=[],toasts=[];
 const element=tag=>({tag,children:[],value:'',classList:{contains:()=>false},setAttribute(){},focus(){},append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes},remove(){this.removed=true},click(){this.clicked=true}});
 const body=element('body'),input=element('input');ids.set('inp-orbit-share-photos',input);
 const c=vm.createContext({File,Blob,URL,URLSearchParams,crypto,console,setTimeout,clearTimeout,location:{href:'https://orbit.example/'},history:{replaceState(){}},
  document:{body,createElement:element,getElementById:id=>ids.get(id)||null,addEventListener(){}},window:{},currentUser:{id:'owner'},currentRoom:null,
  allRoomsMap:new Map([['room',{id:'room',is_direct:true,participants:['owner','peer']}]]),globalUsersMap:new Map([['peer',{display_name:'Recipient'}]]),myFriendsSet:new Set(),
  showToast:message=>toasts.push(message),resolveCanonicalRoomId:async()=> 'room',prepareMediaPreviewItems:async items=>items,releaseMediaPreviewItem(){},openMediaPreviewScreen:items=>previews.push(items)});
 c.openChatRoom=async room=>{opened.push(room);c.currentRoom=room};
 vm.runInContext(fs.readFileSync(path.join(root,'js/media-source.js'),'utf8'),c);
 vm.runInContext(fs.readFileSync(path.join(root,'js/chat-data.js'),'utf8'),c);
 const buttons=()=>{const nodes=[];function visit(node){if(node.removed)return;if(node.tag==='button')nodes.push(node);for(const child of node.children||[])visit(child)}visit(body);return nodes};
 return {c,input,opened,previews,toasts,buttons};
}
test('Gallery fallback captures files, asks for destination and opens preview without sending',async()=>{
 const {c,input,buttons,previews,opened}=setup();c.window.OrbitChatData.openPhotoPicker();assert.equal(input.clicked,true);
 input.files=[new File(['one'],'one.jpg',{type:'image/jpeg'}),new File(['two'],'two.jpg',{type:'image/jpeg'})];input.value='selected';
 await c.window.OrbitChatData.photosPicked(input);assert.equal(input.value,'');assert.equal(previews.length,0);assert.equal(opened.length,0);
 await buttons().find(button=>button.textContent==='Recipient').onclick();assert.deepEqual(opened,['room']);assert.equal(previews.length,1);assert.equal(previews[0].length,2);assert.equal(await previews[0][1].file.text(),'two');
});
test('closing a Gallery selection during file copying cannot reopen a recipient picker',async()=>{
 const {c,input,buttons,previews}=setup();let release;const file=new File(['one'],'one.jpg');file.arrayBuffer=()=>new Promise(resolve=>release=resolve);input.files=[file];
 const pending=c.window.OrbitChatData.photosPicked(input);c.window.OrbitChatData.close();release(new TextEncoder().encode('one').buffer);await pending;
 assert.equal(buttons().length,0);assert.equal(previews.length,0);assert.equal(input.disabled,false);
});
test('switching account during Gallery capture never hands files to the new account',async()=>{
 const {c,input,buttons,previews,toasts}=setup();const file=new File(['one'],'one.jpg'),read=file.arrayBuffer.bind(file);file.arrayBuffer=async()=>{c.currentUser={id:'other'};return read()};input.files=[file];
 await c.window.OrbitChatData.photosPicked(input);assert.ok(!buttons().some(button=>button.textContent==='Recipient'));assert.equal(previews.length,0);assert.match(toasts.at(-1),/account or chat changed/);
});
