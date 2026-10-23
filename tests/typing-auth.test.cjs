const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function harness(){
 const nodes=new Map(),storage=new Map(),timers=new Map(),events={},sent=[];let tick=100000,id=0;
 function node(key){if(!nodes.has(key)){const classes=new Set();nodes.set(key,{value:'',innerHTML:'Presence',textContent:'',dataset:{},style:{},disabled:false,focus(){},addEventListener(){},querySelector(){return null;},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}});}return nodes.get(key);}
 const c=vm.createContext({console,URL,URLSearchParams,AbortController,Date:class extends Date{static now(){return tick;}},
 setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key),setInterval(){},clearInterval(){},
 navigator:{onLine:true},document:{title:'Orbit',hidden:false,documentElement:node('root'),getElementById:node,querySelectorAll:()=>[],addEventListener:(k,fn)=>events[k]=fn},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
 location:{href:'https://orbit-messaging.vercel.app/',origin:'https://orbit-messaging.vercel.app'},
 currentUser:{id:'me'},currentRoom:'uuid-room',activeChatPeerId:'peer',isSelfChat:false,isGroupChat:false,_chatViewEpoch:1,
 globalUsersMap:new Map([['peer',{display_name:'Alex'}]]),allRoomsMap:new Map(),isUserBlocked:()=>false,
 escapeHtml:s=>String(s).replaceAll('<','&lt;'),showToast(){},launchApp:async()=>{c.launches++;},launches:0,
 resolveRoomAliases:r=>[r],SB_URL:'https://example.supabase.co',getDeterministicDMId:()=> 'dm_me_peer',getSupabase:()=>client});
 c.window=c;c.addEventListener=(k,fn)=>events[k]=fn;c.history={replaceState:(_s,_t,url)=>{c.scrubbed=url;}};
 const channels=[];const client={realtime:{setAuth:async()=>{}},removeChannel:async channel=>channel.closed=true,channel:(topic,opts)=>{const channel={topic,opts,state:'joined',on(_type,_opts,fn){this.receive=fn;return this;},subscribe(fn){this.stateChanged=fn;return this;},send:async message=>sent.push(message)};channels.push(channel);return channel;},auth:{}};
 c.ensureSupabase=async()=>client;
 return {c,node,storage,timers,events,sent,channels,client,advance:ms=>tick+=ms,load:p=>vm.runInContext(read(p),c),run:s=>vm.runInContext(s,c)};
}
test('typing uses the same private DM topic despite UUID room aliases; continuous typing refreshes without sending drafts',async()=>{
 const h=harness();h.load('js/chat/chat-realtime.js');await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);
 assert.equal(h.channels[0].topic,'orbit_typing_dm_me_peer');assert.equal(h.channels[0].opts.config.private,true);
 h.node('msg-input').value='private draft';h.c.broadcastTypingStatus();assert.equal(h.sent.length,1);
 h.advance(800);h.c.broadcastTypingStatus();assert.equal(h.sent.length,1);
 h.advance(500);h.c.broadcastTypingStatus();assert.equal(h.sent.length,2);assert.equal(JSON.stringify(h.sent).includes('private draft'),false);
 h.node('msg-input').value='';h.c.broadcastTypingStatus();assert.equal(h.sent.at(-1).payload.state,'stop');
});
test('typing ignores strangers, blocked users, self and old room signals; expires and restores the actual presence',async()=>{
 const h=harness();h.load('js/chat/chat-realtime.js');await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);
 for(const payload of [{room:'old',userId:'peer',state:'start'},{room:'dm_me_peer',userId:'stranger',state:'start'},{room:'dm_me_peer',userId:'me',state:'start'}])h.c.handleRemoteTyping(payload);
 assert.equal(h.node('chat-target-status').innerHTML,'Presence');
 h.c.handleRemoteTyping({room:'dm_me_peer',userId:'peer',state:'start'});assert.match(h.node('chat-target-status').innerHTML,/typing-dot/);
 assert.equal(h.run('activeTypingUsers.size'),1);h.c.isUserBlocked=()=>true;h.c.handleRemoteTyping({room:'dm_me_peer',userId:'peer',state:'start'});
 const expiry=[...h.timers.values()].find(t=>t.ms===4500);expiry.fn();assert.equal(h.node('chat-target-status').innerHTML,'Presence');
});
test('typing stops on background and dispose; stale subscriptions cannot change the next room',async()=>{
 const h=harness();h.load('js/chat/chat-realtime.js');await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);
 const old=h.channels[0];h.node('msg-input').value='hello';h.c.broadcastTypingStatus();h.c.document.hidden=true;h.events.visibilitychange();assert.equal(h.sent.at(-1).payload.state,'stop');
 h.c.disposeOrbitTyping();h.c.currentRoom='different';old.receive({payload:{room:'dm_me_peer',userId:'peer',state:'start'}});assert.equal(h.run('activeTypingUsers.size'),0);assert.equal(old.closed,true);
});
test('group typing uses trusted names and escapes markup; self-chat never subscribes',async()=>{
 const h=harness();h.load('js/chat/chat-realtime.js');h.c.isGroupChat=true;h.c.allRoomsMap.set('uuid-room',{participants:['me','peer']});h.c.globalUsersMap.set('peer',{display_name:'<Alex>'});await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);
 h.c.handleRemoteTyping({room:'uuid-room',userId:'peer',state:'start',username:'spoofed'});assert.match(h.node('chat-target-status').innerHTML,/&lt;Alex> is typing/);assert.doesNotMatch(h.node('chat-target-status').innerHTML,/spoofed/);
 h.c.isSelfChat=true;await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);assert.equal(h.channels.length,1);
});

test('typing waits for the old subscription to leave before rejoining the same topic',async()=>{
 const h=harness();h.load('js/chat/chat-realtime.js');await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);
 let release;h.client.removeChannel=()=>new Promise(resolve=>release=resolve);
 const joining=h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);await Promise.resolve();assert.equal(h.channels.length,1);
 release();await joining;assert.equal(h.channels.length,2);
});
test('typing reconnects after channel failure and ignores retry callbacks after room changes',async()=>{
 const h=harness();h.load('js/chat/chat-realtime.js');await h.c.setupOrbitTypingChannel(h.client,'uuid-room',1);
 h.channels[0].state='closed';h.channels[0].stateChanged('CHANNEL_ERROR');
 const retry=[...h.timers.values()].find(t=>t.ms===1000);assert.ok(retry);retry.fn();
 for(let i=0;i<10;i++)await Promise.resolve();assert.equal(h.channels.length,2);
 h.channels[1].stateChanged('TIMED_OUT');h.c.currentRoom='other';
 for(const t of h.timers.values())if(t.ms<8000)t.fn();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(h.channels.length,2);
});
test('full draft storage does not suppress typing signals',()=>{
 const h=harness();h.load('js/chat/chat-feed.js');let signals=0;
 h.c.updateDynamicActionButtons=()=>{};h.c.hideMentionAutocomplete=()=>{};h.c.broadcastTypingStatus=()=>signals++;
 h.c.localStorage.setItem=()=>{throw new Error('Quota exceeded');};h.c.handleChatInputText({value:'hello'});assert.equal(signals,1);
});
test('an expired hourly token with a refresh token restores the remembered shell without a network wait',async()=>{
 const h=harness();h.load('js/ui/ui-auth.js');h.storage.set('sb-example-auth-token',JSON.stringify({user:{id:'me'},expires_at:1,refresh_token:'test-refresh'}));
 h.c.ensureSupabase=()=>{throw new Error('Must refresh in background');};await h.c.checkExistingSession();assert.equal(h.c.launches,1);
 h.storage.set('orbit_explicit_signout','true');await h.c.checkExistingSession();assert.equal(h.c.launches,1);
});
test('password reset email requests use the exact production recovery callback and prevent duplicate sends',async()=>{
 const h=harness();h.load('js/ui/ui-auth.js');let requests=0,args;h.client.auth.resetPasswordForEmail=async(...a)=>{requests++;args=a;return {};};h.node('forgot-email-input').value='user@example.com';
 await h.c.handleSendForgotOtp();assert.equal(args[1].redirectTo,'https://orbit-messaging.vercel.app/?orbit_auth=recovery');await h.c.handleSendForgotOtp();assert.equal(requests,1);
 assert.match(h.node('forgot-desc-text').textContent,/If this email has an Orbit account/);
});
test('verified recovery opens the password form before cached session restore; successful update clears signout and password inputs',async()=>{
 const h=harness();h.load('js/ui/ui-auth.js');h.c.location.href+='?orbit_auth=recovery&code=single-use';h.storage.set('orbit_explicit_signout','true');
 h.client.auth.exchangeCodeForSession=async code=>{assert.equal(code,'single-use');assert.equal(h.c.scrubbed,'/');return {data:{session:{user:{id:'reset-user'}}}};};
 h.client.auth.getSession=async()=>({data:{session:{user:{id:'reset-user'}}}});let updates=0;h.client.auth.updateUser=async()=>{updates++;return {data:{user:{id:'reset-user'}}};};
 await h.c.checkExistingSession();assert.equal(h.c.launches,0);assert.equal(h.node('forgot-step-2').classList.contains('hide'),false);
 h.node('forgot-new-pass-input').value='Example123';h.node('forgot-confirm-pass-input').value='Example123';await h.c.handleVerifyForgotOtpAndReset();assert.equal(updates,1);assert.equal(h.c.launches,1);assert.equal(h.storage.has('orbit_explicit_signout'),false);assert.equal(h.node('forgot-new-pass-input').value,'');
});
test('expired, missing or failed recovery never permits a password update and does not fall back to email OTP',async()=>{
 const h=harness();h.load('js/ui/ui-auth.js');let updates=0,verifications=0;h.client.auth.updateUser=async()=>updates++;h.client.auth.verifyOtp=async()=>verifications++;
 h.c.location.href+='?orbit_auth=recovery&error=access_denied';await h.c.checkExistingSession();assert.match(h.node('forgot-err').textContent,/expired/);
 h.node('forgot-new-pass-input').value='Example123';h.node('forgot-confirm-pass-input').value='Example123';await h.c.handleVerifyForgotOtpAndReset();assert.equal(updates,0);assert.equal(verifications,0);assert.equal(h.c.launches,0);
});
test('recovery token hash is recovery-only and changing accounts before update is rejected',async()=>{
 const h=harness();h.load('js/ui/ui-auth.js');h.c.location.href+='?orbit_auth=recovery&type=recovery&token_hash=one-use';
 h.client.auth.verifyOtp=async args=>{assert.equal(args.type,'recovery');assert.equal(args.token_hash,'one-use');return {data:{session:{user:{id:'reset-user'}}}};};h.client.auth.getSession=async()=>({data:{session:{user:{id:'other'}}}});
 h.client.auth.updateUser=async()=>{throw Error('Must not update another account');};await h.c.checkExistingSession();h.node('forgot-new-pass-input').value='Example123';h.node('forgot-confirm-pass-input').value='Example123';await h.c.handleVerifyForgotOtpAndReset();assert.match(h.node('forgot-err').innerText,/session has changed/);
});
test('closing recovery cancels its local session and clears passwords',async()=>{
 const h=harness();h.load('js/ui/ui-auth.js');h.c.location.href+='?orbit_auth=recovery&code=valid';h.client.auth.exchangeCodeForSession=async()=>({data:{session:{user:{id:'reset-user'}}}});let signouts=0;h.client.auth.signOut=async options=>{assert.equal(options.scope,'local');signouts++;};await h.c.checkExistingSession();h.node('forgot-new-pass-input').value='private';await h.c.closeForgotPasswordModal();assert.equal(signouts,1);assert.equal(h.node('forgot-new-pass-input').value,'');
});

const api=require('../api/news.js');
test('news parser cleans encoded Google HTML and picks an actual higher-resolution publisher image',()=>{
 const date=new Date().toUTCString();const xml=`<item><title>Article</title><link>https://example.com/story</link><pubDate>${date}</pubDate><description>&lt;a href=&quot;https://example.com/story&quot;&gt;Real story&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color=&quot;gray&quot;&gt;Publisher&lt;/font&gt;</description><media:content width="140" url="https://example.com/small.jpg"/><media:content width="640" url="https://example.com/actual.jpg?a=1&amp;b=2"/></item>`;
 const rows=api.parseFeed(xml,'global','Publisher');assert.equal(rows[0].body,'Real story Publisher');assert.equal(rows[0].img,'https://example.com/actual.jpg?a=1&b=2');assert.equal(rows[0].link,'https://example.com/story');
 const embedded=xml.replace(/<media:content[^>]*\/>/g,'').replace(/<description>[\s\S]*?<\/description>/,'<description><![CDATA[<img src="https://example.com/embedded.jpg">Description]]></description>');assert.equal(api.parseFeed(embedded,'global','Publisher')[0].img,'https://example.com/embedded.jpg');
});
test('news reader cleans old cached HTML and constrains long text on narrow screens',()=>{
 const h=harness();h.c.DOMParser=class{parseFromString(s){return {body:{textContent:s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/<[^>]*>/g,' ')}};}};h.c.liveNewsCache={global:[{id:'old',title:'Headline',source:'Publisher',pubDate:new Date().toISOString(),link:'https://example.com/story',body:'&lt;a href=&quot;https://example.com/long&quot;&gt;Actual summary&lt;/a&gt;',img:''}]};h.c.activeReadingNews=null;h.node('news-reader-img').removeAttribute=()=>{};h.load('js/ui/ui-navigation.js');h.c.openNewsReader('old');assert.equal(h.node('news-reader-body').innerText,'Actual summary');assert.doesNotMatch(h.node('news-reader-body').innerText,/<a|href=/);assert.match(read('style.css'),/#news-reader-title,#news-reader-meta,#news-reader-body[^}]*overflow-wrap:anywhere/);
});
