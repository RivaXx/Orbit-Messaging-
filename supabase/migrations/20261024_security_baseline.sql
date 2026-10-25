-- Recorded production security baseline, 2026-10-24.
-- Existing Orbit schema is required. No chat or storage data is modified.
-- Apply before 20261024_security_hardening.sql on an existing legacy Orbit project.
begin;
CREATE OR REPLACE FUNCTION public.orbit_security_vote(message_key uuid, option_index integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
revoke all on function public."orbit_security_vote"(uuid, integer) from public,anon,authenticated;
grant execute on function public."orbit_security_vote"(uuid, integer) to authenticated;
CREATE OR REPLACE FUNCTION public.orbit_is_room_member(chat_room text, viewer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select viewer is not null and (
    exists(select 1 from public.rooms r where r.id::text=chat_room
        and (r.created_by::text=viewer::text or to_jsonb(r.participants) ? viewer::text))
    or (left(chat_room,3)='dm_' and split_part(chat_room,'_',4)=''
        and split_part(chat_room,'_',2) <> split_part(chat_room,'_',3)
        and (viewer::text in (split_part(chat_room,'_',2),split_part(chat_room,'_',3))
            or left(viewer::text,12) in (split_part(chat_room,'_',2),split_part(chat_room,'_',3)))
        and (select count(*) from auth.users u where u.id::text=split_part(chat_room,'_',2)
            or (length(split_part(chat_room,'_',2))=12 and left(u.id::text,12)=split_part(chat_room,'_',2)))=1
        and (select count(*) from auth.users u where u.id::text=split_part(chat_room,'_',3)
            or (length(split_part(chat_room,'_',3))=12 and left(u.id::text,12)=split_part(chat_room,'_',3)))=1)
);
$function$
;
revoke all on function public."orbit_is_room_member"(text, uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_react(message_key uuid, emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
revoke all on function public."orbit_security_react"(uuid, text) from public,anon,authenticated;
grant execute on function public."orbit_security_react"(uuid, text) to authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_can_access(chat_room text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and (chat_room='self_'||auth.uid()::text
   or public.orbit_is_room_member(chat_room,auth.uid()));
$function$
;
revoke all on function public."orbit_security_can_access"(text) from public,anon,authenticated;
grant execute on function public."orbit_security_can_access"(text) to authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_media_access(object_name text, bucket_name text DEFAULT 'chat-assets'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
revoke all on function public."orbit_security_media_access"(text, text) from public,anon,authenticated;
grant execute on function public."orbit_security_media_access"(text, text) to authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_room_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$
;
revoke all on function public."orbit_security_room_identity"() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_presence_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('authenticated','anon') then
  if new.user_id is distinct from auth.uid() then raise exception 'Access denied' using errcode='42501'; end if;
  new.email:=auth.jwt()->>'email';
 end if;
 return new;
end $function$
;
revoke all on function public."orbit_security_presence_email"() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_friend_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('authenticated','anon') and (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then
  raise exception 'Friend request identity cannot be changed' using errcode='42501';
 end if;
 return new;
end $function$
;
revoke all on function public."orbit_security_friend_identity"() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_message_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user in ('authenticated','anon') and
   (new.id is distinct from old.id or new.sender_id is distinct from old.sender_id
    or new.room is distinct from old.room or new.created_at is distinct from old.created_at) then
  raise exception 'Message identity cannot be changed' using errcode='42501';
 end if;
 return new;
end $function$
;
revoke all on function public."orbit_security_message_identity"() from public,anon,authenticated;
drop policy if exists "orbit_security_no_anon" on "public"."Messaging";
create policy "orbit_security_no_anon" on "public"."Messaging" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."personal_chats";
create policy "orbit_security_no_anon" on "public"."personal_chats" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."user_profiles";
create policy "orbit_security_no_anon" on "public"."user_profiles" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."error_logs";
create policy "orbit_security_no_anon" on "public"."error_logs" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_cleanup_settings";
create policy "orbit_security_no_anon" on "public"."orbit_cleanup_settings" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."contacts";
create policy "orbit_security_no_anon" on "public"."contacts" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."personal_chat_messages";
create policy "orbit_security_no_anon" on "public"."personal_chat_messages" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."pinned_messages";
create policy "orbit_security_no_anon" on "public"."pinned_messages" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_cleanup_queue";
create policy "orbit_security_no_anon" on "public"."orbit_cleanup_queue" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_push_subscriptions";
create policy "orbit_security_no_anon" on "public"."orbit_push_subscriptions" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."reactions";
create policy "orbit_security_no_anon" on "public"."reactions" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."room_meta";
create policy "orbit_security_no_anon" on "public"."room_meta" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_push_settings";
create policy "orbit_security_no_anon" on "public"."orbit_push_settings" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."friends";
create policy "orbit_security_no_anon" on "public"."friends" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."secure_notes";
create policy "orbit_security_no_anon" on "public"."secure_notes" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."friend_requests";
create policy "orbit_security_no_anon" on "public"."friend_requests" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."room_members";
create policy "orbit_security_no_anon" on "public"."room_members" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_user_blocks";
create policy "orbit_security_no_anon" on "public"."orbit_user_blocks" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_scheduled_messages";
create policy "orbit_security_no_anon" on "public"."orbit_scheduled_messages" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_calls";
create policy "orbit_security_no_anon" on "public"."orbit_calls" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_call_signals";
create policy "orbit_security_no_anon" on "public"."orbit_call_signals" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."orbit_view_once_receipts";
create policy "orbit_security_no_anon" on "public"."orbit_view_once_receipts" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."rooms";
create policy "orbit_security_no_anon" on "public"."rooms" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."messages";
create policy "orbit_security_no_anon" on "public"."messages" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_no_anon" on "public"."user_presence";
create policy "orbit_security_no_anon" on "public"."user_presence" as RESTRICTIVE for ALL to "anon" using (false) with check (false);
drop policy if exists "orbit_security_message_member" on "public"."messages";
create policy "orbit_security_message_member" on "public"."messages" as RESTRICTIVE for ALL to "authenticated" using (orbit_security_can_access(room)) with check (orbit_security_can_access(room));
drop policy if exists "orbit_security_message_sender_insert" on "public"."messages";
create policy "orbit_security_message_sender_insert" on "public"."messages" as RESTRICTIVE for INSERT to "authenticated" with check ((sender_id = auth.uid()));
drop policy if exists "orbit_security_message_sender_delete" on "public"."messages";
create policy "orbit_security_message_sender_delete" on "public"."messages" as RESTRICTIVE for DELETE to "authenticated" using ((sender_id = auth.uid()));
drop policy if exists "orbit_security_rooms_member" on "public"."rooms";
create policy "orbit_security_rooms_member" on "public"."rooms" as RESTRICTIVE for SELECT to "authenticated" using (orbit_security_can_access((id)::text));
drop policy if exists "orbit_security_rooms_create" on "public"."rooms";
create policy "orbit_security_rooms_create" on "public"."rooms" as RESTRICTIVE for INSERT to "authenticated" with check (((created_by = auth.uid()) AND (auth.uid() = ANY (participants))));
drop policy if exists "orbit_security_rooms_update" on "public"."rooms";
create policy "orbit_security_rooms_update" on "public"."rooms" as RESTRICTIVE for UPDATE to "authenticated" using (orbit_security_can_access((id)::text)) with check (true);
drop policy if exists "orbit_security_room_changes" on "public"."rooms";
create policy "orbit_security_room_changes" on "public"."rooms" as PERMISSIVE for UPDATE to "authenticated" using (orbit_security_can_access((id)::text)) with check (true);
drop policy if exists "orbit_security_members_read" on "public"."room_members";
create policy "orbit_security_members_read" on "public"."room_members" as RESTRICTIVE for SELECT to "authenticated" using (orbit_security_can_access((room_id)::text));
drop policy if exists "orbit_security_members_insert" on "public"."room_members";
create policy "orbit_security_members_insert" on "public"."room_members" as RESTRICTIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM rooms r
  WHERE ((r.id = room_members.room_id) AND (r.created_by = auth.uid())))));
drop policy if exists "orbit_security_pinned_owner" on "public"."pinned_messages";
create policy "orbit_security_pinned_owner" on "public"."pinned_messages" as RESTRICTIVE for ALL to "authenticated" using ((pinned_by = auth.uid())) with check ((pinned_by = auth.uid()));
drop policy if exists "orbit_security_friend_sender" on "public"."friends";
create policy "orbit_security_friend_sender" on "public"."friends" as RESTRICTIVE for INSERT to "authenticated" with check (((user_id = auth.uid()) AND (friend_id <> auth.uid()) AND (status = 'pending'::text)));
drop policy if exists "orbit_security_friend_recipient" on "public"."friends";
create policy "orbit_security_friend_recipient" on "public"."friends" as RESTRICTIVE for UPDATE to "authenticated" using (((friend_id = auth.uid()) AND (status = 'pending'::text))) with check (((friend_id = auth.uid()) AND (status = 'accepted'::text)));
drop policy if exists "orbit_security_request_sender" on "public"."friend_requests";
create policy "orbit_security_request_sender" on "public"."friend_requests" as RESTRICTIVE for INSERT to "authenticated" with check ((from_user_id = auth.uid()));
drop policy if exists "orbit_security_request_no_update" on "public"."friend_requests";
create policy "orbit_security_request_no_update" on "public"."friend_requests" as RESTRICTIVE for UPDATE to "authenticated" using (false) with check (false);
drop policy if exists "orbit_security_chat_broadcast_read" on "realtime"."messages";
create policy "orbit_security_chat_broadcast_read" on "realtime"."messages" as PERMISSIVE for SELECT to "authenticated" using (((extension = 'broadcast'::text) AND ((("left"(realtime.topic(), 12) = 'chat_stream_'::text) AND orbit_security_can_access(SUBSTRING(realtime.topic() FROM 13))) OR (("left"(realtime.topic(), 11) = 'orbit_fast_'::text) AND orbit_security_can_access(SUBSTRING(realtime.topic() FROM 12))))));
drop policy if exists "orbit_security_chat_broadcast_send" on "realtime"."messages";
create policy "orbit_security_chat_broadcast_send" on "realtime"."messages" as PERMISSIVE for INSERT to "authenticated" with check (((extension = 'broadcast'::text) AND ((("left"(realtime.topic(), 12) = 'chat_stream_'::text) AND orbit_security_can_access(SUBSTRING(realtime.topic() FROM 13))) OR (("left"(realtime.topic(), 11) = 'orbit_fast_'::text) AND orbit_security_can_access(SUBSTRING(realtime.topic() FROM 12))))));
drop policy if exists "orbit_security_storage_read" on "storage"."objects";
create policy "orbit_security_storage_read" on "storage"."objects" as PERMISSIVE for SELECT to "authenticated" using (orbit_security_media_access(name, bucket_id));
drop policy if exists "orbit_security_storage_read_boundary" on "storage"."objects";
create policy "orbit_security_storage_read_boundary" on "storage"."objects" as RESTRICTIVE for SELECT to "anon", "authenticated" using (((auth.uid() IS NOT NULL) AND orbit_security_media_access(name, bucket_id)));
drop policy if exists "orbit_security_storage_write_boundary" on "storage"."objects";
create policy "orbit_security_storage_write_boundary" on "storage"."objects" as RESTRICTIVE for UPDATE to "authenticated" using (((storage.foldername(name))[
CASE
    WHEN (bucket_id = 'chat-assets'::text) THEN 2
    ELSE 1
END] = (auth.uid())::text)) with check (((storage.foldername(name))[
CASE
    WHEN (bucket_id = 'chat-assets'::text) THEN 2
    ELSE 1
END] = (auth.uid())::text));
drop policy if exists "orbit_security_storage_insert_boundary" on "storage"."objects";
create policy "orbit_security_storage_insert_boundary" on "storage"."objects" as RESTRICTIVE for INSERT to "authenticated" with check ((((bucket_id = 'chat-assets'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)) OR ((bucket_id = ANY (ARRAY['avatars'::text, 'voice-notes'::text, 'files'::text, 'uploads'::text, 'orbit-view-once'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text))));
drop policy if exists "orbit_security_storage_delete_boundary" on "storage"."objects";
create policy "orbit_security_storage_delete_boundary" on "storage"."objects" as RESTRICTIVE for DELETE to "authenticated" using ((((bucket_id = 'chat-assets'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)) OR ((bucket_id = ANY (ARRAY['avatars'::text, 'voice-notes'::text, 'files'::text, 'uploads'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text))));
drop trigger if exists "orbit_security_message_identity" on public.messages;
CREATE TRIGGER orbit_security_message_identity BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION orbit_security_message_identity();
drop trigger if exists "orbit_security_room_identity" on public.rooms;
CREATE TRIGGER orbit_security_room_identity BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION orbit_security_room_identity();
drop trigger if exists "orbit_security_presence_email" on public.user_presence;
CREATE TRIGGER orbit_security_presence_email BEFORE INSERT OR UPDATE ON public.user_presence FOR EACH ROW EXECUTE FUNCTION orbit_security_presence_email();
drop trigger if exists "orbit_security_friend_identity" on public.friends;
CREATE TRIGGER orbit_security_friend_identity BEFORE UPDATE ON public.friends FOR EACH ROW EXECUTE FUNCTION orbit_security_friend_identity();
commit;
