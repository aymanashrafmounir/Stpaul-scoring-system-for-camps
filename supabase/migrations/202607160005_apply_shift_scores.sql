begin;

create temporary table replacement_games on commit drop as
select
  slot.id as old_slot_id,
  slot.event_id,
  slot.slot_number,
  slot.scheduled_at,
  slot.scorer_id,
  slot.team_a_id,
  slot.team_b_id,
  right(profile.username,2)::integer as shift_number
from public.match_slots slot
join public.profiles profile on profile.user_id=slot.scorer_id
where slot.event_id=(select id from public.events where is_active)
  and profile.username in (
    'scorer01','scorer02','scorer03','scorer04',
    'scorer05','scorer06','scorer07','scorer08'
  );

do $$
declare
  active_event_id uuid;
  target_slot_ids uuid[];
begin
  select id into strict active_event_id from public.events where is_active;

  if (select count(*) from replacement_games)<>32 then
    raise exception 'expected 32 existing games for scorer01 through scorer08';
  end if;

  if exists (
    select scorer_id from replacement_games
    group by scorer_id having count(*)<>4
  ) then
    raise exception 'every target scorer must have four games';
  end if;

  select array_agg(old_slot_id) into target_slot_ids from replacement_games;

  insert into private.camp_reset_backups(event_id,snapshot)
  values(active_event_id,jsonb_build_object(
    'wallet_ledger',coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select ledger.* from public.wallet_ledger ledger
      join public.teams team on team.id=ledger.team_id
      where team.event_id=active_event_id
    ) row_data),'[]'::jsonb),
    'match_results',coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select result.* from public.match_results result
      join public.match_slots slot on slot.id=result.slot_id
      where slot.event_id=active_event_id
    ) row_data),'[]'::jsonb),
    'tournament_results',coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select result.* from public.tournament_results result
      join public.match_slots slot on slot.id=result.slot_id
      where slot.event_id=active_event_id
    ) row_data),'[]'::jsonb),
    'bonus_awards',coalesce((select jsonb_agg(to_jsonb(award))
      from public.bonus_awards award where award.event_id=active_event_id),'[]'::jsonb),
    'replaced_slots',coalesce((select jsonb_agg(to_jsonb(game))
      from replacement_games game),'[]'::jsonb)
  ));

  alter table public.wallet_ledger disable trigger wallet_ledger_immutable;
  delete from public.wallet_ledger ledger
  using public.teams team
  where team.id=ledger.team_id and team.event_id=active_event_id;
  alter table public.wallet_ledger enable trigger wallet_ledger_immutable;

  delete from public.slot_result_corrections correction
  using public.match_slots slot
  where slot.id=correction.slot_id and slot.event_id=active_event_id;

  delete from public.bonus_awards where event_id=active_event_id;

  delete from public.match_results result
  using public.match_slots slot
  where slot.id=result.slot_id and slot.event_id=active_event_id;

  delete from public.tournament_results result
  using public.match_slots slot
  where slot.id=result.slot_id and slot.event_id=active_event_id;

  delete from public.redemptions redemption
  using public.teams team
  where team.id=redemption.team_id and team.event_id=active_event_id;

  delete from public.admin_adjustments adjustment
  using public.teams team
  where team.id=adjustment.team_id and team.event_id=active_event_id;

  delete from public.match_slots where id=any(target_slot_ids);

  insert into public.match_slots(
    event_id,slot_number,label_ar,scheduled_at,scorer_id,team_a_id,team_b_id,
    slot_type,winner_score,draw_score,loser_score,first_score,second_score,
    third_score,others_score,bonus_limit
  )
  select
    event_id,slot_number,'Shift ' || shift_number,scheduled_at,
    scorer_id,team_a_id,team_b_id,'game',
    50,25,20,175,125,75,30,20
  from replacement_games
  order by slot_number;

  insert into public.slot_participants(slot_id,team_id)
  select slot.id,slot.team_a_id from public.match_slots slot
  where slot.event_id=active_event_id and slot.slot_number between 1 and 32
  union all
  select slot.id,slot.team_b_id from public.match_slots slot
  where slot.event_id=active_event_id and slot.slot_number between 1 and 32;

  if exists (
    select 1 from public.teams team
    left join public.wallet_ledger ledger on ledger.team_id=team.id
    where team.event_id=active_event_id
    group by team.id
    having coalesce(sum(ledger.amount),0)<>0
  ) then
    raise exception 'team balance reset failed';
  end if;

  if exists (
    select 1
    from public.match_slots slot
    join public.profiles profile on profile.user_id=slot.scorer_id
    where slot.event_id=active_event_id
      and profile.username in (
        'scorer01','scorer02','scorer03','scorer04',
        'scorer05','scorer06','scorer07','scorer08'
      )
      and (
        slot.slot_type<>'game'
        or slot.winner_score<>50
        or slot.draw_score<>25
        or slot.loser_score<>20
        or slot.label_ar<>'Shift ' || right(profile.username,2)::integer
      )
  ) then
    raise exception 'shift labels or game scores are incorrect';
  end if;
end $$;

commit;
