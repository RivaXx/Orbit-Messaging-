-- Synthetic regression checks: every row created below is rolled back.
begin;
do $$
declare owner uuid; stranger uuid:=gen_random_uuid(); text_id uuid:=gen_random_uuid(); media_id uuid:=gen_random_uuid(); loc_id uuid:=gen_random_uuid(); result jsonb; m public.messages; rejected boolean:=false;
begin
 select id into owner from auth.users order by created_at limit 1;
 if owner is null then raise exception 'An existing test actor is required'; end if;
 insert into public.messages(id,room,sender_id,text,type,attachments,created_at) values
 (text_id,'self_'||owner,owner,'Synthetic old text','text',ARRAY[]::text[],now()-interval '1 day'),
 (media_id,'self_'||owner,owner,'Synthetic image','image',ARRAY['https://example.invalid/test.png']::text[],now()-interval '1 day');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',stranger,'role','authenticated')::text,true);
 begin perform public.orbit_delete_messages(array[text_id]); exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Another sender could delete a message'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 result:=public.orbit_delete_messages(array[text_id,media_id]);
 if jsonb_array_length(result)<>2 then raise exception 'Bulk deletion failed'; end if;
 select * into m from public.messages where id=media_id;
 if m.deleted_at is null or cardinality(m.attachments)<>0 then raise exception 'Media was not scrubbed'; end if;
 rejected:=false;
 begin update public.messages set text='Resurrected' where id=text_id; exception when insufficient_privilege then rejected:=true; end;
 if not rejected then raise exception 'Deleted content could be restored'; end if;
 result:=public.orbit_delete_messages(array[text_id,media_id]);
 if jsonb_array_length(result)<>2 then raise exception 'Retry is not idempotent'; end if;
 insert into public.messages(id,room,sender_id,text,type,attachments) values(loc_id,'self_'||owner,owner,'geo:1,2','location',ARRAY[]::text[]);
 select * into m from public.messages where id=loc_id;
 if m.expires_at is null or m.expires_at-m.created_at<>interval '5 minutes' then raise exception 'Five-minute expiry not set'; end if;
 perform set_config('request.jwt.claims','{}',true);
 update public.messages set expires_at=now()-interval '1 second' where id=loc_id;
 perform public.orbit_expire_locations();
 select * into m from public.messages where id=loc_id;
 if m.deleted_at is null or m.text like '%geo:%' then raise exception 'Server location expiry failed'; end if;
end $$;
rollback;
select 'Deletion ownership, old text/media, bulk retry, anti-resurrection and location expiry passed; test rows rolled back' as regression,
 (select active from cron.job where jobname='orbit-expire-locations') as expiry_job_active;
