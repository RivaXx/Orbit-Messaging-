-- Existing accounts supply actor IDs only. All synthetic rows, storage metadata,
-- notification events and role/claim changes are rolled back. No real file read.
begin;
do $$
declare a uuid; b uuid; mid uuid:=gen_random_uuid(); pid uuid:=gen_random_uuid();
begin
 select id into a from auth.users order by created_at limit 1;
 select id into b from auth.users where id<>a order by created_at limit 1;
 if a is null or b is null then raise exception 'Two existing test actors required'; end if;
 perform set_config('orbit.audit.a',a::text,true);perform set_config('orbit.audit.b',b::text,true);
 perform set_config('orbit.audit.mid',mid::text,true);perform set_config('orbit.audit.pid',pid::text,true);
 perform set_config('orbit.audit.room','dm_'||least(a::text,b::text)||'_'||greatest(a::text,b::text),true);
 perform set_config('orbit.audit.path','media/'||a||'/audit-'||mid||'.jpg',true);
 perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
 insert into public.messages(id,room,sender_id,username,text,type,attachments) values
 (mid,current_setting('orbit.audit.room'),a,'Audit actor','Synthetic media','image',array[jsonb_build_object('url','https://example.invalid/a.jpg','storage_bucket','chat-assets','storage_path',current_setting('orbit.audit.path'))::text]),
 (pid,current_setting('orbit.audit.room'),a,'Audit actor','Synthetic poll','poll',array['{"type":"poll","poll":{"options":[{"text":"A","voters":[],"votes":0},{"text":"B","voters":[],"votes":0}]}}']);
end $$;
set local role authenticated;
do $$
declare a uuid:=current_setting('orbit.audit.a')::uuid;b uuid:=current_setting('orbit.audit.b')::uuid;
 mid uuid:=current_setting('orbit.audit.mid')::uuid;pid uuid:=current_setting('orbit.audit.pid')::uuid;
 denied boolean; visible integer; result jsonb; fresh uuid:=gen_random_uuid();
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 denied:=false;
 begin
 insert into public.messages(id,room,sender_id,username,text,type,attachments,reactions) values
 (fresh,current_setting('orbit.audit.room'),a,'Audit actor','Synthetic initial poll','poll',array[
 jsonb_build_object('type','poll','poll',jsonb_build_object('options',jsonb_build_array(jsonb_build_object('text','A','voters',array[b],'votes',999))))::text],jsonb_build_object('fake',array[b]));
 exception when insufficient_privilege then denied:=true;end;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='e2ee_version') then
  if not denied then raise exception 'Plaintext poll accepted after encryption cutover';end if;
 else
  if denied then raise exception 'Legacy initial poll unexpectedly rejected';end if;
  if (select reactions<>'{}'::jsonb or (attachments[1]::jsonb->'poll'->'options'->0->>'votes')::integer<>0 from public.messages where id=fresh) then raise exception 'Initial reactions or votes could be forged';end if;
 end if;
 denied:=false;
 begin insert into public.messages(room,sender_id,text,type) values(current_setting('orbit.audit.room'),b,'Forged sender','text');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Sender impersonation allowed';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 select count(*) into visible from public.messages where id=mid;
 if visible<>1 then raise exception 'Recipient cannot read its synthetic message';end if;
 denied:=false;
 begin update public.messages set text='Forged media caption' where id=mid;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Recipient changed sender media text';end if;
 denied:=false;
 begin update public.messages set attachments=array['https://example.invalid/forged'] where id=mid;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Recipient replaced attachment';end if;
 denied:=false;
 begin update public.messages set reactions=jsonb_build_object('fake',array[a]) where id=mid;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Recipient forged reactions';end if;
 update public.messages set read_by=array[b],delivered_to=array[b] where id=mid;
 result:=public.orbit_security_react(mid,'test');
 if not(result->'test' ? b::text) then raise exception 'Authorized reaction failed';end if;
 perform public.orbit_security_vote(pid,0);
 if ((select attachments[1]::jsonb->'poll'->'options'->0->>'votes' from public.messages where id=pid)::integer)<>1 then raise exception 'Authorized vote failed';end if;
 if not public.orbit_security_media_access(current_setting('orbit.audit.path'),'chat-assets') then raise exception 'Recipient media access failed';end if;
 if public.orbit_security_media_access('media/'||a||'/unshared.jpg','chat-assets') then raise exception 'Unshared object accessible';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 select count(*) into visible from public.messages where id in(mid,pid);
 if visible<>0 then raise exception 'Outsider read private messages';end if;
 if public.orbit_security_media_access(current_setting('orbit.audit.path'),'chat-assets') then raise exception 'Outsider accessed media';end if;
 if exists(select 1 from storage.buckets where id in('chat-assets','voice-notes','files','uploads') and public) then raise exception 'Chat bucket remains public';end if;
 if has_table_privilege('authenticated','public.messages','TRUNCATE') then raise exception 'Browser can truncate messages';end if;
end $$;
reset role;
set local role anon;
do $$
declare visible integer;
begin
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin
  select count(*) into visible from public.messages where id=current_setting('orbit.audit.mid')::uuid;
  if visible<>0 then raise exception 'Anonymous access to private message';end if;
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
select 'Room isolation, recipient content protection, receipts, authorized reactions/votes, media isolation and least privilege passed; synthetic rows rolled back' as regression;
