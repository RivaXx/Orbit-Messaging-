import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { isCleanupAdmin } from './cleanup.ts';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const allowed=origin==='https://orbit-messaging.vercel.app'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
 const headers={'Access-Control-Allow-Origin':allowed?origin:'https://orbit-messaging.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,x-orbit-user-token,x-orbit-cleanup-secret','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const body=await req.json(),scheduled=body.action==='scheduled';
  if(scheduled){
   const secret=Deno.env.get('ORBIT_CLEANUP_SECRET');
   if(!secret||req.headers.get('x-orbit-cleanup-secret')!==secret)return reply({error:'Unauthorized'},401);
  }else{
   const token=req.headers.get('x-orbit-user-token')||req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
   if(!token)return reply({error:'Sign in again'},401);
   const {data,error}=await db.auth.getUser(token);
   if(error||!data.user)return reply({error:'Session expired. Sign in again.'},401);
   if(!isCleanupAdmin(data.user.email))return reply({error:'Primary admin only'},403);
  }
  const rpc=async(name:string,args?:Record<string,unknown>)=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;};
  if(body.action==='settings'){
   const r=await db.from('orbit_cleanup_settings').select('enabled').eq('id',true).single();if(r.error)throw r.error;
   const active=await db.from('orbit_cleanup_jobs').select('id').is('finished_at',null).maybeSingle();if(active.error)throw active.error;
   return reply({...r.data,job:active.data?await rpc('orbit_cleanup_job_status',{job_key:active.data.id}):null});
  }
  if(body.action==='schedule'){
   if(typeof body.enabled!=='boolean')return reply({error:'Invalid setting'},400);
   if(body.enabled&&!await rpc('orbit_cleanup_schedule_ready'))return reply({error:'Configure the daily cleanup cron before enabling it.'},409);
   const r=await db.from('orbit_cleanup_settings').update({enabled:body.enabled}).eq('id',true);if(r.error)throw r.error;
   return reply({enabled:body.enabled});
  }
  let jobId:string;
  if(body.action==='continue'){
   if(typeof body.job_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.job_id))return reply({error:'Invalid job'},400);
   jobId=body.job_id;
  }else{
   if(!scheduled&&(body.action!=='clear'||body.confirm!=='CLEAR_ALL_MESSAGES'))return reply({error:'Explicit cleanup confirmation required'},400);
   if(scheduled){const r=await db.from('orbit_cleanup_settings').select('enabled').eq('id',true).single();if(r.error)throw r.error;if(!r.data.enabled)return reply({skipped:true});}
   const cutoff=new Date(Date.now()-(scheduled?10*86400000:0)).toISOString();
   const job=await rpc('orbit_begin_cleanup',{job_mode:scheduled?'older':'all',requested_cutoff:cutoff});
   jobId=(Array.isArray(job)?job[0]:job)?.id;if(!jobId)throw Error('Cleanup job could not start');
  }
  const deadline=Date.now()+18000;let retry=false;
  while(Date.now()<deadline){
   const lease=crypto.randomUUID(),batch=await rpc('orbit_cleanup_batch',{job_key:jobId,lease_key:lease});
   if(!batch?.length)break;
   const removed:number[]=[];
   // Remove actual bytes via Storage API, never SQL-delete storage metadata.
   // Only the server snapshot supplies paths, with profile/live-object rechecks.
   for(const bucket of new Set<string>(batch.map((item:any)=>item.bucket))){
    const items=batch.filter((item:any)=>item.bucket===bucket);
    const r=await db.storage.from(bucket).remove(items.map((item:any)=>item.path));
    if(r.error){console.error('Cleanup storage retry',bucket,r.error.message);retry=true;break;}
    removed.push(...items.map((item:any)=>item.id));
   }
   await rpc('orbit_finish_cleanup_batch',{job_key:jobId,lease_key:lease,removed_keys:removed});
   if(retry)break;
  }
  const status=await rpc('orbit_cleanup_job_status',{job_key:jobId});
  return reply({...status,retry,message:retry?'Storage deletion failed. Retry this job; its original cutoff is preserved.':undefined});
 }catch(error){
  console.error('Orbit cleanup error',error);
  return reply({error:'Cleanup could not finish. Its progress is saved. Check the deployed cleanup migration/function, then retry; accounts and profile pictures are preserved.'},500);
 }
});
