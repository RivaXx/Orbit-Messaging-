const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
function fixture(kind='call'){
 const now=new Date().toISOString(),id='11111111-1111-4111-8111-111111111111',event={id,kind,source_id:kind==='note'?'19':id,user_id:'callee',version:now},sent=[],writes=[];let handler,attempts=0,transient=false,allow=true;
 const rows={orbit_calls:{id,room:'room',caller_id:'caller',callee_id:'callee',caller_name:'Alex',state:'ringing',created_at:now},messages:{id,room:'room',sender_id:'caller',username:'Alex',type:'text',created_at:now},orbit_notification_deliveries:[],secure_notes:{id:'19',user_id:'callee',title:'Secret note',reminder_at:now},orbit_push_subscriptions:[{endpoint:'https://fcm.googleapis.com/test',subscription:{endpoint:'https://fcm.googleapis.com/test'},previews:true,muted_rooms:[]}]};
 const db={rpc:async(name)=>({data:name==='orbit_claim_notification'?[event]:name==='orbit_push_call_recipient'?(allow?[{user_id:'callee'}]:[]):[{user_id:'callee'}]}),from(table){const q={select(){return q;},eq(){return q;},in(){return q;},single:async()=>({data:rows[table]}),upsert(patch){writes.push({table,patch});return q;},update(patch){writes.push({table,patch});return q;},delete(){return q;},then(resolve){return Promise.resolve({data:rows[table]||[],error:null}).then(resolve);}};return q;}};
 let src=fs.readFileSync(require('node:path').join(__dirname,'../supabase/functions/orbit-message-push/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');src=stripTypeScriptTypes(src,{mode:'transform'});
 const c=vm.createContext({console,Date,JSON,URL,Request,Response,setTimeout:fn=>{fn();return 1;},Deno:{env:{get:key=>key==='ORBIT_PUSH_WEBHOOK_SECRET'?'secret':'test'},serve:fn=>handler=fn},createClient:()=>db,webpush:{setVapidDetails(){},sendNotification:async(_sub,body,options)=>{attempts++;if(transient&&attempts===1)throw {statusCode:503};sent.push({body:JSON.parse(body),options});}}});vm.runInContext(src,c);
 const request=(body,secret='secret')=>handler(new Request('https://edge.example',{method:'POST',headers:{'x-orbit-webhook-secret':secret,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {request,event,id,rows,sent,writes,setTransient:v=>transient=v,setAllowed:v=>allow=v};
}
test('push endpoint rejects untrusted requests and authorizes calls independently of read receipts',async()=>{
 const f=fixture();assert.equal((await f.request({eventId:f.id},'wrong')).status,401);assert.equal((await f.request({table:'messages'})).status,400);const response=await f.request({eventId:f.id});assert.equal(response.status,200);assert.equal(f.sent[0].body.isCall,true);assert.equal(f.sent[0].body.callId,f.id);assert.equal(f.sent[0].options.urgency,'high');assert.equal(f.sent[0].options.topic.length,32);
 const denied=fixture();denied.setAllowed(false);await denied.request({eventId:denied.id});assert.equal(denied.sent.length,0);
});
test('transient push failures retry, expired subscriptions are not mistaken for delivery',async()=>{const f=fixture();f.setTransient(true);await f.request({eventId:f.id});assert.equal(f.sent.length,1);assert.ok(f.writes.some(row=>row.patch.sent_at));});

test('message outbox retries only devices without confirmed push acceptance',async()=>{
 const f=fixture('message');await f.request({eventId:f.id});assert.equal(f.sent[0].body.msgId,f.id);assert.equal(f.sent[0].options.urgency,'high');
 assert.ok(f.writes.some(row=>row.table==='orbit_notification_deliveries'&&row.patch.event_id===f.id));
 f.rows.orbit_notification_deliveries=[{endpoint:f.rows.orbit_push_subscriptions[0].endpoint}];await f.request({eventId:f.id});assert.equal(f.sent.length,1);
 const read=fixture('message');read.rows.messages.deleted_at=new Date().toISOString();await read.request({eventId:read.id});assert.equal(read.sent.length,0);
});
test('ended calls carry a silent stop event and notes preserve private previews',async()=>{
 const f=fixture('call_stop');f.rows.orbit_calls.state='ended';await f.request({eventId:f.id});assert.equal(f.sent[0].body.ended,true);
 const n=fixture('note');n.rows.orbit_push_subscriptions[0].previews=false;await n.request({eventId:n.id});assert.equal(n.sent[0].body.noteId,'19');assert.equal(n.sent[0].body.title,'Orbit Messenger');assert.ok(!n.sent[0].body.body.includes('Secret'));
 const old=fixture('note');old.rows.secure_notes.reminder_at='2020-01-01';await old.request({eventId:old.id});assert.equal(old.sent.length,0);
});

test('push rejects mismatched subscription endpoints and non-provider destinations',async()=>{
 const f=fixture('message');f.rows.orbit_push_subscriptions[0].subscription.endpoint='http://127.0.0.1/internal';await f.request({eventId:f.id});assert.equal(f.sent.length,0);
 const g=fixture('message');g.rows.orbit_push_subscriptions[0].endpoint=g.rows.orbit_push_subscriptions[0].subscription.endpoint='https://attacker.example/push';await g.request({eventId:g.id});assert.equal(g.sent.length,0);
});
