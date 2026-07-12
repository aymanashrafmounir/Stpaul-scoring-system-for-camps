begin;

drop function public.my_assignments();
create function public.my_assignments()
returns table (assignment jsonb)
language sql stable security invoker set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'slot_id', s.id, 'slot_number', s.slot_number, 'label_ar', s.label_ar,
    'scheduled_at', s.scheduled_at, 'slot_type', s.slot_type,
    'team_a_id', case when s.slot_type='game' then s.team_a_id else null end,
    'team_b_id', case when s.slot_type='game' then s.team_b_id else null end,
    'scores', case when s.slot_type = 'game' then jsonb_build_object('winner',s.winner_score,'draw',s.draw_score,'loser',s.loser_score)
      else jsonb_build_object('first',s.first_score,'second',s.second_score,'third',s.third_score,'others',s.others_score) end,
    'bonus_limit', s.bonus_limit,
    'bonus_used', coalesce(b.used,0), 'bonus_remaining', s.bonus_limit-coalesce(b.used,0),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'code',t.code,'name_ar',t.name_ar)
      order by case when s.slot_type='game' and t.id=s.team_a_id then 0 when s.slot_type='game' and t.id=s.team_b_id then 1 else 2 end,t.name_ar,t.id)
      from public.slot_participants sp join public.teams t on t.id=sp.team_id where sp.slot_id=s.id),'[]'::jsonb),
    'submitted', (mr.id is not null or tr.id is not null),
    'game_outcome', mr.outcome,
    'tournament_result', case when tr.id is null then null else jsonb_build_object('first_team_id',tr.first_team_id,'second_team_id',tr.second_team_id,'third_team_id',tr.third_team_id) end
  )
  from public.match_slots s
  join public.events e on e.id=s.event_id and e.is_active
  left join public.match_results mr on mr.slot_id=s.id
  left join public.tournament_results tr on tr.slot_id=s.id
  left join lateral (select coalesce(sum(amount),0)::bigint used from public.bonus_awards ba where ba.slot_id=s.id) b on true
  where s.scorer_id=auth.uid()
  order by s.scheduled_at,s.slot_number
$$;

revoke all on function public.my_assignments() from public,anon,authenticated;
grant execute on function public.my_assignments() to authenticated;

commit;
