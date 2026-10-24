const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function context(){
 const element=()=>({dataset:{},style:{},innerHTML:'',classList:{add(){},remove(){},contains(){return false;}},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}});
 const c=vm.createContext({console,Date,Map,Set,URL,currentUser:{id:'me'},currentRoom:'room',window:{location:{href:'https://orbit-messaging.vercel.app/'}},document:{createElement:element,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,SB_URL:'https://project.supabase.co'});
 const config=read('js/config.js');vm.runInContext(config.slice(config.indexOf('function formatMediaUrl('),config.indexOf("document.addEventListener('DOMContentLoaded',()=>{",config.indexOf('function formatMediaUrl('))),c);
 vm.runInContext(config.slice(config.indexOf('function escapeHtml(')),c);return c;
}
test('media URL formatter rejects active schemes and encodes HTML/handler delimiters',()=>{
 const c=context();for(const value of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','vbscript:msgbox(1)','https://x.test/\nfoo'])assert.equal(c.formatMediaUrl(value),'');
 for(const value of ['https://x.test/a\'"<>`\\.jpg',"media/me/a'b.jpg","/storage/v1/object/public/chat-assets/a'\".jpg"]){const safe=c.formatMediaUrl(value);assert.ok(safe);assert.doesNotMatch(safe,/[<>"'`\\]/);}
 assert.equal(c.formatMediaUrl('blob:https://orbit.test/id'),'blob:https://orbit.test/id');
});
test('private media signing uses the exact project and bucket, coalesces requests and rejects cross-account results',async()=>{
 const c=context(),calls=[];let release;c.ensureSupabase=async()=>({storage:{from:bucket=>({createSignedUrl:async(p,ttl)=>{calls.push({bucket,p,ttl});return {data:{signedUrl:`https://project.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=safe`}};}})}});
 const url='https://project.supabase.co/storage/v1/object/public/voice-notes/me/note.webm';
 const [a,b]=await Promise.all([c.getSignedOrbitMediaUrl(url),c.getSignedOrbitMediaUrl(url)]);assert.equal(a,b);assert.deepEqual(calls,[{bucket:'voice-notes',p:'me/note.webm',ttl:300}]);
 assert.equal(await c.getSignedOrbitMediaUrl('https://evil.test/storage/v1/object/public/chat-assets/me/x.jpg'),null);assert.equal(calls.length,1);
 c.ensureSupabase=async()=>({storage:{from:()=>({createSignedUrl:()=>new Promise(resolve=>release=resolve)})}});
 const pending=c.getSignedOrbitMediaUrl('https://project.supabase.co/storage/v1/object/public/files/me/private.txt');await new Promise(setImmediate);c.currentUser={id:'other'};release({data:{signedUrl:'https://project.supabase.co/secret'}});assert.equal(await pending,null);
});
test('attachment filenames remain data when clicked and legacy reaction markup is escaped',()=>{
 const c=context();vm.runInContext(read('js/chat/chat-feed.js'),c);
 c.orbitIsViewOnceMessage=()=>false;c.orbitPhotoQualityBadge=()=>'';c.attachSlideToReplyAndReactionGesture=()=>{};c.formatOrbitMessageText=c.escapeHtml;
 const name="x'); compromised=true; // .txt",emoji='<img src=x onerror=attack()>',url=c.formatMediaUrl("https://example.test/a'b.txt");
 const row=c.createMessageDOMNode({id:'11111111-1111-4111-8111-111111111111',sender_id:'other',created_at:new Date().toISOString(),type:'file',text:'Attachment',attachments:[{url,name,type:'file'}],reply_to:{reactions:{[emoji]:['other']}}});
 assert.match(row.innerHTML,/file-preview-card/);assert.match(row.innerHTML,/reaction-badge/);assert.ok(!row.innerHTML.includes(emoji));
 const handler=row.innerHTML.match(/onclick="(handleDocumentFilePreview\([^\"]+\))"/)[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
 let args;c.handleDocumentFilePreview=(...a)=>args=a;c.compromised=false;vm.runInContext(handler,c);assert.equal(c.compromised,false);assert.equal(args[1],name);
});
test('realtime hints fetch RLS-protected records and ignore missing or wrong-room content',async()=>{
 const c=context(),seen=[],id='11111111-1111-4111-8111-111111111111';c.messageCache=new Map();c.handleRealtimeInsert=p=>seen.push(p.new);c.handleRealtimeUpdate=p=>seen.push(p.new);
 let row={id,room:'other-room',text:'wrong'};c.ensureSupabase=async()=>({from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:row})})});
 const source=read('js/chat/chat-realtime.js');vm.runInContext(source.slice(source.indexOf('const orbitConfirmedRefreshes=')),c);
 await c.orbitRefreshConfirmedMessage(id,'room',['room']);assert.equal(seen.length,0);row=null;await c.orbitRefreshConfirmedMessage(id,'room',['room']);assert.equal(seen.length,0);
 row={id,room:'room',text:'Server-confirmed'};await c.orbitRefreshConfirmedMessage(id,'room',['room']);assert.equal(seen[0].text,'Server-confirmed');
});
test('PDF preview disables evaluation, web headers prevent framing and chat labels do not claim E2EE',()=>{
 assert.match(read('js/actions/file-viewer.js'),/getDocument\(\{url,isEvalSupported:false,enableXfa:false\}\)/);
 assert.doesNotMatch(read('index.html')+read('js/chat/chat-history.js'),/E2EE Active/);
 const headers=JSON.parse(read('vercel.json')).headers[0].headers;assert.equal(headers.find(h=>h.key==='X-Frame-Options').value,'DENY');assert.match(headers.find(h=>h.key==='Content-Security-Policy').value,/object-src 'none'/);assert.doesNotMatch(headers.find(h=>h.key==='Content-Security-Policy').value,/unsafe-eval/);
});
