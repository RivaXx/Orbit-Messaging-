-- Idempotent migration: no existing messages are deleted by applying this file.
begin;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists expires_at timestamptz;
create index if not exists orbit_location_expiry on public.messages(expires_at) where deleted_at is null and expires_at is not null;
create or replace function public.orbit_guard_message_edit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if auth.role()='authenticated' then
   new.created_at:=now();new.edited_at:=null;new.deleted_at:=null;
   if new.type='location' then new.expires_at:=now()+interval '5 minutes'; else new.expires_at:=null; end if;
  end if;
  return new;
 end if;
 if auth.role()='authenticated' then
  if new.id is distinct from old.id or new.sender_id is distinct from old.sender_id
     or new.type is distinct from old.type or new.room is distinct from old.room or new.created_at is distinct from old.created_at then
   raise exception 'Message identity cannot be changed.' using errcode='42501';
  end if;
  new.edited_at:=old.edited_at;
  if old.deleted_at is not null then
   if new.text is distinct from old.text or new.attachments is distinct from old.attachments
      or new.reply_to is distinct from old.reply_to or new.deleted_at is distinct from old.deleted_at then
    raise exception 'Deleted messages cannot be restored.' using errcode='42501';
   end if;
   return new;
  end if;
  if new.deleted_at is not null then
   if old.sender_id is distinct from auth.uid() or
      not (old.room::text='self_'||auth.uid()::text or public.orbit_is_room_member(old.room::text,auth.uid())) then
    raise exception 'Only the sender can delete this message.' using errcode='42501';
   end if;
   new.deleted_at:=now();new.text:='🚫 This message was deleted';new.attachments:=ARRAY[]::text[];new.reply_to:=null;
   return new;
  end if;
  if new.expires_at is distinct from old.expires_at then
   raise exception 'Location expiry cannot be extended.' using errcode='42501';
  end if;
  if new.text is distinct from old.text and coalesce(old.type,'text')='text' then
   if old.sender_id<>auth.uid() or old.created_at<=now()-interval '10 minutes'
      or old.created_at>now() or coalesce(old.type,'text')<>'text'
      or jsonb_array_length(coalesce(to_jsonb(old.attachments),'[]'::jsonb))>0
      or not (old.room::text='self_'||auth.uid()::text or public.orbit_is_room_member(old.room::text,auth.uid())) then
    raise exception 'Only your own text messages can be edited within 10 minutes.' using errcode='42501';
   end if;
   if length(btrim(coalesce(new.text,'')))=0 or length(new.text)>10000 then
    raise exception 'Enter a message between 1 and 10000 characters.';
   end if;
   new.edited_at:=now();
  end if;
 end if;
 return new;
end; $$;

create or replace function public.orbit_delete_messages(message_keys uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; allowed integer;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 if coalesce(cardinality(message_keys),0) not between 1 and 100 then raise exception 'Select between 1 and 100 messages.'; end if;
 -- Lock first so edit/delete races cannot bring content back.
 perform 1 from public.messages where id=any(message_keys) for update;
 select count(distinct id) into allowed from public.messages where id=any(message_keys) and sender_id=auth.uid()
  and (room::text='self_'||auth.uid()::text or public.orbit_is_room_member(room::text,auth.uid()));
 if allowed<>(select count(distinct key) from unnest(message_keys) key) then
  raise exception 'You can only delete your own messages in your conversations.' using errcode='42501';
 end if;
 update public.messages set deleted_at=now(),text='🚫 This message was deleted',attachments=ARRAY[]::text[],reply_to=null
  where id=any(message_keys) and deleted_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'room',room,'deleted_at',deleted_at,'text',text,'attachments',attachments,'type',type)), '[]'::jsonb)
  into result from public.messages where id=any(message_keys);
 return result;
end; $$;
revoke all on function public.orbit_delete_messages(uuid[]) from public,anon;
grant execute on function public.orbit_delete_messages(uuid[]) to authenticated;

-- Server expiry scrubs coordinates even while every browser is closed.
create or replace function public.orbit_expire_locations()
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.messages set deleted_at=now(),text='🚫 This message was deleted',attachments=ARRAY[]::text[],reply_to=null
 where type='location' and expires_at<=now() and deleted_at is null;
end; $$;
revoke all on function public.orbit_expire_locations() from public,anon,authenticated;
-- Quoted locations must not retain a coordinate copy after the original expires.
create or replace function public.orbit_scrub_location_quote()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.reply_to is not null and to_jsonb(new.reply_to)->>'type'='location' then
  new.reply_to:=jsonb_set(to_jsonb(new.reply_to),'{text}','"Location shared for 5 minutes"'::jsonb);
 end if;
 return new;
end; $$;
drop trigger if exists orbit_scrub_location_quote on public.messages;
create trigger orbit_scrub_location_quote before insert or update on public.messages
for each row execute function public.orbit_scrub_location_quote();
revoke all on function public.orbit_guard_message_edit() from public,anon,authenticated;
drop trigger if exists orbit_message_edit_guard on public.messages;
create trigger orbit_message_edit_guard before insert or update on public.messages
for each row execute function public.orbit_guard_message_edit();
commit;

-- Enable Supabase Cron before applying this scheduler block.
create extension if not exists pg_cron;
do $$ begin
 if not exists(select 1 from cron.job where jobname='orbit-expire-locations') then
  perform cron.schedule('orbit-expire-locations','* * * * *','select public.orbit_expire_locations()');
 end if;
end $$;
notify pgrst,'reload schema';
