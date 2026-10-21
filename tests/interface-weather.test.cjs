const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function setup(){const nodes=new Map(),storage=new Map(),events={},timers=[];
 function el(){const classes=new Set();return {dataset:{},style:{},children:[],textContent:'',innerText:'',innerHTML:'',value:'',attributes:{},
  classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},toggle(x,on){if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);},contains:x=>classes.has(x)},
  setAttribute(k,v){this.attributes[k]=v;},append(x){this.children.push(x);x.parentElement=this;},querySelector(selector){return this.parts?.[selector]||null;},querySelectorAll:()=>[],addEventListener(){},remove(){},before(){this.moved=true;},after(){}};}
 const node=id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);};
 const cards=[];const c=vm.createContext({console,Date,URL,URLSearchParams,AbortController,File,Blob,crypto,
  document:{hidden:false,documentElement:el(),body:el(),getElementById:node,createElement:el,querySelectorAll:selector=>selector.includes('main-chats-list')?cards:[],querySelector:()=>null,addEventListener:(name,fn)=>events[name]=fn},window:{addEventListener(){},location:{search:''},OrbitChatSelect:{getMutedRooms:()=>['muted']}},navigator:{onLine:true},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval:()=>0,clearInterval(){},
  currentUser:{id:'me'},currentRoom:'room',globalUsersMap:new Map(),unreadRoomsSet:new Set(),resolveRoomAliases:r=>[r],formatSmartActivity:(_date,online)=>online?'Online':'Last seen yesterday',formatMediaUrl:x=>x,
  escapeHtml:s=>String(s).replaceAll('<','&lt;'),showToast(){},updateTabUnreadBadges(){},isOrbitChatVisible:()=>false,SB_URL:'https://example.supabase.co',launchApp:async()=>{},
  ensureSupabase:async()=>({rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:null}}),signOut:async()=>({})}})});
 return {c,node,storage,events,timers,el,cards};}
test('live calculator preview does not mutate expression or history and persists its toggle',()=>{
 const {c,node,storage}=setup();vm.runInContext(read('js/calculator.js'),c);
 ['1','2','+','3'].forEach(x=>c.calcInput(x));assert.equal(node('calc-answer-preview').textContent,'= 15');assert.equal(vm.runInContext('calcHistory.length',c),0);
 c.toggleCalcPreview();assert.equal(node('calc-answer-preview').textContent,'');assert.equal(storage.get('orbit_calc_preview'),'false');
 c.toggleCalcPreview();assert.equal(node('calc-answer-preview').textContent,'= 15');c.calcInput('=');assert.equal(node('calc-answer-preview').textContent,'');assert.equal(vm.runInContext('calcCurrentVal',c),'15');
 c.calcInput('AC');['5','/','0'].forEach(x=>c.calcInput(x));assert.equal(node('calc-answer-preview').textContent,'');
});
test('conversation presence matches fresh Global presence and privacy settings',()=>{
 const {c,storage}=setup();vm.runInContext(read('js/messaging-experience.js'),c);
 c.globalUsersMap.set('peer',{is_online:true,last_seen:new Date().toISOString()});assert.equal(c.orbitChatPresence('peer'),'Online');
 c.globalUsersMap.set('peer',{is_online:true,last_seen:new Date(Date.now()-120000).toISOString()});assert.equal(c.orbitChatPresence('peer'),'Last seen yesterday');
 storage.set('orbit_privacy_last_seen','nobody');assert.equal(c.orbitChatPresence('peer'),'');
});
test('conversation cards have numbered unread, sender preview, muted and pinned states',async()=>{
 const {c,el}=setup();vm.runInContext(read('js/messaging-experience.js'),c);vm.runInContext(read('js/orbit-interface.js'),c);
 c.ensureSupabase=async()=>({rpc:async()=>({data:[{room:'muted',unread_count:12}],error:null})});await c.orbitRefreshUnreadCounts();
 const card=el();c.orbitRenderConversationCard(card,{roomId:'muted',title:'Coaches',isGroup:true,isPinned:true,presenceDisplay:'12 members',msgPreview:c.orbitConversationPreview({sender_id:'other',username:'Subroto',text:'Students joined'},true)});
 assert.match(card.innerHTML,/Subroto: Students joined/);assert.match(card.innerHTML,/12 unread messages/);assert.match(card.innerHTML,/title="Muted"/);assert.match(card.innerHTML,/title="Pinned"/);assert.equal(card.dataset.group,'true');
 c.orbitClearConversationUnread('muted');assert.equal(c.orbitConversationUnread('muted'),0);
});
test('realtime deduplicates unread increments; stale RPC results cannot erase incoming messages or leak accounts',async()=>{
 const {c}=setup();vm.runInContext(read('js/messaging-experience.js'),c);vm.runInContext(read('js/orbit-interface.js'),c);let finish;
 let started;const ready=new Promise(resolve=>started=resolve);c.ensureSupabase=async()=>({rpc:()=>new Promise(resolve=>{finish=resolve;started();})});const pending=c.orbitRefreshUnreadCounts();await ready;
 const message={id:'one',room:'room',sender_id:'peer',text:'Hello',created_at:new Date().toISOString()};c.orbitReceiveConversationMessage(message);c.orbitReceiveConversationMessage(message);
 finish({data:[],error:null});await pending;assert.equal(c.orbitConversationUnread('room'),1);
 c.currentUser={id:'another'};c.unreadRoomsSet.clear();assert.equal(c.orbitConversationUnread('room'),0);
});
test('remembered session opens app without login flash and enforces six days of inactivity',async()=>{
 const {c,storage}=setup();vm.runInContext(read('js/ui/ui-auth.js'),c);let launches=0,signouts=0;
 storage.set('sb-example-auth-token',JSON.stringify({user:{id:'me'}}));storage.set('orbit_session_activity_me',String(Date.now()-86400000));
 c.launchApp=async()=>launches++;c.ensureSupabase=async()=>({auth:{getSession:async()=>{assert.equal(c.document.documentElement.classList.contains('orbit-restoring'),true);return {data:{session:{user:{id:'me'}}}};},signOut:async()=>signouts++}});
 await c.checkExistingSession();assert.equal(launches,1);assert.equal(c.document.documentElement.classList.contains('orbit-restoring'),false);
 storage.set('orbit_session_activity_me',String(Date.now()-6*86400000));await c.checkExistingSession();assert.equal(launches,1);assert.equal(signouts,1);
 storage.set('orbit_explicit_signout','true');await c.checkExistingSession();assert.equal(launches,1);
 let reloaded=false;c.window.location.reload=()=>reloaded=true;c.orbitRememberSessionActivity();assert.equal(reloaded,true);assert.equal(storage.has('sb-example-auth-token'),false);
});
test('precise weather rejects stale fixes, retains best fresh fix and clears the geolocation watch',async()=>{
 const {c,timers}=setup();let success,error,cleared=0,options;
 c.navigator.geolocation={watchPosition:(ok,fail,opts)=>{success=ok;error=fail;options=opts;return 4;},clearWatch:id=>{assert.equal(id,4);cleared++;}};
 vm.runInContext(read('js/orbit-banner-weather.js'),c);const pending=c.getOrbitPreciseWeatherLocation();
 success({timestamp:Date.now()-60000,coords:{latitude:12,longitude:20,accuracy:5}});
 success({timestamp:Date.now(),coords:{latitude:12,longitude:20,accuracy:500}});
 success({timestamp:Date.now(),coords:{latitude:12.1,longitude:20,accuracy:40}});error({code:3});
 const fix=await pending;assert.equal(fix.coords.accuracy,40);assert.equal(cleared,1);assert.equal(options.enableHighAccuracy,true);assert.equal(options.maximumAge,0);
 c.setOrbitWeatherMotion('live');assert.equal(c.document.getElementById('modal-orbit-weather').dataset.motion,'live');c.setOrbitWeatherMotion('bad');assert.equal(c.document.getElementById('modal-orbit-weather').dataset.motion,'calm');
});

test('valid remembered sessions show cached UI without waiting for network auth',async()=>{
 const {c,storage}=setup();vm.runInContext(read('js/ui/ui-auth.js'),c);let launches=0;
 storage.set('sb-example-auth-token',JSON.stringify({user:{id:'me'},expires_at:Date.now()/1000+3600}));
 c.ensureSupabase=async()=>{throw Error('Fast restore should not wait here');};c.launchApp=async()=>launches++;
 await c.checkExistingSession();assert.equal(launches,1);
});

test('Google beta checks provider availability and requests PKCE on the same app origin',async()=>{
 const {c,node,storage}=setup();c.SB_KEY='publishable';c.location={href:'https://orbit.example/',origin:'https://orbit.example',pathname:'/'};
 c.window.location={assign:url=>c.destination=url};vm.runInContext(read('js/ui/ui-auth.js'),c);
 let enabled=false,oauthCalls=0,options;
 c.fetch=async()=>({ok:true,json:async()=>({external:{google:enabled}})});
 c.ensureSupabase=async()=>({auth:{signInWithOAuth:async args=>{oauthCalls++;options=args;return {data:{url:'https://example.supabase.co/auth/v1/authorize?provider=google'}};}}});
 await c.handleGoogleSignIn();assert.equal(oauthCalls,0);assert.match(node('auth-err').textContent,/not enabled/);
 enabled=true;await c.handleGoogleSignIn();assert.equal(oauthCalls,1);assert.equal(options.provider,'google');
 assert.equal(options.options.redirectTo,'https://orbit.example/?orbit_oauth=google');assert.equal(options.options.skipBrowserRedirect,true);
 assert.ok(storage.get('orbit_google_pending'));assert.match(c.destination,/example.supabase.co\/auth\/v1\/authorize/);
});

test('Google callback scrubs its code before exchanging and restores an authenticated session',async()=>{
 const {c,storage}=setup();c.location={href:'https://orbit.example/?orbit_oauth=google&code=one-use-code'};
 let replaced='',launches=0,exchanges=0;c.window.history={replaceState:(_state,_title,url)=>replaced=url};
 vm.runInContext(read('js/ui/ui-auth.js'),c);storage.set('orbit_google_pending',String(Date.now()));storage.set('orbit_explicit_signout','true');
 c.ensureSupabase=async()=>({auth:{exchangeCodeForSession:async code=>{exchanges++;assert.equal(code,'one-use-code');assert.equal(replaced,'/');return {data:{session:{user:{id:'google-user'}}}};}}});
 c.launchApp=async()=>launches++;await c.checkExistingSession();
 assert.equal(launches,1);assert.equal(exchanges,1);assert.equal(c.currentUser.id,'google-user');assert.equal(storage.has('orbit_explicit_signout'),false);
 assert.equal(storage.has('orbit_google_pending'),false);
});


test('calculator settings keyboard does not change a calculation; Escape closes settings',()=>{
 const {c,node,events}=setup();vm.runInContext(read('js/calculator.js'),c);
 c.calcInput('7');c.calcInput('+');c.calcInput('8');node('calc-settings').open=true;
 events.keydown({key:'9',preventDefault(){}});assert.equal(vm.runInContext('calcCurrentVal',c),'8');
 let prevented=false;events.keydown({key:'Escape',preventDefault(){prevented=true;}});
 assert.equal(node('calc-settings').open,false);assert.equal(prevented,true);
 assert.equal(node('calc-answer-preview').textContent,'= 15');
});
test('calculator settings remain available across converter and date modes',()=>{
 const {c,node}=setup();c.scheduleCalcLayout=()=>{};vm.runInContext(read('js/tools.js'),c);
 c.initUnitConverter=()=>{};c.initDateCalculator=()=>{};
 for(const [mode,label] of [['converter','Unit converter'],['date','Date calculator'],['calc','Calculator']]){
  node('calc-settings').open=true;c.switchCalcSubmode(mode);
  assert.equal(node('calc-settings').open,false);assert.equal(node('calc-app-title').textContent,label);
 }
 c.switchCalcSubmode('invalid');assert.equal(node('calc-app-title').textContent,'Calculator');
});

test('notification navigation listener binds once before a stalled worker update',()=>{
 const {c}=setup();let listeners=0;c.location={protocol:'https:'};c.navigator.serviceWorker={register:()=>new Promise(()=>{}),addEventListener:()=>listeners++};vm.runInContext(read('js/ui/ui-auth.js'),c);c.initServiceWorker();c.initServiceWorker();assert.equal(listeners,1);
});
