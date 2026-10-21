-- Production-safe ownership checks: every synthetic note is rolled back.
begin;
do $$
declare owner_id uuid; stranger uuid:=gen_random_uuid();note_id uuid;denied boolean:=false;
begin
 select id into owner_id from auth.users order by created_at limit 1;
 insert into public.secure_notes(user_id,title,content) values(owner_id,'Orbit RLS verification','Synthetic rolled-back note') returning id into note_id;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',stranger,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.secure_notes where id=note_id) then raise exception 'Cross-account note visible';end if;
 begin
  insert into public.secure_notes(user_id,title,content) values(owner_id,'Rejected note','Must not write another account');
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cross-account note write allowed';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 if not exists(select 1 from public.secure_notes where id=note_id) then raise exception 'Owner cannot read note';end if;
 execute 'reset role';
end$$;
rollback;
select 'PASS · own-note access and cross-account read/write denial; rolled back' as verification;
