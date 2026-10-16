-- Feature migration only. Independent of the postponed SECURITY_HARDENING.sql.
begin;
alter table public.messages add column if not exists edited_at timestamptz;

create or replace function public.orbit_guard_message_edit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if auth.role()='authenticated' then new.created_at:=now();new.edited_at:=null;end if;
  return new;
 end if;
 if auth.role()='authenticated' then
  if new.id is distinct from old.id or new.sender_id is distinct from old.sender_id
     or new.type is distinct from old.type or new.room is distinct from old.room or new.created_at is distinct from old.created_at then
   raise exception 'Message identity cannot be changed.' using errcode='42501';
  end if;
  new.edited_at:=old.edited_at;
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
revoke all on function public.orbit_guard_message_edit() from public,anon,authenticated;
drop trigger if exists orbit_message_edit_guard on public.messages;
create trigger orbit_message_edit_guard before insert or update on public.messages
for each row execute function public.orbit_guard_message_edit();

create or replace function public.orbit_edit_message(message_key uuid,new_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.messages;
begin
 if auth.uid() is null then raise exception 'Sign in to edit messages.' using errcode='42501';end if;
 select * into result from public.messages where id=message_key for update;
 if not found or result.sender_id<>auth.uid() or result.created_at<=now()-interval '10 minutes'
    or result.created_at>now() or coalesce(result.type,'text')<>'text'
    or jsonb_array_length(coalesce(to_jsonb(result.attachments),'[]'::jsonb))>0
    or not (result.room::text='self_'||auth.uid()::text or public.orbit_is_room_member(result.room::text,auth.uid())) then
  raise exception 'The 10-minute edit window has ended, or this message cannot be edited.' using errcode='42501';
 end if;
 if length(btrim(coalesce(new_text,'')))=0 or length(new_text)>10000 then
  raise exception 'Enter a message between 1 and 10000 characters.';
 end if;
 update public.messages set text=btrim(new_text),edited_at=now() where id=message_key returning * into result;
 return to_jsonb(result);
end; $$;

create table if not exists public.orbit_original_photo_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 message_id uuid not null, photo_index integer not null check(photo_index>=0),
 usage_day date not null default (now() at time zone 'UTC')::date,
 primary key(user_id,message_id,photo_index)
);
alter table public.orbit_original_photo_usage enable row level security;
revoke all on public.orbit_original_photo_usage from public,anon,authenticated;

create or replace function public.orbit_original_photo_allowance()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare unlimited boolean; used integer;
begin
 if auth.uid() is null then raise exception 'Sign in to use original quality.' using errcode='42501';end if;
 select lower(email) in ('rivaldo.a.rodrigues@gmail.com','rivacolony@gmail.com') into unlimited from auth.users where id=auth.uid();
 select count(*) into used from public.orbit_original_photo_usage
  where user_id=auth.uid() and usage_day=(now() at time zone 'UTC')::date;
 return jsonb_build_object('unlimited',coalesce(unlimited,false),'used',used,'remaining',greatest(0,10-used),'limit',10,'resetTimezone','UTC');
end; $$;

create or replace function public.orbit_reserve_original_photos(message_key uuid,photo_indexes integer[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare allowance jsonb; amount integer; indexes integer[];
begin
 if auth.uid() is null then raise exception 'Sign in to use original quality.' using errcode='42501';end if;
 if message_key is null or photo_indexes is null or cardinality(photo_indexes)>100 then raise exception 'Invalid photo selection.';end if;
 select array_agg(distinct value) into indexes from unnest(photo_indexes) value;
 if exists(select 1 from unnest(indexes) value where value is null or value<0 or value>99) then raise exception 'Invalid photo index.';end if;
 -- Serialize every reservation for this account, including simultaneous devices.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 allowance:=public.orbit_original_photo_allowance();
 select count(*) into amount from unnest(indexes) value where not exists(
  select 1 from public.orbit_original_photo_usage u where u.user_id=auth.uid() and u.message_id=message_key and u.photo_index=value);
 if not (allowance->>'unlimited')::boolean and amount>(allowance->>'remaining')::integer then
  raise exception 'Original-quality limit reached. % of 10 photos remain today (UTC). Choose fewer originals or use Standard / HD.',allowance->>'remaining';
 end if;
 insert into public.orbit_original_photo_usage(user_id,message_id,photo_index)
  select auth.uid(),message_key,value from unnest(indexes) value on conflict do nothing;
 return public.orbit_original_photo_allowance();
end; $$;
revoke all on function public.orbit_edit_message(uuid,text),public.orbit_original_photo_allowance(),public.orbit_reserve_original_photos(uuid,integer[]) from public,anon;
grant execute on function public.orbit_edit_message(uuid,text),public.orbit_original_photo_allowance(),public.orbit_reserve_original_photos(uuid,integer[]) to authenticated;
notify pgrst,'reload schema';
commit;
