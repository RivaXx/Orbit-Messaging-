-- Non-destructive security migration, matched to the audited production schema.
-- Deploy the matching frontend before switching chat-assets to private at the end.
begin;

-- A permissive legacy policy cannot override these restrictive boundaries.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' loop
  execute format('alter table public.%I enable row level security',t.tablename);
  execute format('drop policy if exists orbit_security_no_anon on public.%I',t.tablename);
  execute format('create policy orbit_security_no_anon on public.%I as restrictive for all to anon using(false) with check(false)',t.tablename);
 end loop;
end $$;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- These unused legacy SECURITY DEFINER RPCs bypassed RLS and trusted caller IDs.
revoke all on function public.admin_purge_inactive_users(uuid) from public,anon,authenticated;
revoke all on function public.admin_purge_old_media(integer,text) from public,anon,authenticated;
revoke all on function public.get_main_chats_feed(uuid) from public,anon,authenticated;
revoke all on function public.get_user_chat_summaries(uuid) from public,anon,authenticated;
revoke all on function public.get_room_messages_smart(text,text,integer) from public,anon,authenticated;
revoke all on function public.get_room_messages_before(text,text,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.get_global_directory(uuid) from public,anon,authenticated;

create or replace function public.orbit_security_can_access(chat_room text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (chat_room='self_'||auth.uid()::text
   or public.orbit_is_room_member(chat_room,auth.uid()));
$$;
revoke all on function public.orbit_security_can_access(text) from public,anon;
grant execute on function public.orbit_security_can_access(text) to authenticated;

drop policy if exists orbit_security_message_member on public.messages;
create policy orbit_security_message_member on public.messages as restrictive for all to authenticated
using(public.orbit_security_can_access(room)) with check(public.orbit_security_can_access(room));
drop policy if exists orbit_security_message_sender_insert on public.messages;
create policy orbit_security_message_sender_insert on public.messages as restrictive for insert to authenticated
with check(sender_id=auth.uid());
drop policy if exists orbit_security_message_sender_update on public.messages;
create policy orbit_security_message_sender_update on public.messages as restrictive for update to authenticated
using(sender_id=auth.uid()) with check(sender_id=auth.uid());
drop policy if exists orbit_security_message_sender_delete on public.messages;
create policy orbit_security_message_sender_delete on public.messages as restrictive for delete to authenticated
using(sender_id=auth.uid());

-- Identity and destination cannot be changed to move a message between chats.
create or replace function public.orbit_security_message_identity()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and
   (new.id is distinct from old.id or new.sender_id is distinct from old.sender_id
    or new.room is distinct from old.room or new.created_at is distinct from old.created_at) then
  raise exception 'Message identity cannot be changed' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists orbit_security_message_identity on public.messages;
create trigger orbit_security_message_identity before update on public.messages
for each row execute function public.orbit_security_message_identity();
revoke all on function public.orbit_security_message_identity() from public,anon,authenticated;

drop policy if exists orbit_security_rooms_member on public.rooms;
create policy orbit_security_rooms_member on public.rooms as restrictive for select to authenticated
using(public.orbit_security_can_access(id::text));
drop policy if exists orbit_security_rooms_create on public.rooms;
create policy orbit_security_rooms_create on public.rooms as restrictive for insert to authenticated
with check(created_by=auth.uid() and auth.uid()=any(participants));
drop policy if exists orbit_security_rooms_update on public.rooms;
create policy orbit_security_rooms_update on public.rooms as restrictive for update to authenticated
using(public.orbit_security_can_access(id::text)) with check(true);
drop policy if exists orbit_security_room_changes on public.rooms;
create policy orbit_security_room_changes on public.rooms for update to authenticated
using(public.orbit_security_can_access(id::text)) with check(true);

create or replace function public.orbit_security_room_identity()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') then
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by
    or new.is_direct is distinct from old.is_direct then
   raise exception 'Room identity cannot be changed' using errcode='42501';
  end if;
  if old.is_direct and new.participants is distinct from old.participants then
   raise exception 'Direct chat participants cannot be changed' using errcode='42501';
  end if;
  if old.created_by<>auth.uid() and (
    (to_jsonb(new)-'participants'-'updated_at') is distinct from (to_jsonb(old)-'participants'-'updated_at')
    or new.participants is distinct from array_remove(old.participants,auth.uid())) then
   raise exception 'Only the creator can edit a group; members may only leave' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists orbit_security_room_identity on public.rooms;
create trigger orbit_security_room_identity before update on public.rooms
for each row execute function public.orbit_security_room_identity();
revoke all on function public.orbit_security_room_identity() from public,anon,authenticated;

drop policy if exists orbit_security_members_read on public.room_members;
create policy orbit_security_members_read on public.room_members as restrictive for select to authenticated
using(public.orbit_security_can_access(room_id::text));
drop policy if exists orbit_security_members_insert on public.room_members;
create policy orbit_security_members_insert on public.room_members as restrictive for insert to authenticated
with check(exists(select 1 from public.rooms r where r.id=room_id and r.created_by=auth.uid()));

-- Obsolete tables are not used by the current client. Preserve rows; deny APIs.
do $$ declare t text; begin
 foreach t in array array['Messaging','reactions','room_meta'] loop
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
end $$;
drop policy if exists orbit_security_pinned_owner on public.pinned_messages;
create policy orbit_security_pinned_owner on public.pinned_messages as restrictive for all to authenticated
using(pinned_by=auth.uid()) with check(pinned_by=auth.uid());

-- Directory email cannot be forged to impersonate the verified administrator.
create or replace function public.orbit_security_presence_email()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') then
  if new.user_id is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
  new.email:=auth.jwt()->>'email';
 end if;
 return new;
end $$;
drop trigger if exists orbit_security_presence_email on public.user_presence;
create trigger orbit_security_presence_email before insert or update on public.user_presence
for each row execute function public.orbit_security_presence_email();
revoke all on function public.orbit_security_presence_email() from public,anon,authenticated;

drop policy if exists orbit_security_friend_sender on public.friends;
create policy orbit_security_friend_sender on public.friends as restrictive for insert to authenticated
with check(user_id=auth.uid() and friend_id<>auth.uid() and status='pending');
drop policy if exists orbit_security_friend_recipient on public.friends;
create policy orbit_security_friend_recipient on public.friends as restrictive for update to authenticated
using(friend_id=auth.uid() and status='pending') with check(friend_id=auth.uid() and status='accepted');
create or replace function public.orbit_security_friend_identity()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
  raise exception 'Friend request identity cannot be changed' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists orbit_security_friend_identity on public.friends;
create trigger orbit_security_friend_identity before update on public.friends
for each row execute function public.orbit_security_friend_identity();
revoke all on function public.orbit_security_friend_identity() from public,anon,authenticated;
drop policy if exists orbit_security_request_sender on public.friend_requests;
create policy orbit_security_request_sender on public.friend_requests as restrictive for insert to authenticated
with check(from_user_id=auth.uid());
drop policy if exists orbit_security_request_no_update on public.friend_requests;
create policy orbit_security_request_no_update on public.friend_requests as restrictive for update to authenticated using(false) with check(false);

-- Broadcast channels carrying chat metadata require the same membership checks.
drop policy if exists orbit_security_chat_broadcast_read on realtime.messages;
create policy orbit_security_chat_broadcast_read on realtime.messages for select to authenticated
using(extension='broadcast' and (
 (left(realtime.topic(),12)='chat_stream_' and public.orbit_security_can_access(substring(realtime.topic() from 13)))
 or (left(realtime.topic(),11)='orbit_fast_' and public.orbit_security_can_access(substring(realtime.topic() from 12)))));
drop policy if exists orbit_security_chat_broadcast_send on realtime.messages;
create policy orbit_security_chat_broadcast_send on realtime.messages for insert to authenticated
with check(extension='broadcast' and (
 (left(realtime.topic(),12)='chat_stream_' and public.orbit_security_can_access(substring(realtime.topic() from 13)))
 or (left(realtime.topic(),11)='orbit_fast_' and public.orbit_security_can_access(substring(realtime.topic() from 12)))));

-- Reactions are changed atomically for the caller; clients cannot edit peers' text.
create or replace function public.orbit_security_react(message_key uuid, emoji text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages; r jsonb; entry record; ids jsonb; was_set boolean; result jsonb;
begin
 if auth.uid() is null or length(emoji)<1 or length(emoji)>32 then raise exception 'Invalid reaction' using errcode='42501'; end if;
 select * into m from public.messages where id=message_key for update;
 if not found or not public.orbit_security_can_access(m.room) then raise exception 'Access denied' using errcode='42501'; end if;
 r:=coalesce(m.reply_to->'reactions',m.reactions,'{}'::jsonb);
 if jsonb_typeof(r)<>'object' then r:='{}'; end if;
 was_set:=coalesce(r->emoji ? auth.uid()::text,false);
 for entry in select * from jsonb_each(r) loop
  if jsonb_typeof(entry.value)='array' then
   select coalesce(jsonb_agg(value),'[]') into ids from jsonb_array_elements(entry.value) where value<>to_jsonb(auth.uid()::text);
   if ids='[]'::jsonb then r:=r-entry.key; else r:=jsonb_set(r,array[entry.key],ids); end if;
  else r:=r-entry.key; end if;
 end loop;
 if not was_set then r:=jsonb_set(r,array[emoji],coalesce(r->emoji,'[]')||to_jsonb(auth.uid()::text)); end if;
 result:=jsonb_set(case when jsonb_typeof(m.reply_to)='object' then m.reply_to else '{}'::jsonb end,'{reactions}',r);
 update public.messages set reply_to=result,reactions=r,
   metadata=jsonb_set(coalesce(m.metadata,'{}'),'{reactions}',r) where id=message_key;
 return r;
end $$;
revoke all on function public.orbit_security_react(uuid,text) from public,anon;
grant execute on function public.orbit_security_react(uuid,text) to authenticated;

create or replace function public.orbit_security_vote(message_key uuid, option_index integer)
returns void language plpgsql security definer set search_path='' as $$
declare m public.messages; att jsonb; poll jsonb; options jsonb; opt jsonb; voters jsonb; chosen boolean; i integer;
begin
 select * into m from public.messages where id=message_key for update;
 if auth.uid() is null or not found or not public.orbit_security_can_access(m.room) then raise exception 'Access denied' using errcode='42501'; end if;
 begin att:=m.attachments[1]::jsonb; exception when others then raise exception 'Invalid poll'; end;
 poll:=att->'poll'; options:=poll->'options';
 if jsonb_typeof(options)<>'array' or option_index is null or option_index<0 or option_index>=jsonb_array_length(options) then raise exception 'Invalid option'; end if;
 chosen:=coalesce(options->option_index->'voters' ? auth.uid()::text,false);
 for i in 0..jsonb_array_length(options)-1 loop
  opt:=options->i;
  voters:=case when jsonb_typeof(opt->'voters')='array' then opt->'voters' else '[]'::jsonb end;
  if coalesce((poll->>'multiple_answers')::boolean,false)=false or i=option_index then
   select coalesce(jsonb_agg(value),'[]') into voters from jsonb_array_elements(voters) where value<>to_jsonb(auth.uid()::text);
  end if;
  if i=option_index and not chosen then voters:=voters||to_jsonb(auth.uid()::text); end if;
  opt:=jsonb_set(opt,'{voters}',voters); options:=jsonb_set(options,array[i::text],opt);
 end loop;
 poll:=jsonb_set(poll,'{options}',options); att:=jsonb_set(att,'{poll}',poll);
 m.attachments[1]:=att::text;
 update public.messages set attachments=m.attachments where id=message_key;
end $$;
revoke all on function public.orbit_security_vote(uuid,integer) from public,anon;
grant execute on function public.orbit_security_vote(uuid,integer) to authenticated;

-- Storage reads validate BOTH the referenced object and the actual chat membership.
create or replace function public.orbit_security_media_access(object_name text, bucket_name text default 'chat-assets')
returns boolean language plpgsql stable security definer set search_path='' as $$
declare row_data record; attachment jsonb; raw jsonb; path text;
begin
 if auth.uid() is null then return false; end if;
 if bucket_name='avatars' then return true; end if;
 if bucket_name not in ('chat-assets','voice-notes','files','uploads') then return false; end if;
 if (storage.foldername(object_name))[case when bucket_name='chat-assets' then 2 else 1 end]=auth.uid()::text then return true; end if;
 -- Profile photos and group pictures are visible to signed-in directory users.
 if bucket_name='chat-assets' and (storage.foldername(object_name))[1] in ('avatars','group-avatars') then return true; end if;
 for row_data in select attachments from public.messages where public.orbit_security_can_access(room) and attachments is not null
   and sender_id::text=(storage.foldername(object_name))[case when bucket_name='chat-assets' then 2 else 1 end] loop
  for raw in select value from jsonb_array_elements(to_jsonb(row_data.attachments)) loop
   begin
    attachment:=case when jsonb_typeof(raw)='string' then (raw#>>'{}')::jsonb else raw end;
    path:=attachment->>'storage_path';
    if path=object_name and coalesce(attachment->>'storage_bucket','chat-assets')=bucket_name then return true; end if;
    path:=split_part(split_part(attachment->>'url','/'||bucket_name||'/',2),'?',1);
    if path=object_name then return true; end if;
   exception when others then null;
   end;
  end loop;
 end loop;
 return false;
end $$;
revoke all on function public.orbit_security_media_access(text,text) from public,anon;
grant execute on function public.orbit_security_media_access(text,text) to authenticated;
drop policy if exists orbit_security_storage_read on storage.objects;
create policy orbit_security_storage_read on storage.objects for select to authenticated
using(public.orbit_security_media_access(name,bucket_id));
drop policy if exists orbit_security_storage_read_boundary on storage.objects;
create policy orbit_security_storage_read_boundary on storage.objects as restrictive for select to anon,authenticated
using(auth.uid() is not null and public.orbit_security_media_access(name,bucket_id));
drop policy if exists orbit_security_storage_write_boundary on storage.objects;
create policy orbit_security_storage_write_boundary on storage.objects as restrictive for update to authenticated
using((storage.foldername(name))[case when bucket_id='chat-assets' then 2 else 1 end]=auth.uid()::text)
with check((storage.foldername(name))[case when bucket_id='chat-assets' then 2 else 1 end]=auth.uid()::text);
drop policy if exists orbit_security_storage_insert_boundary on storage.objects;
create policy orbit_security_storage_insert_boundary on storage.objects as restrictive for insert to authenticated
with check((bucket_id='chat-assets' and (storage.foldername(name))[2]=auth.uid()::text)
 or (bucket_id in ('avatars','voice-notes','files','uploads','orbit-view-once') and (storage.foldername(name))[1]=auth.uid()::text));
drop policy if exists orbit_security_storage_delete_boundary on storage.objects;
create policy orbit_security_storage_delete_boundary on storage.objects as restrictive for delete to authenticated
using((bucket_id='chat-assets' and (storage.foldername(name))[2]=auth.uid()::text)
 or (bucket_id in ('avatars','voice-notes','files','uploads') and (storage.foldername(name))[1]=auth.uid()::text));

-- No file is deleted. Existing public URLs stop authorizing reads.
update storage.buckets set public=false where id in ('chat-assets','voice-notes','files','uploads','avatars');
notify pgrst,'reload schema';
commit;
