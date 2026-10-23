begin;
do $$
declare a uuid;b uuid;mid uuid:=gen_random_uuid();event public.orbit_notification_outbox;claimed public.orbit_notification_outbox;room_key text;
begin
 select id into a from auth.users order by created_at limit 1;
 select id into b from auth.users where id<>a order by created_at limit 1;
 if a is null or b is null then raise exception 'Two test actors required';end if;
 delete from public.orbit_user_blocks where (blocker=a and blocked=b) or(blocker=b and blocked=a);
 room_key:='dm_'||least(a::text,b::text)||'_'||greatest(a::text,b::text);
 insert into public.messages(id,room,sender_id,text,type,attachments) values(mid,room_key,a,'Synthetic push retry test','text',ARRAY[]::text[]);
 select * into event from public.orbit_notification_outbox where source_id=mid::text||':'||b::text and kind='message';
 if event.id is null or event.user_id<>b then raise exception 'Recipient message was not queued';end if;
 select * into claimed from public.orbit_claim_notification(event.id);
 if claimed.attempts<>1 or claimed.next_attempt_at<=now() then raise exception 'Claim did not schedule a retry';end if;
 if exists(select 1 from public.orbit_claim_notification(event.id)) then raise exception 'Concurrent delivery claim succeeded';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.orbit_notification_outbox'::regclass and conname='orbit_notification_outbox_kind_source_id_version_key') then raise exception 'Call/note conflict constraint was removed';end if;
 if not exists(select 1 from pg_class where oid='public.orbit_notification_deliveries'::regclass and relrowsecurity) then raise exception 'Delivery ledger missing RLS';end if;
 if has_table_privilege('authenticated','public.orbit_notification_deliveries','select') then raise exception 'Client can inspect push endpoints';end if;
end$$;
rollback;
select 'Message outbox enqueue, exclusive retry claims, call/note compatibility and ledger protection passed; all test rows rolled back' as regression;
