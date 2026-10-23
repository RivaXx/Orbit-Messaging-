import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import webpush from 'npm:web-push@3.6.7';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const publicKey=Deno.env.get('ORBIT_VAPID_PUBLIC_KEY'),privateKey=Deno.env.get('ORBIT_VAPID_PRIVATE_KEY');
if(publicKey&&privateKey)webpush.setVapidDetails('https://orbit-messaging.vercel.app/',publicKey,privateKey);
const allowedPushHost=(host:string)=>['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com'].includes(host)||/^[a-z0-9-]+\.(notify|notifications)\.windows\.com$/i.test(host);
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const secret=Deno.env.get('ORBIT_PUSH_WEBHOOK_SECRET');
 if(!secret||req.headers.get('x-orbit-webhook-secret')!==secret)return new Response('Unauthorized',{status:401});
 if(!publicKey||!privateKey)return new Response('Push keys unavailable',{status:503});
 try{
  const payload=await req.json();let event:any=null,alert:any=null,recipients:string[]=[],room:string|null=null,isCall=false;
  if(uuid(payload.eventId)){
   const {data,error}=await db.rpc('orbit_claim_notification',{event_id:payload.eventId});if(error)throw error;event=data?.[0];if(!event)return Response.json({sent:0});
   if(event.kind==='call'||event.kind==='call_stop'){
    const {data:call}=await db.from('orbit_calls').select('id,room,caller_id,callee_id,caller_name,state,created_at').eq('id',event.source_id).single();
    if(!call||call.callee_id!==event.user_id)throw Error('Call unavailable');
    // Member verification is independent of the message history record.
    const {data:members}=await db.rpc('orbit_push_call_recipient',{call_key:call.id});
    if(!members?.some((r:any)=>r.user_id===call.callee_id)){await db.from('orbit_notification_outbox').update({sent_at:new Date().toISOString()}).eq('id',event.id);return Response.json({sent:0});}
    isCall=true;room=call.room;recipients=[call.callee_id];
    const ended=call.state!=='ringing'||Date.parse(call.created_at)<Date.now()-45000;
    alert={title:call.caller_name||'Orbit call',body:ended?(call.state==='connecting'||call.state==='connected'?'Call answered':'Missed or ended voice call'):'Incoming voice call · Open Orbit to answer',isCall:true,ended,callId:call.id,roomId:call.room,timestamp:Date.parse(ended?event.version:call.created_at),tag:'orbit-call-'+call.id};
   }else if(event.kind==='note'){
    const {data:note}=await db.from('secure_notes').select('id,user_id,title,reminder_at,archived,deleted_at').eq('id',event.source_id).single();
    if(!note||note.user_id!==event.user_id||note.archived||note.deleted_at||Date.parse(note.reminder_at)!==Date.parse(event.version)){
     await db.from('orbit_notification_outbox').update({sent_at:new Date().toISOString()}).eq('id',event.id);return Response.json({sent:0});
    }
    recipients=[note.user_id];alert={title:'Note reminder',body:note.title||'Your note is due',noteId:note.id,timestamp:Date.parse(note.reminder_at),tag:'orbit-note-'+event.id};
   }else if(event.kind==='message'){
    const messageKey=String(event.source_id).split(':')[0];
    const {data:message,error}=await db.from('messages').select('id,room,sender_id,username,type,created_at,deleted_at').eq('id',messageKey).single();
    if(error)throw error;
    const {data:members,error:membershipError}=await db.rpc('orbit_push_message_recipients',{message_id:messageKey});if(membershipError)throw membershipError;
    if(!message||message.deleted_at||message.type==='call'||!members?.some((r:any)=>r.user_id===event.user_id)){
     await db.from('orbit_notification_outbox').update({sent_at:new Date().toISOString()}).eq('id',event.id);return Response.json({sent:0});
    }
    room=message.room;recipients=[event.user_id];alert={title:message.username||'New message',body:'You have a new message.',roomId:room,msgId:message.id,timestamp:Date.parse(message.created_at),tag:'orbit-message-'+message.id};
   }else return new Response('Invalid event',{status:400});
  }else{
   if(payload.type!=='INSERT'||payload.table!=='messages'||payload.schema!=='public'||!uuid(payload.record?.id))return new Response('Invalid event',{status:400});
   const {data:message,error}=await db.from('messages').select('id,room,sender_id,username,type,created_at').eq('id',payload.record.id).single();if(error||!message)return new Response('Message unavailable',{status:404});
   // Calls use the dedicated outbox, never a generic message chime at hangup.
   if(message.type==='call')return Response.json({sent:0});
   const {data,error:recipError}=await db.rpc('orbit_push_message_recipients',{message_id:message.id});if(recipError)throw recipError;recipients=(data||[]).map((r:any)=>r.user_id);room=message.room;
   alert={title:message.username||'New message',body:'You have a new message.',roomId:room,msgId:message.id,timestamp:Date.parse(message.created_at),tag:'orbit-message-'+message.id};
  }
  if(!recipients.length)return Response.json({sent:0});
  const {data:devices,error}=await db.from('orbit_push_subscriptions').select('*').in('user_id',recipients);if(error)throw error;
  const completed=event?await db.from('orbit_notification_deliveries').select('endpoint').eq('event_id',event.id):{data:[]};
  if(completed.error)throw completed.error;
  const delivered=new Set((completed.data||[]).map((row:any)=>row.endpoint));
  let sent=0,failed=0;
  await Promise.all((devices||[]).map(async device=>{
   if(delivered.has(device.endpoint))return;
   if(room&&(device.muted_rooms||[]).includes(room))return;
   let url;try{url=new URL(device.endpoint);}catch{return;}
   if(url.protocol!=='https:'||url.username||url.password||url.port||!allowedPushHost(url.hostname))return;
   const body=JSON.stringify({...alert,title:device.previews?alert.title:'Orbit Messenger',body:device.previews?alert.body:alert.noteId?'Your note reminder is due':isCall?alert.body:'You have a new message.'});
   for(let attempt=0;attempt<2;attempt++){
    try{await webpush.sendNotification(device.subscription,body,{TTL:isCall&&!alert.ended?Math.max(1,Math.floor((alert.timestamp+45000-Date.now())/1000)):isCall?3600:86400,urgency:'high',topic:isCall?alert.callId.replaceAll('-',''):undefined,timeout:6500});if(event){const saved=await db.from('orbit_notification_deliveries').upsert({event_id:event.id,endpoint:device.endpoint},{onConflict:'event_id,endpoint'});if(saved.error)throw saved.error;}sent++;return;}
    catch(error){if(error.statusCode===404||error.statusCode===410){await db.from('orbit_push_subscriptions').delete().eq('endpoint',device.endpoint);return;}if(attempt===0&&(!error.statusCode||error.statusCode===429||error.statusCode>=500)){await new Promise(resolve=>setTimeout(resolve,400));continue;}failed++;console.warn('Push delivery failed:',error.statusCode||'network');return;}
   }
  }));
  if(event&&!failed)await db.from('orbit_notification_outbox').update({sent_at:new Date().toISOString()}).eq('id',event.id);
  return Response.json({sent,failed});
 }catch(_){return new Response('Delivery failed',{status:500});}
});
