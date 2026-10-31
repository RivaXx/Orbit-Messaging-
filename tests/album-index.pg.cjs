const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
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
