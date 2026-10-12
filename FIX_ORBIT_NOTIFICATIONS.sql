begin;

-- Membership checks require exact identities, including unambiguous legacy DMs.
create or replace function public.orbit_is_room_member(chat_room text, viewer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
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
$$;
revoke all on function public.orbit_is_room_member(text,uuid) from public,anon,authenticated;

create or replace function public.orbit_unread_counts()
returns table(room text,unread_count bigint) language sql stable security definer set search_path = '' as $$
select m.room,count(*) from public.messages m
where auth.uid() is not null and m.sender_id<>auth.uid()
and public.orbit_is_room_member(m.room,auth.uid())
and not (auth.uid() = any(coalesce(m.read_by,'{}'::uuid[])))
group by m.room;
$$;
revoke all on function public.orbit_unread_counts() from public,anon;
grant execute on function public.orbit_unread_counts() to authenticated;

create or replace function public.orbit_mark_room_read(chat_room text,read_before timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or not public.orbit_is_room_member(chat_room,auth.uid()) then
        raise exception 'Room access denied';
    end if;
    update public.messages m set read_by=array_append(coalesce(m.read_by,'{}'::uuid[]),auth.uid())
    where m.room=chat_room and m.sender_id<>auth.uid() and m.created_at<=read_before
    and not(auth.uid()=any(coalesce(m.read_by,'{}'::uuid[])));
end;
$$;
revoke all on function public.orbit_mark_room_read(text,timestamptz) from public,anon;
grant execute on function public.orbit_mark_room_read(text,timestamptz) to authenticated;

create table if not exists public.orbit_push_subscriptions (
    endpoint text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    subscription jsonb not null,
    previews boolean not null default true,
    muted_rooms text[] not null default '{}',
    updated_at timestamptz not null default now(),
    constraint orbit_push_endpoint_valid check (
        endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-zA-Z0-9-]+[.]notify[.]windows[.]com|[a-zA-Z0-9-]+[.]notifications[.]windows[.]com)/'
        and length(endpoint)<4096 and subscription->>'endpoint'=endpoint
        and length(subscription->'keys'->>'p256dh') between 80 and 100
        and length(subscription->'keys'->>'auth') between 20 and 30
    )
);
alter table public.orbit_push_subscriptions enable row level security;
drop policy if exists "Orbit own push subscriptions" on public.orbit_push_subscriptions;
create policy "Orbit own push subscriptions" on public.orbit_push_subscriptions
for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.orbit_push_subscriptions to authenticated;
revoke all on public.orbit_push_subscriptions from anon;

create table if not exists public.orbit_push_settings (id boolean primary key default true check(id),public_key text not null);
alter table public.orbit_push_settings enable row level security;
revoke all on public.orbit_push_settings from anon,authenticated;
create or replace function public.orbit_push_public_config()
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('publicKey',public_key) from public.orbit_push_settings where id=true and auth.uid() is not null;
$$;
revoke all on function public.orbit_push_public_config() from public,anon;
grant execute on function public.orbit_push_public_config() to authenticated;

create or replace function public.orbit_push_message_recipients(message_id uuid)
returns table(user_id uuid) language sql stable security definer set search_path='' as $$
select u.id from auth.users u join public.messages m on m.id=message_id
where u.id<>m.sender_id and public.orbit_is_room_member(m.room,m.sender_id)
and public.orbit_is_room_member(m.room,u.id)
and not(u.id=any(coalesce(m.read_by,'{}'::uuid[])));
$$;
revoke all on function public.orbit_push_message_recipients(uuid) from public,anon,authenticated;
grant execute on function public.orbit_push_message_recipients(uuid) to service_role;

commit;
