-- No real chats, users, or blocks are changed. All test records roll back.
begin;
do $$
declare a uuid; b uuid; outsider uuid:=gen_random_uuid();topic text;
begin
 select id into a from auth.users order by created_at limit 1;
 select id into b from auth.users where id<>a order by created_at limit 1;
 if a is null or b is null then raise exception 'Need two existing account IDs for membership checks';end if;
 topic:='orbit_typing_dm_'||least(a::text,b::text)||'_'||greatest(a::text,b::text);
 -- Remove only a possible preexisting pair block inside this rolled-back transaction.
 delete from public.orbit_user_blocks where (blocker=a and blocked=b) or(blocker=b and blocked=a);
 perform set_config('realtime.topic',topic,true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 execute 'set local role authenticated';
 if not public.orbit_typing_can_access() then raise exception 'Member denied typing';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if public.orbit_typing_can_access() then raise exception 'Stranger allowed typing';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('realtime.topic','not_a_typing_topic',true);
 if public.orbit_typing_can_access() then raise exception 'Wrong topic allowed';end if;
 execute 'reset role';
 insert into public.orbit_user_blocks(blocker,blocked)values(a,b);
 perform set_config('realtime.topic',topic,true);
 execute 'set local role authenticated';
 if public.orbit_typing_can_access() then raise exception 'Blocked pair allowed typing';end if;
 execute 'reset role';
 if has_function_privilege('anon','public.orbit_typing_can_access()','execute') then raise exception 'Anonymous typing access';end if;
end$$;
rollback;
select 'PASS: member accepted; stranger, wrong topic, blocked pair and anonymous denied; all test changes rolled back' as verification;
