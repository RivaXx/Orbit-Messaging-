-- Read-only usage statistics for the verified primary Orbit administrator.
begin;

create or replace function public.orbit_admin_usage_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    today date := (now() at time zone 'UTC')::date;
    first_day date := today - 29;
    cutoff timestamptz := first_day::timestamp at time zone 'UTC';
begin
    if not exists (
        select 1 from auth.users
        where id = auth.uid()
          and lower(email) = 'rivaldo.a.rodrigues@gmail.com'
          and email_confirmed_at is not null
    ) then
        raise exception 'Orbit usage analytics requires the primary administrator'
            using errcode = '42501';
    end if;

    return (
        with message_counts as (
            select (created_at at time zone 'UTC')::date as day, count(*) as total
            from public.messages
            where created_at >= cutoff and created_at <= now()
            group by 1
        ),
        signups as (
            select (created_at at time zone 'UTC')::date as day, count(*) as total
            from auth.users
            where created_at >= cutoff and created_at <= now()
            group by 1
        )
        select jsonb_build_object(
            'registered_accounts', (select count(*) from auth.users),
            'new_accounts', (select coalesce(sum(total), 0) from signups),
            'active_accounts', (select count(distinct user_id) from public.user_presence where last_seen between cutoff and now()),
            'active_senders', (select count(distinct sender_id) from public.messages where created_at between cutoff and now()),
            'messages', (select coalesce(sum(total), 0) from message_counts),
            'days', (
                select jsonb_agg(jsonb_build_object('day', day, 'signups', coalesce(s.total, 0), 'messages', coalesce(m.total, 0)) order by day desc)
                from (select today - n as day from generate_series(0, 29) n) dates
                left join signups s using (day)
                left join message_counts m using (day)
            )
        )
    );
end;
$$;

revoke all on function public.orbit_admin_usage_analytics() from public, anon, authenticated;
grant execute on function public.orbit_admin_usage_analytics() to authenticated;

commit;
