import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const normalize=(value:unknown):any[]=>{
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{return [];}}
 return (Array.isArray(value)?value:[]).map(item=>{if(typeof item==='string'){try{return JSON.parse(item);}catch{return null;}}return item;}).filter(Boolean);
};
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const allowedOrigin=origin==='https://orbit-messaging.vercel.app'||/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
 const headers={'Access-Control-Allow-Origin':allowedOrigin?origin:'https://orbit-messaging.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,x-orbit-webhook-secret,x-orbit-user-token','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store, private, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};
 const fail=(message:string,status:number)=>Response.json({error:message},{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return fail('Method not allowed',405);
 try{
  const body=await req.json();
  // Service-only relocation keeps previously shared one-time photos private.
  if(body.action==='migrate'){
   const secret=Deno.env.get('ORBIT_PUSH_WEBHOOK_SECRET');
   if(!secret||req.headers.get('x-orbit-webhook-secret')!==secret)return fail('Unauthorized',401);
   const {data:rows,error}=await db.rpc('orbit_legacy_private_photos');
   if(error)return fail('Migration lookup: '+error.message,500);
   let moved=0;
   for(const row of rows||[]){
    const items=normalize(row.attachments);let changed=false;
    for(const [index,item] of items.entries()){
     if(!item.view_once||item.storage_bucket==='orbit-view-once')continue;
     const oldPath=item.storage_path||String(item.url||'').split('/chat-assets/')[1]?.split('?')[0];
     if(!oldPath)continue;
     const path=`${row.sender_id}/${row.id}_${index}.jpg`;
     const result=await db.storage.from('chat-assets').move(oldPath,path,{destinationBucket:'orbit-view-once'});
     if(result.error){const saved=await db.storage.from('orbit-view-once').download(path);if(saved.error)return fail('Photo relocation: '+result.error.message,500);}
     items[index]={...item,url:`orbit-once://${row.id}`,storage_bucket:'orbit-view-once',storage_path:path,view_once:true};changed=true;moved++;
    }
    if(changed){const result=await db.from('messages').update({attachments:items.map(item=>JSON.stringify(item)),updated_at:new Date().toISOString()}).eq('id',row.id);if(result.error)throw result.error;}
   }
   return Response.json({scanned:rows?.length||0,moved},{headers});
  }
  // The public project key passes the legacy gateway; the user's JWT is
  // independently verified by Auth, supporting both HS256 and ECC sessions.
  const jwt=req.headers.get('x-orbit-user-token')||req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!jwt)return fail('Sign in to open this photo.',401);
  const {data:auth,error:authError}=await db.auth.getUser(jwt);
  if(authError||!auth.user)return fail('Sign in to open this photo.',401);
  if(!/^[0-9a-f-]{36}$/i.test(body.messageId||''))return fail('Invalid photo.',400);
  const {data:message,error}=await db.from('messages').select('id,sender_id,attachments').eq('id',body.messageId).single();
  if(error||!message)return fail('Photo unavailable.',404);
  const attachment=normalize(message.attachments).find(item=>item.view_once&&item.storage_bucket==='orbit-view-once');
  if(!attachment?.storage_path||!attachment.storage_path.startsWith(`${message.sender_id}/`))return fail('Photo unavailable.',404);
  // Download internally before claiming: a missing file does not consume a view.
  const {data:file,error:fileError}=await db.storage.from('orbit-view-once').download(attachment.storage_path);
  if(fileError||!file)return fail('Photo unavailable.',404);
  const {data:claimed,error:claimError}=await db.rpc('orbit_consume_private_photo',{message_key:message.id,viewer:auth.user.id});
  if(claimError)throw claimError;
  if(!claimed)return fail('This photo has already been opened or is unavailable.',410);
  return new Response(file,{headers:{...headers,'Content-Type':file.type||'image/jpeg','Content-Disposition':'inline; filename="orbit-photo.jpg"'}});
 }catch{return fail('Could not open photo. Please try again.',500);}
});
