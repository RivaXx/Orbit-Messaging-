-- All synthetic records and HTTP dispatches are rolled back.
begin;
do $$
declare a uuid;b uuid;outsider uuid:=gen_random_uuid();mid uuid:=gen_random_uuid();room_key text;m public.messages;denied boolean:=false;
begin
 select id into a from auth.users order by created_at limit 1;
 select id into b from auth.users where id<>a order by created_at limit 1;
 if a is null or b is null then raise exception 'Two existing test actors required';end if;
 room_key:='dm_'||least(a::text,b::text)||'_'||greatest(a::text,b::text);
 perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
 insert into public.messages(id,room,sender_id,text,type,attachments) values(mid,room_key,a,'Synthetic receipt check','text',ARRAY[]::text[]);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 perform public.orbit_mark_messages_delivered(array[mid]);
 select * into m from public.messages where id=mid;
 if cardinality(m.delivered_to)<>0 then raise exception 'Outsider acknowledged delivery';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 begin update public.messages set read_by=array[b] where id=mid;exception when others then denied:=true;end;
 if not denied then raise exception 'Sender could forge read';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 perform public.orbit_mark_messages_delivered(array[mid]);perform public.orbit_mark_messages_delivered(array[mid]);
 select * into m from public.messages where id=mid;
 if m.delivered_to<>array[b] or cardinality(coalesce(m.read_by,'{}'))<>0 then raise exception 'Delivery must be idempotent and not imply read';end if;
 perform public.orbit_mark_room_read(room_key,now());perform public.orbit_mark_room_read(room_key,now());
 select * into m from public.messages where id=mid;
 if m.read_by<>array[b] or m.delivered_to<>array[b] then raise exception 'Read confirmation failed';end if;
 denied:=false;
 begin update public.messages set read_by='{}' where id=mid;exception when others then denied:=true;end;
 if not denied then raise exception 'Receipt could be removed';end if;
 if has_function_privilege('anon','public.orbit_mark_messages_delivered(uuid[])','execute') then raise exception 'Anonymous delivery access';end if;
end$$;
rollback;
select 'Receipt ownership, idempotency, read separation and anti-forgery passed; test rows rolled back' as regression;
