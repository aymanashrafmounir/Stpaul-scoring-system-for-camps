-- Local/demo data only. Password for every demo account: CampDemo!2026
-- Never use these credentials or deterministic NFC tokens in production.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'admin@stpaul.local',
  extensions.crypt('CampDemo!2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"مدير المخيم"}', now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

do $$
declare
  i integer;
  uid uuid;
  mail text;
begin
  for i in 1..18 loop
    uid := ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    mail := 'scorer' || lpad(i::text, 2, '0') || '@stpaul.local';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid,
      'authenticated', 'authenticated', mail,
      extensions.crypt('CampDemo!2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('display_name', 'مسجل ' || lpad(i::text, 2, '0')),
      now(), now(), '', '', '', ''
    ) on conflict (id) do nothing;
  end loop;
end $$;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
from auth.users u
where u.id = '10000000-0000-0000-0000-000000000001'
   or u.id::text like '20000000-0000-0000-0000-%'
on conflict (provider_id, provider) do nothing;

insert into public.profiles (user_id, username, display_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'admin', 'مدير المخيم', 'admin')
on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name, role = excluded.role;

insert into public.profiles (user_id, username, display_name, role)
select ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'scorer' || lpad(i::text, 2, '0'),
       'مسجل ' || lpad(i::text, 2, '0'), 'scorer'::public.app_role
from generate_series(1, 18) i
on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name, role = excluded.role;

insert into public.events (id, name, starts_at, ends_at, winner_coins, draw_coins, loser_coins, is_active)
values ('30000000-0000-0000-0000-000000000001', 'معسكر سانت بول التجريبي',
        '2026-07-11 16:00:00+03', '2026-07-12 04:00:00+03', 10, 5, 2, true)
on conflict (id) do nothing;

insert into public.teams (id, event_id, code, name_ar)
select ('40000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       '30000000-0000-0000-0000-000000000001', 'TEAM_' || i,
       (array['النسور','الأسود','الصقور','الفرسان','الأبطال','النجوم','العاصفة','الشعلة'])[i]
from generate_series(1, 8) i
on conflict (id) do nothing;

insert into public.scorer_allowances (event_id, scorer_id, bonus_limit)
select '30000000-0000-0000-0000-000000000001',
       ('20000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       20
from generate_series(1, 18) i
on conflict (event_id, scorer_id) do update set bonus_limit = excluded.bonus_limit;

insert into public.match_slots (
  id, event_id, slot_number, label_ar, scheduled_at, scorer_id, team_a_id, team_b_id,
  slot_type, winner_score, draw_score, loser_score, bonus_limit
)
select ('50000000-0000-0000-0000-' || lpad(slot_number::text, 12, '0'))::uuid,
       '30000000-0000-0000-0000-000000000001', slot_number,
       'مباراة ' || slot_number || '، Team ' || team_a || ' ضد Team ' || team_b,
       '2026-07-11 17:00:00+03'::timestamptz + ((slot_number - 1) * interval '20 minutes'),
       ('20000000-0000-0000-0000-' || lpad(scorer_number::text, 12, '0'))::uuid,
       ('40000000-0000-0000-0000-' || lpad(team_a::text, 12, '0'))::uuid,
       ('40000000-0000-0000-0000-' || lpad(team_b::text, 12, '0'))::uuid,
       'game'::public.slot_type, 10, 5, 2, 20
from (
  values
    (1, 1, 1, 8), (2, 1, 2, 7), (3, 1, 3, 6), (4, 1, 4, 5),
    (5, 2, 3, 4), (6, 2, 5, 6), (7, 2, 1, 2), (8, 2, 7, 8),
    (9, 3, 6, 7), (10, 3, 1, 4), (11, 3, 5, 8), (12, 3, 2, 3),
    (13, 4, 2, 5), (14, 4, 3, 8), (15, 4, 4, 7), (16, 4, 1, 6),
    (17, 5, 1, 2), (18, 5, 3, 4), (19, 5, 5, 6), (20, 5, 7, 8),
    (21, 6, 5, 7), (22, 6, 6, 8), (23, 6, 2, 4), (24, 6, 1, 3),
    (25, 7, 4, 8), (26, 7, 1, 5), (27, 7, 3, 7), (28, 7, 2, 6),
    (29, 8, 3, 6), (30, 8, 2, 7), (31, 8, 1, 8), (32, 8, 4, 5)
) as schedule(slot_number, scorer_number, team_a, team_b)
on conflict (id) do update set
  slot_number = excluded.slot_number,
  label_ar = excluded.label_ar,
  scheduled_at = excluded.scheduled_at,
  scorer_id = excluded.scorer_id,
  team_a_id = excluded.team_a_id,
  team_b_id = excluded.team_b_id,
  slot_type = excluded.slot_type,
  winner_score = excluded.winner_score,
  draw_score = excluded.draw_score,
  loser_score = excluded.loser_score,
  bonus_limit = excluded.bonus_limit;

delete from public.slot_participants
where slot_id in (
  select ('50000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
  from generate_series(1, 32) i
);

insert into public.slot_participants(slot_id,team_id)
select id,team_a_id from public.match_slots
where event_id = '30000000-0000-0000-0000-000000000001'
union
select id,team_b_id from public.match_slots
where event_id = '30000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- Known local-only NFC values make manual client testing easy.
insert into public.nfc_tokens (team_id, token_hash, label)
select ('40000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       extensions.digest('demo-stpaul-nfc-team-' || lpad(i::text, 2, '0') || '-2026-local-only', 'sha256'),
       'بطاقة تجريبية'
from generate_series(1, 8) i
on conflict (token_hash) do nothing;
