begin;

create function public.rename_team(p_team_id uuid,p_name_ar text)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  perform private.require_role('admin');
  if p_name_ar is null or length(trim(p_name_ar)) not between 1 and 80 then
    raise exception 'invalid team name' using errcode='22023';
  end if;
  update public.teams set name_ar=trim(p_name_ar) where id=p_team_id;
  if not found then raise exception 'team not found' using errcode='P0002'; end if;
end $$;

revoke all on function public.rename_team(uuid,text) from public,anon,authenticated;
grant execute on function public.rename_team(uuid,text) to authenticated;

commit;
