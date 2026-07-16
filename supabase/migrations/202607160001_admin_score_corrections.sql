begin;

alter table public.bonus_awards
  add column undone_at timestamptz,
  add column undone_by uuid references public.profiles(user_id) on delete restrict,
  add column undo_reason text check (undo_reason is null or length(trim(undo_reason)) between 1 and 240),
  add column undo_idempotency_key uuid;

create unique index bonus_awards_admin_undo_key
  on public.bonus_awards(undone_by, undo_idempotency_key)
  where undo_idempotency_key is not null;

create table public.slot_result_corrections (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.match_slots(id) on delete restrict,
  admin_id uuid not null references public.profiles(user_id) on delete restrict,
  previous_result jsonb not null,
  corrected_result jsonb not null,
  reason text not null check (length(trim(reason)) between 1 and 240),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique(admin_id, idempotency_key)
);

alter table public.slot_result_corrections enable row level security;
create policy slot_result_corrections_admin_only
  on public.slot_result_corrections for select to authenticated
  using (private.current_role() = 'admin');

revoke all on public.slot_result_corrections from anon, authenticated;
grant select on public.slot_result_corrections to authenticated;

create function public.correct_slot_result(
  p_slot_id uuid,
  p_result jsonb,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  caller uuid := private.require_role('admin');
  slot_row public.match_slots%rowtype;
  game_result public.match_results%rowtype;
  tournament_result public.tournament_results%rowtype;
  existing public.slot_result_corrections%rowtype;
  previous_result jsonb;
  corrected_result jsonb;
  correction_id uuid;
  participant_id uuid;
  previous_amount integer;
  corrected_amount integer;
  amount_delta integer;
  team_balance bigint;
  adjustment_id uuid;
  adjustment_key uuid;
begin
  if p_result is null or p_reason is null or length(trim(p_reason)) not between 1 and 240
     or p_idempotency_key is null then
    raise exception 'invalid score correction request' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_idempotency_key::text, 0));
  select * into existing
  from public.slot_result_corrections
  where admin_id=caller and idempotency_key=p_idempotency_key;
  if found then
    if existing.slot_id<>p_slot_id or existing.corrected_result<>p_result or existing.reason<>trim(p_reason) then
      raise exception 'idempotency key was already used with different input' using errcode='22023';
    end if;
    return existing.id;
  end if;

  select * into slot_row from public.match_slots where id=p_slot_id for update;
  if not found then raise exception 'slot not found' using errcode='P0002'; end if;

  if slot_row.slot_type='game' then
    select * into game_result from public.match_results where slot_id=p_slot_id for update;
    if not found then raise exception 'slot result not found' using errcode='P0002'; end if;
    if p_result->>'outcome' not in ('team_a_win','draw','team_b_win') then
      raise exception 'invalid game result' using errcode='22023';
    end if;
    previous_result := jsonb_build_object('outcome', game_result.outcome);
    corrected_result := jsonb_build_object('outcome', p_result->>'outcome');
  else
    select * into tournament_result from public.tournament_results where slot_id=p_slot_id for update;
    if not found then raise exception 'slot result not found' using errcode='P0002'; end if;
    if p_result->>'first_team_id' is null or p_result->>'second_team_id' is null or p_result->>'third_team_id' is null
       or p_result->>'first_team_id'=p_result->>'second_team_id'
       or p_result->>'first_team_id'=p_result->>'third_team_id'
       or p_result->>'second_team_id'=p_result->>'third_team_id' then
      raise exception 'invalid tournament result' using errcode='22023';
    end if;
    if exists (
      select 1
      from unnest(array[
        (p_result->>'first_team_id')::uuid,
        (p_result->>'second_team_id')::uuid,
        (p_result->>'third_team_id')::uuid
      ]) ranked_team
      where not exists (
        select 1 from public.slot_participants
        where slot_id=p_slot_id and team_id=ranked_team
      )
    ) then
      raise exception 'ranked team is not a participant' using errcode='23503';
    end if;
    previous_result := jsonb_build_object(
      'first_team_id', tournament_result.first_team_id,
      'second_team_id', tournament_result.second_team_id,
      'third_team_id', tournament_result.third_team_id
    );
    corrected_result := jsonb_build_object(
      'first_team_id', p_result->>'first_team_id',
      'second_team_id', p_result->>'second_team_id',
      'third_team_id', p_result->>'third_team_id'
    );
  end if;

  if previous_result=corrected_result then
    raise exception 'corrected result matches current result' using errcode='22023';
  end if;

  perform 1
  from public.teams team
  join public.slot_participants participant on participant.team_id=team.id
  where participant.slot_id=p_slot_id
  order by team.id
  for update of team;

  insert into public.slot_result_corrections(
    slot_id,admin_id,previous_result,corrected_result,reason,idempotency_key
  )
  values(p_slot_id,caller,previous_result,corrected_result,trim(p_reason),p_idempotency_key)
  returning id into correction_id;

  for participant_id in
    select team_id from public.slot_participants where slot_id=p_slot_id order by team_id
  loop
    if slot_row.slot_type='game' then
      previous_amount := case
        when game_result.outcome='team_a_win' and participant_id=slot_row.team_a_id then slot_row.winner_score
        when game_result.outcome='team_b_win' and participant_id=slot_row.team_b_id then slot_row.winner_score
        when game_result.outcome='draw' then slot_row.draw_score
        else slot_row.loser_score
      end;
      corrected_amount := case
        when corrected_result->>'outcome'='team_a_win' and participant_id=slot_row.team_a_id then slot_row.winner_score
        when corrected_result->>'outcome'='team_b_win' and participant_id=slot_row.team_b_id then slot_row.winner_score
        when corrected_result->>'outcome'='draw' then slot_row.draw_score
        else slot_row.loser_score
      end;
    else
      previous_amount := case participant_id
        when tournament_result.first_team_id then slot_row.first_score
        when tournament_result.second_team_id then slot_row.second_score
        when tournament_result.third_team_id then slot_row.third_score
        else slot_row.others_score
      end;
      corrected_amount := case participant_id
        when (corrected_result->>'first_team_id')::uuid then slot_row.first_score
        when (corrected_result->>'second_team_id')::uuid then slot_row.second_score
        when (corrected_result->>'third_team_id')::uuid then slot_row.third_score
        else slot_row.others_score
      end;
    end if;

    amount_delta := corrected_amount - previous_amount;
    if amount_delta<>0 then
      select coalesce(sum(amount),0) into team_balance
      from public.wallet_ledger where team_id=participant_id;
      if team_balance+amount_delta<0 then
        raise exception 'score correction would make balance negative' using errcode='23514';
      end if;
      adjustment_key := md5(p_idempotency_key::text || ':' || participant_id::text)::uuid;
      insert into public.admin_adjustments(team_id,admin_id,amount,reason,idempotency_key)
      values(participant_id,caller,amount_delta,'تصحيح نتيجة: ' || trim(p_reason),adjustment_key)
      returning id into adjustment_id;
      insert into public.wallet_ledger(team_id,amount,kind,description_ar,adjustment_id,created_by)
      values(participant_id,amount_delta,'adjustment','تصحيح نتيجة: ' || trim(p_reason),adjustment_id,caller);
    end if;
  end loop;

  if slot_row.slot_type='game' then
    update public.match_results
    set outcome=(corrected_result->>'outcome')::public.match_outcome
    where id=game_result.id;
  else
    update public.tournament_results
    set first_team_id=(corrected_result->>'first_team_id')::uuid,
        second_team_id=(corrected_result->>'second_team_id')::uuid,
        third_team_id=(corrected_result->>'third_team_id')::uuid
    where id=tournament_result.id;
  end if;

  return correction_id;
end $$;

create function public.undo_slot_bonus(
  p_bonus_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  caller uuid := private.require_role('admin');
  award public.bonus_awards%rowtype;
  original_entry public.wallet_ledger%rowtype;
  reversal_id uuid;
  team_balance bigint;
begin
  if p_reason is null or length(trim(p_reason)) not between 1 and 240 or p_idempotency_key is null then
    raise exception 'invalid bonus undo request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_idempotency_key::text, 0));
  select * into award from public.bonus_awards where id=p_bonus_id for update;
  if not found then raise exception 'bonus not found' using errcode='P0002'; end if;
  if award.undone_at is not null then
    if award.undone_by=caller and award.undo_idempotency_key=p_idempotency_key and award.undo_reason=trim(p_reason) then
      select id into reversal_id from public.wallet_ledger
      where reverses_entry_id=(select id from public.wallet_ledger where bonus_award_id=p_bonus_id);
      return reversal_id;
    end if;
    raise exception 'bonus already undone' using errcode='55000';
  end if;
  select * into original_entry from public.wallet_ledger where bonus_award_id=p_bonus_id for update;
  if not found then raise exception 'bonus ledger entry not found' using errcode='P0002'; end if;
  select id into reversal_id from public.wallet_ledger where reverses_entry_id=original_entry.id;
  if found then
    update public.bonus_awards
    set undone_at=now(),undone_by=caller,undo_reason=trim(p_reason),undo_idempotency_key=p_idempotency_key
    where id=p_bonus_id;
    return reversal_id;
  end if;
  perform 1 from public.teams where id=award.team_id for update;
  select coalesce(sum(amount),0) into team_balance from public.wallet_ledger where team_id=award.team_id;
  if team_balance-award.amount<0 then
    raise exception 'bonus undo would make balance negative' using errcode='23514';
  end if;
  insert into public.wallet_ledger(team_id,amount,kind,description_ar,reverses_entry_id,created_by)
  values(award.team_id,-award.amount,'reversal','إلغاء Bonus: ' || trim(p_reason),original_entry.id,caller)
  returning id into reversal_id;
  update public.bonus_awards
  set undone_at=now(),undone_by=caller,undo_reason=trim(p_reason),undo_idempotency_key=p_idempotency_key
  where id=p_bonus_id;
  return reversal_id;
end $$;

create or replace function public.reverse_wallet_entry(p_entry_id uuid,p_reason text)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  caller uuid:=private.require_role('admin');
  original public.wallet_ledger%rowtype;
  reversal_id uuid;
  balance bigint;
begin
  if p_reason is null or length(trim(p_reason)) not between 1 and 240 then
    raise exception 'reversal reason is required' using errcode='22023';
  end if;
  select * into original from public.wallet_ledger where id=p_entry_id;
  if not found or original.kind='reversal' then
    raise exception 'entry cannot be reversed' using errcode='22023';
  end if;
  if original.kind='bonus' then
    raise exception 'bonus must be undone with undo_slot_bonus' using errcode='55000';
  end if;
  select id into reversal_id from public.wallet_ledger where reverses_entry_id=p_entry_id;
  if found then return reversal_id; end if;
  perform 1 from public.teams where id=original.team_id for update;
  select id into reversal_id from public.wallet_ledger where reverses_entry_id=p_entry_id;
  if found then return reversal_id; end if;
  select coalesce(sum(amount),0) into balance from public.wallet_ledger where team_id=original.team_id;
  if balance-original.amount<0 then
    raise exception 'reversal would make balance negative' using errcode='23514';
  end if;
  insert into public.wallet_ledger(team_id,amount,kind,description_ar,reverses_entry_id,created_by)
  values(original.team_id,-original.amount,'reversal',trim(p_reason),p_entry_id,caller)
  returning id into reversal_id;
  return reversal_id;
end $$;

create or replace function public.my_assignments()
returns table (assignment jsonb)
language sql stable security invoker set search_path=pg_catalog,public
as $$
  select jsonb_build_object(
    'slot_id',s.id,'slot_number',s.slot_number,'label_ar',s.label_ar,
    'scheduled_at',s.scheduled_at,'slot_type',s.slot_type,
    'team_a_id',case when s.slot_type='game' then s.team_a_id else null end,
    'team_b_id',case when s.slot_type='game' then s.team_b_id else null end,
    'scores',case when s.slot_type='game'
      then jsonb_build_object('winner',s.winner_score,'draw',s.draw_score,'loser',s.loser_score)
      else jsonb_build_object('first',s.first_score,'second',s.second_score,'third',s.third_score,'others',s.others_score) end,
    'bonus_limit',s.bonus_limit,
    'bonus_used',coalesce(b.used,0),'bonus_remaining',s.bonus_limit-coalesce(b.used,0),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('team_id',t.id,'code',t.code,'name_ar',t.name_ar)
      order by case when s.slot_type='game' and t.id=s.team_a_id then 0 when s.slot_type='game' and t.id=s.team_b_id then 1 else 2 end,t.name_ar,t.id)
      from public.slot_participants sp join public.teams t on t.id=sp.team_id where sp.slot_id=s.id),'[]'::jsonb),
    'submitted',(mr.id is not null or tr.id is not null),
    'game_outcome',mr.outcome,
    'tournament_result',case when tr.id is null then null else jsonb_build_object(
      'first_team_id',tr.first_team_id,'second_team_id',tr.second_team_id,'third_team_id',tr.third_team_id
    ) end
  )
  from public.match_slots s
  join public.events e on e.id=s.event_id and e.is_active
  left join public.match_results mr on mr.slot_id=s.id
  left join public.tournament_results tr on tr.slot_id=s.id
  left join lateral (
    select coalesce(sum(amount),0)::bigint used
    from public.bonus_awards ba
    where ba.slot_id=s.id and ba.undone_at is null
  ) b on true
  where s.scorer_id=auth.uid()
  order by s.scheduled_at,s.slot_number
$$;

create or replace function public.award_slot_bonus(
  p_slot_id uuid,p_team_id uuid,p_amount integer,p_reason text,p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  caller uuid:=private.require_role('scorer');
  slot_row public.match_slots%rowtype;
  existing public.bonus_awards%rowtype;
  used bigint;
  award_id uuid;
begin
  if p_amount is null or p_amount<=0 or p_idempotency_key is null
     or p_reason is null or length(trim(p_reason)) not between 1 and 240 then
    raise exception 'invalid bonus request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text||':'||p_idempotency_key::text,0));
  select * into slot_row from public.match_slots where id=p_slot_id for update;
  if not found or slot_row.scorer_id<>caller then
    raise exception 'slot is not assigned to scorer' using errcode='42501';
  end if;
  if not exists(select 1 from public.events where id=slot_row.event_id and is_active for share) then
    raise exception 'event is not active' using errcode='55000';
  end if;
  if not exists(select 1 from public.slot_participants where slot_id=p_slot_id and team_id=p_team_id) then
    raise exception 'team is not a slot participant' using errcode='42501';
  end if;
  select * into existing from public.bonus_awards
  where scorer_id=caller and idempotency_key=p_idempotency_key;
  if found then
    if existing.slot_id<>p_slot_id or existing.team_id<>p_team_id
       or existing.amount<>p_amount or existing.reason<>trim(p_reason) then
      raise exception 'idempotency conflict' using errcode='22023';
    end if;
    return existing.id;
  end if;
  select coalesce(sum(amount),0) into used
  from public.bonus_awards where slot_id=p_slot_id and undone_at is null;
  if used+p_amount>slot_row.bonus_limit then
    raise exception 'slot bonus limit exceeded' using errcode='23514';
  end if;
  perform 1 from public.teams where id=p_team_id for update;
  insert into public.bonus_awards(event_id,scorer_id,team_id,slot_id,amount,reason,idempotency_key)
  values(slot_row.event_id,caller,p_team_id,p_slot_id,p_amount,trim(p_reason),p_idempotency_key)
  returning id into award_id;
  insert into public.wallet_ledger(team_id,amount,kind,description_ar,bonus_award_id,created_by)
  values(p_team_id,p_amount,'bonus',trim(p_reason),award_id,caller);
  return award_id;
end $$;

revoke all on function public.correct_slot_result(uuid,jsonb,text,uuid),
  public.undo_slot_bonus(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.correct_slot_result(uuid,jsonb,text,uuid),
  public.undo_slot_bonus(uuid,text,uuid) to authenticated;

commit;
