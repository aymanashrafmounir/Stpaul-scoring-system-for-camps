begin;

create or replace function private.reject_bonus_after_slot_result()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if exists(select 1 from public.match_results where slot_id=new.slot_id)
     or exists(select 1 from public.tournament_results where slot_id=new.slot_id) then
    raise exception 'bonus is closed after result submission' using errcode='55000';
  end if;
  return new;
end $$;

drop trigger if exists reject_bonus_after_slot_result on public.bonus_awards;
create trigger reject_bonus_after_slot_result
before insert on public.bonus_awards
for each row execute function private.reject_bonus_after_slot_result();

revoke all on function private.reject_bonus_after_slot_result() from public,anon,authenticated;

commit;
