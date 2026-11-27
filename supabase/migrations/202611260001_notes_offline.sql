begin;

alter table public.secure_notes
    add column if not exists revision bigint,
    add column if not exists folder text not null default '',
    add column if not exists is_template boolean not null default false,
    add column if not exists document jsonb,
    add column if not exists sort_rank double precision;

create sequence if not exists public.orbit_note_revision;
update public.secure_notes set revision = nextval('public.orbit_note_revision') where revision is null;
alter table public.secure_notes alter column revision set not null;

create table if not exists public.orbit_note_changes (
    user_id uuid not null references auth.users(id) on delete cascade,
    note_id uuid not null,
    cursor bigint not null,
    note jsonb,
    mutation_id uuid,
    primary key (user_id, note_id)
);
create index if not exists orbit_note_changes_cursor on public.orbit_note_changes(user_id, cursor);
create table if not exists public.orbit_note_mutations (
    user_id uuid not null references auth.users(id) on delete cascade,
    mutation_id uuid not null,
    revision bigint not null,
    primary key (user_id, mutation_id)
);
alter table public.orbit_note_changes enable row level security;
alter table public.orbit_note_mutations enable row level security;
revoke all on public.orbit_note_changes, public.orbit_note_mutations from public, anon, authenticated;

create or replace function public.orbit_stamp_note_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'DELETE' then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.user_id::text, 732019));
        return old;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 732019));
    new.revision := nextval('public.orbit_note_revision');
    if tg_op = 'UPDATE' and new.content is distinct from old.content and new.document is not distinct from old.document then
        new.document := null;
    end if;
    return new;
end;
$$;

create or replace function public.orbit_record_note_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    mutation uuid := nullif(current_setting('orbit.note_mutation', true), '')::uuid;
begin
    if tg_op = 'DELETE' then
        -- The auth user may already be gone during an account cascade.
        if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
        insert into public.orbit_note_changes(user_id,note_id,cursor,note,mutation_id)
        values(old.user_id,old.id,nextval('public.orbit_note_revision'),null,mutation)
        on conflict(user_id,note_id) do update
        set cursor=excluded.cursor,note=excluded.note,mutation_id=excluded.mutation_id;
        return old;
    end if;
    insert into public.orbit_note_changes(user_id,note_id,cursor,note,mutation_id)
    values(new.user_id,new.id,new.revision,to_jsonb(new) || jsonb_build_object('revision',new.revision::text),mutation)
    on conflict(user_id,note_id) do update
    set cursor=excluded.cursor,note=excluded.note,mutation_id=excluded.mutation_id;
    return new;
end;
$$;

revoke all on function public.orbit_stamp_note_revision() from public, anon, authenticated;
revoke all on function public.orbit_record_note_change() from public, anon, authenticated;

drop trigger if exists orbit_notes_stamp_revision on public.secure_notes;
create trigger orbit_notes_stamp_revision before insert or update or delete on public.secure_notes
for each row execute function public.orbit_stamp_note_revision();
drop trigger if exists orbit_notes_record_change on public.secure_notes;
create trigger orbit_notes_record_change after insert or update or delete on public.secure_notes
for each row execute function public.orbit_record_note_change();

insert into public.orbit_note_changes(user_id,note_id,cursor,note)
select n.user_id,n.id,n.revision,to_jsonb(n) || jsonb_build_object('revision',n.revision::text)
from public.secure_notes as n
on conflict(user_id,note_id) do nothing;

create or replace function public.orbit_pull_notes(expected_owner uuid, after_cursor bigint default 0)
returns table(cursor text, note_id uuid, note jsonb, mutation_id uuid)
language sql stable security definer set search_path = '' as $$
    select c.cursor::text,c.note_id,c.note,c.mutation_id
    from public.orbit_note_changes c
    where c.user_id = auth.uid() and c.user_id = expected_owner and c.cursor > after_cursor
    order by c.cursor limit 200;
$$;

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

    perform set_config('orbit.note_mutation', mutation_id::text, true);
    if base_revision is null then
        insert into public.secure_notes(id,user_id,title,content,tags,color,pinned,archived,deleted_at,reminder_at,folder,is_template,document,sort_rank)
        values(target_id,owner_id,values_in.title,values_in.content,values_in.tags,values_in.color,values_in.pinned,
            values_in.archived,values_in.deleted_at,values_in.reminder_at,values_in.folder,values_in.is_template,values_in.document,values_in.sort_rank)
        on conflict(id) do nothing returning * into current_note;
    else
        update public.secure_notes n set
            title=values_in.title,content=values_in.content,tags=values_in.tags,color=values_in.color,
            pinned=values_in.pinned,archived=values_in.archived,deleted_at=values_in.deleted_at,
            reminder_at=values_in.reminder_at,folder=values_in.folder,is_template=values_in.is_template,
            document=values_in.document,sort_rank=values_in.sort_rank,updated_at=now()
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

revoke all on function public.orbit_pull_notes(uuid,bigint) from public, anon;
revoke all on function public.orbit_apply_note(uuid,uuid,uuid,bigint,jsonb) from public, anon;
grant execute on function public.orbit_pull_notes(uuid,bigint) to authenticated;
grant execute on function public.orbit_apply_note(uuid,uuid,uuid,bigint,jsonb) to authenticated;

create or replace function public.orbit_set_note_trash_expiry()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.deleted_at is null then new.trash_expires_at := null;
    elsif tg_op = 'INSERT' then new.trash_expires_at := new.deleted_at + interval '30 days';
    elsif new.deleted_at is distinct from old.deleted_at then new.trash_expires_at := new.deleted_at + interval '30 days';
    else new.trash_expires_at := coalesce(old.trash_expires_at, old.deleted_at + interval '30 days');
    end if;
    return new;
end;
$$;
-- Compute existing Trash deadlines during the migration without extending their deletion dates.
alter table public.secure_notes disable trigger orbit_note_trash_expiry;
update public.secure_notes set trash_expires_at = deleted_at + interval '30 days' where deleted_at is not null;
alter table public.secure_notes enable trigger orbit_note_trash_expiry;

commit;
