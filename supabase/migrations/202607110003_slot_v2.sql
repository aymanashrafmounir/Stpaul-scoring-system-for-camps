begin;

create type public.slot_type as enum ('game', 'tournament');

alter table public.match_slots
  add column slot_type public.slot_type not null default 'game',
  add column winner_score integer not null default 50 check (winner_score >= 0),
  add column draw_score integer not null default 25 check (draw_score >= 0),
  add column loser_score integer not null default 20 check (loser_score >= 0),
  add column first_score integer not null default 175 check (first_score >= 0),
  add column second_score integer not null default 125 check (second_score >= 0),
  add column third_score integer not null default 75 check (third_score >= 0),
  add column others_score integer not null default 30 check (others_score >= 0),
  add column bonus_limit integer not null default 10 check (bonus_limit >= 0);

create table public.slot_participants (
  slot_id uuid not null references public.match_slots(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (slot_id, team_id)
);

-- Existing slots remain games and their two teams become explicit participants.
insert into public.slot_participants (slot_id, team_id)
select id, team_a_id from public.match_slots
union all
select id, team_b_id from public.match_slots;

alter table public.bonus_awards add column slot_id uuid references public.match_slots(id) on delete restrict;
-- Historical awards may span several old slots, so they intentionally remain NULL.
create index bonus_awards_slot_idx on public.bonus_awards (slot_id);

create table public.tournament_results (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.match_slots(id) on delete restrict,
  scorer_id uuid not null references public.profiles(user_id) on delete restrict,
  first_team_id uuid not null references public.teams(id) on delete restrict,
  second_team_id uuid not null references public.teams(id) on delete restrict,
  third_team_id uuid not null references public.teams(id) on delete restrict,
  idempotency_key uuid not null,
  submitted_at timestamptz not null default now(),
  unique (scorer_id, idempotency_key),
  check (first_team_id <> second_team_id and first_team_id <> third_team_id and second_team_id <> third_team_id)
);

alter table public.wallet_ledger
  add column tournament_result_id uuid references public.tournament_results(id) on delete restrict;
drop index if exists public.wallet_ledger_match_team_idx;
create unique index wallet_ledger_game_team_idx on public.wallet_ledger (match_result_id, team_id) where match_result_id is not null;
create unique index wallet_ledger_tournament_team_idx on public.wallet_ledger (tournament_result_id, team_id) where tournament_result_id is not null;

alter table public.wallet_ledger drop constraint wallet_ledger_single_source_check;
alter table public.wallet_ledger add constraint wallet_ledger_single_source_check
  check (num_nonnulls(match_result_id, tournament_result_id, bonus_award_id, redemption_id, reverses_entry_id, adjustment_id) <= 1);

-- Replace the generated original "match source" check without depending on its name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.wallet_ledger'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind = ''match''%match_result_id%'
  loop execute format('alter table public.wallet_ledger drop constraint %I', c.conname); end loop;
end $$;
alter table public.wallet_ledger add constraint wallet_ledger_match_source_check
  check ((kind = 'match') = (num_nonnulls(match_result_id, tournament_result_id) = 1));

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

create function public.upsert_slot_v2(p_request jsonb)
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

create function public.submit_game_result(p_slot_id uuid,p_outcome public.match_outcome,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$
declare caller uuid:=private.require_role('scorer'); s public.match_slots%rowtype; ex public.match_results%rowtype; rid uuid; aa int; ba int;
begin
  if p_idempotency_key is null then raise exception 'idempotency key required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text||':'||p_idempotency_key::text,0));
  select * into s from public.match_slots where id=p_slot_id for update;
  if not found or s.scorer_id<>caller then raise exception 'slot is not assigned to scorer' using errcode='42501'; end if;
  if s.slot_type<>'game' then raise exception 'slot is not a game' using errcode='22023'; end if;
  if not exists(select 1 from public.events where id=s.event_id and is_active for share) then raise exception 'event is not active' using errcode='55000'; end if;
  select * into ex from public.match_results where scorer_id=caller and idempotency_key=p_idempotency_key;
  if found then if ex.slot_id<>p_slot_id or ex.outcome<>p_outcome then raise exception 'idempotency conflict' using errcode='22023'; end if; return ex.id; end if;
  select * into ex from public.match_results where slot_id=p_slot_id;
  if found then if ex.outcome=p_outcome then return ex.id; end if; raise exception 'slot already submitted' using errcode='23505'; end if;
  perform 1 from public.teams where id in(s.team_a_id,s.team_b_id) order by id for update;
  aa:=case p_outcome when 'team_a_win' then s.winner_score when 'draw' then s.draw_score else s.loser_score end;
  ba:=case p_outcome when 'team_b_win' then s.winner_score when 'draw' then s.draw_score else s.loser_score end;
  insert into public.match_results(slot_id,scorer_id,outcome,idempotency_key) values(p_slot_id,caller,p_outcome,p_idempotency_key) returning id into rid;
  if aa<>0 then insert into public.wallet_ledger(team_id,amount,kind,description_ar,match_result_id,created_by) values(s.team_a_id,aa,'match','نتيجة لعبة',rid,caller); end if;
  if ba<>0 then insert into public.wallet_ledger(team_id,amount,kind,description_ar,match_result_id,created_by) values(s.team_b_id,ba,'match','نتيجة لعبة',rid,caller); end if;
  return rid;
end $$;

create function public.submit_tournament_result(p_slot_id uuid,p_first_team_id uuid,p_second_team_id uuid,p_third_team_id uuid,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$
declare caller uuid:=private.require_role('scorer'); s public.match_slots%rowtype; ex public.tournament_results%rowtype; rid uuid; tid uuid; amount int;
begin
  if p_idempotency_key is null or p_first_team_id=p_second_team_id or p_first_team_id=p_third_team_id or p_second_team_id=p_third_team_id then raise exception 'invalid tournament result' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text||':'||p_idempotency_key::text,0));
  select * into s from public.match_slots where id=p_slot_id for update;
  if not found or s.scorer_id<>caller then raise exception 'slot is not assigned to scorer' using errcode='42501'; end if;
  if s.slot_type<>'tournament' then raise exception 'slot is not a tournament' using errcode='22023'; end if;
  if not exists(select 1 from public.events where id=s.event_id and is_active for share) then raise exception 'event is not active' using errcode='55000'; end if;
  if exists(select 1 from unnest(array[p_first_team_id,p_second_team_id,p_third_team_id]) x where not exists(select 1 from public.slot_participants sp where sp.slot_id=p_slot_id and sp.team_id=x)) then raise exception 'ranked team is not a participant' using errcode='23503'; end if;
  select * into ex from public.tournament_results where scorer_id=caller and idempotency_key=p_idempotency_key;
  if found then if ex.slot_id<>p_slot_id or ex.first_team_id<>p_first_team_id or ex.second_team_id<>p_second_team_id or ex.third_team_id<>p_third_team_id then raise exception 'idempotency conflict' using errcode='22023'; end if; return ex.id; end if;
  select * into ex from public.tournament_results where slot_id=p_slot_id;
  if found then if ex.first_team_id=p_first_team_id and ex.second_team_id=p_second_team_id and ex.third_team_id=p_third_team_id then return ex.id; end if; raise exception 'slot already submitted' using errcode='23505'; end if;
  perform 1 from public.teams t join public.slot_participants sp on sp.team_id=t.id where sp.slot_id=p_slot_id order by t.id for update of t;
  insert into public.tournament_results(slot_id,scorer_id,first_team_id,second_team_id,third_team_id,idempotency_key) values(p_slot_id,caller,p_first_team_id,p_second_team_id,p_third_team_id,p_idempotency_key) returning id into rid;
  for tid in select team_id from public.slot_participants where slot_id=p_slot_id loop
    amount:=case tid when p_first_team_id then s.first_score when p_second_team_id then s.second_score when p_third_team_id then s.third_score else s.others_score end;
    if amount<>0 then insert into public.wallet_ledger(team_id,amount,kind,description_ar,tournament_result_id,created_by) values(tid,amount,'match','نتيجة بطولة',rid,caller); end if;
  end loop;
  return rid;
end $$;

create or replace function public.award_slot_bonus(p_slot_id uuid,p_team_id uuid,p_amount integer,p_reason text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$
declare caller uuid:=private.require_role('scorer'); s public.match_slots%rowtype; ex public.bonus_awards%rowtype; used bigint; aid uuid;
begin
  if p_amount is null or p_amount<=0 or p_idempotency_key is null or p_reason is null or length(trim(p_reason)) not between 1 and 240 then raise exception 'invalid bonus request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text||':'||p_idempotency_key::text,0));
  select * into s from public.match_slots where id=p_slot_id for update;
  if not found or s.scorer_id<>caller then raise exception 'slot is not assigned to scorer' using errcode='42501'; end if;
  if not exists(select 1 from public.events where id=s.event_id and is_active for share) then raise exception 'event is not active' using errcode='55000'; end if;
  if not exists(select 1 from public.slot_participants where slot_id=p_slot_id and team_id=p_team_id) then raise exception 'team is not a slot participant' using errcode='42501'; end if;
  select * into ex from public.bonus_awards where scorer_id=caller and idempotency_key=p_idempotency_key;
  if found then if ex.slot_id<>p_slot_id or ex.team_id<>p_team_id or ex.amount<>p_amount or ex.reason<>trim(p_reason) then raise exception 'idempotency conflict' using errcode='22023'; end if; return ex.id; end if;
  select coalesce(sum(amount),0) into used from public.bonus_awards where slot_id=p_slot_id;
  if used+p_amount>s.bonus_limit then raise exception 'slot bonus limit exceeded' using errcode='23514'; end if;
  perform 1 from public.teams where id=p_team_id for update;
  insert into public.bonus_awards(event_id,scorer_id,team_id,slot_id,amount,reason,idempotency_key) values(s.event_id,caller,p_team_id,p_slot_id,p_amount,trim(p_reason),p_idempotency_key) returning id into aid;
  insert into public.wallet_ledger(team_id,amount,kind,description_ar,bonus_award_id,created_by) values(p_team_id,p_amount,'bonus',trim(p_reason),aid,caller);
  return aid;
end $$;

create function public.redeem_by_team(p_team_id uuid,p_amount integer,p_note text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public
as $$
declare caller uuid:=private.require_role('admin'); ex public.redemptions%rowtype; bal bigint; rid uuid;
begin
  if p_amount is null or p_amount<=0 or p_idempotency_key is null or p_note is null or length(trim(p_note)) not between 1 and 240 then raise exception 'invalid redemption request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text||':'||p_idempotency_key::text,0));
  select * into ex from public.redemptions where admin_id=caller and idempotency_key=p_idempotency_key;
  if found then if ex.team_id<>p_team_id or ex.amount<>p_amount or ex.note<>trim(p_note) then raise exception 'idempotency conflict' using errcode='22023'; end if; return ex.id; end if;
  perform 1 from public.teams where id=p_team_id for update; if not found then raise exception 'team not found' using errcode='P0002'; end if;
  select coalesce(sum(amount),0) into bal from public.wallet_ledger where team_id=p_team_id;
  if bal<p_amount then raise exception 'insufficient team balance' using errcode='23514'; end if;
  insert into public.redemptions(team_id,admin_id,amount,note,idempotency_key) values(p_team_id,caller,p_amount,trim(p_note),p_idempotency_key) returning id into rid;
  insert into public.wallet_ledger(team_id,amount,kind,description_ar,redemption_id,created_by) values(p_team_id,-p_amount,'redemption',trim(p_note),rid,caller);
  return rid;
end $$;

create function public.reassign_nfc_token(p_token_id uuid,p_team_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public,extensions
as $$ declare raw_token text:=encode(gen_random_bytes(32),'hex'); old_label text; begin
  perform private.require_role('admin');
  if not exists(select 1 from public.teams where id=p_team_id) then raise exception 'team not found' using errcode='P0002'; end if;
  update public.nfc_tokens set revoked_at=coalesce(revoked_at,now()) where id=p_token_id returning label into old_label;
  if not found then raise exception 'token not found' using errcode='P0002'; end if;
  insert into public.nfc_tokens(team_id,token_hash,label) values(p_team_id,digest(raw_token,'sha256'),old_label);
  return raw_token;
end $$;

create function public.delete_nfc_token(p_token_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$ begin
  perform private.require_role('admin');
  delete from public.nfc_tokens where id=p_token_id;
  if not found then raise exception 'token not found' using errcode='P0002'; end if;
end $$;

alter table public.slot_participants enable row level security;
alter table public.tournament_results enable row level security;
create policy participants_self_or_admin on public.slot_participants for select to authenticated using (
  private.current_role()='admin' or exists(select 1 from public.match_slots s where s.id=slot_id and s.scorer_id=auth.uid()));
create policy tournament_results_self_or_admin on public.tournament_results for select to authenticated using (scorer_id=auth.uid() or private.current_role()='admin');

drop policy teams_admin_or_assigned on public.teams;
create policy teams_admin_or_assigned on public.teams for select to authenticated using (
  private.current_role()='admin' or (private.current_role()='scorer' and exists(
    select 1 from public.slot_participants sp join public.match_slots s on s.id=sp.slot_id where s.scorer_id=auth.uid() and sp.team_id=teams.id)));

revoke all on public.slot_participants,public.tournament_results from anon,authenticated;
grant select on public.slot_participants,public.tournament_results to authenticated;
revoke all on function public.my_assignments() from public,anon,authenticated;
grant execute on function public.my_assignments() to authenticated;
revoke all on function public.upsert_slot_v2(jsonb),public.submit_game_result(uuid,public.match_outcome,uuid),public.submit_tournament_result(uuid,uuid,uuid,uuid,uuid),
 public.award_slot_bonus(uuid,uuid,integer,text,uuid),public.redeem_by_team(uuid,integer,text,uuid),public.reassign_nfc_token(uuid,uuid),public.delete_nfc_token(uuid) from public,anon,authenticated;
grant execute on function public.upsert_slot_v2(jsonb),public.submit_game_result(uuid,public.match_outcome,uuid),public.submit_tournament_result(uuid,uuid,uuid,uuid,uuid),
 public.award_slot_bonus(uuid,uuid,integer,text,uuid),public.redeem_by_team(uuid,integer,text,uuid),public.reassign_nfc_token(uuid,uuid),public.delete_nfc_token(uuid) to authenticated;

-- Old scorer-wide mutation paths are closed; reads remain for legacy history.
revoke execute on function public.submit_match_result(uuid,public.match_outcome,uuid) from authenticated;
revoke execute on function public.award_bonus(uuid,integer,text,uuid) from authenticated;

commit;
