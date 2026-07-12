begin;

alter table public.profiles add column username text;

do $$
declare
  account record;
  base_username text;
  candidate text;
  suffix integer;
begin
  for account in
    select p.user_id, u.email
    from public.profiles p
    join auth.users u on u.id = p.user_id
    order by p.created_at, p.user_id
  loop
    base_username := regexp_replace(lower(coalesce(nullif(split_part(account.email, '@', 1), ''), 'user')), '[^a-z0-9._-]', '', 'g');
    if length(base_username) < 3 then
      base_username := 'user-' || left(replace(account.user_id::text, '-', ''), 8);
    end if;
    base_username := left(base_username, 32);
    candidate := base_username;
    suffix := 1;
    while exists (select 1 from public.profiles where lower(username) = candidate) loop
      candidate := left(base_username, 32 - length(suffix::text) - 1) || '-' || suffix;
      suffix := suffix + 1;
    end loop;
    update public.profiles set username = candidate where user_id = account.user_id;
  end loop;
end;
$$;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_normalized_check
    check (username = lower(username) and username ~ '^[a-z0-9._-]{3,32}$');

create unique index profiles_username_lower_uidx on public.profiles (lower(username));

create or replace function public.complete_scorer_provisioning(p_request jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  admin_id uuid := (p_request ->> 'admin_id')::uuid;
  scorer_id uuid := (p_request ->> 'user_id')::uuid;
  scorer_username text := lower(trim(p_request ->> 'username'));
  scorer_name text := trim(p_request ->> 'display_name');
  scorer_event_id uuid := (p_request ->> 'event_id')::uuid;
  scorer_bonus_limit integer := (p_request ->> 'bonus_limit')::integer;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = admin_id and role = 'admin' and is_active
  ) then raise exception 'provisioning caller is not an active admin' using errcode = '42501'; end if;
  if scorer_username is null or scorer_username !~ '^[a-z0-9._-]{3,32}$' then
    raise exception 'username is invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = scorer_id) then
    raise exception 'auth user does not exist' using errcode = '23503';
  end if;
  insert into public.profiles (user_id, username, display_name, role)
  values (scorer_id, scorer_username, scorer_name, 'scorer');
  insert into public.scorer_allowances (event_id, scorer_id, bonus_limit)
  values (scorer_event_id, scorer_id, scorer_bonus_limit);
end;
$$;

commit;
