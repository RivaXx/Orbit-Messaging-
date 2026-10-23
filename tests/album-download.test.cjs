const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/actions/media-lightbox.js'),'utf8');
function fixture(){
 const errors=[],links=[],c=vm.createContext({Blob,TextEncoder,URL,AbortController,Date,Uint8Array,Uint32Array,DataView,console,
  setTimeout:(fn,ms)=>ms===0?setTimeout(fn,0):0,clearTimeout,currentUser:{id:'me'},currentRoom:'room',
  showToast:msg=>errors.push(msg),document:{addEventListener(){},createElement(){const link={isConnected:true};links.push(link);return link;}}});
 c.window=c;c.addEventListener=()=>{};vm.runInContext(source,c);
 const button={disabled:false,isConnected:true,textContent:'Download 2 photos',replaceWith(link){this.replacement=link;}};
 return {c,errors,links,button};
}
test('ZIP contains exact original bytes, valid CRCs, distinct safe Unicode filenames and a central directory',async()=>{
 const {c}=fixture(),zip=await c.orbitBuildPhotoZip([{name:'../résumé.jpg',blob:new Blob(['123456789'])},{name:'../résumé.jpg',blob:new Blob(['second'])}]);
 const b=Buffer.from(await zip.arrayBuffer());assert.equal(b.readUInt32LE(0),0x04034b50);assert.equal(b.readUInt32LE(14),0xcbf43926);
 const name=b.subarray(30,30+b.readUInt16LE(26)).toString();assert.equal(name,'001-.._résumé.jpg');assert.equal(b.subarray(30+Buffer.byteLength(name),39+Buffer.byteLength(name)).toString(),'123456789');
 assert.ok(b.includes(Buffer.from('002-.._résumé.jpg')));assert.equal(b.readUInt32LE(b.length-22),0x06054b50);assert.equal(b.readUInt16LE(b.length-12),2);
 const central=b.readUInt32LE(b.length-6);assert.equal(b.readUInt32LE(central),0x02014b50);
});
test('album prepares one ZIP link; a failed photo never produces a misleading partial download',async()=>{
 const h=fixture();h.c.fetch=async()=>new Response('photo',{headers:{'content-type':'image/jpeg'}});
 await h.c.orbitDownloadAlbum([{url:'https://example.com/a',name:'a.jpg'},{url:'https://example.com/b',name:'b.jpg'}],h.button);
 assert.match(h.button.replacement.download,/\.zip$/);assert.match(h.button.replacement.textContent,/2 photos/);URL.revokeObjectURL(h.button.replacement.href);
 const fail=fixture();fail.c.fetch=async()=>new Response('',{status:403});await fail.c.orbitDownloadAlbum([{url:'https://example.com/a'}],fail.button);
 assert.equal(fail.links.length,0);assert.equal(fail.button.disabled,false);assert.match(fail.errors[0],/retry/);
});
test('view-once media and albums over the mobile memory cap cannot be bulk downloaded',async()=>{
 const h=fixture();let calls=0;h.c.fetch=async()=>{calls++;return new Response('',{headers:{'content-length':String(101*1024*1024)}});};
 await h.c.orbitDownloadAlbum([{url:'private',view_once:true}],h.button);assert.equal(calls,0);
 await h.c.orbitDownloadAlbum([{url:'https://example.com/large'}],h.button);assert.equal(h.links.length,0);assert.match(h.errors[0],/100 MB/);
});
test('photo labels distinguish original, HD and SD; legacy unknown quality is not mislabelled',()=>{
 const {c}=fixture();for(const [quality,label] of [['hd','HD'],['sd','SD'],['original','Original']])assert.ok(c.orbitPhotoQualityBadge({quality}).includes('>'+label+'<'));
 assert.equal(c.orbitPhotoQualityBadge({}), '');assert.equal(c.orbitPhotoQualityBadge({quality:'<script>'}), '');
});
