-- Start seven-day retention for notes trashed after this migration.
-- Notes already in Trash retain their existing recovery period.
begin;

alter table public.secure_notes add column if not exists trash_expires_at timestamptz;

create or replace function public.orbit_set_note_trash_expiry()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.deleted_at is null then
        new.trash_expires_at := null;
    elsif tg_op = 'INSERT' then
        new.trash_expires_at := now() + interval '168 hours';
    elsif old.deleted_at is null then
        new.trash_expires_at := now() + interval '168 hours';
    else
        new.trash_expires_at := old.trash_expires_at;
    end if;
    return new;
end;
$$;

drop trigger if exists orbit_note_trash_expiry on public.secure_notes;
create trigger orbit_note_trash_expiry
before insert or update on public.secure_notes
for each row execute function public.orbit_set_note_trash_expiry();

create index if not exists orbit_notes_trash_expires on public.secure_notes (trash_expires_at)
where trash_expires_at is not null;

create or replace function public.orbit_expire_note_trash()
returns void language sql set search_path = '' as $$
    delete from public.secure_notes
    where deleted_at is not null and trash_expires_at <= now();
$$;

revoke all on function public.orbit_expire_note_trash() from public, anon, authenticated;
select cron.schedule('orbit-note-trash-retention', '17 * * * *', 'select public.orbit_expire_note_trash()');

commit;
