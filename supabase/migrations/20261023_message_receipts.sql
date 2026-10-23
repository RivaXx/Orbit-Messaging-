begin;
alter table public.messages add column if not exists delivered_to uuid[] not null default '{}';

create or replace function public.orbit_guard_receipts()
returns trigger language plpgsql set search_path='' as $$
declare viewer uuid:=auth.uid(); added uuid;
begin
 if viewer is null then return new; end if;
 if tg_op='INSERT' then new.read_by:='{}';new.delivered_to:='{}';return new;end if;
 if new.read_by is not distinct from old.read_by and new.delivered_to is not distinct from old.delivered_to then return new;end if;
 if viewer=new.sender_id or not public.orbit_is_room_member(new.room,viewer) then raise exception 'Cannot forge receipts';end if;
 if not(coalesce(new.read_by,'{}') @> coalesce(old.read_by,'{}')) or not(coalesce(new.delivered_to,'{}') @> coalesce(old.delivered_to,'{}')) then raise exception 'Receipts cannot be removed';end if;
 for added in select unnest(coalesce(new.read_by,'{}')) except select unnest(coalesce(old.read_by,'{}')) loop
  if added<>viewer then raise exception 'Cannot acknowledge another recipient';end if;
 end loop;
 for added in select unnest(coalesce(new.delivered_to,'{}')) except select unnest(coalesce(old.delivered_to,'{}')) loop
  if added<>viewer then raise exception 'Cannot acknowledge another recipient';end if;
 end loop;
 return new;
end;$$;
-- The trigger runs as the caller's context but invokes the private membership
-- helper through its definer, without granting that helper to clients.
alter function public.orbit_guard_receipts() security definer;
revoke all on function public.orbit_guard_receipts() from public,anon,authenticated;
drop trigger if exists orbit_receipt_guard on public.messages;
create trigger orbit_receipt_guard before insert or update on public.messages for each row execute function public.orbit_guard_receipts();

create or replace function public.orbit_mark_messages_delivered(message_keys uuid[])
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or cardinality(message_keys)>100 then raise exception 'Invalid acknowledgement';end if;
 update public.messages m set delivered_to=array_append(coalesce(m.delivered_to,'{}'),auth.uid())
 where m.id=any(message_keys) and m.sender_id<>auth.uid() and public.orbit_is_room_member(m.room,auth.uid())
 and not(auth.uid()=any(coalesce(m.delivered_to,'{}')));
end;$$;
revoke all on function public.orbit_mark_messages_delivered(uuid[]) from public,anon;
grant execute on function public.orbit_mark_messages_delivered(uuid[]) to authenticated;

create or replace function public.orbit_mark_room_read(chat_room text,read_before timestamptz default now())
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.orbit_is_room_member(chat_room,auth.uid()) then raise exception 'Room access denied';end if;
 update public.messages m set read_by=case when auth.uid()=any(coalesce(m.read_by,'{}')) then m.read_by else array_append(coalesce(m.read_by,'{}'),auth.uid()) end,
 delivered_to=case when auth.uid()=any(coalesce(m.delivered_to,'{}')) then m.delivered_to else array_append(coalesce(m.delivered_to,'{}'),auth.uid()) end
 where m.room=chat_room and m.sender_id<>auth.uid() and m.created_at<=least(read_before,now())
 and (not(auth.uid()=any(coalesce(m.read_by,'{}'))) or not(auth.uid()=any(coalesce(m.delivered_to,'{}'))));
end;$$;
revoke all on function public.orbit_mark_room_read(text,timestamptz) from public,anon;
grant execute on function public.orbit_mark_room_read(text,timestamptz) to authenticated;
commit;
