begin;

-- A team has at most one usable NFC card. Replacing or reassigning a card
-- removes the previous card for the destination team in the same transaction.
delete from public.nfc_tokens older
using public.nfc_tokens newer
where older.team_id=newer.team_id
  and older.revoked_at is null and newer.revoked_at is null
  and (older.issued_at, older.id) < (newer.issued_at, newer.id);

create unique index if not exists nfc_tokens_one_active_card_per_team
  on public.nfc_tokens(team_id) where revoked_at is null;

create or replace function public.issue_nfc_token(p_team_id uuid, p_label text default 'team')
returns text language plpgsql security definer set search_path=pg_catalog,public,extensions
as $$
declare raw_token text:=encode(gen_random_bytes(32),'hex'); team_name text;
begin
  perform private.require_role('admin');
  select name_ar into team_name from public.teams where id=p_team_id for update;
  if not found then raise exception 'team not found' using errcode='P0002'; end if;
  delete from public.nfc_tokens where team_id=p_team_id and revoked_at is null;
  insert into public.nfc_tokens(team_id,token_hash,label)
  values(p_team_id,digest(raw_token,'sha256'),team_name);
  return raw_token;
end $$;

create or replace function public.reassign_nfc_token(p_token_id uuid,p_team_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public,extensions
as $$
declare raw_token text:=encode(gen_random_bytes(32),'hex'); team_name text;
begin
  perform private.require_role('admin');
  select name_ar into team_name from public.teams where id=p_team_id for update;
  if not found then raise exception 'team not found' using errcode='P0002'; end if;
  perform 1 from public.nfc_tokens where id=p_token_id for update;
  if not found then raise exception 'token not found' using errcode='P0002'; end if;
  delete from public.nfc_tokens where team_id=p_team_id and id<>p_token_id and revoked_at is null;
  update public.nfc_tokens
    set team_id=p_team_id, token_hash=digest(raw_token,'sha256'), label=team_name,
        revoked_at=null, last_used_at=null, issued_at=now()
    where id=p_token_id;
  return raw_token;
end $$;

create function public.delete_slot(p_slot_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$
begin
  perform private.require_role('admin');
  if exists(select 1 from public.match_results where slot_id=p_slot_id)
     or exists(select 1 from public.tournament_results where slot_id=p_slot_id)
     or exists(select 1 from public.bonus_awards where slot_id=p_slot_id) then
    raise exception 'a scored slot cannot be deleted' using errcode='55000';
  end if;
  delete from public.slot_participants where slot_id=p_slot_id;
  delete from public.match_slots where id=p_slot_id;
  if not found then raise exception 'slot not found' using errcode='P0002'; end if;
end $$;

create function public.delete_team(p_team_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public
as $$
begin
  perform private.require_role('admin');
  if exists(select 1 from public.slot_participants where team_id=p_team_id)
     or exists(select 1 from public.wallet_ledger where team_id=p_team_id)
     or exists(select 1 from public.nfc_tokens where team_id=p_team_id) then
    raise exception 'team has operational history' using errcode='55000';
  end if;
  delete from public.teams where id=p_team_id;
  if not found then raise exception 'team not found' using errcode='P0002'; end if;
end $$;

revoke all on function public.delete_slot(uuid), public.delete_team(uuid) from public,anon,authenticated;
grant execute on function public.delete_slot(uuid), public.delete_team(uuid) to authenticated;

commit;
