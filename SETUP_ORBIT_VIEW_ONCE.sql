begin;
create table public.orbit_view_once_receipts (
 message_id uuid not null references public.messages(id) on delete cascade,
 viewer_id uuid not null references auth.users(id) on delete cascade,
 opened_at timestamptz not null default now(),primary key(message_id,viewer_id)
);
alter table public.orbit_view_once_receipts enable row level security;
create policy "Orbit own view-once receipts" on public.orbit_view_once_receipts for select to authenticated using(viewer_id=auth.uid());
revoke all on public.orbit_view_once_receipts from authenticated;
grant select on public.orbit_view_once_receipts to authenticated;
revoke all on public.orbit_view_once_receipts from anon;
create function public.orbit_claim_view_once(message_key uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.messages; att jsonb; has_once boolean:=false;
begin
 select * into m from public.messages where id=message_key;
 if not found or auth.uid() is null or auth.uid()=m.sender_id or not public.orbit_is_room_member(m.room::text,auth.uid()) or public.orbit_pair_blocked(auth.uid(),m.sender_id) then return false;end if;
 for att in select value from jsonb_array_elements(to_jsonb(m.attachments)) loop
  begin
   if jsonb_typeof(att)='string' then att:=(att#>>'{}')::jsonb;end if;
   if att->>'view_once'='true' then has_once:=true;end if;
  exception when others then null;
  end;
 end loop;
 if not has_once then return false;end if;
 insert into public.orbit_view_once_receipts(message_id,viewer_id) values(message_key,auth.uid()) on conflict do nothing;
 return found;
end;$$;
revoke all on function public.orbit_claim_view_once(uuid) from public,anon;
grant execute on function public.orbit_claim_view_once(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
