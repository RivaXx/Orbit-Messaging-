const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function setup({cached=false,reduced=false,scene=true,sound=false}={}){
 let now=0,cleanup=0,closed=0,notes=0;const store=new Map(),nodes=new Map(),events={},timers=[];
 const make=tag=>{const classes=new Set();const e={tagName:tag.toUpperCase(),inert:false,isConnected:true,style:{},children:[],attributes:{},classList:{add:x=>classes.add(x),contains:x=>classes.has(x)},setAttribute(k,v){this.attributes[k]=v;},append(child){this.children.push(child);if(child.id)nodes.set(child.id,child);},remove(){this.isConnected=false;if(nodes.get(this.id)===this)nodes.delete(this.id);},addEventListener(name,fn){this[name]=fn;},removeEventListener(name){delete this[name];},focus(){document.activeElement=this;},closest:()=>null};return e;};
 const viewport=make('div');nodes.set('app-viewport',viewport);const document={hidden:false,activeElement:null,body:make('body'),head:make('head'),createElement:make,getElementById:id=>nodes.get(id),addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name]};
 const c=vm.createContext({console,URLSearchParams,location:{search:''},performance:{now:()=>now},document,window:{matchMedia:()=>({matches:reduced}),addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name]},localStorage:{getItem:key=>store.get(key)??null,removeItem:key=>store.delete(key),setItem:(key,value)=>store.set(key,String(value))},setTimeout:(fn,ms)=>{const timer={fn,at:now+ms,ms};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;}});
 if(scene)c.window.createOrbitIntroScene=()=>()=>cleanup++;
 if(cached)store.set('sb-dhtbiggamuwoqurguhib-auth-token',JSON.stringify({user:{id:'existing'}}));
 if(sound)c.window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;}resume(){return Promise.resolve();}close(){this.state='closed';closed++;return Promise.resolve();}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}},connect(){}};}createBiquadFilter(){return {frequency:{},Q:{},connect(){}};}createOscillator(){return {frequency:{},connect(){},start(){notes++;},stop(){}};}};
 vm.runInContext(read('js/orbit-introduction.js'),c);
 const tick=ms=>{const end=now+ms;for(;;){const next=timers.filter(t=>!t.cancelled&&!t.ran&&t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;now=next.at;next.ran=true;next.fn();}now=end;};
 return {c,api:c.window.OrbitIntroduction,store,nodes,events,timers,viewport,document,tick,get cleanup(){return cleanup;},get closed(){return closed;},get notes(){return notes;}};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};
test('new visitor sees one finite introduction; it restores the app without an Enter button',async()=>{
 const h=setup();h.api.boot();assert.equal(h.api.isActive(),true);assert.equal(h.viewport.inert,true);assert.doesNotMatch(h.nodes.get('orbit-introduction').innerHTML,/<button|Everything|ENTER/i);await settle();h.tick(12000);h.tick(450);await settle();assert.equal(h.api.isActive(),false);assert.equal(h.viewport.inert,false);assert.equal(h.nodes.has('orbit-introduction'),false);assert.equal(h.cleanup,1);h.api.boot();assert.equal(h.api.isActive(),false);
});
test('remembered signed-in sessions and ordinary session restoration never play the introduction',()=>{
 const h=setup({cached:true});h.api.boot();h.api.afterSignIn({id:'existing'},{interactive:false});assert.equal(h.api.isActive(),false);assert.equal(h.timers.length,0);
});
test('new account plays once, an explicit logout/sign-in replays, and account markers stay separate',async()=>{
 const h=setup();h.api.afterSignIn({id:'one'},{interactive:true});await settle();h.api.finish();h.tick(450);await settle();h.api.afterSignIn({id:'one'},{interactive:true});assert.equal(h.api.isActive(),false);
 h.api.afterSignIn({id:'one'},{interactive:true,force:true});assert.equal(h.api.isActive(),true);h.api.finish();h.tick(450);await settle();h.api.afterSignIn({id:'two'},{interactive:true});assert.equal(h.api.isActive(),true);
});
test('first visitor does not get a second introduction when signing in on the same page',async()=>{
 const h=setup();h.api.boot();await settle();h.api.finish();h.api.afterSignIn({id:'new'},{interactive:true});assert.equal(h.api.isActive(),false);h.tick(450);await settle();assert.equal(h.store.get('orbit_intro_user_v1_new'),'done');
});
test('reduced motion uses the static logo and automatically continues quickly',()=>{
 const h=setup({reduced:true});h.api.boot();assert.equal(h.nodes.get('orbit-introduction').classList.contains('is-static'),true);h.tick(1500);assert.equal(h.api.isActive(),false);assert.equal(h.nodes.has('orbit-introduction'),false);
});
test('a failed or stalled scene falls back without trapping the app; late scene loads cannot restart it',async()=>{
 const h=setup({scene:false});h.api.boot();const script=h.document.head.children[0];h.tick(2500);assert.equal(h.nodes.get('orbit-introduction').classList.contains('is-static'),true);h.tick(1950);await settle();assert.equal(h.api.isActive(),false);assert.equal(h.viewport.inert,false);let created=0;h.c.window.createOrbitIntroScene=()=>{created++;};script.onload();await settle();assert.equal(created,0);
});
test('hidden pages and incoming-call dismissal stop animation and release audio resources',async()=>{
 const h=setup({sound:true});h.api.primeAudio();assert.equal(h.notes,0);h.api.afterSignIn({id:'one'},{interactive:true});await settle();assert.ok(h.notes>0);h.document.hidden=true;h.events.visibilitychange();assert.equal(h.api.isActive(),false);h.tick(450);assert.equal(h.closed,1);assert.equal(h.cleanup,1);assert.equal(h.viewport.inert,false);
});
test('blocked autoplay does not block visual playback or automatic completion',async()=>{
 const h=setup();h.c.window.AudioContext=class{constructor(){this.state='suspended';}resume(){return Promise.reject(Error('NotAllowed'));}close(){return Promise.resolve();}};h.api.boot();await settle();assert.equal(h.api.isActive(),true);h.tick(12450);await settle();assert.equal(h.api.isActive(),false);
});
test('scene disposal cancels its frame and removes both global event listeners',()=>{
 const events={},removed=[],frames=[];let canceled;const context={};const canvas={width:0,height:0,getContext:()=>context},bloom={...canvas};
 const c=vm.createContext({window:{addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>removed.push(name)},performance:{now:()=>0},devicePixelRatio:3,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame:id=>canceled=id,Math});
 vm.runInContext(read('js/orbit-intro-scene.js'),c);const dispose=c.window.createOrbitIntroScene({clientWidth:360,clientHeight:780,querySelector:selector=>selector.includes('bloom')?bloom:canvas,classList:{add(){}}});assert.equal(canvas.width,540);dispose();assert.equal(canceled,1);assert.deepEqual(removed,['resize','pointermove']);assert.equal(canvas.width,0);
});

test('email login requests the introduction only after a successful authenticated response',async()=>{
 const h=setup();h.c.currentUser=null;h.c.showToast=()=>{};for(const id of ['auth-login-email','auth-login-pass','auth-login-btn','auth-err'])h.nodes.set(id,{value:id.includes('email')?'member@example.com':'password123',style:{}});
 vm.runInContext(read('js/ui/ui-auth.js'),h.c);let launches=0,fail=false;
 h.c.launchApp=async options=>{launches++;assert.equal(options.introduction,true);};h.c.ensureSupabase=async()=>({auth:{signInWithPassword:async()=>fail?{error:{message:'Invalid login credentials'}}:{data:{user:{id:'member'},session:{}}}}});
 await h.c.handleLogin();assert.equal(launches,1);assert.equal(h.c.currentUser.id,'member');fail=true;await h.c.handleLogin();assert.equal(launches,1);assert.match(h.nodes.get('auth-err').innerText,/Invalid email or password/);
});
test('Google callback preserves explicit logout replay intent before clearing the sign-out marker',async()=>{
 const h=setup();h.c.URL=URL;h.c.SB_URL='https://example.supabase.co';h.c.location={href:'https://orbit.example/?orbit_oauth=google&code=one-use',search:'?orbit_oauth=google&code=one-use'};h.c.window.history={replaceState(){}};h.store.set('orbit_google_pending',String(Date.now()));h.store.set('orbit_explicit_signout','true');
 vm.runInContext(read('js/ui/ui-auth.js'),h.c);let options;
 h.c.ensureSupabase=async()=>({auth:{exchangeCodeForSession:async()=>({data:{session:{user:{id:'google-member'}}}})}});h.c.launchApp=async value=>options=value;
 await h.c.orbitCompleteGoogleSignIn();assert.equal(options.introduction,true);assert.equal(options.forceIntroduction,true);assert.equal(h.store.has('orbit_explicit_signout'),false);
});
