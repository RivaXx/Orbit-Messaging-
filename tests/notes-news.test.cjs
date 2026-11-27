const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture() {
 const context=vm.createContext({crypto});
 vm.runInContext(read('js/orbit-note-store.js'),context);
 return vm.runInContext('OrbitNoteStore',context);
}
test('concurrent checklist changes merge by stable block ID, including nested entries',()=>{
 const store=fixture();
 const base=store.canonical({id:'note',content:'- [ ] First\n  - [ ] Second'});
 const local={...base,content:'- [x] First\n  - [ ] Second'};
 const remote={...base,content:'- [ ] First\n  - [x] Second'};
 local.document=store.documentFor(local.content,store.blocks(base));
 remote.document=store.documentFor(remote.content,store.blocks(base));
 const {row,conflict}=store.merge(base,local,remote);
 assert.equal(row.content,'- [x] First\n  - [x] Second');
 assert.equal(conflict,null);
 assert.equal(row.document[1].id,store.blocks(base)[1].id);
});

test('same-line text conflicts retain both versions while independent settings merge',()=>{
 const store=fixture();
 const base=store.canonical({id:'note',content:'original',tags:['Old']});
 const local={...base,content:'my text',tags:['Travel']};
 const remote={...base,content:'their text',pinned:true,tags:['Old','Weekend']};
 const {row,conflict}=store.merge(base,local,remote);
 assert.equal(row.content,'their text');
 assert.equal(conflict.content,'my text');
 assert.deepEqual([...row.tags],['Weekend','Travel']);
 assert.equal(row.pinned,true);
});

test('news server returns more than ten dated stories and validates categories',async()=>{
 const handler=require('../api/news.js');const now=new Date().toUTCString();const xml='<rss>'+Array.from({length:35},(_,i)=>`<item><title>Story ${i}</title><link>https://example.com/${i}</link><pubDate>${now}</pubDate><media:thumbnail url="https://example.com/${i}.jpg"/></item>`).join('')+'</rss>';
 const rows=handler.parseFeed(xml,'finance','BBC News');assert.equal(rows.length,35);assert.equal(rows[20].img,'https://example.com/20.jpg');assert.equal(rows[20].category,'finance');assert.equal(handler.parseFeed('<item><title>Bad</title><link>javascript:alert(1)</link><pubDate>'+now+'</pubDate></item>','global','Test').length,0);
 let code,data;await handler({method:'GET',query:{category:'https://evil.example'}},{status(n){code=n;return this;},json(x){data=x;}});assert.equal(code,400);assert.ok(data.error);
});

test('notes pair readable foregrounds with every tinted surface in both themes',()=>{
 const css=read('notes.css');const parse=hex=>hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16));const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const themes=[{surface:'151c27',ink:'f4f7fc',muted:'bdc9da'},{surface:'ffffff',ink:'172337',muted:'4b5b71'}];const tints=[[130,145,164],[75,139,232],[52,168,110],[220,107,145],[216,164,60]];
 for(const theme of themes){for(const value of Object.values(theme))assert.ok(css.includes('#'+value));for(const tint of tints){const surface=parse(theme.surface).map((v,i)=>v*.85+tint[i]*.15);assert.ok(ratio(parse(theme.ink),surface)>=4.5);assert.ok(ratio(parse(theme.muted),surface)>=4.5);}}
});
