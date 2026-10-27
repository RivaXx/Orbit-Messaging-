const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {stripTypeScriptTypes} = require('node:module');
const root = path.join(__dirname,'..');
function uiContext(saved = {}) {
    const store = new Map(Object.entries(saved));
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) {
            const props = new Map(), classes = new Set();
            elements.set(id,{style:{setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k),getPropertyValue:k=>props.get(k)},
                classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
                value:'',innerHTML:'',addEventListener:()=>{},getAttribute:()=>'',setAttribute:()=>{},getBoundingClientRect:()=>({left:14,width:440}),
                parentElement:{clientWidth:640,getBoundingClientRect:()=>({left:0})},querySelector:()=>null,querySelectorAll:()=>[]});
        }
        return elements.get(id);
    }
    const document = {documentElement:element('root'),body:element('body'),getElementById:element,
        querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
    const context = vm.createContext({document,window:{innerWidth:640,addEventListener:()=>{}},navigator:{},
        localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
        showToast:()=>{},console,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},currentUser:{id:'user'},isPrimaryAdmin:()=>false,
        getGroupPrivacyPref:()=> 'contacts',requestAnimationFrame:()=>0});
    vm.runInContext(fs.readFileSync(path.join(root,'js/ui/ui-modals.js'),'utf8'),context);
    return {context,document,store};
}
test('accent applies to root and body and survives startup',()=>{
    const {context,document,store}=uiContext();
    context.setLiquidAccent('#00E676',true);
    for(const scope of [document.body,document.documentElement]) {
        assert.equal(scope.style.getPropertyValue('--accent'),'#00E676');
        assert.match(scope.style.getPropertyValue('--accent-gradient'),/#00E676/);
    }
    assert.equal(store.get('orbit_selected_color'),'#00E676');
    const restored=uiContext(Object.fromEntries(store));
    restored.context.initTheme();
    assert.equal(restored.document.body.style.getPropertyValue('--accent'),'#00E676');
});
test('accent foreground and theme-specific ink stay readable across the palette',()=>{
    const {context,document}=uiContext();
    const lum=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
    for(const color of ['#FFD700','#ae43df','#000000','#ffffff','#007aff','#ff3b30','#00E676']) {
        context.setLiquidAccent(color,true);
        const style=document.body.style;
        assert.ok(ratio(color,style.getPropertyValue('--accent-on'))>=4.5,color+' button ink');
        assert.ok(ratio('#0e141e',style.getPropertyValue('--accent-ink-dark'))>=4.5,color+' dark text');
        assert.ok(ratio('#f5f9ff',style.getPropertyValue('--accent-ink-light'))>=4.5,color+' light text');
    }
});
test('manual glass sliders override preset and retain zero after reload',()=>{
    const {context,store}=uiContext();
    context.setLiquidBlur('ultra');
    context.handleBlurSlider('0'); context.handleOpacitySlider('42'); context.handleGlowSlider('0');
    assert.equal(store.has('orbit_pref_glass_preset'),false);
    const restored=uiContext(Object.fromEntries(store)); restored.context.initTheme();
    assert.equal(restored.document.documentElement.style.getPropertyValue('--blur-deep'),'none');
    assert.equal(restored.document.documentElement.style.getPropertyValue('--glass-card'),'rgba(18, 18, 24, 0.42)');
    assert.equal(restored.store.get('orbit_pref_glow'),'0');
});
test('water intensity survives reload and performance preset disables refraction',()=>{
    const {context,store}=uiContext();
    context.handleRefractionSlider('82');
    const restored=uiContext(Object.fromEntries(store)); restored.context.initTheme();
    assert.equal(restored.store.get('orbit_pref_refraction'),'82');
    restored.context.setLiquidBlur('performance');
    assert.equal(restored.store.get('orbit_pref_refraction'),'0');
});

test('existing custom slider values are not overwritten by legacy preset',()=>{
    const {context,store}=uiContext({orbit_pref_glass_preset:'ultra',orbit_pref_blur:'7',orbit_pref_opacity:'51',orbit_pref_glow:'9'});
    context.initTheme(); assert.equal(store.get('orbit_pref_blur'),'7'); assert.equal(store.get('orbit_pref_opacity'),'51');
});
test('cleanup drops old cached messages but preserves newer and unsent messages',()=>{
    const {context}=uiContext();
    context.currentRoom = null;
    context.messageCache = new Map([['room',[
        {id:'old',created_at:'2026-10-01T00:00:00Z'},
        {id:'new',created_at:'2026-10-14T12:00:00Z'},
        {id:'pending',created_at:'2026-10-01T00:00:00Z',status:'queued'}
    ]]]);
    context.applyOrbitCleanupCutoff('2026-10-14T10:00:00Z');
    assert.deepEqual(Array.from(context.messageCache.get('room'),m=>m.id),['new','pending']);
});

async function edgeContext({email='rivaldo.a.rodrigues@gmail.com',authError=false,secret,enabled=false,queue=[],photos=[],removeError=false,ready=true}={}) {
    const helpers=await import('../supabase/functions/orbit-admin-cleanup/cleanup.ts');
    const calls={enqueue:0,removed:[],deleted:[],updates:[]};
    const remaining=[...queue],jobId='11111111-1111-4111-8111-111111111111';
    function query(table) {
        const q={select:(_s,opts)=>{q.head=opts?.head;return q;},eq:()=>q,order:()=>q,limit:()=>q,
            update:val=>{calls.updates.push(val);return q;},delete:()=>{calls.deleted.push(table);return q;},
            single:async()=>({data:{enabled},error:null}),then:resolve=>resolve({data:table==='orbit_cleanup_queue'?queue:[],count:removeError?queue.length:0,error:null})};
        return q;
    }
    const db={auth:{getUser:async()=>({data:{user:authError?null:{email}},error:authError})},from:query,
        storage:{from:bucket=>({remove:async paths=>{calls.removed.push({bucket,paths});return {error:removeError?{message:'retry'}:null};}})},
        rpc:(name,args)=>{
            if(name==='orbit_begin_cleanup'){calls.enqueue++;return Promise.resolve({data:[{id:jobId}],error:null});}
            if(name==='orbit_cleanup_batch')return Promise.resolve({data:remaining.slice(0,100),error:null});
            if(name==='orbit_finish_cleanup_batch'){for(const id of args.removed_keys){const i=remaining.findIndex(r=>r.id===id);if(i>=0)remaining.splice(i,1);calls.deleted.push(id);}return Promise.resolve({error:null});}
            if(name==='orbit_cleanup_job_status')return Promise.resolve({data:{job_id:jobId,messages:3,files:queue.length-remaining.length,total_files:queue.length,pending:remaining.length,complete:!remaining.length},error:null});
            if(name==='orbit_cleanup_schedule_ready')return Promise.resolve({data:ready,error:null});
            return {range:async(offset)=>({data:offset?[]:name==='orbit_cleanup_protected_urls'?photos:[],error:null})};
        }};
    let handler;
    const context=vm.createContext({...helpers,createClient:()=>db,URL,Response,Date,Set,Map,crypto,console:{error:()=>{}},
        Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://project.supabase.co':key==='ORBIT_CLEANUP_SECRET'?secret:'server-key'},serve:fn=>handler=fn}});
    let source=fs.readFileSync(path.join(root,'supabase/functions/orbit-admin-cleanup/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');
    vm.runInContext(stripTypeScriptTypes(source),context);
    return {calls,request:async(body,headers={'x-orbit-user-token':'test-token'})=>{
        const response=await handler(new Request('https://project.supabase.co',{method:'POST',headers,body:JSON.stringify(body)}));
        return {status:response.status,data:await response.json()};
    }};
}
test('only exact primary admin is accepted; spoofed or invalid sessions cannot enqueue cleanup',async()=>{
    for(const options of [{email:'rivacolony@gmail.com'},{email:'someone@example.com'},{authError:true}]) {
        const edge=await edgeContext(options); const result=await edge.request({action:'clear',confirm:'CLEAR_ALL_MESSAGES'});
        assert.ok([401,403].includes(result.status)); assert.equal(edge.calls.enqueue,0);
    }
});
test('manual cleanup requires explicit destructive confirmation',async()=>{
    const edge=await edgeContext(); assert.equal((await edge.request({action:'clear'})).status,400); assert.equal(edge.calls.enqueue,0);
});
test('scheduled cleanup rejects missing secrets and respects disabled switch',async()=>{
    let edge=await edgeContext(); assert.equal((await edge.request({action:'scheduled'})).status,401);
    edge=await edgeContext({secret:'server-secret',enabled:false});
    assert.equal((await edge.request({action:'scheduled'},{'x-orbit-cleanup-secret':'server-secret'})).data.skipped,true);
    assert.equal(edge.calls.enqueue,0);
});
test('scheduled cleanup cannot be enabled without a cron job',async()=>{
    const edge=await edgeContext({ready:false}); assert.equal((await edge.request({action:'schedule',enabled:true})).status,409);
    assert.equal(edge.calls.updates.length,0);
});
test('clear drains more than one page across all five buckets, using only server paths',async()=>{
    const buckets=['chat-assets','orbit-view-once','voice-notes','files','uploads'];
    const queue=Array.from({length:325},(_,i)=>({id:i+1,bucket:buckets[i%5],path:'owner/media-'+i}));
    const edge=await edgeContext({queue});
    const result=await edge.request({action:'clear',confirm:'CLEAR_ALL_MESSAGES',bucket:'avatars',path:'forged'});
    assert.equal(result.status,200); assert.equal(result.data.messages,3);
    assert.equal(result.data.files,325);assert.equal(result.data.complete,true);assert.equal(edge.calls.deleted.length,325);
    assert.ok(edge.calls.removed.every(r=>r.bucket!=='avatars'&&!r.paths.includes('forged')));
});
test('failed storage deletion remains queued and is reported pending',async()=>{
    const edge=await edgeContext({removeError:true,queue:[{id:1,bucket:'files',path:'owner/chat.jpg'}]});
    const result=await edge.request({action:'clear',confirm:'CLEAR_ALL_MESSAGES'});
    assert.equal(result.data.pending,1); assert.equal(edge.calls.deleted.length,0);
    assert.equal(result.data.complete,false);assert.equal(result.data.retry,true);
    await edge.request({action:'continue',job_id:result.data.job_id});assert.equal(edge.calls.enqueue,1);
});
