-- Optional server setup for private fast message previews and media access.
-- Run in this Orbit project's Supabase SQL Editor. Existing bucket visibility,
-- MIME restrictions, stored messages and message table policies are preserved.
begin;

create or replace function public.orbit_can_access_chat_room(chat_room text)
returns boolean language sql stable security invoker set search_path = ''
as $function$
    select auth.uid() is not null and (
        chat_room = 'self_' || auth.uid()::text
        or (left(chat_room, 3) = 'dm_' and split_part(chat_room, '_', 4) = '' and (
            split_part(chat_room, '_', 2) in (auth.uid()::text, left(auth.uid()::text, 12))
            or split_part(chat_room, '_', 3) in (auth.uid()::text, left(auth.uid()::text, 12))
        ))
        or exists (
            select 1 from public.rooms r
            where r.id::text = chat_room and (
                r.created_by::text = auth.uid()::text
                or to_jsonb(r.participants) ? auth.uid()::text
            )
        )
    );
$function$;
revoke all on function public.orbit_can_access_chat_room(text) from public;
grant execute on function public.orbit_can_access_chat_room(text) to authenticated;

drop policy if exists "Orbit Chat Broadcast Read" on realtime.messages;
create policy "Orbit Chat Broadcast Read" on realtime.messages
for select to authenticated using (
    extension = 'broadcast'
    and left(realtime.topic(), 11) = 'orbit_fast_'
    and public.orbit_can_access_chat_room(substring(realtime.topic() from 12))
);
drop policy if exists "Orbit Chat Broadcast Send" on realtime.messages;
create policy "Orbit Chat Broadcast Send" on realtime.messages
for insert to authenticated with check (
    extension = 'broadcast'
    and left(realtime.topic(), 11) = 'orbit_fast_'
    and public.orbit_can_access_chat_room(substring(realtime.topic() from 12))
);
grant select, insert on realtime.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-assets', 'chat-assets', true, 52428800, null)
on conflict (id) do nothing;

drop policy if exists "Authenticated Users Upload Chat Assets" on storage.objects;
create policy "Authenticated Users Upload Chat Assets" on storage.objects
for insert to authenticated with check (
    bucket_id = 'chat-assets' and (storage.foldername(name))[2] = auth.uid()::text
);

drop policy if exists "Orbit Read Own Chat Assets" on storage.objects;
drop policy if exists "Orbit Read Chat Attachments" on storage.objects;
create policy "Orbit Read Chat Attachments" on storage.objects
for select to authenticated using (
    bucket_id = 'chat-assets' and (
        (storage.foldername(name))[2] = auth.uid()::text
        or exists (
            select 1 from public.messages m
            where public.orbit_can_access_chat_room(m.room::text)
              and exists (
                select 1 from jsonb_array_elements(
                    case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end
                ) attachment
                where attachment->>'storage_path' = storage.objects.name
                   or split_part(split_part(attachment->>'url', '/chat-assets/', 2), '?', 1) = storage.objects.name
              )
        )
    )
);
notify pgrst, 'reload schema';
commit;
