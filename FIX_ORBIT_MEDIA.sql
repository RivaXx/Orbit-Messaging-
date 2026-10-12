-- Orbit media repair. Run this complete file in your Supabase SQL Editor.
-- Creates a missing bucket; preserves existing visibility, size and MIME limits.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-assets', 'chat-assets', true, 52428800, null)
on conflict (id) do nothing;

-- Run once in Supabase SQL Editor for an existing Orbit database.
-- This does not change bucket visibility. It limits writes to the signed-in
-- owner's folder: <subfolder>/<auth uid>/<stable upload id>.

drop policy if exists "Authenticated Users Upload Chat Assets" on storage.objects;
drop policy if exists "Authenticated Users Update Chat Assets" on storage.objects;

create policy "Authenticated Users Upload Chat Assets"
    on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'chat-assets'
        and (storage.foldername(name))[2] = auth.uid()::text
    );

create policy "Authenticated Users Update Chat Assets"
    on storage.objects
    for update to authenticated
    using (
        bucket_id = 'chat-assets'
        and (storage.foldername(name))[2] = auth.uid()::text
    )
    with check (
        bucket_id = 'chat-assets'
        and (storage.foldername(name))[2] = auth.uid()::text
    );

notify pgrst, 'reload schema';

-- SELECT is needed to verify/recover uploads owned by the signed-in user.
drop policy if exists "Orbit Read Own Chat Assets" on storage.objects;
create policy "Orbit Read Own Chat Assets"
on storage.objects for select to authenticated
using (bucket_id = 'chat-assets' and (storage.foldername(name))[2] = auth.uid()::text);
commit;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'chat-assets';
