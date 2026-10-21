-- Private, short-lived typing signals only; no messages or drafts are stored.
begin;
create or replace function public.orbit_typing_can_access()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); chat_room text:=substring(realtime.topic() from 14); peer uuid;
begin
 if left(realtime.topic(),13)<>'orbit_typing_' or viewer is null or not public.orbit_is_room_member(chat_room,viewer) then return false; end if;
 peer:=public.orbit_direct_peer(chat_room,viewer);
 if peer is not null and public.orbit_pair_blocked(viewer,peer) then return false; end if;
 return true;
end; $$;
revoke all on function public.orbit_typing_can_access() from public,anon;
grant execute on function public.orbit_typing_can_access() to authenticated;
drop policy if exists "Orbit private typing receive" on realtime.messages;
create policy "Orbit private typing receive" on realtime.messages for select to authenticated using (
 extension='broadcast' and public.orbit_typing_can_access()
);
drop policy if exists "Orbit private typing send" on realtime.messages;
create policy "Orbit private typing send" on realtime.messages for insert to authenticated with check (
 extension='broadcast' and public.orbit_typing_can_access()
);
grant select,insert on realtime.messages to authenticated;
commit;
