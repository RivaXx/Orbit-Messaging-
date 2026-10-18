const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
test('cached navigation stays usable when an online network request never responds',async()=>{
 const handlers={},cached=new Response('cached Orbit shell');let response,timer,started;
 const ready=new Promise(resolve=>started=resolve);
 const c=vm.createContext({URL,Response,Promise,fetch:()=>new Promise(()=>{}),setTimeout:fn=>{timer=fn;started();},
  self:{location:{origin:'https://orbit.example'},navigator:{onLine:true},addEventListener:(name,fn)=>handlers[name]=fn},
  caches:{open:async()=>({match:async()=>cached})}});
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),c);
 handlers.fetch({request:{method:'GET',url:'https://orbit.example/',mode:'navigate'},waitUntil(){},respondWith:value=>response=value});
 await ready;timer();assert.equal(await (await response).text(),'cached Orbit shell');
});
test('every deferred local script and stylesheet has an offline cache entry and exists on disk',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 const assets=[...html.matchAll(/<(script|link)\b[^>]*(?:src|href)="((?:js\/|assets\/vendor\/)[^"]+|[^"/]+\.css\?[^"]+)"[^>]*>/g)];
 assert.ok(assets.length>25);
 for(const [tag,type,url] of assets){if(type==='script')assert.match(tag,/\bdefer\b/);assert.ok(fs.existsSync(path.join(root,url.split('?')[0])),url);assert.ok(worker.includes('"./'+url+'"'),url);}
 assert.doesNotMatch(worker,/_polish-review/);
});
