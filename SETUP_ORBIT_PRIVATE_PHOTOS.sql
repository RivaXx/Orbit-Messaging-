begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('orbit-view-once','orbit-view-once',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false;
create policy "Orbit upload private one-time photo" on storage.objects for insert to authenticated
with check(bucket_id='orbit-view-once' and (storage.foldername(name))[1]=auth.uid()::text);
-- Restrictive policies also protect this bucket from older broad storage grants.
create policy "Orbit private photos block direct reads" on storage.objects as restrictive for select to authenticated,anon using(bucket_id<>'orbit-view-once');
create policy "Orbit private photos block direct updates" on storage.objects as restrictive for update to authenticated,anon using(bucket_id<>'orbit-view-once') with check(bucket_id<>'orbit-view-once');
create policy "Orbit private photos block direct deletes" on storage.objects as restrictive for delete to authenticated,anon using(bucket_id<>'orbit-view-once');
create policy "Orbit private photos own uploads only" on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'orbit-view-once' or (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.orbit_consume_private_photo(message_key uuid,viewer uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.messages;att jsonb;private_photo boolean:=false;
begin
 select * into m from public.messages where id=message_key;
 if not found or viewer is null or viewer=m.sender_id or not public.orbit_is_room_member(m.room::text,viewer) or public.orbit_pair_blocked(viewer,m.sender_id) then return false;end if;
 for att in select value from jsonb_array_elements(to_jsonb(m.attachments)) loop
  begin
   if jsonb_typeof(att)='string' then att:=(att#>>'{}')::jsonb;end if;
   if att->>'view_once'='true' and att->>'storage_bucket'='orbit-view-once' and att->>'storage_path' like m.sender_id::text||'/%' then private_photo:=true;end if;
  exception when others then null;
  end;
 end loop;
 if not private_photo then return false;end if;
 insert into public.orbit_view_once_receipts(message_id,viewer_id) values(message_key,viewer) on conflict do nothing;
 return found;
end;$$;
revoke all on function public.orbit_consume_private_photo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.orbit_consume_private_photo(uuid,uuid) to service_role;
create function public.orbit_attachments_need_private(value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare att jsonb;
begin
 if jsonb_typeof(value)<>'array' then return false;end if;
 for att in select e.element from jsonb_array_elements(value) as e(element) loop
  begin
   if jsonb_typeof(att)='string' then att:=(att#>>'{}')::jsonb;end if;
   if att->>'view_once'='true' and coalesce(att->>'storage_bucket','')<>'orbit-view-once' then return true;end if;
  exception when others then null;
  end;
 end loop;
 return false;
end;$$;
revoke all on function public.orbit_attachments_need_private(jsonb) from public,anon,authenticated;
create function public.orbit_attachments_need_private_text(value text[])
returns boolean language sql immutable set search_path='' as $$
 select public.orbit_attachments_need_private(to_jsonb(value));
$$;
revoke all on function public.orbit_attachments_need_private_text(text[]) from public,anon,authenticated;
create index orbit_legacy_private_photos_idx on public.messages(created_at desc)
where public.orbit_attachments_need_private_text(attachments);
create function public.orbit_legacy_private_photos()
returns table(id uuid,sender_id uuid,attachments jsonb) language sql stable security definer set search_path='' as $$
 select m.id,m.sender_id,to_jsonb(m.attachments) from public.messages m
 where public.orbit_attachments_need_private_text(m.attachments) order by m.created_at desc limit 50;
$$;
revoke all on function public.orbit_legacy_private_photos() from public,anon,authenticated;
grant execute on function public.orbit_legacy_private_photos() to service_role;
notify pgrst,'reload schema';
commit;
