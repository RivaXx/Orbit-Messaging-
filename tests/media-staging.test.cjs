const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
test('staging serializes files across batches and resumes after a failed batch',async()=>{
 const source=fs.readFileSync(path.join(root,'js/chat/chat-dispatcher.js'),'utf8');
 const body=source.slice(source.indexOf('function _stageOutboxMedia('),source.indexOf('function _flushChatCacheWrites('));
 let active=0,max=0;const calls=[];
 const context=vm.createContext({currentUser:{id:'u'},_setMediaQueuePhase(){},_storeOutboxMedia:async(id,index)=>{active++;max=Math.max(max,active);calls.push(id+index);await new Promise(r=>setTimeout(r,2));active--;if(id==='bad')throw Error('failed');}});
 vm.runInContext('let _mediaStagingLane=Promise.resolve();\n'+body+'\nglobalThis.stage=_stageOutboxMedia;',context);
 const item=id=>({payload:{id,sender_id:'u'},mediaUploadInfo:[{index:0},{index:1}]});
 const files=[{file:{}},{file:{}}];
 const first=context.stage(item('bad'),files).catch(()=>{}), second=context.stage(item('ok'),files);
 await Promise.all([first,second]);assert.equal(max,1);assert.deepEqual(calls,['bad0','ok0','ok1']);
});
test('share target manifest includes standard PNG icon sizes',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 for(const size of [192,512]) {const icon=m.icons.find(i=>i.sizes===`${size}x${size}`&&i.type==='image/png');assert.ok(icon);const data=fs.readFileSync(path.join(root,icon.src));assert.equal(data.readUInt32BE(16),size);assert.equal(data.readUInt32BE(20),size);}
});

function uploadContext({diskFailure=false}={}){
 const disk=new Map(),uploads=[],original=new Blob(['exact original photo'],{type:'image/jpeg'});
 let encryptions=0,prepareWrites=0;
 const c=vm.createContext({currentUser:{id:'u'},window:{addEventListener(){}},document:{getElementById:()=>null,querySelector:()=>null},navigator:{onLine:true},Blob,File,URL,console:{warn(){}},setTimeout,clearTimeout,
  OrbitCrypto:{selfSeal:async(id,room,value)=>({signed:value}),selfOpen:async record=>record.signed,encryptAttachment:async body=>{assert.equal(await body.text(),'exact original photo');encryptions++;return {body:new Blob(['ciphertext '+encryptions]),digest:String(encryptions).repeat(64),recipientKeyset:'keys'};}},
  updateBubbleSendingProgress(){},updateChatMediaUploadProgress(){},hideChatMediaUploadProgress(){},showToast(){},getOrbitStorageObjectPath:url=>url.split('/').pop()});
 vm.runInContext(fs.readFileSync(path.join(root,'js/chat/chat-dispatcher.js'),'utf8'),c);
 c._getOutboxMedia=async()=>original;c._storeOutboxMedia=async(id,index,body)=>{assert.equal(body,original);prepareWrites++;};c._persistMessageOutbox=async()=>{};c._updateOutboxMessage=()=>{};
 c._openMediaOutboxDb=async()=>({transaction:()=>{if(diskFailure)throw Error('disk full');const tx={objectStore:()=>({put:saved=>{disk.set(saved.key,saved);queueMicrotask(()=>tx.oncomplete());},get:key=>{const req={};queueMicrotask(()=>{req.result=disk.get(key);req.onsuccess();});return req;}})};return tx;}});
 c.uploadMediaToStorage=async(body,name,mime,folder,progress,id)=>{uploads.push({body,id});if(uploads.length===1)throw Object.assign(Error('connection dropped'),{status:0});return 'https://storage/'+id;};
 const item=()=>({payload:{id:'message',room:'room',sender_id:'u',attachments:[{url:'',size:original.size,upload_pending:true}]},mediaUploadInfo:[{index:0,name:'photo.jpg',mime:'image/jpeg',type:'image',originalQuality:true}]});
 return {c,uploads,disk,original,item,stats:()=>({encryptions,prepareWrites})};
}

test('interrupted upload recovers ciphertext and metadata atomically after stale queue restore',async()=>{
 const {c,uploads,item,stats}=uploadContext();
 await assert.rejects(c._uploadQueuedMedia(item()),/connection dropped/);
 vm.runInContext('_mediaUploadCheckpoints.clear()',c);
 const restored=item();await c._uploadQueuedMedia(restored);
 assert.equal(stats().encryptions,1);assert.equal(stats().prepareWrites,1);
 assert.equal(uploads[0].body,uploads[1].body);assert.equal(uploads[0].id,uploads[1].id);
 assert.match(uploads[0].id,/^message_0_1{64}$/);
 assert.equal(restored.payload.attachments[0].mime,'image/jpeg');
 assert.equal(restored.payload.attachments[0].digest,'1'.repeat(64));
});

test('lost volatile checkpoint retries original bytes at a different object path',async()=>{
 const {c,uploads,item,stats}=uploadContext({diskFailure:true});
 await assert.rejects(c._uploadQueuedMedia(item()),/connection dropped/);
 vm.runInContext('_mediaUploadCheckpoints.clear()',c);
 const restored=item();restored.mediaUploadInfo[0].checkpointVersion=1;restored.mediaUploadInfo[0].encryptedDigest='1'.repeat(64);
 await c._uploadQueuedMedia(restored);
 assert.equal(stats().encryptions,2);assert.notEqual(uploads[0].id,uploads[1].id);
 assert.equal(restored.payload.attachments[0].digest,'2'.repeat(64));
});

test('upload checkpoints reject a different signed-in owner',async()=>{
 const {c,item}=uploadContext();
 await assert.rejects(c._uploadQueuedMedia(item()),/connection dropped/);
 c.currentUser={id:'another-account'};
 await assert.rejects(c._getOutboxUpload('message',0),/another account/);
});
