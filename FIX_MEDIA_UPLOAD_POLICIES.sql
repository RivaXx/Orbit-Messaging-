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
