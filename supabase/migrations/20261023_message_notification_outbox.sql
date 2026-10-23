begin;
alter table public.orbit_notification_outbox drop constraint if exists orbit_notification_outbox_kind_check;
alter table public.orbit_notification_outbox add constraint orbit_notification_outbox_kind_check check(kind in('call','call_stop','note','message'));
create unique index if not exists orbit_notification_recipient_event on public.orbit_notification_outbox(kind,source_id,user_id,version);
create table if not exists public.orbit_notification_deliveries(
 event_id uuid not null references public.orbit_notification_outbox(id) on delete cascade,
 endpoint text not null, sent_at timestamptz not null default now(),primary key(event_id,endpoint)
);
alter table public.orbit_notification_deliveries enable row level security;
revoke all on public.orbit_notification_deliveries from public,anon,authenticated;
grant all on public.orbit_notification_deliveries to service_role;

create or replace function public.orbit_notify_message_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record;event_id uuid;
begin
 if new.type='call' or new.deleted_at is not null then return new;end if;
 for recipient in select user_id from public.orbit_push_message_recipients(new.id) loop
  if public.orbit_pair_blocked(new.sender_id,recipient.user_id) then continue;end if;
  insert into public.orbit_notification_outbox(kind,source_id,user_id,version,expires_at)
  values('message',new.id::text||':'||recipient.user_id::text,recipient.user_id,new.created_at,now()+interval '1 day')
  on conflict do nothing returning id into event_id;
  if event_id is not null then perform public.orbit_dispatch_notification(event_id);end if;
 end loop;
 return new;
end;$$;
revoke all on function public.orbit_notify_message_push() from public,anon,authenticated;
drop trigger if exists orbit_message_push on public.messages;
create trigger orbit_message_push after insert on public.messages for each row execute function public.orbit_notify_message_push();
create or replace function public.orbit_claim_notification(event_id uuid)
returns setof public.orbit_notification_outbox language sql security definer set search_path='' as $$
 update public.orbit_notification_outbox set attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(300,20*power(2,least(attempts,4)))::int)
 where id=event_id and sent_at is null and next_attempt_at<=now() and expires_at>now() and attempts<24 returning *;
$$;
revoke all on function public.orbit_claim_notification(uuid) from public,anon,authenticated;
grant execute on function public.orbit_claim_notification(uuid) to service_role;
create or replace function public.orbit_process_notifications()
returns void language plpgsql security definer set search_path='' as $$
declare note record; event_id uuid; pending record;
begin
 for note in select id,user_id,reminder_at from public.secure_notes where reminder_at<=now() and reminder_at>now()-interval '1 day' and reminder_sent_at is null and deleted_at is null and not archived order by reminder_at limit 100 for update skip locked loop
  insert into public.orbit_notification_outbox(kind,source_id,user_id,version,expires_at) values('note',note.id::text,note.user_id,note.reminder_at,now()+interval '1 day') on conflict(kind,source_id,version) do nothing;
  update public.secure_notes set reminder_sent_at=now() where id=note.id;
 end loop;
 for pending in select id from public.orbit_notification_outbox where sent_at is null and next_attempt_at<=now() and expires_at>now() and attempts<24 order by case when kind='call' then 0 else 1 end,created_at limit 30 loop
  perform public.orbit_dispatch_notification(pending.id);
 end loop;
 -- Retain only recent delivery metadata, never note or message content.
 delete from public.orbit_notification_outbox where expires_at<now()-interval '2 days';
end; $$;
revoke all on function public.orbit_process_notifications() from public,anon,authenticated;
commit;
