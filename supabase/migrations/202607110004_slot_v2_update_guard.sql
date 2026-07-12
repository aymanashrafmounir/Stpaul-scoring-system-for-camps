begin;

create or replace function public.upsert_slot_v2(p_request jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  sid uuid := nullif(p_request->>'id','')::uuid;
  eid uuid := (p_request->>'event_id')::uuid; scorer uuid := (p_request->>'scorer_id')::uuid;
  st public.slot_type := coalesce((p_request->>'slot_type')::public.slot_type,'game');
  teams uuid[];
begin
  perform private.require_role('admin');
  if jsonb_typeof(p_request) <> 'object' then raise exception 'request must be an object' using errcode='22023'; end if;
  select coalesce(array_agg(x::uuid),array[]::uuid[]) into teams from jsonb_array_elements_text(coalesce(p_request->'team_ids','[]')) x;
  if cardinality(teams) <> (select count(distinct x) from unnest(teams) x) then raise exception 'participants must be distinct' using errcode='22023'; end if;
  if (st='game' and cardinality(teams)<>2) or (st='tournament' and cardinality(teams)<4) then raise exception 'game needs 2 teams; tournament needs at least 4' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles where user_id=scorer and role='scorer' and is_active) then raise exception 'active scorer not found' using errcode='P0002'; end if;
  if exists(select 1 from unnest(teams) x where not exists(select 1 from public.teams t where t.id=x and t.event_id=eid)) then raise exception 'participant is outside event' using errcode='23503'; end if;
  if sid is not null then
    perform 1 from public.match_slots where id=sid for update;
    if not found then raise exception 'slot not found' using errcode='P0002'; end if;
    if exists(select 1 from public.match_results where slot_id=sid) or exists(select 1 from public.tournament_results where slot_id=sid) then raise exception 'submitted slot cannot be changed' using errcode='55000'; end if;
    if (select coalesce(sum(amount),0) from public.bonus_awards where slot_id=sid) > coalesce((p_request->>'bonus_limit')::int,10) then raise exception 'bonus limit cannot be below used amount' using errcode='23514'; end if;
    if exists(select 1 from public.bonus_awards where slot_id=sid and not (team_id=any(teams))) then raise exception 'awarded participant cannot be removed' using errcode='55000'; end if;
  else sid:=gen_random_uuid(); end if;
  insert into public.match_slots(id,event_id,slot_number,label_ar,scheduled_at,scorer_id,team_a_id,team_b_id,slot_type,winner_score,draw_score,loser_score,first_score,second_score,third_score,others_score,bonus_limit)
  values(sid,eid,(p_request->>'slot_number')::int,trim(p_request->>'label_ar'),(p_request->>'scheduled_at')::timestamptz,scorer,teams[1],teams[2],st,
    coalesce((p_request->>'winner_score')::int,50),coalesce((p_request->>'draw_score')::int,25),coalesce((p_request->>'loser_score')::int,20),
    coalesce((p_request->>'first_score')::int,175),coalesce((p_request->>'second_score')::int,125),coalesce((p_request->>'third_score')::int,75),coalesce((p_request->>'others_score')::int,30),coalesce((p_request->>'bonus_limit')::int,10))
  on conflict(id) do update set event_id=excluded.event_id,slot_number=excluded.slot_number,label_ar=excluded.label_ar,scheduled_at=excluded.scheduled_at,
    scorer_id=excluded.scorer_id,team_a_id=excluded.team_a_id,team_b_id=excluded.team_b_id,slot_type=excluded.slot_type,winner_score=excluded.winner_score,
    draw_score=excluded.draw_score,loser_score=excluded.loser_score,first_score=excluded.first_score,second_score=excluded.second_score,third_score=excluded.third_score,
    others_score=excluded.others_score,bonus_limit=excluded.bonus_limit;
  delete from public.slot_participants where slot_id=sid;
  insert into public.slot_participants(slot_id,team_id) select sid,unnest(teams);
  return sid;
end $$;

revoke all on function public.upsert_slot_v2(jsonb) from public,anon,authenticated;
grant execute on function public.upsert_slot_v2(jsonb) to authenticated;

commit;
