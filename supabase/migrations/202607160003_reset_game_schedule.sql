begin;

create table if not exists private.camp_reset_backups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  created_at timestamptz not null default now(),
  snapshot jsonb not null
);

revoke all on private.camp_reset_backups from public,anon,authenticated;

create temporary table desired_game_schedule (
  slot_number integer primary key,
  scorer_username text not null,
  team_a_code text not null,
  team_b_code text not null
) on commit drop;

insert into desired_game_schedule(slot_number,scorer_username,team_a_code,team_b_code) values
  (1,'scorer01','TEAM-1','TEAM-8'),
  (2,'scorer01','TEAM-2','TEAM-7'),
  (3,'scorer01','TEAM-3','TEAM-6'),
  (4,'scorer01','TEAM-4','TEAM-5'),
  (5,'scorer02','TEAM-3','TEAM-4'),
  (6,'scorer02','TEAM-5','TEAM-6'),
  (7,'scorer02','TEAM-1','TEAM-2'),
  (8,'scorer02','TEAM-7','TEAM-8'),
  (9,'scorer03','TEAM-6','TEAM-7'),
  (10,'scorer03','TEAM-1','TEAM-4'),
  (11,'scorer03','TEAM-5','TEAM-8'),
  (12,'scorer03','TEAM-2','TEAM-3'),
  (13,'scorer04','TEAM-2','TEAM-5'),
  (14,'scorer04','TEAM-3','TEAM-8'),
  (15,'scorer04','TEAM-4','TEAM-7'),
  (16,'scorer04','TEAM-1','TEAM-6'),
  (17,'scorer05','TEAM-1','TEAM-2'),
  (18,'scorer05','TEAM-3','TEAM-4'),
  (19,'scorer05','TEAM-5','TEAM-6'),
  (20,'scorer05','TEAM-7','TEAM-8'),
  (21,'scorer06','TEAM-5','TEAM-7'),
  (22,'scorer06','TEAM-6','TEAM-8'),
  (23,'scorer06','TEAM-2','TEAM-4'),
  (24,'scorer06','TEAM-1','TEAM-3'),
  (25,'scorer07','TEAM-4','TEAM-8'),
  (26,'scorer07','TEAM-1','TEAM-5'),
  (27,'scorer07','TEAM-3','TEAM-7'),
  (28,'scorer07','TEAM-2','TEAM-6'),
  (29,'scorer08','TEAM-3','TEAM-6'),
  (30,'scorer08','TEAM-2','TEAM-7'),
  (31,'scorer08','TEAM-1','TEAM-8'),
  (32,'scorer08','TEAM-4','TEAM-5');

do $$
declare
  active_event public.events%rowtype;
  target_scorer_ids uuid[];
  target_slot_ids uuid[];
begin
  select * into strict active_event from public.events where is_active;

  if (
    select count(*) from public.teams
    where event_id=active_event.id and code in (
      'TEAM-1','TEAM-2','TEAM-3','TEAM-4','TEAM-5','TEAM-6','TEAM-7','TEAM-8'
    )
  )<>8 then
    raise exception 'expected TEAM-1 through TEAM-8 in active event';
  end if;

  select coalesce(array_agg(user_id order by username),'{}'::uuid[]) into target_scorer_ids
  from public.profiles
  where role='scorer' and username in (
    'scorer01','scorer02','scorer03','scorer04',
    'scorer05','scorer06','scorer07','scorer08'
  );
  if cardinality(target_scorer_ids)<>8 then
    raise exception 'expected scorer01 through scorer08';
  end if;

  select coalesce(array_agg(id),'{}'::uuid[]) into target_slot_ids
  from public.match_slots
  where event_id=active_event.id and scorer_id=any(target_scorer_ids);

  insert into private.camp_reset_backups(event_id,snapshot)
  values(active_event.id,jsonb_build_object(
    'wallet_ledger',coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select ledger.* from public.wallet_ledger ledger
      join public.teams team on team.id=ledger.team_id
      where team.event_id=active_event.id
    ) row_data),'[]'::jsonb),
    'match_results',coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select result.* from public.match_results result
      join public.match_slots slot on slot.id=result.slot_id
      where slot.event_id=active_event.id
    ) row_data),'[]'::jsonb),
    'tournament_results',coalesce((select jsonb_agg(to_jsonb(row_data)) from (
      select result.* from public.tournament_results result
      join public.match_slots slot on slot.id=result.slot_id
      where slot.event_id=active_event.id
    ) row_data),'[]'::jsonb),
    'bonus_awards',coalesce((select jsonb_agg(to_jsonb(award)) from public.bonus_awards award
      where award.event_id=active_event.id),'[]'::jsonb),
    'redemptions',coalesce((select jsonb_agg(to_jsonb(redemption)) from public.redemptions redemption
      join public.teams team on team.id=redemption.team_id
      where team.event_id=active_event.id),'[]'::jsonb),
    'admin_adjustments',coalesce((select jsonb_agg(to_jsonb(adjustment)) from public.admin_adjustments adjustment
      join public.teams team on team.id=adjustment.team_id
      where team.event_id=active_event.id),'[]'::jsonb),
    'slot_result_corrections',coalesce((select jsonb_agg(to_jsonb(correction))
      from public.slot_result_corrections correction
      join public.match_slots slot on slot.id=correction.slot_id
      where slot.event_id=active_event.id),'[]'::jsonb),
    'replaced_slots',coalesce((select jsonb_agg(to_jsonb(slot)) from public.match_slots slot
      where slot.id=any(target_slot_ids)),'[]'::jsonb),
    'replaced_participants',coalesce((select jsonb_agg(to_jsonb(participant))
      from public.slot_participants participant
      where participant.slot_id=any(target_slot_ids)),'[]'::jsonb)
  ));

  alter table public.wallet_ledger disable trigger wallet_ledger_immutable;
  delete from public.wallet_ledger ledger
  using public.teams team
  where team.id=ledger.team_id and team.event_id=active_event.id;
  alter table public.wallet_ledger enable trigger wallet_ledger_immutable;

  delete from public.slot_result_corrections correction
  using public.match_slots slot
  where slot.id=correction.slot_id and slot.event_id=active_event.id;

  delete from public.bonus_awards where event_id=active_event.id;

  delete from public.match_results result
  using public.match_slots slot
  where slot.id=result.slot_id and slot.event_id=active_event.id;

  delete from public.tournament_results result
  using public.match_slots slot
  where slot.id=result.slot_id and slot.event_id=active_event.id;

  delete from public.redemptions redemption
  using public.teams team
  where team.id=redemption.team_id and team.event_id=active_event.id;

  delete from public.admin_adjustments adjustment
  using public.teams team
  where team.id=adjustment.team_id and team.event_id=active_event.id;

  delete from public.match_slots where id=any(target_slot_ids);

  if exists (
    select 1 from public.match_slots
    where event_id=active_event.id and slot_number between 1 and 32
  ) then
    raise exception 'slot numbers 1 through 32 are used by non-target scorers';
  end if;

  insert into public.match_slots(
    event_id,slot_number,label_ar,scheduled_at,scorer_id,team_a_id,team_b_id,
    slot_type,winner_score,draw_score,loser_score,first_score,second_score,
    third_score,others_score,bonus_limit
  )
  select
    active_event.id,
    schedule.slot_number,
    'Game ' || schedule.slot_number || '، ' || team_a.name_ar || ' ضد ' || team_b.name_ar,
    active_event.starts_at + interval '1 hour' + ((schedule.slot_number-1)*interval '20 minutes'),
    scorer.user_id,
    team_a.id,
    team_b.id,
    'game',
    10,5,2,175,125,75,30,20
  from desired_game_schedule schedule
  join public.profiles scorer on scorer.username=schedule.scorer_username and scorer.role='scorer'
  join public.teams team_a on team_a.event_id=active_event.id and team_a.code=schedule.team_a_code
  join public.teams team_b on team_b.event_id=active_event.id and team_b.code=schedule.team_b_code;

  insert into public.slot_participants(slot_id,team_id)
  select slot.id,slot.team_a_id from public.match_slots slot
  where slot.event_id=active_event.id and slot.scorer_id=any(target_scorer_ids)
  union all
  select slot.id,slot.team_b_id from public.match_slots slot
  where slot.event_id=active_event.id and slot.scorer_id=any(target_scorer_ids);

  if exists (
    select 1 from public.teams team
    left join public.wallet_ledger ledger on ledger.team_id=team.id
    where team.event_id=active_event.id
    group by team.id
    having coalesce(sum(ledger.amount),0)<>0
  ) then
    raise exception 'team balance reset failed';
  end if;

  if (
    select count(*) from public.match_slots
    where event_id=active_event.id and scorer_id=any(target_scorer_ids)
      and slot_type='game'
  )<>32 then
    raise exception 'expected 32 game slots after reset';
  end if;

  if exists (
    select scorer_id from public.match_slots
    where event_id=active_event.id and scorer_id=any(target_scorer_ids)
    group by scorer_id having count(*)<>4
  ) then
    raise exception 'every target scorer must have exactly four slots';
  end if;

  if exists (
    select 1
    from desired_game_schedule schedule
    left join public.match_slots slot
      on slot.event_id=active_event.id and slot.slot_number=schedule.slot_number
    left join public.profiles scorer on scorer.user_id=slot.scorer_id
    left join public.teams team_a on team_a.id=slot.team_a_id
    left join public.teams team_b on team_b.id=slot.team_b_id
    where scorer.username is distinct from schedule.scorer_username
       or team_a.code is distinct from schedule.team_a_code
       or team_b.code is distinct from schedule.team_b_code
       or slot.slot_type is distinct from 'game'::public.slot_type
  ) then
    raise exception 'created schedule does not match requested games';
  end if;
end $$;

commit;
