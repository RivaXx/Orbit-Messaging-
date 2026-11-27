begin;

alter table public.secure_notes add column if not exists lockbox jsonb;
update storage.buckets set file_size_limit=12582940,
    allowed_mime_types=array_append(allowed_mime_types,'application/octet-stream')
where id='orbit-note-attachments' and not ('application/octet-stream'=any(allowed_mime_types));

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
                    when 'sealed' then item->>'mime' = 'application/octet-stream'
                    else false end
                and item - array['id','kind','mime'] = '{}'::jsonb,false
            )
        ) end;
$$;

create table if not exists public.orbit_note_versions (
    user_id uuid not null references auth.users(id) on delete cascade,
    note_id uuid not null references public.secure_notes(id) on delete cascade,
    revision bigint not null,
    saved_at timestamptz not null default now(),
    note jsonb not null,
    primary key(user_id,note_id,revision)
);
alter table public.orbit_note_versions enable row level security;
revoke all on public.orbit_note_versions from public, anon, authenticated;

create or replace function public.orbit_protect_note()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'UPDATE' and old.lockbox is not null and new.lockbox is null then
        raise exception 'Locked note requires an updated client' using errcode='22023';
    end if;
    if new.lockbox is not null then
        if new.title <> 'Locked note' or new.content <> '' or cardinality(new.tags) <> 0
           or new.folder <> '' or new.color <> 'default' or new.document is not null
           or not coalesce(new.lockbox->>'v' = '1' and new.lockbox->>'id' ~ '^[a-f0-9-]{36}$'
              and new.lockbox->>'salt' ~ '^[A-Za-z0-9+/]{22}==$'
              and new.lockbox->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
              and new.lockbox->>'data' ~ '^[A-Za-z0-9+/]+={0,2}$'
              and length(new.lockbox->>'data') between 24 and 1200000
              and new.lockbox->'wrap'->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
              and new.lockbox->'wrap'->>'data' ~ '^[A-Za-z0-9+/]{64}$',false)
           or new.lockbox - array['id','v','salt','iv','data','wrap'] <> '{}'::jsonb
           or (new.lockbox->'wrap') - array['iv','data'] <> '{}'::jsonb
           or exists(select 1 from jsonb_array_elements(new.attachments) asset where asset->>'kind' <> 'sealed')
        then raise exception 'Invalid locked note envelope' using errcode='22023'; end if;
    elsif exists(select 1 from jsonb_array_elements(new.attachments) asset where asset->>'kind' = 'sealed') then
        raise exception 'Missing note protection' using errcode='22023';
    end if;
    if tg_op <> 'UPDATE' then return new; end if;
    if old.lockbox is null and new.lockbox is not null then
        delete from public.orbit_note_versions where user_id=old.user_id and note_id=old.id;
    elsif (old.title,old.content,old.tags,old.color,old.folder,old.attachments,old.lockbox) is distinct from
          (new.title,new.content,new.tags,new.color,new.folder,new.attachments,new.lockbox)
    then
        if not exists (
            select 1 from public.orbit_note_versions
            where user_id=old.user_id and note_id=old.id and saved_at > now()-interval '15 seconds'
        ) then
            insert into public.orbit_note_versions(user_id,note_id,revision,note)
                values(old.user_id,old.id,old.revision,to_jsonb(old)) on conflict do nothing;
            delete from public.orbit_note_versions v where v.user_id=old.user_id and v.note_id=old.id and v.revision in
                (select history.revision from public.orbit_note_versions history where history.user_id=old.user_id and history.note_id=old.id
                 order by history.revision desc offset 30);
        end if;
    end if;
    return new;
end;
$$;
revoke all on function public.orbit_protect_note() from public,anon,authenticated;
drop trigger if exists orbit_notes_protect on public.secure_notes;
create trigger orbit_notes_protect before insert or update on public.secure_notes
for each row execute function public.orbit_protect_note();

create or replace function public.orbit_note_history(expected_owner uuid,target_id uuid)
returns table(note jsonb,saved_at timestamptz)
language sql stable security definer set search_path = '' as $$
    select v.note,v.saved_at from public.orbit_note_versions v
    where v.user_id=auth.uid() and v.user_id=expected_owner and v.note_id=target_id
    order by v.revision desc limit 30;
$$;
revoke all on function public.orbit_note_history(uuid,uuid) from public,anon;
grant execute on function public.orbit_note_history(uuid,uuid) to authenticated;

create or replace function public.orbit_apply_note_v3(
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
    where m.user_id = owner_id and m.mutation_id = orbit_apply_note_v3.mutation_id;
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
        insert into public.secure_notes(id,user_id,title,content,tags,color,pinned,archived,deleted_at,reminder_at,folder,is_template,document,sort_rank,attachments,reminder_rule,lockbox)
        values(target_id,owner_id,values_in.title,values_in.content,values_in.tags,values_in.color,values_in.pinned,
            values_in.archived,values_in.deleted_at,values_in.reminder_at,values_in.folder,values_in.is_template,values_in.document,values_in.sort_rank,
            coalesce(values_in.attachments,'[]'::jsonb),values_in.reminder_rule,values_in.lockbox)
        on conflict(id) do nothing returning * into current_note;
    else
        update public.secure_notes n set
            title=values_in.title,content=values_in.content,tags=values_in.tags,color=values_in.color,
            pinned=values_in.pinned,archived=values_in.archived,deleted_at=values_in.deleted_at,
            reminder_at=values_in.reminder_at,folder=values_in.folder,is_template=values_in.is_template,
            document=values_in.document,sort_rank=values_in.sort_rank,updated_at=now(),
            lockbox=case when patch ? 'lockbox' then values_in.lockbox else n.lockbox end,
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

revoke all on function public.orbit_apply_note_v3(uuid,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.orbit_apply_note_v3(uuid,uuid,uuid,bigint,jsonb) to authenticated;

commit;
