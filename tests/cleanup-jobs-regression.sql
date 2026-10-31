-- Synthetic metadata only. No Storage API calls and no real files deleted.
-- The cutoff predates production data; EVERY mutation is rolled back.
begin;
do $$
declare actor uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); survivor uuid:=gen_random_uuid();
 job public.orbit_cleanup_jobs; resumed public.orbit_cleanup_jobs; lease_key uuid:=gen_random_uuid();
 prefix text:='cleanup-test-'||gen_random_uuid(); bucket_name text; n int; report jsonb;
begin
 if exists(select 1 from public.orbit_cleanup_jobs where finished_at is null) then raise exception 'An actual cleanup is in progress; do not run the regression until it finishes.';end if;
 perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
 insert into auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
 values(actor,'authenticated','authenticated',prefix||'@example.invalid',jsonb_build_object('display_name','Preserved test account','avatar_url','https://example.invalid/storage/v1/object/public/uploads/'||prefix||'/profile%20photo.jpg'),now(),now());
 insert into public.messages(id,room,sender_id,username,text,type,created_at,attachments) values
 (mid,'dm_'||actor||'_'||actor,actor,'Test','Only synthetic old text','text','1969-01-01','{}'),
 (survivor,'dm_'||actor||'_'||actor,actor,'Test','Newer message','file','1970-01-02',array[jsonb_build_object('storage_bucket','uploads','storage_path',prefix||'/surviving.jpg')::text]);
 foreach bucket_name in array array['chat-assets','voice-notes','files','uploads','orbit-view-once'] loop
  insert into storage.objects(bucket_id,name,created_at,updated_at) values(bucket_name,prefix||'/chat.bin','1969-01-01','1969-01-01');
 end loop;
 insert into storage.objects(bucket_id,name,created_at,updated_at) values
 ('chat-assets','avatars/'||prefix||'.jpg','1969-01-01','1969-01-01'),
 ('uploads',prefix||'/profile photo.jpg','1969-01-01','1969-01-01'),
 ('uploads',prefix||'/surviving.jpg','1969-01-01','1969-01-01'),
 ('uploads',prefix||'/became-profile.jpg','1969-01-01','1969-01-01'),
 ('files',prefix||'/changed.bin','1969-01-01','1969-01-01'),
 ('files',prefix||'/new.bin',now(),now());
 if not public.orbit_cleanup_object_protected('uploads',prefix||'/profile photo.jpg','1970-01-01') then raise exception 'Encoded profile URL was not protected';end if;
 job:=public.orbit_begin_cleanup('all','1970-01-01');
 resumed:=public.orbit_begin_cleanup('all',now());
 if resumed.id<>job.id or resumed.cutoff<>job.cutoff then raise exception 'Retry broadened the cleanup cutoff';end if;
 if exists(select 1 from public.messages where id=mid) or not exists(select 1 from public.messages where id=survivor) then raise exception 'Message cutoff is wrong';end if;
 if not exists(select 1 from auth.users where id=actor and raw_user_meta_data->>'display_name'='Preserved test account') then raise exception 'Account changed';end if;
 if exists(select 1 from public.orbit_cleanup_objects where job_id=job.id and (path like 'avatars/%' or path in(prefix||'/profile photo.jpg',prefix||'/surviving.jpg',prefix||'/new.bin'))) then raise exception 'Protected/new media was queued';end if;
 update auth.users set raw_user_meta_data=raw_user_meta_data||jsonb_build_object('picture','https://example.invalid/storage/v1/object/public/uploads/'||prefix||'/became-profile.jpg') where id=actor;
 update storage.objects set updated_at=now() where bucket_id='files' and name=prefix||'/changed.bin';
 select count(*) into n from public.orbit_cleanup_batch(job.id,lease_key);
 if n<>5 then raise exception 'Expected five eligible buckets, got %',n;end if;
 if exists(select 1 from public.orbit_cleanup_batch(job.id,gen_random_uuid())) then raise exception 'A leased object was claimed twice';end if;
 -- Simulate one successful API result and a failed batch; no physical files exist.
 perform public.orbit_finish_cleanup_batch(job.id,lease_key,array[(select id from public.orbit_cleanup_objects where job_id=job.id and state='pending' limit 1)]);
 report:=public.orbit_cleanup_job_status(job.id);
 if (report->>'pending')::int<>4 or (report->>'complete')::boolean then raise exception 'Storage failure reported success';end if;
 if (select count(*) from storage.objects where name like prefix||'/%')<>10 then raise exception 'SQL removed storage metadata';end if;
 if has_function_privilege('authenticated','public.orbit_begin_cleanup(text,timestamptz)','EXECUTE') or has_table_privilege('authenticated','public.orbit_cleanup_objects','SELECT') then raise exception 'Client can perform cleanup directly';end if;
end $$;
rollback;
select 'Cleanup cutoff, profiles, all five buckets, leases, retries, account preservation and server-only authorization passed; synthetic data rolled back' as regression;
