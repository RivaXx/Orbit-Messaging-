create or replace function public.orbit_typing_can_access()
returns boolean language sql stable security definer set search_path='' as $$
select left(realtime.topic(),13)='orbit_typing_'
and public.orbit_is_room_member(substring(realtime.topic() from 14),auth.uid());
$$;
revoke all on function public.orbit_typing_can_access() from public,anon;
grant execute on function public.orbit_typing_can_access() to authenticated;
drop policy if exists "Orbit private typing receive" on realtime.messages;
create policy "Orbit private typing receive" on realtime.messages for select to authenticated
using(extension='broadcast' and public.orbit_typing_can_access());
drop policy if exists "Orbit private typing send" on realtime.messages;
create policy "Orbit private typing send" on realtime.messages for insert to authenticated
with check(extension='broadcast' and public.orbit_typing_can_access());
grant select,insert on realtime.messages to authenticated;
do $$ begin
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
        alter publication supabase_realtime add table public.messages;
    end if;
end $$;
