const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
function baseContext(){
 const nodes=new Map(),cache=new Map(),toasts=[];
 const element=id=>{if(!nodes.has(id))nodes.set(id,{style:{setProperty:()=>{},removeProperty:()=>{}},classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false},
  querySelectorAll:()=>[],replaceChildren:function(child){this.image=child;},removeAttribute:()=>{}});return nodes.get(id);};
 class DOMParser {parseFromString(value){return {body:{textContent:String(value).replace(/<[^>]+>/g,'')},querySelector:selector=>selector==='img'&&/<img[^>]*src="([^"]+)"/.test(value)?{getAttribute:()=>value.match(/<img[^>]*src="([^"]+)"/)[1]}:null};}}
 const context=vm.createContext({window:{addEventListener:()=>{}},document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>({}),addEventListener:()=>{}},
  localStorage:{getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v)},setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,
  DOMParser,URL,URLSearchParams,Blob,Uint8Array,atob,Date,console,AbortController,
  currentUser:{id:'user'},userProfile:{first_name:'User',dp_url:'https://example.com/old.jpg'},
  showToast:(message,type)=>toasts.push({message,type}),updateUserHeaderUI:()=>{},updatePresenceStatus:async()=>{},
  liveNewsCache:{},currentNewsCategory:'global',escapeHtml:s=>String(s).replaceAll('"','&quot;')});
 return {context,element,cache,toasts};
}
test('profile photo uses resized avatar upload and changes local state only after confirmed save',async()=>{
 const {context:c,element,cache,toasts}=baseContext();let saved,folder;
 c.compressImageForUpload=async()=> 'data:image/jpeg;base64,YXZhdGFy';
 c.uploadMediaToStorage=async(blob,_name,_mime,subfolder)=>{assert.equal(await blob.text(),'avatar');folder=subfolder;return 'https://example.com/avatars/user/photo.jpg';};
 c.ensureSupabase=async()=>({from:()=>({upsert:async value=>{saved=value;return {error:null};}})});
 vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-modals.js'),'utf8'),c);
 await c.handleProfileAvatarUpload({target:{files:[new Blob(['image'],{type:'image/png'})]}});
 assert.equal(folder,'avatars');assert.equal(saved.user_id,'user');assert.equal(c.userProfile.dp_url,saved.dp_url);
 assert.equal(element('profile-large-av').image.src,saved.dp_url);
 assert.equal(JSON.parse(cache.get('orbit_profile_user')).dp_url,saved.dp_url);
 assert.ok(toasts.some(item=>item.type==='success'));
});
test('rejected profile save keeps old photo and reports the server error',async()=>{
 const {context:c,toasts}=baseContext();c.compressImageForUpload=async()=> 'data:image/jpeg;base64,YQ==';
 c.uploadMediaToStorage=async()=> 'https://example.com/new.jpg';
 c.ensureSupabase=async()=>({from:()=>({upsert:async()=>({error:{message:'Permission denied'}})})});
 vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-modals.js'),'utf8'),c);
 await c.handleProfileAvatarUpload({target:{files:[new Blob(['image'],{type:'image/png'})]}});
 assert.equal(c.userProfile.dp_url,'https://example.com/old.jpg');
 assert.ok(toasts.some(item=>item.message.includes('Permission denied')));assert.ok(!toasts.some(item=>item.type==='success'));
});
test('account change during avatar upload never writes or updates the other account',async()=>{
 const {context:c}=baseContext();c.compressImageForUpload=async()=> 'data:image/jpeg;base64,YQ==';
 c.uploadMediaToStorage=async()=>{c.currentUser={id:'other'};return 'https://example.com/new.jpg';};
 c.ensureSupabase=async()=>{throw Error('Must not save');};
 vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-modals.js'),'utf8'),c);
 await c.handleProfileAvatarUpload({target:{files:[new Blob(['image'],{type:'image/png'})]}});
 assert.equal(c.userProfile.dp_url,'https://example.com/old.jpg');
});
test('publisher images stay associated with their stories; stock and invalid images are removed',()=>{
 const {context:c}=baseContext();vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-navigation.js'),'utf8'),c);
 const rows=c.makeNewsItems([{title:'Markets rise - banks lead',link:'https://example.com/story',pubDate:'2026-10-15',thumbnail:'https://example.com/banks.jpg'},
  {title:'Film awards',link:'https://example.com/film',pubDate:'2026-10-15',description:'<img src="https://example.com/awards.jpg">'}],'finance','BBC News');
 assert.equal(rows[0].title,'Markets rise - banks lead');assert.equal(rows[0].source,'BBC News');
 assert.equal(rows[0].img,'https://example.com/banks.jpg');assert.equal(rows[1].img,'https://example.com/awards.jpg');
 assert.equal(c.safeNewsImage('https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400'),'');
 assert.equal(c.safeNewsImage('javascript:alert(1)'),'');
});
test('finance, entertainment and sports use distinct publisher feeds and keep category identity',async()=>{
 const {context:c}=baseContext();vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-navigation.js'),'utf8'),c);
 const feeds=[];c.fetchRssItems=async url=>{feeds.push(url);return [{title:'Story',link:'https://example.com/'+feeds.length,pubDate:'2026-10-15',thumbnail:'https://example.com/image.jpg'}];};
 for(const category of ['finance','entertainment','sports']){c.currentNewsCategory=category;await c.refreshNewsFeed();assert.equal(c.liveNewsCache[category][0].category,category);}
 assert.ok(feeds[0].includes('/business/'));assert.ok(feeds[1].includes('/entertainment_and_arts/'));assert.ok(feeds[2].includes('/sport/'));
});
test('cached stock thumbnails render a neutral fallback instead of a repeated fake photo',()=>{
 const {context:c,element}=baseContext();vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-navigation.js'),'utf8'),c);
 c.liveNewsCache.global=[{id:'story',title:'Headline',source:'Publisher',pubDate:'2026-10-15',link:'https://example.com',img:'https://images.unsplash.com/photo-1504711434969-e33886168f5c'}];
 c.loadNewsFeed();assert.ok(element('news-feed-list').innerHTML.includes('No publisher image'));
 assert.ok(!element('news-feed-list').innerHTML.includes('<img'));
});
