const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(){
 const nodes=new Map(),store=new Map(),toasts=[],timers=[],rows=[];let fail=false;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},contains:()=>true},querySelectorAll:()=>[],setAttribute(){},focus(){}});return nodes.get(id);};
 const c=vm.createContext({console,Date,JSON,URL,crypto,window:{addEventListener(){}},document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){}},currentUser:{id:'owner'},userCalendarEvents:[],localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},clearTimeout(){},setTimeout:fn=>{timers.push(fn);return timers.length;},showToast:(message,type)=>toasts.push({message,type}),escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),switchTab(){},requestNotificationPermission(){}});
 const client={channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel(){},from(){let operation='read',patch,filters=[];const q={select(){return q;},order(){return q;},eq(k,v){filters.push([k,v]);return q;},insert(v){operation='insert';patch=v;return q;},update(v){operation='update';patch=v;return q;},single(){return run();},then(resolve,reject){return run().then(resolve,reject);}};
  async function run(){if(fail)return {error:{message:'offline'}};let found=rows.filter(row=>filters.every(([k,v])=>String(row[k])===String(v)));
   if(operation==='read')return {data:found.map(x=>({...x}))};if(operation==='insert'){const row={id:String(rows.length+1),...patch};rows.push(row);return {data:{...row}};}if(!found.length)return {error:{code:'PGRST116',message:'Version conflict'}};Object.assign(found[0],patch);return {data:{...found[0]}};}
  return q;}};
 c.ensureSupabase=async()=>client;c.getSupabase=()=>client;vm.runInContext(read('js/orbit-notes.js'),c);return {c,api:vm.runInContext('OrbitNotes',c),node,rows,store,timers,toasts,setFail:v=>fail=v};
}
test('notes create/edit/checklist and reminder use one confirmed row in calendar',async()=>{
 const {c,api,node,rows,toasts}=fixture();await api.load();api.open();node('note-title-inp').value='Trip <script>';node('note-body-inp').value='- [ ] Tickets\n- [ ] Passport';node('note-tags').value='Travel, Travel, Personal';node('note-color').value='blue';node('note-reminder').value=new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);await api.save();
 assert.equal(rows.length,1,JSON.stringify(toasts));assert.equal(rows[0].tags.length,2);assert.equal(c.userCalendarEvents.length,1);assert.equal(c.userCalendarEvents[0].noteId,'1');assert.match(node('notes-list').innerHTML,/&lt;script>/);assert.ok(toasts.some(x=>x.type==='success'));
 await api.task('1',0,true);assert.match(rows[0].content,/^- \[x\]/);assert.equal(c.userCalendarEvents.length,1);
 await api.action('1','trash');assert.equal(c.userCalendarEvents.length,0);assert.ok(rows[0].deleted_at);await api.action('1','restore');assert.equal(c.userCalendarEvents.length,1);
 await api.action('1','archive');assert.equal(c.userCalendarEvents.length,0);await api.action('1','archive');assert.equal(c.userCalendarEvents.length,1);
});
test('failed saves retain the editor and draft without reporting cloud success',async()=>{
 const {api,node,timers,toasts,setFail,store}=fixture();await api.load();api.open();node('note-title-inp').value='Offline draft';node('note-body-inp').value='Keep this';setFail(true);await api.save();for(const fn of timers)fn();assert.ok(store.get('orbit_note_draft_owner').includes('Keep this'));assert.ok(!toasts.some(x=>x.type==='success'));assert.equal(node('note-save-button').disabled,false);
});
test('stale note version is rejected and delayed draft cannot leak into another account',async()=>{
 const {c,api,node,rows,timers,store,toasts}=fixture();rows.push({id:'19',user_id:'owner',title:'Existing',content:'first',updated_at:'2026-01-01T00:00:00Z'});await api.load();api.open('19');node('note-body-inp').value='My edits';rows[0].updated_at='2026-01-02T00:00:00Z';await api.save();assert.equal(rows[0].content,'first');assert.match(toasts.at(-1).message,/another device/);c.currentUser={id:'other'};api.stop();for(const fn of timers)fn();assert.equal(store.has('orbit_note_draft_other'),false);assert.equal(c.userCalendarEvents.length,0);
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

test('rapid checklist changes serialize against the last confirmed note version',async()=>{
 const {api,rows}=fixture();rows.push({id:'1',user_id:'owner',title:'Tasks',content:'- [ ] First\n- [ ] Second',updated_at:'2026-01-01T00:00:00Z'});await api.load();await Promise.all([api.task('1',0,true),api.task('1',1,true)]);assert.equal(rows[0].content,'- [x] First\n- [x] Second');
});
