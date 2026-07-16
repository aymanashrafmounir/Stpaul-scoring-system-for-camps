begin;

create function public.scorer_login_options()
returns table(username text)
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select profile.username
  from public.profiles profile
  where profile.role='scorer'
    and profile.is_active
    and profile.username is not null
  order by profile.username
$$;

revoke all on function public.scorer_login_options() from public,anon,authenticated;
grant execute on function public.scorer_login_options() to anon,authenticated;

commit;
