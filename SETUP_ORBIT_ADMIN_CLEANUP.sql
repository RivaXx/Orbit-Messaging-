-- Run once in Supabase SQL Editor, then deploy orbit-admin-cleanup.
-- Installs capabilities only. This script does NOT delete existing messages.
begin;
create table if not exists public.orbit_cleanup_settings (
    id boolean primary key default true check(id), enabled boolean not null default false
);
insert into public.orbit_cleanup_settings(id) values(true) on conflict do nothing;
alter table public.orbit_cleanup_settings add column if not exists cleared_before timestamptz not null default '1970-01-01T00:00:00Z';
create table if not exists public.orbit_cleanup_queue (
    id bigint generated always as identity primary key,
    sender_id uuid not null, attachments jsonb not null,
    created_at timestamptz not null default now()
);
alter table public.orbit_cleanup_settings enable row level security;
alter table public.orbit_cleanup_queue enable row level security;
revoke all on public.orbit_cleanup_settings, public.orbit_cleanup_queue from public, anon, authenticated;
grant all on public.orbit_cleanup_settings, public.orbit_cleanup_queue to service_role;
grant usage, select on sequence public.orbit_cleanup_queue_id_seq to service_role;

-- Only the service role may enqueue a cleanup. The Edge Function verifies the
-- caller against Supabase Auth, never against editable presence/profile email.
create or replace function public.orbit_enqueue_cleanup(before_time timestamptz)
returns bigint language plpgsql security definer set search_path='' as $$
declare cleared bigint;
begin
    perform pg_advisory_xact_lock(716042014);
    with removed as (
        delete from public.messages where created_at < before_time
        returning sender_id, attachments
    ), queued as (
        insert into public.orbit_cleanup_queue(sender_id,attachments)
        select sender_id, coalesce(to_jsonb(attachments),'[]'::jsonb) from removed
        where coalesce(to_jsonb(attachments),'[]'::jsonb) <> '[]'::jsonb
        returning id
    ) select count(*) into cleared from removed;
    update public.orbit_cleanup_settings set cleared_before = greatest(cleared_before, before_time) where id;
    return cleared;
end;
$$;
revoke all on function public.orbit_enqueue_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.orbit_enqueue_cleanup(timestamptz) to service_role;

-- Authenticated clients may read only the cleanup watermark, so offline copies
-- can be discarded when a device reconnects. This grants no deletion capability.
create or replace function public.orbit_message_cleanup_cutoff()
returns timestamptz language sql stable security definer set search_path='' as $$
    select cleared_before from public.orbit_cleanup_settings where id;
$$;
revoke all on function public.orbit_message_cleanup_cutoff() from public, anon;
grant execute on function public.orbit_message_cleanup_cutoff() to authenticated;

-- Fail closed if any protected profile source cannot be read. Include legacy
-- Auth avatars and presence photos as well as the canonical profile picture.
create or replace function public.orbit_cleanup_protected_urls()
returns table(url text) language sql stable security definer set search_path='' as $$
    select dp_url from public.user_profiles where dp_url is not null
    union select dp_url from public.user_presence where dp_url is not null
    union select raw_user_meta_data->>'avatar_url' from auth.users
    union select raw_user_meta_data->>'picture' from auth.users
    union select to_jsonb(r)->>'dp_url' from public.rooms r
    union select to_jsonb(r)->>'avatar_url' from public.rooms r;
$$;
revoke all on function public.orbit_cleanup_protected_urls() from public, anon, authenticated;
grant execute on function public.orbit_cleanup_protected_urls() to service_role;

-- Protect attachments referenced by messages created after the cleanup cutoff.
create or replace function public.orbit_cleanup_live_attachments()
returns table(attachments jsonb) language sql stable security definer set search_path='' as $$
    select to_jsonb(m.attachments) from public.messages m where m.attachments is not null;
$$;
revoke all on function public.orbit_cleanup_live_attachments() from public, anon, authenticated;
grant execute on function public.orbit_cleanup_live_attachments() to service_role;

create or replace function public.orbit_cleanup_schedule_ready()
returns boolean language plpgsql security definer set search_path='' as $$
declare ready boolean := false;
begin
    if to_regclass('cron.job') is null then return false; end if;
    execute 'select exists(select 1 from cron.job where jobname = ''orbit-message-cleanup'' and active)' into ready;
    return ready;
end;
$$;
revoke all on function public.orbit_cleanup_schedule_ready() from public, anon, authenticated;
grant execute on function public.orbit_cleanup_schedule_ready() to service_role;
notify pgrst, 'reload schema';
commit;

-- For daily cleanup while the app is closed, enable pg_cron and pg_net in
-- Supabase. Store the project's anon key as orbit_cleanup_anon_key and a long
-- random ORBIT_CLEANUP_SECRET as orbit_cleanup_secret in Supabase Vault.
-- Use the same secret for the Edge Function's ORBIT_CLEANUP_SECRET env var.
-- Then run the following separately (never put the service-role key in cron):
-- select cron.schedule('orbit-message-cleanup', '0 0 * * *', $job$
--   select net.http_post(
--     url := 'https://dhtbiggamuwoqurguhib.supabase.co/functions/v1/orbit-admin-cleanup',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='orbit_cleanup_anon_key'),
--       'x-orbit-cleanup-secret',(select decrypted_secret from vault.decrypted_secrets where name='orbit_cleanup_secret')),
--     body := '{"action":"scheduled"}'::jsonb,
--     timeout_milliseconds := 120000
--   );
-- $job$);
