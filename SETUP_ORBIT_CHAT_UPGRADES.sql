-- Server-enforced blocks, durable scheduling and participant-only call signaling.
begin;
create table if not exists public.orbit_user_blocks (
 blocker uuid references auth.users(id) on delete cascade,
 blocked uuid references auth.users(id) on delete cascade,
 primary key(blocker,blocked), check(blocker<>blocked)
);
alter table public.orbit_user_blocks enable row level security;
create policy "Orbit own blocks" on public.orbit_user_blocks for all to authenticated
 using(blocker=auth.uid()) with check(blocker=auth.uid());
revoke all on public.orbit_user_blocks from authenticated;
grant select,insert,delete on public.orbit_user_blocks to authenticated;
revoke all on public.orbit_user_blocks from anon;

create or replace function public.orbit_pair_blocked(a uuid,b uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orbit_user_blocks where (blocker=a and blocked=b) or (blocker=b and blocked=a));
$$;
revoke all on function public.orbit_pair_blocked(uuid,uuid) from public,anon,authenticated;
create or replace function public.orbit_direct_peer(chat_room text,viewer uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare parts text[]; candidate uuid; amount int;
begin
 if left(chat_room,3)='dm_' then
  parts:=string_to_array(substring(chat_room from 4),'_');
  if array_length(parts,1)<>2 then return null; end if;
  if parts[1] not in (viewer::text,left(viewer::text,12)) and parts[2] not in (viewer::text,left(viewer::text,12)) then return null; end if;
  select count(*),min(id::text)::uuid into amount,candidate from auth.users
   where id<>viewer and (id::text=any(parts) or left(id::text,12)=any(parts));
  if amount=1 then return candidate; end if;
 else
  select p.value::uuid into candidate from public.rooms r, lateral jsonb_array_elements_text(to_jsonb(r.participants)) p(value)
   where r.id::text=chat_room and r.is_direct=true and jsonb_array_length(to_jsonb(r.participants))=2
    and to_jsonb(r.participants) ? viewer::text and p.value<>viewer::text limit 1;
  return candidate;
 end if;
 return null;
end; $$;
revoke all on function public.orbit_direct_peer(text,uuid) from public,anon,authenticated;
create or replace function public.orbit_guard_message_block()
returns trigger language plpgsql security definer set search_path='' as $$
declare peer uuid;
begin
 if auth.uid() is not null and new.sender_id<>auth.uid() then raise exception 'Message sender must be the signed-in user.' using errcode='42501'; end if;
 peer:=public.orbit_direct_peer(new.room::text,new.sender_id);
 if peer is not null and public.orbit_pair_blocked(new.sender_id,peer) then
  raise exception 'Messaging is unavailable for this conversation.' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function public.orbit_guard_message_block() from public,anon,authenticated;
create trigger orbit_message_block_guard before insert on public.messages for each row execute function public.orbit_guard_message_block();

create table public.orbit_scheduled_messages (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references auth.users(id) on delete cascade,
 room text not null, text text not null check(length(text) between 1 and 32768),
 scheduled_at timestamptz not null, status text not null default 'pending' check(status in ('pending','sent','cancelled','failed')),
 sent_at timestamptz, error text, created_at timestamptz not null default now()
);
create index orbit_schedule_due on public.orbit_scheduled_messages(scheduled_at) where status='pending';
alter table public.orbit_scheduled_messages enable row level security;
create policy "Orbit own schedules" on public.orbit_scheduled_messages for select to authenticated using(sender_id=auth.uid());
revoke all on public.orbit_scheduled_messages from authenticated;
grant select on public.orbit_scheduled_messages to authenticated;
revoke all on public.orbit_scheduled_messages from anon;
create or replace function public.orbit_schedule_message(chat_room text,body text,send_at timestamptz,request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare peer uuid;
begin
 if auth.uid() is null or not public.orbit_is_room_member(chat_room,auth.uid()) or send_at<=now() or send_at>now()+interval '1 year' then
  raise exception 'Choose a future time and an accessible chat.';
 end if;
 peer:=public.orbit_direct_peer(chat_room,auth.uid());
 if peer is not null and public.orbit_pair_blocked(auth.uid(),peer) then raise exception 'Messaging is unavailable for this conversation.'; end if;
 insert into public.orbit_scheduled_messages(id,sender_id,room,text,scheduled_at)
 values(request_id,auth.uid(),chat_room,body,send_at) on conflict(id) do nothing;
 if not exists(select 1 from public.orbit_scheduled_messages where id=request_id and sender_id=auth.uid() and room=chat_room and text=body and scheduled_at=send_at) then raise exception 'Schedule request conflict.'; end if;
 return request_id;
end; $$;
create or replace function public.orbit_cancel_schedule(schedule_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.orbit_scheduled_messages set status='cancelled' where id=schedule_id and sender_id=auth.uid() and status='pending';
 return found;
end; $$;
create or replace function public.orbit_dispatch_schedules()
returns int language plpgsql security definer set search_path='' as $$
declare job record; count_sent int:=0; peer uuid;
begin
 for job in select * from public.orbit_scheduled_messages where status='pending' and scheduled_at<=now() order by scheduled_at limit 100 for update skip locked loop
  begin
   peer:=public.orbit_direct_peer(job.room,job.sender_id);
   if not public.orbit_is_room_member(job.room,job.sender_id) or (peer is not null and public.orbit_pair_blocked(job.sender_id,peer)) then
    update public.orbit_scheduled_messages set status='failed',error='Conversation unavailable or blocked.' where id=job.id;
   else
    insert into public.messages(id,room,sender_id,username,text,type,created_at)
    values(job.id,job.room,job.sender_id,coalesce((select first_name from public.user_profiles where user_id=job.sender_id limit 1),'Orbit user'),job.text,'text',now()) on conflict(id) do nothing;
    update public.orbit_scheduled_messages set status='sent',sent_at=now(),error=null where id=job.id;
    count_sent:=count_sent+1;
   end if;
  exception when others then
   update public.orbit_scheduled_messages set status='failed',error='Could not send. Please review and schedule again.' where id=job.id;
  end;
 end loop;
 return count_sent;
end; $$;
revoke all on function public.orbit_schedule_message(text,text,timestamptz,uuid),public.orbit_cancel_schedule(uuid),public.orbit_dispatch_schedules() from public,anon,authenticated;
grant execute on function public.orbit_schedule_message(text,text,timestamptz,uuid),public.orbit_cancel_schedule(uuid) to authenticated;

create table public.orbit_calls (
 id uuid primary key default gen_random_uuid(),room text not null,caller_id uuid not null references auth.users(id) on delete cascade,
 callee_id uuid not null references auth.users(id) on delete cascade,caller_name text not null,callee_name text not null,
 state text not null default 'ringing' check(state in ('ringing','connecting','connected','ended','declined','missed','failed')),
 offer jsonb not null,answer jsonb,created_at timestamptz not null default now(),connected_at timestamptz,ended_at timestamptz,
 check(caller_id<>callee_id)
);
create index orbit_calls_incoming on public.orbit_calls(callee_id,created_at) where state='ringing';
alter table public.orbit_calls enable row level security;
create policy "Orbit participant calls" on public.orbit_calls for select to authenticated using(auth.uid() in (caller_id,callee_id));
revoke all on public.orbit_calls from authenticated;
grant select on public.orbit_calls to authenticated;
create table public.orbit_call_signals (
 id bigint generated always as identity primary key,call_id uuid not null references public.orbit_calls(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete cascade,candidate jsonb not null check(octet_length(candidate::text)<8192),created_at timestamptz default now()
);
alter table public.orbit_call_signals enable row level security;
create policy "Orbit participant ICE read" on public.orbit_call_signals for select to authenticated using(exists(select 1 from public.orbit_calls c where c.id=call_id and auth.uid() in(c.caller_id,c.callee_id)));
-- A narrow wrapper permits the policy to check a pair without exposing the block list.
create or replace function public.orbit_call_access(call_key uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orbit_calls c where c.id=call_key and auth.uid() in(c.caller_id,c.callee_id) and c.state in('ringing','connecting','connected') and not public.orbit_pair_blocked(c.caller_id,c.callee_id));
$$;
create policy "Orbit participant ICE write" on public.orbit_call_signals for insert to authenticated with check(sender_id=auth.uid() and public.orbit_call_access(call_id));
revoke all on function public.orbit_call_access(uuid) from public,anon;
grant execute on function public.orbit_call_access(uuid) to authenticated;
revoke all on public.orbit_call_signals from authenticated;
grant select,insert on public.orbit_call_signals to authenticated;
grant usage on sequence public.orbit_call_signals_id_seq to authenticated;
revoke all on public.orbit_calls,public.orbit_call_signals from anon;

create or replace function public.orbit_start_call(chat_room text,peer_id uuid,description jsonb)
returns public.orbit_calls language plpgsql security definer set search_path='' as $$
declare c public.orbit_calls;
begin
 if auth.uid() is null or peer_id=auth.uid() or not public.orbit_is_room_member(chat_room,auth.uid()) or not public.orbit_is_room_member(chat_room,peer_id) or public.orbit_direct_peer(chat_room,auth.uid()) is distinct from peer_id or public.orbit_pair_blocked(auth.uid(),peer_id) then raise exception 'Calling is unavailable for this conversation.'; end if;
 if coalesce(description->>'type','')<>'offer' or coalesce(length(description->>'sdp'),0) not between 1 and 65536 then raise exception 'Invalid call offer.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(auth.uid()::text,peer_id::text),0));
 perform pg_advisory_xact_lock(hashtextextended(greatest(auth.uid()::text,peer_id::text),0));
 if exists(select 1 from public.orbit_calls where state in('ringing','connecting','connected') and created_at>now()-interval '4 hours' and (caller_id in(auth.uid(),peer_id) or callee_id in(auth.uid(),peer_id))) then raise exception 'This person is on another call.'; end if;
 insert into public.orbit_calls(room,caller_id,callee_id,caller_name,callee_name,offer)
 values(chat_room,auth.uid(),peer_id,coalesce((select first_name from public.user_profiles where user_id=auth.uid() limit 1),'Orbit user'),coalesce((select first_name from public.user_profiles where user_id=peer_id limit 1),'Orbit user'),description) returning * into c;
 insert into public.messages(id,room,sender_id,username,text,type) values(c.id,c.room,c.caller_id,c.caller_name,'Voice call','call');
 return c;
end; $$;
create or replace function public.orbit_update_call(call_key uuid,next_state text,description jsonb default null)
returns public.orbit_calls language plpgsql security definer set search_path='' as $$
declare c public.orbit_calls;
begin
 select * into c from public.orbit_calls where id=call_key for update;
 if not found or auth.uid() is null or auth.uid() not in(c.caller_id,c.callee_id) then raise exception 'Call unavailable.'; end if;
 if c.state in('ended','declined','missed','failed') then return c; end if;
 if c.state='ringing' and c.created_at<now()-interval '45 seconds' then next_state:='missed'; end if;
 if public.orbit_pair_blocked(c.caller_id,c.callee_id) then next_state:='ended'; end if;
 if next_state='connecting' and (auth.uid()<>c.callee_id or c.state<>'ringing' or coalesce(description->>'type','')<>'answer' or coalesce(length(description->>'sdp'),0) not between 1 and 65536) then raise exception 'Invalid answer.'; end if;
 if next_state='connected' and c.state not in('connecting','connected') then raise exception 'Call is not answered.'; end if;
 if next_state='declined' and (auth.uid()<>c.callee_id or c.state<>'ringing') then raise exception 'Invalid decline.'; end if;
 if next_state='missed' and (c.state<>'ringing' or now()<c.created_at+interval '45 seconds') then raise exception 'Call is still ringing.'; end if;
 if next_state not in('connecting','connected','ended','declined','missed','failed') then raise exception 'Invalid state.'; end if;
 update public.orbit_calls set state=next_state,answer=case when next_state='connecting' then description else answer end,
 connected_at=case when next_state='connected' then coalesce(connected_at,now()) else connected_at end,
 ended_at=case when next_state in('ended','declined','missed','failed') then now() else null end where id=call_key returning * into c;
 if c.ended_at is not null then
  update public.messages set text='Voice call · '||case when c.connected_at is not null then floor(extract(epoch from(c.ended_at-c.connected_at)))::int||' seconds' else c.state end,
   updated_at=now() where id=c.id;
 end if;
 return c;
end; $$;
revoke all on function public.orbit_start_call(text,uuid,jsonb),public.orbit_update_call(uuid,text,jsonb) from public,anon;
grant execute on function public.orbit_start_call(text,uuid,jsonb),public.orbit_update_call(uuid,text,jsonb) to authenticated;
create or replace function public.orbit_expire_calls() returns void language plpgsql security definer set search_path='' as $$
declare c record;
begin
 for c in update public.orbit_calls set state='missed',ended_at=now() where state='ringing' and created_at<now()-interval '45 seconds' returning * loop
  update public.messages set text='Voice call · missed',updated_at=now() where id=c.id;
 end loop;
 update public.orbit_calls set state='ended',ended_at=now() where state in('connecting','connected') and created_at<now()-interval '4 hours';
end; $$;
revoke all on function public.orbit_expire_calls() from public,anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='orbit_calls') then alter publication supabase_realtime add table public.orbit_calls; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='orbit_call_signals') then alter publication supabase_realtime add table public.orbit_call_signals; end if;
end; $$;
create extension if not exists pg_cron;
select cron.schedule('orbit-chat-dispatch','* * * * *','select public.orbit_dispatch_schedules(); select public.orbit_expire_calls();');
notify pgrst,'reload schema';
commit;
