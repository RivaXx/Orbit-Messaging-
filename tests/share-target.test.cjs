const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
function worker(fail=false){const handlers={},saved=[];const context=vm.createContext({URL,Response,importScripts:()=>{},OrbitShareInbox:{save:async form=>{if(fail)throw Error('Device storage full');saved.push(form.get('text'));return 'share-id';}},self:{location:{origin:'https://orbit.example'},registration:{scope:'https://orbit.example/'},addEventListener:(name,fn)=>handlers[name]=fn}});vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);return {handlers,saved};}
test('share POST is handled locally, then redirected without putting shared text in the URL',async()=>{
 const {handlers,saved}=worker();let response;const form=new FormData();form.set('text','private shared text');
 handlers.fetch({request:new Request('https://orbit.example/_orbit-share',{method:'POST',body:form}),respondWith:p=>response=p});
 const r=await response;assert.equal(r.status,303);assert.equal(r.headers.get('location'),'https://orbit.example/index.html?orbitShare=share-id');assert.deepEqual(saved,['private shared text']);
});
test('share storage failures are reported without redirecting to an empty composer',async()=>{
 const {handlers}=worker(true);let response;handlers.fetch({request:new Request('https://orbit.example/_orbit-share',{method:'POST',body:new FormData()}),respondWith:p=>response=p});
 const r=await response;assert.equal(r.status,400);assert.match(await r.text(),/Device storage full/);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('manifest declares multipart files and share endpoint remains out of shell caching',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));assert.equal(m.share_target.method,'POST');assert.equal(m.share_target.enctype,'multipart/form-data');assert.ok(m.share_target.params.files[0].accept.includes('image/*'));
});
