const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function mediaSecurity(){
 const calls=[];const source=fs.readFileSync(path.join(root,'js/config.js'),'utf8');
 const c=vm.createContext({URL,SB_URL:'https://project.supabase.co',window:{location:{href:'https://orbit.example/'}},currentUser:{id:'owner'},console,
  ensureSupabase:async()=>({storage:{from:bucket=>({createSignedUrl:async(object,expiry)=>{calls.push({bucket,object,expiry});return {data:{signedUrl:'https://signed.example/file'}};}})}})});
 vm.runInContext(source.slice(source.indexOf('function formatMediaUrl('),source.indexOf('async function resolveMediaUrlForAccess(')),c);
 return {c,calls};
}
test('media URLs cannot escape quoted HTML attributes or inline media actions',()=>{
 const {c}=mediaSecurity();
 const attack='https://example.com/image.jpg\" onerror=\"alert(1)\' <script>';
 assert.doesNotMatch(c.formatMediaUrl(attack),/[\s\"'<>`\\]/);
 assert.equal(c.formatMediaUrl('https://example.com/&quot;onclick=&quot;attack'), '');
 assert.equal(c.formatMediaUrl('javascript:alert(1)'), '');
 assert.equal(c.formatMediaUrl('data:text/html,<script>attack</script>'), '');
 assert.equal(c.formatMediaUrl('https://example.com/file.jpg?width=100&height=200'),'https://example.com/file.jpg?width=100&height=200');
});
test('only own-project storage is signed and links expire within five minutes',async()=>{
 const {c,calls}=mediaSecurity();
 assert.equal(await c.getSignedOrbitMediaUrl('https://evil.example/storage/v1/object/public/chat-assets/images/owner/a.jpg'),null);
 assert.equal(calls.length,0);
 await c.getSignedOrbitMediaUrl('https://project.supabase.co/storage/v1/object/public/avatars/owner/a.jpg',999999);
 assert.deepEqual(calls,[{bucket:'avatars',object:'owner/a.jpg',expiry:300}]);
});
test('signed media from a previous account is discarded',async()=>{
 const {c}=mediaSecurity();let finish;
 c.ensureSupabase=async()=>({storage:{from:()=>({createSignedUrl:()=>new Promise(resolve=>finish=resolve)})}});
 const pending=c.getSignedOrbitMediaUrl('images/owner/a.jpg');await new Promise(setImmediate);
 c.currentUser={id:'other'};finish({data:{signedUrl:'private'}});assert.equal(await pending,null);
});
test('error reports omit raw context and redact tokens and signed URL parameters',async()=>{
 let body;const handlers={};
 const c=vm.createContext({window:{location:{pathname:'/index.html',hash:'#private'},getSupabase:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'test'}}})}})},
  localStorage:{getItem:()=>null,length:0},navigator:{onLine:true,userAgent:'test'},Map,Date,Error,console,
  fetch:async(url,options)=>{body=JSON.parse(options.body);return {ok:true};}});
 c.window.addEventListener=(type,fn)=>handlers[type]=fn;
 vm.runInContext(fs.readFileSync(path.join(root,'js/logger.js'),'utf8'),c);
 c.window.Logger.captureException('URL https://project.supabase.co/file?token=private', {password:'private',text:'chat contents',status:403});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.ok(body);assert.ok(!JSON.stringify(body).includes('chat contents'));assert.ok(!JSON.stringify(body).includes('token=private'));
 assert.deepEqual(body.metadata.context,{status:403,code:''});assert.equal(body.route,'/index.html');
});
test('stored reaction keys cannot inject markup or JavaScript into reaction controls',()=>{
 const source=fs.readFileSync(path.join(root,'js/chat/chat-feed.js'),'utf8');const c=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf('function getMessageReactionsMap('),source.indexOf('function showQuickReactionPicker(')),c);
 const owner='11111111-1111-4111-8111-111111111111';
 const result=c.getMessageReactionsMap({reply_to:{reactions:{'👍':[owner],"');alert(1);//":[owner],'<img src=x onerror=alert(1)>':[owner]}}});
 assert.deepEqual(Object.keys(result),['👍']);assert.deepEqual(Array.from(result['👍']),[owner]);
});
