-- New chat content is encrypted on the sending device. Existing history is
-- preserved and remains legacy server-readable content. No production purge.
begin;
create table if not exists public.orbit_encryption_keys(
 user_id uuid primary key references auth.users(id) on delete cascade,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 public_key text not null check(length(public_key) between 100 and 20000),
 created_at timestamptz not null default now()
);
create table if not exists public.orbit_encryption_backups(
 user_id uuid primary key references public.orbit_encryption_keys(user_id) on delete cascade,
 backup jsonb not null check(jsonb_typeof(backup)='object' and octet_length(backup::text)<85000),
 created_at timestamptz not null default now()
);
alter table public.orbit_encryption_keys enable row level security;
alter table public.orbit_encryption_backups enable row level security;
revoke all on public.orbit_encryption_keys,public.orbit_encryption_backups from public,anon,authenticated;
grant select on public.orbit_encryption_keys,public.orbit_encryption_backups to authenticated;
drop policy if exists orbit_keys_read on public.orbit_encryption_keys;
create policy orbit_keys_read on public.orbit_encryption_keys for select to authenticated using(auth.uid() is not null);
drop policy if exists orbit_backup_read on public.orbit_encryption_backups;
create policy orbit_backup_read on public.orbit_encryption_backups for select to authenticated using(user_id=auth.uid());
create or replace function public.orbit_register_encryption(key_fingerprint text,key_public text,key_backup jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(key_fingerprint,'') !~ '^[a-f0-9]{64}$'
  or key_public is null or length(key_public) not between 100 and 20000 or key_public not like '-----BEGIN PGP PUBLIC KEY BLOCK-----%'
  or jsonb_typeof(key_backup) is distinct from 'object' or octet_length(key_backup::text)>85000
  or key_backup->>'version' is distinct from '1' or key_backup->>'iterations' is distinct from '600000'
  or key_backup->>'kdf' is distinct from 'PBKDF2-SHA256' or key_backup->>'cipher' is distinct from 'AES-256-GCM'
  or jsonb_typeof(key_backup->'version') is distinct from 'number' or jsonb_typeof(key_backup->'iterations') is distinct from 'number'
  or (key_backup-array['version','kdf','iterations','cipher','salt','iv','ciphertext'])<>'{}'::jsonb
  or coalesce(key_backup->>'salt','') !~ '^[A-Za-z0-9_-]{22}$' or coalesce(key_backup->>'iv','') !~ '^[A-Za-z0-9_-]{16}$'
  or length(coalesce(key_backup->>'ciphertext','')) not between 100 and 80000 then
  raise exception 'Invalid encrypted recovery backup' using errcode='22023';
 end if;
 -- Immutable registration: a normal signed-in session cannot replace an
 -- existing identity or its recovery backup. Recovery decrypts the same key.
 insert into public.orbit_encryption_keys(user_id,fingerprint,public_key) values(auth.uid(),key_fingerprint,key_public);
 insert into public.orbit_encryption_backups(user_id,backup) values(auth.uid(),key_backup);
end $$;
revoke all on function public.orbit_register_encryption(text,text,jsonb) from public,anon;
grant execute on function public.orbit_register_encryption(text,text,jsonb) to authenticated;

create or replace function public.orbit_encryption_members_for(chat_room text,viewer uuid)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare members uuid[]; parts text[]; a uuid; b uuid; direct boolean;
begin
 if viewer is null or not (chat_room='self_'||viewer::text or public.orbit_is_room_member(chat_room,viewer)) then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if chat_room='self_'||viewer::text then return array[viewer];end if;
 select array(select distinct x from unnest(coalesce(r.participants,'{}'::uuid[])) x where x is not null order by x),r.is_direct
 into members,direct from public.rooms r where r.id::text=chat_room;
 if direct and cardinality(members)<>2 then raise exception 'Direct encrypted chats require exactly two participants';end if;
 if members is null and left(chat_room,3)='dm_' then
  parts:=string_to_array(chat_room,'_');
  select id into strict a from auth.users where id::text=parts[2] or (length(parts[2])=12 and left(id::text,12)=parts[2]);
  select id into strict b from auth.users where id::text=parts[3] or (length(parts[3])=12 and left(id::text,12)=parts[3]);
  members:=array[least(a,b),greatest(a,b)];
 end if;
 if members is null or cardinality(members) not between 1 and 100 or not viewer=any(members) then
  raise exception 'Join the conversation before sending; encrypted conversations support 1 to 100 participants';end if;
 return members;
end $$;
revoke all on function public.orbit_encryption_members_for(text,uuid) from public,anon,authenticated;
create or replace function public.orbit_encryption_members(chat_room text)
returns uuid[] language sql stable security definer set search_path='' as $$select public.orbit_encryption_members_for(chat_room,auth.uid());$$;
revoke all on function public.orbit_encryption_members(text) from public,anon;
grant execute on function public.orbit_encryption_members(text) to authenticated;

alter table public.messages add column if not exists e2ee_version integer;
alter table public.messages add column if not exists e2ee_revision integer;
alter table public.messages add column if not exists e2ee_sender_fingerprint text;
alter table public.messages add column if not exists e2ee_recipients uuid[];
alter table public.messages add column if not exists e2ee_expires boolean not null default false;
create or replace function public.orbit_validate_encrypted_envelope(body text,sender uuid,fingerprint text,recipients uuid[],chat_room text)
returns void language plpgsql stable security definer set search_path='' as $$
declare expected uuid[];
begin
 if body is null or length(body) not between 100 and 250000 or body not like '-----BEGIN PGP MESSAGE-----%'
  or not exists(select 1 from public.orbit_encryption_keys k where k.user_id=sender and k.fingerprint=orbit_validate_encrypted_envelope.fingerprint)
  or cardinality(recipients) not between 1 and 100 then raise exception 'Invalid encrypted message';end if;
 expected:=public.orbit_encryption_members_for(chat_room,sender);
 if (select array_agg(distinct x order by x) from unnest(recipients) x) is distinct from expected
  or cardinality(recipients)<>cardinality(expected)
  or (select count(*) from public.orbit_encryption_keys where user_id=any(expected))<>cardinality(expected) then
  raise exception 'Conversation membership changed or a member has not set up encryption. Retry after refreshing the chat.' using errcode='40001';
 end if;
end $$;
revoke all on function public.orbit_validate_encrypted_envelope(text,uuid,text,uuid[],text) from public,anon,authenticated;
grant execute on function public.orbit_validate_encrypted_envelope(text,uuid,text,uuid[],text) to authenticated;

create or replace function public.orbit_e2ee_guard()
returns trigger language plpgsql set search_path='' as $$
declare attachment jsonb; ref text;
begin
 if tg_op='INSERT' and new.e2ee_version=1 and new.e2ee_expires then new.expires_at:=now()+interval '5 minutes';end if;
 if tg_op='UPDATE' and new.e2ee_expires is distinct from old.e2ee_expires then raise exception 'Message expiry cannot be changed';end if;
 if tg_op='INSERT' and current_user='authenticated' and coalesce(new.e2ee_version,0)<>1 then
  raise exception 'Update Orbit and set up encrypted chats before sending.' using errcode='42501';end if;
 if tg_op='UPDATE' and old.e2ee_version=1 then
  if new.e2ee_version is distinct from old.e2ee_version then raise exception 'Encryption cannot be removed';end if;
  if old.deleted_at is not null and (to_jsonb(new)-array['read_by','delivered_to','updated_at']) is distinct from (to_jsonb(old)-array['read_by','delivered_to','updated_at']) then
   raise exception 'Deleted messages cannot be restored';end if;
  if new.deleted_at is not null then return new;end if;
  if new.text is distinct from old.text then
   if auth.uid() is distinct from old.sender_id or old.created_at<=now()-interval '10 minutes'
    or new.e2ee_revision<>old.e2ee_revision+1 then raise exception 'Encrypted edit rejected' using errcode='42501';end if;
   new.edited_at:=now();
  elsif (to_jsonb(new)-array['read_by','delivered_to','updated_at','pinned','reactions','reply_to','metadata','view_status','is_read','deleted_by']) is distinct from
        (to_jsonb(old)-array['read_by','delivered_to','updated_at','pinned','reactions','reply_to','metadata','view_status','is_read','deleted_by']) then
   raise exception 'Encrypted content requires a new signed revision';
  end if;
 end if;
 if new.e2ee_version=1 and new.deleted_at is null then
  if new.type is distinct from 'encrypted' or new.e2ee_revision is null or new.e2ee_revision<1 or new.reply_to is not null
   or coalesce(new.metadata,'{}')<>'{}'::jsonb or coalesce(new.reactions,'{}')<>'{}'::jsonb then
   raise exception 'Encrypted content cannot expose plaintext metadata';end if;
  if tg_op='INSERT' or new.text is distinct from old.text then
   perform public.orbit_validate_encrypted_envelope(new.text,new.sender_id,new.e2ee_sender_fingerprint,new.e2ee_recipients,new.room);
  end if;
  foreach ref in array coalesce(new.attachments,ARRAY[]::text[]) loop
   attachment:=ref::jsonb;
   if jsonb_typeof(attachment) is distinct from 'object' or attachment->>'encrypted' is distinct from 'true'
    or (attachment-array['encrypted','storage_bucket','storage_path','digest','view_once'])<>'{}'::jsonb
    or coalesce(attachment->>'digest','') !~ '^[a-f0-9]{64}$'
    or not coalesce(((attachment->>'storage_bucket'='chat-assets' and attachment->>'storage_path' like 'encrypted/'||new.sender_id::text||'/%')
      or (attachment->>'storage_bucket'='orbit-view-once' and attachment->>'storage_path' like new.sender_id::text||'/%')),false) then
    raise exception 'Only encrypted attachment references may be stored';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.orbit_e2ee_guard() from public,anon,authenticated;
-- Runs after the legacy edit guard, retaining its identity/deletion protection.
drop trigger if exists orbit_zy_e2ee on public.messages;
create trigger orbit_zy_e2ee before insert or update on public.messages for each row execute function public.orbit_e2ee_guard();

create or replace function public.orbit_e2ee_edit(message_key uuid,expected_revision integer,ciphertext text,fingerprint text,recipients uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages;
begin
 select * into m from public.messages where id=message_key for update;
 if auth.uid() is null or not found or m.sender_id<>auth.uid() or not public.orbit_security_can_access(m.room)
  or m.deleted_at is not null or m.e2ee_version<>1 or m.e2ee_revision<>expected_revision
  or m.created_at<=now()-interval '10 minutes' or cardinality(m.attachments)>0 then
  raise exception 'The message changed or its edit window ended' using errcode='42501';end if;
 perform public.orbit_validate_encrypted_envelope(ciphertext,m.sender_id,fingerprint,recipients,m.room);
 update public.messages set text=ciphertext,e2ee_revision=expected_revision+1,e2ee_sender_fingerprint=fingerprint,e2ee_recipients=recipients,edited_at=now() where id=message_key returning * into m;
 return to_jsonb(m);
end $$;
revoke all on function public.orbit_e2ee_edit(uuid,integer,text,text,uuid[]) from public,anon;
grant execute on function public.orbit_e2ee_edit(uuid,integer,text,text,uuid[]) to authenticated;
create or replace function public.orbit_expire_locations()
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.messages set deleted_at=now(),text='🚫 This message was deleted',attachments=ARRAY[]::text[],reply_to=null
 where (type='location' or e2ee_expires) and expires_at<=now() and deleted_at is null;
end $$;

alter table public.orbit_scheduled_messages add column if not exists e2ee_envelope jsonb;
revoke insert,update,delete on public.orbit_scheduled_messages from authenticated;
create or replace function public.orbit_e2ee_schedule(envelope jsonb,send_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare message_id uuid; peer uuid;
begin
 message_id:=(envelope->>'id')::uuid;
 if auth.uid() is null or envelope->>'sender_id' is distinct from auth.uid()::text or envelope->>'type' is distinct from 'encrypted'
  or envelope->>'e2ee_version' is distinct from '1' or envelope->>'e2ee_revision' is distinct from '1'
  or jsonb_array_length(coalesce(envelope->'attachments','[]'))<>0
  or send_at is null or send_at<=now() or send_at>now()+interval '1 year' then raise exception 'Invalid encrypted schedule';end if;
 perform public.orbit_validate_encrypted_envelope(envelope->>'text',auth.uid(),envelope->>'e2ee_sender_fingerprint',array(select jsonb_array_elements_text(envelope->'e2ee_recipients'))::uuid[],envelope->>'room');
 peer:=public.orbit_direct_peer(envelope->>'room',auth.uid());
 if peer is not null and public.orbit_pair_blocked(auth.uid(),peer) then raise exception 'Conversation unavailable';end if;
 insert into public.orbit_scheduled_messages(id,sender_id,room,text,scheduled_at,e2ee_envelope)
 values(message_id,auth.uid(),envelope->>'room',envelope->>'text',send_at,envelope) on conflict(id) do nothing;
 if not exists(select 1 from public.orbit_scheduled_messages where id=message_id and sender_id=auth.uid() and e2ee_envelope=envelope and scheduled_at=send_at) then raise exception 'Schedule request conflict';end if;
 return message_id;
end $$;
revoke all on function public.orbit_e2ee_schedule(jsonb,timestamptz) from public,anon;
grant execute on function public.orbit_e2ee_schedule(jsonb,timestamptz) to authenticated;
revoke execute on function public.orbit_schedule_message(text,text,timestamptz,uuid) from authenticated;
create or replace function public.orbit_dispatch_schedules()
returns integer language plpgsql security definer set search_path='' as $$
declare job record; sent integer:=0; peer uuid; envelope jsonb;
begin
 for job in select * from public.orbit_scheduled_messages where status='pending' and scheduled_at<=now() order by scheduled_at limit 100 for update skip locked loop
  begin
   envelope:=job.e2ee_envelope;
   if envelope is null then
    update public.orbit_scheduled_messages set status='failed',error='Open Orbit and reschedule this legacy message with encryption.' where id=job.id;
    continue;
   end if;
   peer:=public.orbit_direct_peer(job.room,job.sender_id);
   if not (job.room='self_'||job.sender_id::text or public.orbit_is_room_member(job.room,job.sender_id)) or (peer is not null and public.orbit_pair_blocked(job.sender_id,peer)) then raise exception 'Conversation unavailable';end if;
   perform public.orbit_validate_encrypted_envelope(job.text,job.sender_id,envelope->>'e2ee_sender_fingerprint',array(select jsonb_array_elements_text(envelope->'e2ee_recipients'))::uuid[],job.room);
   insert into public.messages(id,room,sender_id,username,text,type,e2ee_version,e2ee_revision,e2ee_sender_fingerprint,e2ee_recipients)
   values(job.id,job.room,job.sender_id,coalesce((select first_name from public.user_profiles where user_id=job.sender_id limit 1),'Orbit user'),job.text,'encrypted',1,1,envelope->>'e2ee_sender_fingerprint',array(select jsonb_array_elements_text(envelope->'e2ee_recipients'))::uuid[])
   on conflict(id) do nothing;
   update public.orbit_scheduled_messages set status='sent',sent_at=now(),error=null where id=job.id;sent:=sent+1;
  exception when others then
   update public.orbit_scheduled_messages set status='failed',error='Conversation membership changed or delivery failed. Open Orbit to review and reschedule.' where id=job.id;
  end;
 end loop;
 return sent;
end $$;

-- Each participant signs their own reaction/vote state. No participant can
-- overwrite the author's ciphertext or impersonate another participant's vote.
create table if not exists public.orbit_encrypted_events(
 id uuid primary key,
 message_key uuid not null references public.messages(id) on delete cascade,
 actor uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('reaction','vote')),
 revision integer not null check(revision>0),
 fingerprint text not null,
 recipients uuid[] not null,
 ciphertext text not null check(length(ciphertext) between 100 and 250000),
 unique(message_key,actor,kind)
);
alter table public.orbit_encrypted_events enable row level security;
revoke all on public.orbit_encrypted_events from public,anon,authenticated;
grant select on public.orbit_encrypted_events to authenticated;
drop policy if exists orbit_encrypted_events_read on public.orbit_encrypted_events;
create policy orbit_encrypted_events_read on public.orbit_encrypted_events for select to authenticated using(
 exists(select 1 from public.messages m where m.id=message_key and m.deleted_at is null and public.orbit_security_can_access(m.room))
);
create or replace function public.orbit_e2ee_event(event_key uuid,parent_message uuid,event_kind text,expected_revision integer,body text,key_fingerprint text,key_recipients uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages; previous public.orbit_encrypted_events; saved public.orbit_encrypted_events;
begin
 select * into m from public.messages where id=parent_message for share;
 if auth.uid() is null or not found or m.e2ee_version<>1 or m.deleted_at is not null or event_kind not in('reaction','vote')
  or not public.orbit_security_can_access(m.room) then raise exception 'Event rejected' using errcode='42501';end if;
 perform public.orbit_validate_encrypted_envelope(body,auth.uid(),key_fingerprint,key_recipients,m.room);
 -- Serialize first writes too; a unique-constraint race must never replace a
 -- state that the caller did not read and sign at the next revision.
 perform pg_advisory_xact_lock(hashtextextended(parent_message::text||auth.uid()::text||event_kind,0));
 select * into previous from public.orbit_encrypted_events where message_key=parent_message and actor=auth.uid() and kind=event_kind for update;
 if found then
  if previous.id<>event_key or previous.revision<>expected_revision then raise exception 'Event changed. Retry.' using errcode='40001';end if;
  update public.orbit_encrypted_events set revision=expected_revision+1,ciphertext=body,fingerprint=key_fingerprint,recipients=key_recipients where id=event_key returning * into saved;
 else
  if expected_revision<>0 then raise exception 'Event changed. Retry.' using errcode='40001';end if;
  insert into public.orbit_encrypted_events values(event_key,parent_message,auth.uid(),event_kind,1,key_fingerprint,key_recipients,body) returning * into saved;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.orbit_e2ee_event(uuid,uuid,text,integer,text,text,uuid[]) from public,anon;
grant execute on function public.orbit_e2ee_event(uuid,uuid,text,integer,text,text,uuid[]) to authenticated;
do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orbit_encrypted_events') then
  alter publication supabase_realtime add table public.orbit_encrypted_events;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
