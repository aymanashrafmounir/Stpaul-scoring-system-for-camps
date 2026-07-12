begin;

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('admin', 'scorer');
create type public.match_outcome as enum ('team_a_win', 'draw', 'team_b_win');
create type public.ledger_kind as enum ('match', 'bonus', 'redemption', 'reversal', 'adjustment');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  winner_coins integer not null check (winner_coins >= 0),
  draw_coins integer not null check (draw_coins >= 0),
  loser_coins integer not null check (loser_coins >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index events_one_active_idx on public.events (is_active) where is_active;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar text not null check (length(trim(name_ar)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (event_id, code),
  unique (event_id, id)
);

create table public.scorer_allowances (
  event_id uuid not null references public.events(id) on delete restrict,
  scorer_id uuid not null references public.profiles(user_id) on delete cascade,
  bonus_limit integer not null default 0 check (bonus_limit >= 0),
  created_at timestamptz not null default now(),
  primary key (event_id, scorer_id)
);

create table public.match_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  slot_number integer not null check (slot_number > 0),
  label_ar text not null check (length(trim(label_ar)) between 1 and 120),
  scheduled_at timestamptz not null,
  scorer_id uuid not null references public.profiles(user_id) on delete restrict,
  team_a_id uuid not null,
  team_b_id uuid not null,
  created_at timestamptz not null default now(),
  unique (event_id, slot_number),
  foreign key (event_id, team_a_id) references public.teams(event_id, id) on delete restrict,
  foreign key (event_id, team_b_id) references public.teams(event_id, id) on delete restrict,
  check (team_a_id <> team_b_id)
);

create index match_slots_scorer_idx on public.match_slots (scorer_id, scheduled_at);

create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.match_slots(id) on delete restrict,
  scorer_id uuid not null references public.profiles(user_id) on delete restrict,
  outcome public.match_outcome not null,
  idempotency_key uuid not null,
  submitted_at timestamptz not null default now(),
  unique (scorer_id, idempotency_key)
);

create table public.bonus_awards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  scorer_id uuid not null references public.profiles(user_id) on delete restrict,
  team_id uuid not null,
  amount integer not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 1 and 240),
  idempotency_key uuid not null,
  awarded_at timestamptz not null default now(),
  unique (scorer_id, idempotency_key),
  foreign key (event_id, team_id) references public.teams(event_id, id) on delete restrict
);

create index bonus_awards_allowance_idx on public.bonus_awards (event_id, scorer_id);

create table public.nfc_tokens (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  token_hash bytea not null unique,
  label text not null default 'primary' check (length(trim(label)) between 1 and 80),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (octet_length(token_hash) = 32)
);

create index nfc_tokens_active_team_idx on public.nfc_tokens (team_id) where revoked_at is null;

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  admin_id uuid not null references public.profiles(user_id) on delete restrict,
  amount integer not null check (amount > 0),
  note text not null check (length(trim(note)) between 1 and 240),
  idempotency_key uuid not null,
  redeemed_at timestamptz not null default now(),
  unique (admin_id, idempotency_key)
);

create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  amount integer not null check (amount <> 0),
  kind public.ledger_kind not null,
  description_ar text not null check (length(trim(description_ar)) between 1 and 240),
  match_result_id uuid references public.match_results(id) on delete restrict,
  bonus_award_id uuid references public.bonus_awards(id) on delete restrict,
  redemption_id uuid references public.redemptions(id) on delete restrict,
  reverses_entry_id uuid unique references public.wallet_ledger(id) on delete restrict,
  created_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  check (num_nonnulls(match_result_id, bonus_award_id, redemption_id, reverses_entry_id) <= 1),
  check ((kind = 'match') = (match_result_id is not null)),
  check ((kind = 'bonus') = (bonus_award_id is not null)),
  check ((kind = 'redemption') = (redemption_id is not null)),
  check ((kind = 'reversal') = (reverses_entry_id is not null))
);

create unique index wallet_ledger_match_team_idx
  on public.wallet_ledger (match_result_id, team_id) where match_result_id is not null;
create unique index wallet_ledger_bonus_idx
  on public.wallet_ledger (bonus_award_id) where bonus_award_id is not null;
create unique index wallet_ledger_redemption_idx
  on public.wallet_ledger (redemption_id) where redemption_id is not null;
create index wallet_ledger_team_created_idx on public.wallet_ledger (team_id, created_at, id);

create table public.admin_adjustments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  admin_id uuid not null references public.profiles(user_id) on delete restrict,
  amount integer not null check (amount <> 0),
  reason text not null check (length(trim(reason)) between 1 and 240),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (admin_id, idempotency_key)
);

alter table public.wallet_ledger add column adjustment_id uuid references public.admin_adjustments(id) on delete restrict;
alter table public.wallet_ledger drop constraint wallet_ledger_check;
alter table public.wallet_ledger add constraint wallet_ledger_single_source_check
  check (num_nonnulls(match_result_id, bonus_award_id, redemption_id, reverses_entry_id, adjustment_id) <= 1);
alter table public.wallet_ledger add constraint wallet_ledger_adjustment_source_check
  check ((kind = 'adjustment') = (adjustment_id is not null));
create unique index wallet_ledger_adjustment_idx
  on public.wallet_ledger (adjustment_id) where adjustment_id is not null;

create schema if not exists private;
revoke all on schema private from public;

create function private.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.role from public.profiles p
  where p.user_id = auth.uid() and p.is_active
$$;

create function private.require_role(required_role public.app_role)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (
    select 1 from public.profiles p
    where p.user_id = caller and p.role = required_role and p.is_active
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return caller;
end;
$$;

create function private.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'wallet ledger entries are immutable' using errcode = '55000';
end;
$$;

create trigger wallet_ledger_immutable
before update or delete on public.wallet_ledger
for each row execute function private.prevent_ledger_mutation();

create function public.complete_scorer_provisioning(p_request jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  admin_id uuid := (p_request ->> 'admin_id')::uuid;
  scorer_id uuid := (p_request ->> 'user_id')::uuid;
  scorer_name text := trim(p_request ->> 'display_name');
  scorer_event_id uuid := (p_request ->> 'event_id')::uuid;
  scorer_bonus_limit integer := (p_request ->> 'bonus_limit')::integer;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = admin_id and role = 'admin' and is_active
  ) then raise exception 'provisioning caller is not an active admin' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = scorer_id) then
    raise exception 'auth user does not exist' using errcode = '23503';
  end if;
  insert into public.profiles (user_id, display_name, role)
  values (scorer_id, scorer_name, 'scorer');
  insert into public.scorer_allowances (event_id, scorer_id, bonus_limit)
  values (scorer_event_id, scorer_id, scorer_bonus_limit);
end;
$$;

create function public.update_scorer_settings(
  p_scorer_id uuid,
  p_event_id uuid,
  p_display_name text,
  p_is_active boolean,
  p_bonus_limit integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  used_bonus bigint;
begin
  perform private.require_role('admin');
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 80 then
    raise exception 'display name is invalid' using errcode = '22023';
  end if;
  if p_is_active is null or p_bonus_limit is null or p_bonus_limit < 0 then
    raise exception 'scorer settings are invalid' using errcode = '22023';
  end if;
  perform 1 from public.profiles
  where user_id = p_scorer_id and role = 'scorer' for update;
  if not found then raise exception 'scorer profile not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  perform 1 from public.scorer_allowances
  where event_id = p_event_id and scorer_id = p_scorer_id for update;
  if not found then raise exception 'scorer allowance not found' using errcode = 'P0002'; end if;
  select coalesce(sum(amount), 0) into used_bonus from public.bonus_awards
  where event_id = p_event_id and scorer_id = p_scorer_id;
  if p_bonus_limit < used_bonus then
    raise exception 'bonus limit cannot be below used amount' using errcode = '23514';
  end if;
  update public.profiles set display_name = trim(p_display_name), is_active = p_is_active
  where user_id = p_scorer_id;
  update public.scorer_allowances set bonus_limit = p_bonus_limit
  where event_id = p_event_id and scorer_id = p_scorer_id;
end;
$$;

create function public.my_assignments()
returns table (
  slot_id uuid,
  slot_number integer,
  label_ar text,
  scheduled_at timestamptz,
  team_a_id uuid,
  team_a_name_ar text,
  team_b_id uuid,
  team_b_name_ar text,
  submitted_outcome public.match_outcome,
  bonus_limit integer,
  bonus_used bigint,
  bonus_remaining bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select s.id, s.slot_number, s.label_ar, s.scheduled_at,
         a.id, a.name_ar, b.id, b.name_ar, r.outcome,
         al.bonus_limit,
         coalesce(used.amount, 0),
         al.bonus_limit - coalesce(used.amount, 0)
  from public.match_slots s
  join public.events e on e.id = s.event_id and e.is_active
  join public.teams a on a.id = s.team_a_id
  join public.teams b on b.id = s.team_b_id
  join public.scorer_allowances al on al.event_id = s.event_id and al.scorer_id = s.scorer_id
  left join public.match_results r on r.slot_id = s.id
  left join lateral (
    select sum(ba.amount)::bigint as amount
    from public.bonus_awards ba
    where ba.event_id = s.event_id and ba.scorer_id = s.scorer_id
  ) used on true
  where s.scorer_id = auth.uid()
  order by s.scheduled_at, s.slot_number
$$;

create function public.submit_match_result(
  p_slot_id uuid,
  p_outcome public.match_outcome,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := private.require_role('scorer');
  slot_row public.match_slots%rowtype;
  existing public.match_results%rowtype;
  event_row public.events%rowtype;
  result_id uuid;
  a_amount integer;
  b_amount integer;
begin
  if p_idempotency_key is null then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_idempotency_key::text, 0));

  select * into slot_row from public.match_slots where id = p_slot_id for update;
  if not found or slot_row.scorer_id <> caller then
    raise exception 'slot is not assigned to this scorer' using errcode = '42501';
  end if;

  select * into event_row from public.events where id = slot_row.event_id for share;
  if not event_row.is_active then raise exception 'event is not active' using errcode = '55000'; end if;

  select * into existing from public.match_results
  where scorer_id = caller and idempotency_key = p_idempotency_key;
  if found then
    if existing.slot_id <> p_slot_id or existing.outcome <> p_outcome then
      raise exception 'idempotency key was already used with different input' using errcode = '22023';
    end if;
    return existing.id;
  end if;

  select * into existing from public.match_results where slot_id = p_slot_id;
  if found then
    if existing.scorer_id = caller and existing.outcome = p_outcome then return existing.id; end if;
    raise exception 'slot already has a result' using errcode = '23505';
  end if;

  perform 1 from public.teams where id in (slot_row.team_a_id, slot_row.team_b_id) order by id for update;

  select case p_outcome when 'team_a_win' then event_row.winner_coins when 'draw' then event_row.draw_coins else event_row.loser_coins end,
         case p_outcome when 'team_b_win' then event_row.winner_coins when 'draw' then event_row.draw_coins else event_row.loser_coins end
    into a_amount, b_amount
  ;

  insert into public.match_results (slot_id, scorer_id, outcome, idempotency_key)
  values (p_slot_id, caller, p_outcome, p_idempotency_key) returning id into result_id;

  if a_amount <> 0 then
    insert into public.wallet_ledger (team_id, amount, kind, description_ar, match_result_id, created_by)
    values (slot_row.team_a_id, a_amount, 'match', 'نقاط نتيجة المباراة', result_id, caller);
  end if;
  if b_amount <> 0 then
    insert into public.wallet_ledger (team_id, amount, kind, description_ar, match_result_id, created_by)
    values (slot_row.team_b_id, b_amount, 'match', 'نقاط نتيجة المباراة', result_id, caller);
  end if;
  return result_id;
end;
$$;

create function public.award_bonus(
  p_team_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := private.require_role('scorer');
  allowance integer;
  used bigint;
  existing public.bonus_awards%rowtype;
  award_id uuid;
  team_event_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'bonus amount must be positive' using errcode = '22023'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 240 then raise exception 'bonus reason is required' using errcode = '22023'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_idempotency_key::text, 0));

  select event_id into team_event_id from public.teams where id = p_team_id;
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;

  perform 1 from public.events where id = team_event_id and is_active for share;
  if not found then raise exception 'event is not active' using errcode = '55000'; end if;

  select * into existing from public.bonus_awards
  where scorer_id = caller and idempotency_key = p_idempotency_key;
  if found then
    if existing.team_id <> p_team_id or existing.amount <> p_amount or existing.reason <> trim(p_reason) then
      raise exception 'idempotency key was already used with different input' using errcode = '22023';
    end if;
    return existing.id;
  end if;

  select bonus_limit into allowance from public.scorer_allowances
  where event_id = team_event_id and scorer_id = caller for update;
  if not found then raise exception 'no bonus allowance for this event' using errcode = '42501'; end if;

  if not exists (
    select 1 from public.match_slots s
    where s.event_id = team_event_id and s.scorer_id = caller and p_team_id in (s.team_a_id, s.team_b_id)
  ) then raise exception 'team is outside scorer assignments' using errcode = '42501'; end if;

  perform 1 from public.teams where id = p_team_id for update;

  select coalesce(sum(amount), 0) into used from public.bonus_awards
  where event_id = team_event_id and scorer_id = caller;
  if used + p_amount > allowance then raise exception 'bonus allowance exceeded' using errcode = '23514'; end if;

  insert into public.bonus_awards (event_id, scorer_id, team_id, amount, reason, idempotency_key)
  values (team_event_id, caller, p_team_id, p_amount, trim(p_reason), p_idempotency_key)
  returning id into award_id;
  insert into public.wallet_ledger (team_id, amount, kind, description_ar, bonus_award_id, created_by)
  values (p_team_id, p_amount, 'bonus', trim(p_reason), award_id, caller);
  return award_id;
end;
$$;

create function public.issue_nfc_token(p_team_id uuid, p_label text default 'primary')
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  raw_token text := encode(gen_random_bytes(32), 'hex');
begin
  perform private.require_role('admin');
  if not exists (select 1 from public.teams where id = p_team_id) then raise exception 'team not found' using errcode = 'P0002'; end if;
  insert into public.nfc_tokens (team_id, token_hash, label)
  values (p_team_id, digest(raw_token, 'sha256'), trim(p_label));
  return raw_token;
end;
$$;

create function public.revoke_nfc_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform private.require_role('admin');
  update public.nfc_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_token_id;
  if not found then raise exception 'token not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.get_team_wallet_by_nfc(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  token_row public.nfc_tokens%rowtype;
  payload jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'invalid NFC token' using errcode = '22023'; end if;
  select * into token_row from public.nfc_tokens
  where token_hash = digest(p_token, 'sha256') and revoked_at is null;
  if not found then raise exception 'invalid or revoked NFC token' using errcode = '42501'; end if;

  update public.nfc_tokens set last_used_at = now() where id = token_row.id;
  select jsonb_build_object(
    'team', jsonb_build_object('code', t.code, 'name_ar', t.name_ar),
    'balance', coalesce(sum(l.amount), 0),
    'transactions', coalesce(jsonb_agg(
      jsonb_build_object('amount', l.amount, 'kind', l.kind, 'description_ar', l.description_ar, 'created_at', l.created_at)
      order by l.created_at desc, l.id desc
    ) filter (where l.id is not null), '[]'::jsonb)
  ) into payload
  from public.teams t left join public.wallet_ledger l on l.team_id = t.id
  where t.id = token_row.team_id group by t.id;
  return payload;
end;
$$;

create function public.redeem_by_nfc(
  p_token text,
  p_amount integer,
  p_note text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  caller uuid := private.require_role('admin');
  token_row public.nfc_tokens%rowtype;
  existing public.redemptions%rowtype;
  balance bigint;
  redemption_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'redemption amount must be positive' using errcode = '22023'; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 240 then raise exception 'redemption note is required' using errcode = '22023'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_idempotency_key::text, 0));

  select * into token_row from public.nfc_tokens
  where token_hash = digest(p_token, 'sha256');
  if not found then raise exception 'invalid NFC token' using errcode = '42501'; end if;

  select * into existing from public.redemptions where admin_id = caller and idempotency_key = p_idempotency_key;
  if found then
    if existing.team_id <> token_row.team_id or existing.amount <> p_amount or existing.note <> trim(p_note) then raise exception 'idempotency key was already used with different input' using errcode = '22023'; end if;
    return existing.id;
  end if;

  select * into token_row from public.nfc_tokens
  where token_hash = digest(p_token, 'sha256') and revoked_at is null for update;
  if not found then raise exception 'invalid or revoked NFC token' using errcode = '42501'; end if;
  perform 1 from public.teams where id = token_row.team_id for update;
  select coalesce(sum(amount), 0) into balance from public.wallet_ledger where team_id = token_row.team_id;
  if balance < p_amount then raise exception 'insufficient team balance' using errcode = '23514'; end if;

  insert into public.redemptions (team_id, admin_id, amount, note, idempotency_key)
  values (token_row.team_id, caller, p_amount, trim(p_note), p_idempotency_key) returning id into redemption_id;
  insert into public.wallet_ledger (team_id, amount, kind, description_ar, redemption_id, created_by)
  values (token_row.team_id, -p_amount, 'redemption', trim(p_note), redemption_id, caller);
  update public.nfc_tokens set last_used_at = now() where id = token_row.id;
  return redemption_id;
end;
$$;

create function public.adjust_wallet(p_team_id uuid, p_amount integer, p_reason text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := private.require_role('admin');
  existing public.admin_adjustments%rowtype;
  adjustment_id uuid;
  balance bigint;
begin
  if p_amount is null or p_amount = 0 then raise exception 'adjustment amount cannot be zero' using errcode = '22023'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 240 then raise exception 'adjustment reason is required' using errcode = '22023'; end if;
  if p_idempotency_key is null then raise exception 'idempotency key is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_idempotency_key::text, 0));
  select * into existing from public.admin_adjustments where admin_id = caller and idempotency_key = p_idempotency_key;
  if found then
    if existing.team_id <> p_team_id or existing.amount <> p_amount or existing.reason <> trim(p_reason) then raise exception 'idempotency key was already used with different input' using errcode = '22023'; end if;
    return existing.id;
  end if;
  perform 1 from public.teams where id = p_team_id for update;
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;
  select coalesce(sum(amount), 0) into balance from public.wallet_ledger where team_id = p_team_id;
  if balance + p_amount < 0 then raise exception 'adjustment would make balance negative' using errcode = '23514'; end if;
  insert into public.admin_adjustments (team_id, admin_id, amount, reason, idempotency_key)
  values (p_team_id, caller, p_amount, trim(p_reason), p_idempotency_key) returning id into adjustment_id;
  insert into public.wallet_ledger (team_id, amount, kind, description_ar, adjustment_id, created_by)
  values (p_team_id, p_amount, 'adjustment', trim(p_reason), adjustment_id, caller);
  return adjustment_id;
end;
$$;

create function public.reverse_wallet_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := private.require_role('admin');
  original public.wallet_ledger%rowtype;
  reversal_id uuid;
  balance bigint;
begin
  if p_reason is null or length(trim(p_reason)) not between 1 and 240 then raise exception 'reversal reason is required' using errcode = '22023'; end if;
  select * into original from public.wallet_ledger where id = p_entry_id;
  if not found or original.kind = 'reversal' then raise exception 'entry cannot be reversed' using errcode = '22023'; end if;
  select id into reversal_id from public.wallet_ledger where reverses_entry_id = p_entry_id;
  if found then return reversal_id; end if;
  perform 1 from public.teams where id = original.team_id for update;
  select id into reversal_id from public.wallet_ledger where reverses_entry_id = p_entry_id;
  if found then return reversal_id; end if;
  select coalesce(sum(amount), 0) into balance from public.wallet_ledger where team_id = original.team_id;
  if balance - original.amount < 0 then raise exception 'reversal would make balance negative' using errcode = '23514'; end if;
  insert into public.wallet_ledger (team_id, amount, kind, description_ar, reverses_entry_id, created_by)
  values (original.team_id, -original.amount, 'reversal', trim(p_reason), p_entry_id, caller)
  returning id into reversal_id;
  return reversal_id;
end;
$$;

alter table public.events enable row level security;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.scorer_allowances enable row level security;
alter table public.match_slots enable row level security;
alter table public.match_results enable row level security;
alter table public.bonus_awards enable row level security;
alter table public.nfc_tokens enable row level security;
alter table public.redemptions enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.admin_adjustments enable row level security;

create policy admin_read_events on public.events for select to authenticated using (private.current_role() = 'admin');
create policy scorer_read_active_event on public.events for select to authenticated using (private.current_role() = 'scorer' and is_active);
create policy admin_manage_events on public.events for all to authenticated
  using (private.current_role() = 'admin') with check (private.current_role() = 'admin');
create policy profiles_self_or_admin on public.profiles for select to authenticated using (user_id = auth.uid() or private.current_role() = 'admin');
create policy teams_admin_or_assigned on public.teams for select to authenticated using (
  private.current_role() = 'admin' or (private.current_role() = 'scorer' and exists (
    select 1 from public.match_slots s where s.scorer_id = auth.uid() and teams.id in (s.team_a_id, s.team_b_id)
  ))
);
create policy admin_manage_teams on public.teams for all to authenticated
  using (private.current_role() = 'admin') with check (private.current_role() = 'admin');
create policy allowances_self_or_admin on public.scorer_allowances for select to authenticated using (scorer_id = auth.uid() or private.current_role() = 'admin');
create policy slots_self_or_admin on public.match_slots for select to authenticated using (scorer_id = auth.uid() or private.current_role() = 'admin');
create policy admin_manage_slots on public.match_slots for all to authenticated
  using (private.current_role() = 'admin') with check (private.current_role() = 'admin');
create policy results_self_or_admin on public.match_results for select to authenticated using (scorer_id = auth.uid() or private.current_role() = 'admin');
create policy bonuses_self_or_admin on public.bonus_awards for select to authenticated using (scorer_id = auth.uid() or private.current_role() = 'admin');
create policy nfc_admin_only on public.nfc_tokens for select to authenticated using (private.current_role() = 'admin');
create policy redemptions_admin_only on public.redemptions for select to authenticated using (private.current_role() = 'admin');
create policy ledger_admin_or_creator on public.wallet_ledger for select to authenticated using (private.current_role() = 'admin' or created_by = auth.uid());
create policy adjustments_admin_only on public.admin_adjustments for select to authenticated using (private.current_role() = 'admin');

revoke all on all tables in schema public from anon, authenticated;
grant select on public.events, public.profiles, public.teams, public.scorer_allowances, public.match_slots,
  public.match_results, public.bonus_awards, public.nfc_tokens, public.redemptions,
  public.wallet_ledger, public.admin_adjustments to authenticated;
grant insert, update, delete on public.events, public.teams,
  public.match_slots to authenticated;
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update, delete on public.scorer_allowances from authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_assignments() to authenticated;
grant execute on function public.submit_match_result(uuid, public.match_outcome, uuid) to authenticated;
grant execute on function public.award_bonus(uuid, integer, text, uuid) to authenticated;
grant execute on function public.issue_nfc_token(uuid, text) to authenticated;
grant execute on function public.revoke_nfc_token(uuid) to authenticated;
grant execute on function public.redeem_by_nfc(text, integer, text, uuid) to authenticated;
grant execute on function public.adjust_wallet(uuid, integer, text, uuid) to authenticated;
grant execute on function public.reverse_wallet_entry(uuid, text) to authenticated;
grant execute on function public.update_scorer_settings(uuid, uuid, text, boolean, integer) to authenticated;
grant execute on function public.get_team_wallet_by_nfc(text) to anon, authenticated;
revoke all on function public.complete_scorer_provisioning(jsonb) from public, anon, authenticated;
grant execute on function public.complete_scorer_provisioning(jsonb) to service_role;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_role() to authenticated;

commit;
