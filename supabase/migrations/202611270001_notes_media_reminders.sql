begin;

alter table public.secure_notes
    add column if not exists attachments jsonb not null default '[]',
    add column if not exists reminder_rule jsonb;

create or replace function public.orbit_valid_note_media(items jsonb)
returns boolean language sql immutable set search_path = '' as $$
    select case when jsonb_typeof(items) <> 'array' then false else
        jsonb_array_length(items) <= 10 and not exists (
            select 1 from jsonb_array_elements(items) item
            where not coalesce(
                jsonb_typeof(item) = 'object'
                and item->>'id' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
                and case item->>'kind'
                    when 'photo' then item->>'mime' in ('image/jpeg','image/png','image/webp')
                    when 'drawing' then item->>'mime' = 'image/png'
                    when 'sticker' then item->>'mime' in ('image/png','image/webp')
                    when 'gif' then item->>'mime' in ('image/gif','image/webp')
                    when 'voice' then item->>'mime' in ('audio/webm','audio/mp4','audio/ogg')
                    else false end
                and item - array['id','kind','mime'] = '{}'::jsonb,
                false
            )
        ) end;
$$;
alter table public.secure_notes add constraint orbit_note_media_valid check (public.orbit_valid_note_media(attachments));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('orbit-note-attachments','orbit-note-attachments',false,12582912,
    array['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mp4','audio/ogg'])
on conflict(id) do nothing;

create policy orbit_note_attachments_read on storage.objects for select to authenticated
using (bucket_id = 'orbit-note-attachments' and name ~ ('^' || auth.uid()::text || '/[a-f0-9-]{36}$'));
create policy orbit_note_attachments_insert on storage.objects for insert to authenticated
with check (bucket_id = 'orbit-note-attachments' and name ~ ('^' || auth.uid()::text || '/[a-f0-9-]{36}$'));
-- Restrictive guards keep any existing broad object policies from allowing access to this bucket.
create policy orbit_note_attachments_owner on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'orbit-note-attachments' or coalesce(name ~ ('^' || auth.uid()::text || '/[a-f0-9-]{36}$'),false));
create policy orbit_note_attachments_owner_write on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'orbit-note-attachments' or coalesce(name ~ ('^' || auth.uid()::text || '/[a-f0-9-]{36}$'),false));
create policy orbit_note_attachments_immutable on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'orbit-note-attachments') with check (bucket_id <> 'orbit-note-attachments');
create policy orbit_note_attachments_no_direct_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'orbit-note-attachments');
create policy orbit_note_attachments_no_anon on storage.objects as restrictive for all to anon
using (bucket_id <> 'orbit-note-attachments') with check (bucket_id <> 'orbit-note-attachments');

create or replace function public.orbit_note_due(anchor timestamptz, rule jsonb, reference_time timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
    zone text := coalesce(rule->>'zone','UTC');
    days integer := case rule->>'repeat' when 'daily' then 1 when 'weekly' then 7 else 0 end;
    snooze_time timestamptz;
    wall_anchor timestamp;
    wall_reference timestamp;
    elapsed_days integer;
    due timestamptz;
begin
    if anchor is null or reference_time < anchor then return null; end if;
    if rule->>'snooze' is not null then
        begin snooze_time := (rule->>'snooze')::timestamptz;
        exception when invalid_datetime_format or datetime_field_overflow then snooze_time := null;
        end;
    end if;
    if snooze_time > reference_time then return null; end if;
    if days = 0 then return coalesce(snooze_time,anchor); end if;
    if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = zone) then zone := 'UTC'; end if;
    wall_anchor := anchor at time zone zone;
    wall_reference := reference_time at time zone zone;
    elapsed_days := greatest(0, (wall_reference::date - wall_anchor::date) / days * days);
    due := (wall_anchor + make_interval(days => elapsed_days)) at time zone zone;
    if due > reference_time and elapsed_days >= days then
        due := (wall_anchor + make_interval(days => elapsed_days - days)) at time zone zone;
    end if;
    return greatest(due,snooze_time);
end;
$$;
revoke execute on function public.orbit_note_due(timestamptz,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.orbit_note_due(timestamptz,jsonb,timestamptz) to service_role;

create or replace function public.orbit_apply_note(
    expected_owner uuid, target_id uuid, mutation_id uuid, base_revision bigint, patch jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := auth.uid();
    current_note public.secure_notes;
    values_in public.secure_notes;
    response jsonb;
    prior_revision bigint;
begin
    if owner_id is null or owner_id is distinct from expected_owner then raise insufficient_privilege; end if;
    if target_id is null or mutation_id is null or jsonb_typeof(patch) is distinct from 'object' then
        raise exception 'Invalid note mutation' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(732020, pg_catalog.hashtext(mutation_id::text));
    select m.revision into prior_revision from public.orbit_note_mutations m
    where m.user_id = owner_id and m.mutation_id = orbit_apply_note.mutation_id;
    if found then
        select * into current_note from public.secure_notes where id=target_id and user_id=owner_id;
        return jsonb_build_object('applied',coalesce(current_note.revision=prior_revision,false),
            'receipt_revision',prior_revision::text,'note',case when found then
            to_jsonb(current_note) || jsonb_build_object('revision',current_note.revision::text) end);
    end if;

    values_in := jsonb_populate_record(null::public.secure_notes, patch);
    if values_in.title is null or char_length(values_in.title) > 180
        or values_in.content is null or char_length(values_in.content) > 50000
        or values_in.folder is null or char_length(values_in.folder) > 100
        or cardinality(values_in.tags) > 12
        or (values_in.document is not null and (jsonb_typeof(values_in.document) <> 'array' or pg_column_size(values_in.document) > 1600000)) then
        raise exception 'Note exceeds supported limits' using errcode = '22023';
    end if;

    if patch ? 'attachments' and (values_in.attachments is null or not public.orbit_valid_note_media(values_in.attachments)) then
        raise exception 'Invalid note attachments' using errcode = '22023';
    end if;
    if values_in.reminder_rule is not null and (jsonb_typeof(values_in.reminder_rule) <> 'object'
        or not coalesce(values_in.reminder_rule->>'repeat' in ('none','daily','weekly'),false)
        or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = values_in.reminder_rule->>'zone')
        or values_in.reminder_rule - array['repeat','zone','snooze'] <> '{}'::jsonb
        or coalesce(jsonb_typeof(values_in.reminder_rule->'snooze') not in ('null','string'),false)
        or char_length(values_in.reminder_rule->>'snooze') > 40) then
        raise exception 'Invalid note reminder' using errcode = '22023';
    end if;
    perform set_config('orbit.note_mutation', mutation_id::text, true);
    if base_revision is null then
        insert into public.secure_notes(id,user_id,title,content,tags,color,pinned,archived,deleted_at,reminder_at,folder,is_template,document,sort_rank,attachments,reminder_rule)
        values(target_id,owner_id,values_in.title,values_in.content,values_in.tags,values_in.color,values_in.pinned,
            values_in.archived,values_in.deleted_at,values_in.reminder_at,values_in.folder,values_in.is_template,values_in.document,values_in.sort_rank,
            coalesce(values_in.attachments,'[]'::jsonb),values_in.reminder_rule)
        on conflict(id) do nothing returning * into current_note;
    else
        update public.secure_notes n set
            title=values_in.title,content=values_in.content,tags=values_in.tags,color=values_in.color,
            pinned=values_in.pinned,archived=values_in.archived,deleted_at=values_in.deleted_at,
            reminder_at=values_in.reminder_at,folder=values_in.folder,is_template=values_in.is_template,
            document=values_in.document,sort_rank=values_in.sort_rank,updated_at=now(),
            attachments=case when patch ? 'attachments' then values_in.attachments else n.attachments end,
            reminder_rule=case when patch ? 'reminder_rule' then values_in.reminder_rule
                               when n.reminder_at is distinct from values_in.reminder_at then null else n.reminder_rule end
        where n.id=target_id and n.user_id=owner_id and n.revision=base_revision
        returning n.* into current_note;
    end if;
    if found then
        response := jsonb_build_object('applied',true,'note',to_jsonb(current_note) || jsonb_build_object('revision',current_note.revision::text));
        insert into public.orbit_note_mutations values(owner_id,mutation_id,current_note.revision);
    else
        select * into current_note from public.secure_notes where id=target_id and user_id=owner_id;
        response := jsonb_build_object('applied',false,'note',case when found then
            to_jsonb(current_note) || jsonb_build_object('revision',current_note.revision::text) end);
    end if;
    perform set_config('orbit.note_mutation', '', true);
    return response;
end;
$$;

create or replace function public.orbit_process_notifications()
returns void language plpgsql security definer set search_path = '' as $$
declare
    note record;
    pending record;
begin
    for note in
        select n.id,n.user_id,d.due
        from public.secure_notes n
        cross join lateral (select public.orbit_note_due(n.reminder_at,n.reminder_rule,now()) as due) d
        where n.reminder_at <= now() and n.deleted_at is null and not n.archived and not n.is_template
          and (n.reminder_at > now()-interval '1 day' or n.reminder_rule is not null)
          and d.due <= now() and d.due > now()-interval '1 day'
          and (n.reminder_sent_at is null or n.reminder_sent_at < d.due)
        order by d.due limit 100 for update of n skip locked
    loop
        insert into public.orbit_notification_outbox(kind,source_id,user_id,version,expires_at)
        values('note',note.id::text,note.user_id,note.due,now()+interval '1 day')
        on conflict(kind,source_id,version) do nothing;
        update public.secure_notes set reminder_sent_at=now() where id=note.id;
    end loop;

    for pending in
        select id from public.orbit_notification_outbox where sent_at is null and next_attempt_at<=now()
          and expires_at>now() and attempts<24 order by case when kind='call' then 0 else 1 end,created_at limit 30
    loop
        perform public.orbit_dispatch_notification(pending.id);
    end loop;
    delete from public.orbit_notification_outbox where expires_at<now()-interval '2 days';
end;
$$;
revoke all on function public.orbit_process_notifications() from public,anon,authenticated;

commit;
