-- Run after 20261025_e2ee.sql. This complete file always rolls back.
-- Fake cryptographic envelopes test database authorization only. Real signature,
-- key, ciphertext and recovery behavior is exercised by the Node/browser tests.
begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();r uuid:=gen_random_uuid();hidden uuid:=gen_random_uuid();bad_dm uuid:=gen_random_uuid();
begin
 perform set_config('orbit.e2ee.a',a::text,true);perform set_config('orbit.e2ee.b',b::text,true);perform set_config('orbit.e2ee.c',c::text,true);perform set_config('orbit.e2ee.room',r::text,true);
 perform set_config('orbit.e2ee.hidden',hidden::text,true);perform set_config('orbit.e2ee.bad_dm',bad_dm::text,true);
 perform set_config('orbit.e2ee.message',gen_random_uuid()::text,true);perform set_config('orbit.e2ee.old_message',gen_random_uuid()::text,true);perform set_config('orbit.e2ee.event',gen_random_uuid()::text,true);perform set_config('orbit.e2ee.schedule',gen_random_uuid()::text,true);
 insert into auth.users(id,email,role,aud,created_at,raw_user_meta_data,raw_app_meta_data)
 select x,'orbit-e2ee-regression-'||x::text||'@example.invalid','authenticated','authenticated',now(),'{}','{}' from unnest(array[a,b,c])x;
 insert into public.rooms(id,name,created_by,participants,is_direct) values(r,'Synthetic encryption regression',a,array[a,b],false);
 insert into public.rooms(id,name,created_by,participants,is_direct) values(hidden,'Synthetic creator left',c,array[a,b],false),(bad_dm,'Synthetic invalid direct room',a,array[a,b,c],true);
end $$;
set local role authenticated;
do $$
declare actor uuid; backup jsonb:=jsonb_build_object('version',1,'iterations',600000,'kdf','PBKDF2-SHA256','cipher','AES-256-GCM','salt',repeat('A',22),'iv',repeat('B',16),'ciphertext',repeat('x',200));
begin
 foreach actor in array array[current_setting('orbit.e2ee.a')::uuid,current_setting('orbit.e2ee.b')::uuid,current_setting('orbit.e2ee.c')::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform public.orbit_register_encryption(repeat(substr(actor::text,1,1),64),'-----BEGIN PGP PUBLIC KEY BLOCK-----'||repeat('x',200),backup);
  if (select count(*) from public.orbit_encryption_backups)<>1 then raise exception 'Another account backup is visible';end if;
  begin
   perform public.orbit_register_encryption(repeat('f',64),'-----BEGIN PGP PUBLIC KEY BLOCK-----'||repeat('x',200),backup);
   raise exception 'Identity replacement unexpectedly accepted';
  exception when unique_violation then null;end;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('orbit.e2ee.a'),'role','authenticated')::text,true);
 if current_setting('orbit.e2ee.c')::uuid=any(public.orbit_encryption_members(current_setting('orbit.e2ee.hidden'))) then raise exception 'A departed creator was added as a hidden recipient';end if;
 begin perform public.orbit_encryption_members(current_setting('orbit.e2ee.bad_dm'));raise exception 'Three-person direct room unexpectedly accepted';exception when raise_exception then
  if sqlerrm<>'Direct encrypted chats require exactly two participants' then raise;end if;
 end;
 begin
  insert into public.messages(room,sender_id,text)values(current_setting('orbit.e2ee.room'),auth.uid(),'Plaintext must not commit');
  raise exception 'Plaintext insert unexpectedly accepted';
 exception when insufficient_privilege then null;end;
 insert into public.messages(id,room,sender_id,username,type,text,e2ee_version,e2ee_revision,e2ee_sender_fingerprint,e2ee_recipients)
 values(current_setting('orbit.e2ee.message')::uuid,current_setting('orbit.e2ee.room'),auth.uid(),'Synthetic sender','encrypted','-----BEGIN PGP MESSAGE-----'||repeat('a',200),1,1,
  (select fingerprint from public.orbit_encryption_keys where user_id=auth.uid()),public.orbit_encryption_members(current_setting('orbit.e2ee.room')));
end $$;
do $$
declare m public.messages;
begin
 select * into m from public.messages where id=current_setting('orbit.e2ee.message')::uuid;
 begin
  insert into public.messages(room,sender_id,type,text,e2ee_version,e2ee_revision,e2ee_sender_fingerprint,e2ee_recipients)
  values(m.room,auth.uid(),'encrypted',m.text,1,1,m.e2ee_sender_fingerprint,array[auth.uid()]);
  raise exception 'Missing recipient unexpectedly accepted';
 exception when serialization_failure then null;end;
 perform public.orbit_e2ee_edit(m.id,1,m.text||'revision2',m.e2ee_sender_fingerprint,m.e2ee_recipients);
 begin
  perform public.orbit_e2ee_edit(m.id,1,m.text||'stale revision',m.e2ee_sender_fingerprint,m.e2ee_recipients);
  raise exception 'Stale edit unexpectedly accepted';
 exception when insufficient_privilege then null;end;
 begin
  insert into public.messages(room,sender_id,type,text,e2ee_version,e2ee_revision,e2ee_sender_fingerprint,e2ee_recipients,attachments)
  values(m.room,auth.uid(),'encrypted',m.text,1,1,m.e2ee_sender_fingerprint,m.e2ee_recipients,array['{"url":"https://example.invalid/plain.jpg","name":"secret.jpg"}']);
  raise exception 'Plaintext attachment metadata unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm='Plaintext attachment metadata unexpectedly accepted' then raise;end if;
 end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('orbit.e2ee.b'),'role','authenticated')::text,true);
 begin
  update public.messages set text=m.text||'recipient mutation',e2ee_revision=3 where id=m.id;
  raise exception 'Recipient edit unexpectedly accepted';
 exception when insufficient_privilege then null;end;
 perform public.orbit_mark_messages_delivered(array[m.id]);
 perform public.orbit_mark_room_read(m.room,now());
 if not exists(select 1 from public.messages where id=m.id and auth.uid()=any(read_by) and auth.uid()=any(delivered_to)) then raise exception 'Encrypted receipts failed';end if;
 perform public.orbit_e2ee_event(current_setting('orbit.e2ee.event')::uuid,m.id,'reaction',0,m.text,
  (select fingerprint from public.orbit_encryption_keys where user_id=auth.uid()),m.e2ee_recipients);
 begin
  perform public.orbit_e2ee_event(current_setting('orbit.e2ee.event')::uuid,m.id,'reaction',0,m.text,
   (select fingerprint from public.orbit_encryption_keys where user_id=auth.uid()),m.e2ee_recipients);
  raise exception 'Stale event unexpectedly accepted';
 exception when serialization_failure then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('orbit.e2ee.c'),'role','authenticated')::text,true);
 if exists(select 1 from public.messages where id=m.id) or exists(select 1 from public.orbit_encrypted_events where message_key=m.id) then raise exception 'Outsider can read a private conversation';end if;
 begin perform public.orbit_encryption_members(m.room);raise exception 'Outsider membership lookup unexpectedly accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('orbit.e2ee.a'),'role','authenticated')::text,true);
 perform public.orbit_e2ee_schedule(jsonb_build_object('id',current_setting('orbit.e2ee.schedule'),'room',m.room,'sender_id',auth.uid(),'type','encrypted','e2ee_version',1,'e2ee_revision',1,'text',m.text,'attachments','[]'::jsonb,'e2ee_sender_fingerprint',m.e2ee_sender_fingerprint,'e2ee_recipients',m.e2ee_recipients),now()+interval '1 hour');
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
do $$
declare m public.messages;
begin
 select * into m from public.messages where id=current_setting('orbit.e2ee.message')::uuid;
 insert into public.messages(id,room,sender_id,username,type,text,e2ee_version,e2ee_revision,e2ee_sender_fingerprint,e2ee_recipients,created_at)
 values(current_setting('orbit.e2ee.old_message')::uuid,m.room,m.sender_id,'Synthetic sender','encrypted',m.text,1,1,m.e2ee_sender_fingerprint,m.e2ee_recipients,now()-interval '2 days');
 update public.orbit_scheduled_messages set scheduled_at=now()-interval '1 minute' where id=current_setting('orbit.e2ee.schedule')::uuid;
 perform public.orbit_dispatch_schedules();
 if not exists(select 1 from public.messages where id=current_setting('orbit.e2ee.schedule')::uuid and type='encrypted' and e2ee_version=1) then raise exception 'Encrypted schedule did not dispatch';end if;
end $$;
set local role authenticated;
do $$
declare mid uuid:=current_setting('orbit.e2ee.old_message')::uuid;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('orbit.e2ee.a'),'role','authenticated')::text,true);
 perform public.orbit_delete_messages(array[mid]);
 if not exists(select 1 from public.messages where messages.id=mid and deleted_at is not null and cardinality(attachments)=0) then raise exception 'Old encrypted message deletion failed';end if;
 begin update public.messages set deleted_at=null,text='restored plaintext' where messages.id=mid;raise exception 'Deleted message restoration unexpectedly accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Encryption authorization, backups, receipts, revisions, schedules and deletion passed; all synthetic data rolled back' as regression;
