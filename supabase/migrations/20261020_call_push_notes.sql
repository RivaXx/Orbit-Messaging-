-- Additive delivery and personal notes upgrade. Does not delete chats or media.
begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
alter table public.secure_notes add column if not exists tags text[] not null default '{}';
alter table public.secure_notes add column if not exists color text not null default 'default';
alter table public.secure_notes add column if not exists pinned boolean not null default false;
alter table public.secure_notes add column if not exists archived boolean not null default false;
alter table public.secure_notes add column if not exists deleted_at timestamptz;
alter table public.secure_notes add column if not exists reminder_at timestamptz;
alter table public.secure_notes add column if not exists reminder_sent_at timestamptz;
create index if not exists orbit_notes_reminders_due on public.secure_notes(reminder_at) where reminder_at is not null and reminder_sent_at is null and deleted_at is null and not archived;
alter table public.secure_notes enable row level security;
-- Restrictive guard also protects against a legacy permissive notes policy.
drop policy if exists "Orbit notes owner guard" on public.secure_notes;
create policy "Orbit notes owner guard" on public.secure_notes as restrictive for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "Orbit own notes" on public.secure_notes;
create policy "Orbit own notes" on public.secure_notes for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.secure_notes to authenticated;
revoke all on public.secure_notes from public,anon;

create table if not exists public.orbit_notification_outbox(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in('call','call_stop','note')),
 source_id text not null,user_id uuid not null references auth.users(id) on delete cascade,
 version timestamptz not null,created_at timestamptz not null default now(),expires_at timestamptz not null,
 attempts int not null default 0,next_attempt_at timestamptz not null default now(),sent_at timestamptz,
 unique(kind,source_id,version)
);
alter table public.orbit_notification_outbox enable row level security;
revoke all on public.orbit_notification_outbox from public,anon,authenticated;
grant all on public.orbit_notification_outbox to service_role;
create index if not exists orbit_notification_outbox_pending on public.orbit_notification_outbox(next_attempt_at) where sent_at is null;

create or replace function public.orbit_claim_notification(event_id uuid)
returns setof public.orbit_notification_outbox language sql security definer set search_path='' as $$
 update public.orbit_notification_outbox set attempts=attempts+1,next_attempt_at=now()+interval '20 seconds'
 where id=event_id and sent_at is null and next_attempt_at<=now() and expires_at>now() and attempts<8 returning *;
$$;
revoke all on function public.orbit_claim_notification(uuid) from public,anon,authenticated;
grant execute on function public.orbit_claim_notification(uuid) to service_role;

create or replace function public.orbit_push_call_recipient(call_key uuid)
returns table(user_id uuid) language sql stable security definer set search_path='' as $$
 select c.callee_id from public.orbit_calls c
 where c.id=call_key and public.orbit_is_room_member(c.room,c.caller_id) and public.orbit_is_room_member(c.room,c.callee_id)
 and not public.orbit_pair_blocked(c.caller_id,c.callee_id);
$$;
revoke all on function public.orbit_push_call_recipient(uuid) from public,anon,authenticated;
grant execute on function public.orbit_push_call_recipient(uuid) to service_role;

create or replace function public.orbit_dispatch_notification(event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare secret text; anon_key text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='orbit_push_webhook_secret' limit 1;
 if secret is null then return; end if;
 -- The gateway key is public, while the separate webhook secret authorizes delivery.
 anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRodGJpZ2dhbXV3b3F1cmd1aGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNzY2MzksImV4cCI6MjA3ODc1MjYzOX0.-utin9W_-hSeijdHwcVSjft9biB5DSXrNOmuz5kCPlE';
 perform net.http_post(url:='https://dhtbiggamuwoqurguhib.supabase.co/functions/v1/orbit-message-push',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||anon_key,'x-orbit-webhook-secret',secret),body:=jsonb_build_object('eventId',event_id),timeout_milliseconds:=10000);
exception when others then
 -- Retry from the outbox; never abort the user's call because a push route failed.
 raise warning 'Orbit notification dispatch queued for retry';
end; $$;
revoke all on function public.orbit_dispatch_notification(uuid) from public,anon,authenticated;

create or replace function public.orbit_queue_call_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_id uuid; event_kind text; stamp timestamptz;
begin
 if tg_op='INSERT' then event_kind:='call';stamp:=new.created_at;
 elsif new.state is distinct from old.state and new.state in('connecting','ended','declined','missed','failed') then event_kind:='call_stop';stamp:=clock_timestamp();
 else return new; end if;
 if public.orbit_pair_blocked(new.caller_id,new.callee_id) then return new; end if;
 insert into public.orbit_notification_outbox(kind,source_id,user_id,version,expires_at)
 values(event_kind,new.id::text,new.callee_id,stamp,case when event_kind='call' then new.created_at+interval '45 seconds' else now()+interval '1 hour' end)
 on conflict(kind,source_id,version) do nothing returning id into event_id;
 if event_id is not null then perform public.orbit_dispatch_notification(event_id); end if;
 return new;
end; $$;
revoke all on function public.orbit_queue_call_notification() from public,anon,authenticated;
drop trigger if exists orbit_call_push on public.orbit_calls;
create trigger orbit_call_push after insert or update of state on public.orbit_calls for each row execute function public.orbit_queue_call_notification();

create or replace function public.orbit_reset_note_reminder()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or new.reminder_at is distinct from old.reminder_at or new.deleted_at is distinct from old.deleted_at or new.archived is distinct from old.archived then new.reminder_sent_at:=null;end if;
 return new;
end; $$;
drop trigger if exists orbit_note_reminder_reset on public.secure_notes;
create trigger orbit_note_reminder_reset before insert or update on public.secure_notes for each row execute function public.orbit_reset_note_reminder();

create or replace function public.orbit_process_notifications()
returns void language plpgsql security definer set search_path='' as $$
declare note record; event_id uuid; pending record;
begin
 for note in select id,user_id,reminder_at from public.secure_notes where reminder_at<=now() and reminder_at>now()-interval '1 day' and reminder_sent_at is null and deleted_at is null and not archived order by reminder_at limit 100 for update skip locked loop
  insert into public.orbit_notification_outbox(kind,source_id,user_id,version,expires_at) values('note',note.id::text,note.user_id,note.reminder_at,now()+interval '1 day') on conflict(kind,source_id,version) do nothing;
  update public.secure_notes set reminder_sent_at=now() where id=note.id;
 end loop;
 for pending in select id from public.orbit_notification_outbox where sent_at is null and next_attempt_at<=now() and expires_at>now() and attempts<8 order by case when kind='call' then 0 else 1 end,created_at limit 30 loop
  perform public.orbit_dispatch_notification(pending.id);
 end loop;
 -- Retain only recent delivery metadata, never note or message content.
 delete from public.orbit_notification_outbox where expires_at<now()-interval '2 days';
end; $$;
revoke all on function public.orbit_process_notifications() from public,anon,authenticated;
do $$begin
 if exists(select 1 from cron.job where jobname='orbit-notifications') then perform cron.unschedule('orbit-notifications');end if;
 perform cron.schedule('orbit-notifications','10 seconds','select public.orbit_process_notifications();');
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='secure_notes') then alter publication supabase_realtime add table public.secure_notes;end if;
end$$;
commit;
