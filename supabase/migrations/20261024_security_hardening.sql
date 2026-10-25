-- Apply after the recorded security baseline and existing message migrations.
-- No messages, accounts, objects or profile photos are deleted.
begin;

-- Invoker trigger distinguishes direct API writes from vetted definer RPCs.
create or replace function public.orbit_guard_direct_content()
returns trigger language plpgsql set search_path='' as $$
declare att jsonb; options jsonb; i integer;
begin
 if current_user<>'authenticated' then return new; end if;
 if tg_op='INSERT' then
  new.reactions:='{}'::jsonb;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'reactions';
  new.reply_to:=new.reply_to-'reactions';
  if new.type='poll' then
   att:=new.attachments[1]::jsonb; options:=att->'poll'->'options';
   if jsonb_typeof(options) is distinct from 'array' or jsonb_array_length(options) not between 1 and 30 then
    raise exception 'A poll requires between 1 and 30 options';
   end if;
   for i in 0..jsonb_array_length(options)-1 loop
    options:=jsonb_set(options,array[i::text],jsonb_set(jsonb_set(options->i,'{voters}','[]'),'{votes}','0'));
   end loop;
   att:=jsonb_set(att,'{poll,options}',options);new.attachments[1]:=att::text;
   new.metadata:=new.metadata-'poll';
  end if;
  return new;
 end if;
 if new.username is distinct from old.username then
  raise exception 'Message author label cannot be changed' using errcode='42501';
 end if;
 if old.sender_id is distinct from auth.uid() and
   (to_jsonb(new)-array['read_by','delivered_to','updated_at']) is distinct from
   (to_jsonb(old)-array['read_by','delivered_to','updated_at']) then
  raise exception 'Recipients can only acknowledge delivery or reading' using errcode='42501';
 end if;
 if new.reactions is distinct from old.reactions
    or (new.metadata->'reactions') is distinct from (old.metadata->'reactions')
    or (new.reply_to->'reactions') is distinct from (old.reply_to->'reactions') then
  raise exception 'Use the authorized reaction operation' using errcode='42501';
 end if;
 if old.type='poll' and new.attachments is distinct from old.attachments
    and new.deleted_at is null then
  raise exception 'Use the authorized poll operation' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.orbit_guard_direct_content() from public,anon,authenticated;
drop trigger if exists orbit_zz_direct_content on public.messages;
create trigger orbit_zz_direct_content before insert or update on public.messages
for each row execute function public.orbit_guard_direct_content();

-- A public bucket bypasses SELECT RLS on download. Restrict chat media itself.
update storage.buckets set public=false
where id in('chat-assets','voice-notes','files','uploads');

create or replace function public.orbit_security_media_access(object_name text,bucket_name text default 'chat-assets')
returns boolean language plpgsql stable security definer set search_path='' as $$
declare row_data record; attachment jsonb; raw jsonb; path text; owner_part text;
begin
 if auth.uid() is null then return false; end if;
 if bucket_name='avatars' then return true; end if;
 if bucket_name not in('chat-assets','voice-notes','files','uploads') then return false; end if;
 owner_part:=(storage.foldername(object_name))[case when bucket_name='chat-assets' then 2 else 1 end];
 if owner_part=auth.uid()::text then return true; end if;
 if bucket_name='chat-assets' and (storage.foldername(object_name))[1] in('avatars','group-avatars') then return true; end if;
 for row_data in select m.attachments,m.text from public.messages m
  where public.orbit_security_can_access(m.room) and m.deleted_at is null
   and (m.expires_at is null or m.expires_at>now())
   and m.sender_id::text=owner_part loop
  -- Legacy media-only messages may keep their URL in text.
  if split_part(split_part(row_data.text,'/'||bucket_name||'/',2),'?',1)=object_name then return true; end if;
  for raw in select value from jsonb_array_elements(coalesce(to_jsonb(row_data.attachments),'[]')) loop
   begin
    attachment:=case when jsonb_typeof(raw)='string' then (raw#>>'{}')::jsonb else raw end;
    path:=attachment->>'storage_path';
    if path=object_name and coalesce(attachment->>'storage_bucket','chat-assets')=bucket_name then return true; end if;
    path:=split_part(split_part(attachment->>'url','/'||bucket_name||'/',2),'?',1);
    if path=object_name then return true; end if;
   exception when others then
    if jsonb_typeof(raw)='string' and split_part(split_part(raw#>>'{}','/'||bucket_name||'/',2),'?',1)=object_name then return true; end if;
   end;
  end loop;
 end loop;
 return false;
end $$;
revoke all on function public.orbit_security_media_access(text,text) from public,anon;
grant execute on function public.orbit_security_media_access(text,text) to authenticated;

-- RLS does not govern TRUNCATE; browser roles only need CRUD, not DDL powers.
revoke truncate,references,trigger on all tables in schema public from anon,authenticated;
CREATE OR REPLACE FUNCTION public.orbit_security_vote(message_key uuid, option_index integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.messages; att jsonb; poll jsonb; options jsonb; opt jsonb; voters jsonb; chosen boolean; i integer;
begin
 select * into m from public.messages where id=message_key for update;
 if auth.uid() is null or not found or m.type<>'poll' or m.deleted_at is not null or not public.orbit_security_can_access(m.room) then raise exception 'Access denied' using errcode='42501'; end if;
 begin att:=m.attachments[1]::jsonb; exception when others then raise exception 'Invalid poll'; end;
 poll:=att->'poll'; options:=poll->'options';
 if jsonb_typeof(options)<>'array' or option_index is null or option_index<0 or option_index>=jsonb_array_length(options) then raise exception 'Invalid option'; end if;
 chosen:=coalesce(options->option_index->'voters' ? auth.uid()::text,false);
 for i in 0..jsonb_array_length(options)-1 loop
  opt:=options->i;
  voters:=case when jsonb_typeof(opt->'voters')='array' then opt->'voters' else '[]'::jsonb end;
  if coalesce((poll->>'multiple_answers')::boolean,false)=false or i=option_index then
   select coalesce(jsonb_agg(value),'[]') into voters from jsonb_array_elements(voters) where value<>to_jsonb(auth.uid()::text);
  end if;
  if i=option_index and not chosen then voters:=voters||to_jsonb(auth.uid()::text); end if;
  opt:=jsonb_set(jsonb_set(opt,'{voters}',voters),'{votes}',to_jsonb(jsonb_array_length(voters))); options:=jsonb_set(options,array[i::text],opt);
 end loop;
 poll:=jsonb_set(poll,'{options}',options); att:=jsonb_set(att,'{poll}',poll);
 m.attachments[1]:=att::text;
 update public.messages set attachments=m.attachments where id=message_key;
end $function$
;
revoke all on function public.orbit_security_vote(uuid,integer) from public,anon;
grant execute on function public.orbit_security_vote(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
