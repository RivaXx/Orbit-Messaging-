-- Run after deploying orbit-message-push and adding its ORBIT_* secrets.
-- Store the same ORBIT_PUSH_WEBHOOK_SECRET in Supabase Vault under
-- orbit_push_webhook_secret. Never put the value in source control.
create extension if not exists pg_net with schema extensions;
create or replace function public.orbit_notify_message_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare hook_secret text;
begin
    select decrypted_secret into hook_secret from vault.decrypted_secrets where name='orbit_push_webhook_secret' limit 1;
    if hook_secret is null then return new; end if;
    perform net.http_post(
        url := 'https://dhtbiggamuwoqurguhib.supabase.co/functions/v1/orbit-message-push',
        headers := jsonb_build_object('Content-Type','application/json','x-orbit-webhook-secret',hook_secret,
            'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRodGJpZ2dhbXV3b3F1cmd1aGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNzY2MzksImV4cCI6MjA3ODc1MjYzOX0.-utin9W_-hSeijdHwcVSjft9biB5DSXrNOmuz5kCPlE'),
        body := jsonb_build_object('type','INSERT','schema','public','table','messages','record',jsonb_build_object('id',new.id)),
        timeout_milliseconds := 10000
    );
    return new;
end;
$$;
revoke all on function public.orbit_notify_message_push() from public,anon,authenticated;
drop trigger if exists orbit_message_push on public.messages;
create trigger orbit_message_push after insert on public.messages
for each row execute function public.orbit_notify_message_push();
