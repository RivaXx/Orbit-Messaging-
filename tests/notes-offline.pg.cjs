const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {indexedDB}=require('fake-indexeddb');
const {PGlite}=require('@electric-sql/pglite');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const owner=crypto.randomUUID();
const other=crypto.randomUUID();
const id=()=>crypto.randomUUID();

test('pending edits survive reopening and a retry of an acknowledged create preserves a newer edit',async()=>{
 const context=vm.createContext({crypto,indexedDB});
 vm.runInContext(read('js/orbit-note-store.js'),context);
 const api=vm.runInContext('OrbitNoteStore',context);
 const noteId=id();
 const first=await api.save(owner,noteId,{title:'Trip',content:'- [ ] Tickets'});
 const push=await api.beginPush(owner,noteId);
 await api.editTask(owner,noteId,first.row.document[0].id,true);
 assert.equal((await api.list(other)).length,0);
 // Simulate reopening the web client against the existing database.
 const nextContext=vm.createContext({crypto,indexedDB});
 vm.runInContext(read('js/orbit-note-store.js'),nextContext);
 const next=vm.runInContext('OrbitNoteStore',nextContext);
 assert.equal((await next.beginPush(owner,noteId)).op,push.op);
 await next.acknowledge(owner,push,{...push.row,revision:'1'},true);
 const [edited]=await next.list(owner);
 assert.equal(edited.row.content,'- [x] Tickets');
 assert.equal(edited.base.revision,'1');
 assert.notEqual(edited.op,push.op);
 const editedPush=await next.beginPush(owner,noteId);
 await next.acknowledge(owner,editedPush,{...edited.row,revision:'2'},true);
 assert.equal((await next.list(owner))[0].op,undefined);
});

test('legacy drafts stay queued through first pull and stale edits become conflict copies',async()=>{
 const context=vm.createContext({crypto,indexedDB});
 vm.runInContext(read('js/orbit-note-store.js'),context);
 const api=vm.runInContext('OrbitNoteStore',context);
 const account=id(), noteId=id();
 const snapshot={id:noteId,user_id:account,title:'Trip',content:'Budget',updated_at:'2026-11-01T10:00:00Z'};
 await api.migrate(account,[snapshot],[{id:noteId,version:snapshot.updated_at,values:{title:'Trip',content:'Budget edit'}}]);
 await api.pull(account,[{cursor:'10',note_id:noteId,note:api.canonical({...snapshot,revision:'10',color:'blue'})}]);
 await api.finishBootstrap(account);
 const [record]=await api.list(account);
 assert.equal(record.row.content,'Budget edit');
 assert.equal(record.row.color,'blue');
 const push=await api.beginPush(account,noteId);
 await api.acknowledge(account,push,{...record.base,revision:'11',content:'Cloud budget edit'},false);
 const rows=(await api.list(account)).map(item=>item.row);
 assert.equal(rows.length,2);
 assert.ok(rows.some(row=>row.id===noteId && row.content==='Cloud budget edit'));
 assert.ok(rows.some(row=>row.title.includes('conflict copy') && row.content==='Budget edit'));
 await api.pull(account,[{cursor:'12',note_id:noteId,note:null}]);
 assert.equal((await api.list(account)).length,1);
});

test('PostgreSQL applies note mutations once, rejects stale revisions and enforces owner-scoped sync',async()=>{
 const db=new PGlite();
 const oldId=id(), mutation=id(), newId=id();
 const row={title:'Trip',content:'Packing',tags:[],color:'default',pinned:false,archived:false,deleted_at:null,
  reminder_at:null,folder:'Travel',is_template:false,document:null,sort_rank:null};
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
 const login=account=>db.query("select set_config('orbit.test_user',$1,false)",[account]);
 const apply=async(account,note,op,revision,patch)=>(await one(
  'select public.orbit_apply_note($1,$2,$3,$4,$5) as result',[account,note,op,revision,JSON.stringify(patch)])).result;
 try {
  await db.exec([
   'create role anon; create role authenticated; create schema auth; create schema cron;',
   "create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''orbit.test_user'',true),'''')::uuid';",
   "create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';",
   'create table auth.users(id uuid primary key);',
   "create table public.secure_notes(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,title text not null,content text not null,updated_at timestamptz default now(),tags text[] not null default array[]::text[],color text not null default 'default',pinned boolean not null default false,archived boolean not null default false,deleted_at timestamptz,reminder_at timestamptz);",
   'alter table public.secure_notes enable row level security;',
   'create policy note_owner on public.secure_notes for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());',
   'grant select,insert,update,delete on public.secure_notes to authenticated;'
  ].join('\n'));
  await db.query('insert into auth.users values($1),($2)',[owner,other]);
  await db.query("insert into public.secure_notes(id,user_id,title,content,deleted_at) values($1,$2,'legacy','old',now()-interval '10 days')",[oldId,owner]);
  await db.exec(read('supabase/migrations/202611080002_note_trash_retention.sql'));
  await db.exec(read('supabase/migrations/202611260001_notes_offline.sql'));
  const expiry=await one("select extract(epoch from (trash_expires_at-deleted_at))::int as seconds from secure_notes where id=$1",[oldId]);
  assert.equal(expiry.seconds,30*86400);
  await db.exec('set role authenticated');
  await login(owner);
  const pull=async(account,cursor=0)=>(await db.query('select * from public.orbit_pull_notes($1,$2)',[account,cursor])).rows;
  const [old]=await pull(owner);
  assert.equal(old.note.id,oldId);
  const first=await apply(owner,newId,mutation,null,row);
  assert.equal(first.applied,true);
  assert.equal((await apply(owner,newId,mutation,null,row)).note.revision,first.note.revision);
  const newest=await apply(owner,newId,id(),first.note.revision,{...row,content:'Packing updated'});
  assert.equal(newest.applied,true);
  assert.equal((await apply(owner,newId,mutation,null,row)).receipt_revision,first.note.revision);
  const stale=await apply(owner,newId,id(),first.note.revision,{...row,content:'A stale edit'});
  assert.equal(stale.applied,false);
  assert.equal(stale.note.content,'Packing updated');
  assert.deepEqual((await pull(owner,old.cursor)).map(change=>change.note.id),[newId]);
  await login(other);
  assert.equal((await pull(owner)).length,0);
  await assert.rejects(apply(owner,id(),id(),null,row),error=>error.code==='42501');
  assert.equal((await apply(other,newId,id(),newest.note.revision,row)).note,null);
  await login(owner);
  await db.query('delete from secure_notes where id=$1',[newId]);
  const [tombstone]=await pull(owner,newest.note.revision);
  assert.equal(tombstone.note,null);
  assert.equal(tombstone.note_id,newId);
 } finally {await db.close();}
});
test('attachment blobs stay account scoped and survive database reopen',async()=>{
 const context=vm.createContext({crypto,indexedDB,Blob});
 vm.runInContext(read('js/orbit-note-store.js'),context);
 vm.runInContext(read('js/orbit-note-media.js'),context);
 const api=vm.runInContext('OrbitNoteStore',context);
 const media=vm.runInContext('OrbitNoteMedia',context);
 const account=id(), blob=new Blob(['test fixture'],{type:'image/png'});
 const photo=await media.add(account,'photo',blob);
 const remote=()=>{throw Error('Local attachment unexpectedly requested the network');};
 assert.equal(await (await media.read(account,photo,remote)).text(),'test fixture');
 assert.equal(await api.getBlob(id(),photo.id),undefined);
 const reopened=vm.createContext({crypto,indexedDB,Blob});
 vm.runInContext(read('js/orbit-note-store.js'),reopened);
 const reopenedStore=vm.runInContext('OrbitNoteStore',reopened);
 assert.equal(await (await reopenedStore.getBlob(account,photo.id)).blob.text(),'test fixture');
 await assert.rejects(media.add(account,'photo',new Blob(['invalid'],{type:'text/html'})),/format/);
 const pending=await api.save(account,id(),{attachments:[photo]});
 const uploads=[];
 const client={storage:{from:bucket=>({upload:async(path,data)=>{uploads.push({bucket,path,size:data.size});return {};}})}};
 await media.upload(account,pending.row,client);
 await media.upload(account,pending.row,client);
 assert.deepEqual(uploads,[{bucket:'orbit-note-attachments',path:account+'/'+photo.id,size:blob.size}]);
});

test('recurrence keeps wall time across daylight saving changes, and links omit URL credentials',()=>{
 const context=vm.createContext({crypto,URL,Intl});
 vm.runInContext(read('js/orbit-note-media.js'),context);
 const media=vm.runInContext('OrbitNoteMedia',context);
 const reminder={reminder_at:'2026-03-07T14:00:00Z',reminder_rule:{zone:'America/New_York',repeat:'daily',snooze:null}};
 assert.equal(new Date(media.occurrence(reminder,Date.parse('2026-03-08T10:00:00Z'))).toISOString(),'2026-03-08T13:00:00.000Z');
 assert.equal(new Date(media.occurrence(reminder,Date.parse('2026-03-08T13:05:00Z'))).toISOString(),'2026-03-09T13:00:00.000Z');
 const snoozed={...reminder,reminder_rule:{...reminder.reminder_rule,snooze:'2026-03-08T13:10:00Z'}};
 assert.equal(new Date(media.occurrence(snoozed,Date.parse('2026-03-08T13:05:00Z'))).toISOString(),'2026-03-08T13:10:00.000Z');
 assert.deepEqual([...media.links('https://user:p@private.example and https://example.com/foo.')].map(url=>url.href),['https://example.com/foo']);
});

test('Phase 2 migration keeps Phase 1 writes compatible, scopes attachments, and queues a due reminder once',async()=>{
 const db=new PGlite();
 const account=id(), stranger=id(), note=id(), attachment=id();
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
 const login=value=>db.query("select set_config('orbit.test_user',$1,false)",[value]);
 const apply=async(op,revision,patch)=>(await one('select public.orbit_apply_note($1,$2,$3,$4,$5) as result',
  [account,note,op,revision,JSON.stringify(patch)])).result;
 try {
  await db.exec([
   'create role anon; create role authenticated; create role service_role; create schema auth; create schema cron; create schema storage;',
   "create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''orbit.test_user'',true),'''')::uuid';",
   "create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';",
   'create table auth.users(id uuid primary key);',
   "create table public.secure_notes(id uuid primary key,user_id uuid references auth.users(id),title text not null,content text not null,updated_at timestamptz default now(),tags text[] not null default array[]::text[],color text not null default 'default',pinned boolean not null default false,archived boolean not null default false,deleted_at timestamptz,reminder_at timestamptz,reminder_sent_at timestamptz);",
   'create table public.orbit_notification_outbox(id uuid default gen_random_uuid(),kind text,source_id text,user_id uuid,version timestamptz,expires_at timestamptz,sent_at timestamptz,next_attempt_at timestamptz default now(),attempts integer default 0,created_at timestamptz default now(),unique(kind,source_id,version));',
   'create function public.orbit_dispatch_notification(uuid) returns void language sql as $$ select $$;',
   'create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);',
   'create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;',
   'grant usage on schema auth,storage to authenticated; grant select,insert,delete,update on storage.objects to authenticated;',
   'create policy broad on storage.objects for all to authenticated using(true) with check(true);'
  ].join('\n'));
  await db.query('insert into auth.users values($1),($2)',[account,stranger]);
  for(const migration of ['202611080002_note_trash_retention.sql','202611260001_notes_offline.sql','202611270001_notes_media_reminders.sql']) {
   await db.exec(read('supabase/migrations/'+migration));
  }
  await db.exec('set role authenticated');
  await login(account);
  const rule={repeat:'daily',zone:'UTC',snooze:null};
  const patch={title:'Test',content:'body',tags:[],color:'default',pinned:false,archived:false,deleted_at:null,
   reminder_at:new Date(Date.now()-3600000).toISOString(),folder:'',is_template:false,document:null,sort_rank:null};
  const created=await apply(id(),null,{...patch,attachments:[{id:attachment,kind:'photo',mime:'image/png'}],reminder_rule:rule});
  assert.equal(created.applied,true);
  assert.equal(created.note.attachments[0].id,attachment);
  const compatible=await apply(id(),created.note.revision,{...patch,title:'From Phase 1'});
  assert.equal(compatible.note.attachments[0].id,attachment);
  assert.equal(compatible.note.reminder_rule.repeat,'daily');
  await assert.rejects(apply(id(),compatible.note.revision,{...patch,attachments:[{id:attachment,kind:'photo',mime:'text/html'}]}),error=>error.code==='22023');
  await db.query("insert into storage.objects values('orbit-note-attachments',$1)",[account+'/'+attachment]);
  await login(stranger);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
  await assert.rejects(db.query("insert into storage.objects values('orbit-note-attachments',$1)",[account+'/'+id()]),error=>error.code==='42501');
  await db.exec('reset role');
  await db.exec('select public.orbit_process_notifications(); select public.orbit_process_notifications();');
  assert.equal((await one('select count(*)::int as count from public.orbit_notification_outbox')).count,1);
  const dst=await one("select orbit_note_due('2026-03-07 14:00:00+00',$1,'2026-03-08 13:20:00+00') as due",[JSON.stringify({repeat:'daily',zone:'America/New_York'})]);
  assert.equal(dst.due.toISOString(),'2026-03-08T13:00:00.000Z');
  await db.exec(read('supabase/migrations/202611270002_notes_privacy.sql'));
  await db.exec('set role authenticated');
  await login(account);
  const noteLock={v:1,id:id(),salt:'A'.repeat(22)+'==',iv:'B'.repeat(16),data:'C'.repeat(64),wrap:{iv:'D'.repeat(16),data:'E'.repeat(64)}};
  const invokeV3=async(base,patch)=>(await one('select public.orbit_apply_note_v3($1,$2,$3,$4,$5) as result',
    [account,note,id(),base,JSON.stringify(patch)])).result;
  const latest=(await one('select note from public.orbit_pull_notes($1,0)',[account])).note;
  const locked=await invokeV3(latest.revision,{...patch,title:'Locked note',content:'',attachments:[{id:attachment,kind:'sealed',mime:'application/octet-stream'}],lockbox:noteLock});
  assert.equal(locked.applied,true);
  assert.equal(locked.note.lockbox.id,noteLock.id);
  assert.equal((await db.query('select * from public.orbit_note_history($1,$2)',[account,note])).rows.length,0);
  await assert.rejects(invokeV3(locked.note.revision,{...patch,title:'Plaintext leak',content:'private',lockbox:noteLock}),error=>error.code==='22023');
  const newer=await invokeV3(locked.note.revision,{...patch,title:'Locked note',content:'',attachments:[],lockbox:{...noteLock,data:'F'.repeat(64)}});
  assert.equal(newer.applied,true);
  assert.equal((await db.query('select * from public.orbit_note_history($1,$2)',[account,note])).rows[0].note.content,'');
  await login(stranger);
  assert.equal((await db.query('select * from public.orbit_note_history($1,$2)',[account,note])).rows.length,0);
 } finally {await db.close();}
});

test('note lock masks private data and detects wrong account, passphrase and attachment tampering',async()=>{
 const context=vm.createContext({crypto,indexedDB,Blob,TextEncoder,TextDecoder,btoa,atob});
 vm.runInContext(read('js/orbit-note-store.js'),context);
 vm.runInContext(read('js/orbit-note-lock.js'),context);
 const core=vm.runInContext('OrbitNoteLock',context);
 const store=vm.runInContext('OrbitNoteStore',context);
 const ownerId=id(), noteId=id(), assetId=id(), passphrase='first orbit note recovery phrase';
 const session=await core.create(ownerId,passphrase);
 const clear={title:'Private title',content:'Private body',attachments:[{id:assetId,kind:'photo',mime:'image/png'}],tags:['private label']};
 const packed=await core.pack(session,clear);
 assert.doesNotMatch(JSON.stringify(packed),/Private body|Private title|private label|image\/png/);
 const opened=await core.open(ownerId,packed.lockbox,{phrase:passphrase});
 assert.equal(opened.values.content,clear.content);
 await assert.rejects(core.open(ownerId,packed.lockbox,{phrase:'incorrect recovery phrase'}),/Could not unlock/);
 await assert.rejects(core.open(id(),packed.lockbox,{deviceKey:core.deviceKey(opened)}),/Could not unlock/);
 const encrypted=await core.encryptBlob(session,assetId,new Blob(['asset contents'],{type:'image/png'}));
 assert.equal(await (await core.decryptBlob(opened,clear.attachments[0],encrypted)).text(),'asset contents');
 await assert.rejects(core.decryptBlob(opened,{...clear.attachments[0],id:id()},encrypted));
 const first=await store.save(ownerId,noteId,clear);
 await store.save(ownerId,noteId,{content:'second body'},first.row);
 assert.equal((await store.history(ownerId,noteId)).length,1);
 await store.save(ownerId,noteId,packed);
 assert.equal((await store.history(ownerId,noteId)).length,0);
 assert.doesNotMatch(JSON.stringify(await store.list(ownerId)),/Private body|Private title|second body/);
});
