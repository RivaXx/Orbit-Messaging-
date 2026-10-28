-- Installs resumable cleanup only; applying this migration does NOT clear chats.
begin;
create table if not exists public.orbit_cleanup_jobs(
 id uuid primary key default gen_random_uuid(), cutoff timestamptz not null,
 mode text not null check(mode in('all','older')), messages bigint not null default 0,
 schedules bigint not null default 0, files bigint not null default 0,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create unique index if not exists orbit_one_cleanup_job on public.orbit_cleanup_jobs((true)) where finished_at is null;
create table if not exists public.orbit_cleanup_objects(
 id bigint generated always as identity primary key,
 job_id uuid not null references public.orbit_cleanup_jobs(id) on delete cascade,
 object_id uuid not null, bucket text not null, path text not null,
 state text not null default 'pending' check(state in('pending','removed','protected')),
 lease uuid, lease_until timestamptz, unique(job_id,bucket,path)
);
alter table public.orbit_cleanup_jobs enable row level security;
alter table public.orbit_cleanup_objects enable row level security;
revoke all on public.orbit_cleanup_jobs,public.orbit_cleanup_objects from public,anon,authenticated;
grant all on public.orbit_cleanup_jobs,public.orbit_cleanup_objects to service_role;
grant usage,select on sequence public.orbit_cleanup_objects_id_seq to service_role;

create or replace function public.orbit_cleanup_attachment(value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value)='object' then return value;end if;
 if jsonb_typeof(value)='string' then
  begin return (value#>>'{}')::jsonb;exception when others then return jsonb_build_object('url',value#>>'{}');end;
 end if;
 return '{}'::jsonb;
end $$;
create or replace function public.orbit_cleanup_url_path(value text,bucket text)
returns text language plpgsql immutable set search_path='' as $$
declare encoded text; bytes bytea:=''::bytea; i int:=1;
begin
 encoded:=split_part(value,'?',1);
 if encoded like bucket||'/%' then return substr(encoded,length(bucket)+2);end if;
 encoded:=substring(encoded from '/storage/v1/object/(?:public|sign|authenticated)/'||bucket||'/(.*)$');
 if encoded is null then return null;end if;
 while i<=length(encoded) loop
  if substr(encoded,i,1)='%' and substr(encoded,i+1,2)~'^[0-9A-Fa-f]{2}$' then
   bytes:=bytes||decode(substr(encoded,i+1,2),'hex');i:=i+3;
  else bytes:=bytes||convert_to(substr(encoded,i,1),'UTF8');i:=i+1;end if;
 end loop;
 return convert_from(bytes,'UTF8');
exception when others then return null;
end $$;
-- Preserve dedicated avatar buckets, all avatar/profile directories, and every
-- canonical/legacy profile URL even if somebody stored it in a chat directory.
create or replace function public.orbit_cleanup_object_protected(bucket text,path text,cutoff timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if bucket not in('chat-assets','voice-notes','files','uploads','orbit-view-once')
  or path ~* '(^|/)(avatars?|profiles?|profile-pictures|group-avatars)(/|$)' then return true;end if;
 if exists(select 1 from public.orbit_cleanup_protected_urls() p
  where public.orbit_cleanup_url_path(p.url,bucket)=path) then return true;end if;
 -- An old orphan may have been reused by a message that survives this job.
 if exists(select 1 from public.messages m cross join lateral
  jsonb_array_elements(coalesce(to_jsonb(m.attachments),'[]'::jsonb)) a
  where m.created_at>=cutoff and
   ((coalesce(public.orbit_cleanup_attachment(a)->>'storage_bucket','chat-assets')=bucket
    and public.orbit_cleanup_attachment(a)->>'storage_path'=path)
    or public.orbit_cleanup_url_path(public.orbit_cleanup_attachment(a)->>'url',bucket)=path)) then return true;end if;
 return false;
end $$;

create or replace function public.orbit_begin_cleanup(job_mode text default 'all',requested_cutoff timestamptz default now())
returns public.orbit_cleanup_jobs language plpgsql security definer set search_path='' as $$
declare job public.orbit_cleanup_jobs; n bigint;
begin
 perform pg_advisory_xact_lock(716042014);
 select * into job from public.orbit_cleanup_jobs where finished_at is null;
 if found then return job;end if;
 if job_mode not in('all','older') or requested_cutoff is null then raise exception 'Invalid cleanup scope';end if;
 insert into public.orbit_cleanup_jobs(cutoff,mode) values(least(requested_cutoff,now()),job_mode) returning * into job;
 insert into public.orbit_cleanup_objects(job_id,object_id,bucket,path)
 select job.id,o.id,o.bucket_id,o.name from storage.objects o
 where o.bucket_id in('chat-assets','voice-notes','files','uploads','orbit-view-once')
 and o.created_at<job.cutoff and coalesce(o.updated_at,o.created_at)<job.cutoff
 and not public.orbit_cleanup_object_protected(o.bucket_id,o.name,job.cutoff);
 get diagnostics n=row_count;
 update public.orbit_cleanup_jobs set files=n where id=job.id;
 -- Prevent delayed notifications and schedules from bringing removed content back.
 delete from public.orbit_notification_outbox where kind='message' and source_id in
  (select id::text from public.messages where created_at<job.cutoff);
 delete from public.orbit_scheduled_messages where created_at<job.cutoff;
 get diagnostics n=row_count;
 update public.orbit_cleanup_jobs set schedules=n where id=job.id;
 delete from public.messages where created_at<job.cutoff;
 get diagnostics n=row_count;
 update public.orbit_cleanup_jobs set messages=n where id=job.id returning * into job;
 update public.orbit_cleanup_settings set cleared_before=greatest(cleared_before,job.cutoff) where id;
 -- Retired attachment-only queue is covered by the storage snapshot, including
 -- orphaned uploads. Profile protection is checked again before API deletion.
 delete from public.orbit_cleanup_queue where created_at<job.cutoff;
 return job;
end $$;

create or replace function public.orbit_cleanup_batch(job_key uuid,lease_key uuid)
returns setof public.orbit_cleanup_objects language plpgsql security definer set search_path='' as $$
declare cutoff_time timestamptz;
begin
 select cutoff into cutoff_time from public.orbit_cleanup_jobs where id=job_key and finished_at is null for update;
 if not found then return;end if;
 update public.orbit_cleanup_objects q set state='protected',lease=null,lease_until=null
 where q.job_id=job_key and q.state='pending' and (q.lease_until is null or q.lease_until<now())
 and (public.orbit_cleanup_object_protected(q.bucket,q.path,cutoff_time)
 or exists(select 1 from storage.objects o where o.bucket_id=q.bucket and o.name=q.path
  and (o.id<>q.object_id or coalesce(o.updated_at,o.created_at)>=cutoff_time)));
 return query update public.orbit_cleanup_objects q set lease=lease_key,lease_until=now()+interval '60 seconds'
 where q.id in(select x.id from public.orbit_cleanup_objects x where x.job_id=job_key and x.state='pending'
 and (x.lease_until is null or x.lease_until<now()) order by x.id limit 100 for update skip locked) returning q.*;
end $$;

create or replace function public.orbit_finish_cleanup_batch(job_key uuid,lease_key uuid,removed_keys bigint[])
returns void language sql security definer set search_path='' as $$
 update public.orbit_cleanup_objects set state='removed',lease=null,lease_until=null
 where job_id=job_key and lease=lease_key and id=any(removed_keys);
 -- Failed items are retryable immediately; another invocation never starts a new purge.
 update public.orbit_cleanup_objects set lease=null,lease_until=null where job_id=job_key and lease=lease_key;
$$;
create or replace function public.orbit_cleanup_job_status(job_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.orbit_cleanup_jobs; pending bigint; removed bigint; protected_count bigint;
begin
 select * into job from public.orbit_cleanup_jobs where id=job_key for update;
 if not found then raise exception 'Cleanup job not found';end if;
 select count(*) filter(where state='pending'),count(*) filter(where state='removed'),count(*) filter(where state='protected')
 into pending,removed,protected_count from public.orbit_cleanup_objects where job_id=job_key;
 if pending=0 then update public.orbit_cleanup_jobs set finished_at=coalesce(finished_at,now()) where id=job_key;end if;
 return jsonb_build_object('job_id',job.id,'cutoff',job.cutoff,'messages',job.messages,'schedules',job.schedules,
  'total_files',job.files,'files',removed,'protected_files',protected_count,'pending',pending,'complete',pending=0);
end $$;
revoke all on function public.orbit_cleanup_attachment(jsonb),public.orbit_cleanup_url_path(text,text),public.orbit_cleanup_object_protected(text,text,timestamptz),public.orbit_begin_cleanup(text,timestamptz),public.orbit_cleanup_batch(uuid,uuid),public.orbit_finish_cleanup_batch(uuid,uuid,bigint[]),public.orbit_cleanup_job_status(uuid) from public,anon,authenticated;
grant execute on function public.orbit_cleanup_attachment(jsonb),public.orbit_cleanup_url_path(text,text),public.orbit_cleanup_object_protected(text,text,timestamptz),public.orbit_begin_cleanup(text,timestamptz),public.orbit_cleanup_batch(uuid,uuid),public.orbit_finish_cleanup_batch(uuid,uuid,bigint[]),public.orbit_cleanup_job_status(uuid) to service_role;
notify pgrst,'reload schema';
create or replace function public.orbit_guard_cleanup_cutoff()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and new.created_at<(select cleared_before from public.orbit_cleanup_settings where id) then
  raise exception 'This pending message predates an admin cleanup. Compose a new message to send.' using errcode='42501';
 end if;return new;
end $$;
drop trigger if exists orbit_za_cleanup_cutoff on public.messages;
create trigger orbit_za_cleanup_cutoff before insert on public.messages for each row execute function public.orbit_guard_cleanup_cutoff();
revoke all on function public.orbit_guard_cleanup_cutoff() from public,anon,authenticated;
commit;
