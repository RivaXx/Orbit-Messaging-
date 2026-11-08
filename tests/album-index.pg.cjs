const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const analyticsMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611080001_admin_usage_analytics.sql'),'utf8');
test('usage analytics is gated by the verified account and returns only aggregate figures',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon; create role authenticated;
   create schema auth;
   create function auth.uid() returns uuid language sql stable as
    'select nullif(current_setting(''orbit.test_user'',true),'''')::uuid';
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz);
   create table public.messages(sender_id uuid,created_at timestamptz,text text);
   create table public.user_presence(user_id uuid,last_seen timestamptz);
   alter table public.messages enable row level security;
   insert into auth.users values
    ('11111111-1111-4111-8111-111111111111','rivaldo.a.rodrigues@gmail.com',now(),now()),
    ('22222222-2222-4222-8222-222222222222','regular@example.com',now(),now()-interval '60 days'),
    ('33333333-3333-4333-8333-333333333333','rivaldo.a.rodrigues@gmail.com',null,now());
   insert into public.messages values
    ('22222222-2222-4222-8222-222222222222',now(),'private message'),
    ('22222222-2222-4222-8222-222222222222',now()-interval '60 days','older message');
   insert into public.user_presence values ('22222222-2222-4222-8222-222222222222',now());
  `);
  await db.exec(analyticsMigration);
  await db.exec('set role anon');
  await assert.rejects(db.query('select public.orbit_admin_usage_analytics()'),error=>error.code==='42501');
  await db.exec('set role authenticated');
  for(const id of ['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333']){
   await db.query("select set_config('orbit.test_user',$1,false)",[id]);
   await assert.rejects(db.query('select public.orbit_admin_usage_analytics()'),error=>error.code==='42501');
  }
  await db.query("select set_config('orbit.test_user',$1,false)",['11111111-1111-4111-8111-111111111111']);
  const {usage}= (await db.query('select public.orbit_admin_usage_analytics() as usage')).rows[0];
  assert.deepEqual([usage.registered_accounts,usage.new_accounts,usage.active_accounts,usage.active_senders,usage.messages],[3,2,1,1,1]);
  assert.equal(usage.days.length,30);
  assert.doesNotMatch(JSON.stringify(usage),/example\.com|private message|22222222/);
 }finally{await db.close();}
});

test('seven-day note retention expires newly trashed notes only and cancels on restore',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   create role anon;create role authenticated;create schema cron;
   create table cron.jobs(name text primary key,schedule text,command text);
   create function cron.schedule(text,text,text) returns bigint language sql as
    'insert into cron.jobs values ($1,$2,$3) on conflict(name) do update set schedule=$2,command=$3 returning 1::bigint';
   create table public.secure_notes(id integer primary key,deleted_at timestamptz);
   insert into public.secure_notes values(1,now()-interval '20 days'),(2,null),(3,null),(4,null);
  `);
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611080002_note_trash_retention.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.equal((await db.query("select count(*)::int as n from cron.jobs")).rows[0].n,1);
  await db.exec('update public.secure_notes set deleted_at=now() where id in (2,3,4)');
  const {hours}= (await db.query("select round(extract(epoch from trash_expires_at-now())/3600)::int as hours from public.secure_notes where id=2")).rows[0];
  assert.equal(hours,168);
  await db.exec(`
   update public.secure_notes set deleted_at=null where id=3;
   alter table public.secure_notes disable trigger orbit_note_trash_expiry;
   update public.secure_notes set trash_expires_at=now()-interval '1 minute' where id=2;
   alter table public.secure_notes enable trigger orbit_note_trash_expiry;
   select public.orbit_expire_note_trash();
  `);
  assert.deepEqual((await db.query('select id from public.secure_notes order by id')).rows.map(row=>row.id),[1,3,4]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select public.orbit_expire_note_trash()'),error=>error.code==='42501');
 }finally{await db.close();}
});

const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261101_album_feed_index.sql'),'utf8');
test('actual PostgreSQL rejects the covering index, then accepts the full album after repair without changing history or RLS',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table public.messages(id uuid primary key,room text not null,created_at timestamptz not null default now(),text text,attachments text[]);alter table public.messages enable row level security;create policy preserve_history_policy on public.messages for select using(true);create index idx_messages_feed_covering on public.messages(room,created_at desc) include(text,attachments);`);
 const oldId=crypto.randomUUID(),albumId=crypto.randomUUID(),body=crypto.randomBytes(4000).toString('hex');
 await db.query('insert into public.messages(id,room,text) values($1,$2,$3)',[oldId,'synthetic-room','existing history']);
 await assert.rejects(db.query('insert into public.messages(id,room,text) values($1,$2,$3)',[albumId,'synthetic-room',body]),error=>error.code==='54000'&&/idx_messages_feed_covering/.test(error.message));
 await db.exec(migration);await db.query('insert into public.messages(id,room,text) values($1,$2,$3)',[albumId,'synthetic-room',body]);await db.exec(migration);
 const saved=(await db.query('select id,text from public.messages')).rows;assert.equal(saved.length,2);assert.equal(saved.find(row=>row.id===albumId).text,body);assert.equal(saved.find(row=>row.id===oldId).text,'existing history');
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.messages'::regclass")).rows[0].relrowsecurity,true);
 assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename='messages'")).rows[0].n,1);
 assert.ok(!(await db.query("select indexdef from pg_indexes where tablename='messages'")).rows.some(row=>row.indexdef.includes('INCLUDE')));
 }finally{await db.close();}
});
test('repair refuses to remove a unique or constraint index',async()=>{
 const db=new PGlite();try{await db.exec(`create table public.messages(id uuid primary key,room text,created_at timestamptz);create unique index idx_messages_feed_covering on public.messages(room);`);
 await assert.rejects(db.exec(migration),/Unexpected covering index ownership/);await db.exec('rollback');assert.equal((await db.query("select to_regclass('public.idx_messages_feed_covering') is not null as kept")).rows[0].kept,true);
 }finally{await db.close();}
});
