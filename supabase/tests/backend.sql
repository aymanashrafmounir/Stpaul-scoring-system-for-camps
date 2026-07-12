begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select is((select count(*) from public.match_slots where slot_type='game'),18::bigint,'legacy slots preserved as games');
select is((select count(*) from public.slot_participants),36::bigint,'legacy game participants preserved');
select is((select winner_score from public.match_slots limit 1),10,'legacy configured winner score preserved');
select is((select bonus_limit from public.match_slots limit 1),20,'legacy bonus allowance copied per slot');
select ok(not has_function_privilege('anon','public.upsert_slot_v2(jsonb)','EXECUTE'),'anon cannot manage slots');
select ok(not has_function_privilege('anon','public.redeem_by_team(uuid,integer,text,uuid)','EXECUTE'),'anon cannot spend');
select ok(has_function_privilege('authenticated','public.submit_tournament_result(uuid,uuid,uuid,uuid,uuid)','EXECUTE'),'scorer RPC exposed to authenticated');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.upsert_slot_v2(jsonb_build_object(
 'event_id','30000000-0000-0000-0000-000000000001','slot_number',99,'label_ar','بطولة',
 'scheduled_at','2026-07-11T22:00:00+03:00','scorer_id','20000000-0000-0000-0000-000000000001',
 'slot_type','tournament','team_ids',jsonb_build_array('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004')))$$,'admin creates tournament');
select is((select count(*) from public.slot_participants where slot_id=(select id from public.match_slots where slot_number=99)),4::bigint,'tournament has four participants');
select throws_ok($$select public.upsert_slot_v2(jsonb_build_object('event_id','30000000-0000-0000-0000-000000000001','slot_number',100,'label_ar','bad','scheduled_at',now(),'scorer_id','20000000-0000-0000-0000-000000000001','slot_type','tournament','team_ids',jsonb_build_array('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003')))$$,'22023','game needs 2 teams; tournament needs at least 4','tournament rejects fewer than four');

select set_config('request.jwt.claims','{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.my_assignments()),2::bigint,'scorer sees only assigned slots');
select is((select assignment->'participants'->0->>'team_id' from public.my_assignments() where (assignment->>'slot_number')::int=1),'40000000-0000-0000-0000-000000000001','game participants keep Team A first');
select lives_ok($$select public.submit_tournament_result((select id from public.match_slots where slot_number=99),'40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001')$$,'scorer submits tournament');
select is((select amount from public.wallet_ledger where tournament_result_id is not null and team_id='40000000-0000-0000-0000-000000000001'),175,'first gets default');
select is((select amount from public.wallet_ledger where tournament_result_id is not null and team_id='40000000-0000-0000-0000-000000000002'),125,'second gets default');
select is((select amount from public.wallet_ledger where tournament_result_id is not null and team_id='40000000-0000-0000-0000-000000000003'),75,'third gets default');
select is((select amount from public.wallet_ledger where tournament_result_id is not null and team_id='40000000-0000-0000-0000-000000000004'),30,'other gets default');
select lives_ok($$select public.award_slot_bonus((select id from public.match_slots where slot_number=99),'40000000-0000-0000-0000-000000000001',10,'Bonus','92000000-0000-0000-0000-000000000001')$$,'bonus independent after result');
select throws_ok($$select public.award_slot_bonus((select id from public.match_slots where slot_number=99),'40000000-0000-0000-0000-000000000001',1,'More','92000000-0000-0000-0000-000000000002')$$,'23514','slot bonus limit exceeded','slot cap enforced');

select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.redeem_by_team('40000000-0000-0000-0000-000000000001',5,'صرف Kaizen','93000000-0000-0000-0000-000000000001')$$,'admin spends by team');
select is(public.redeem_by_team('40000000-0000-0000-0000-000000000001',5,'صرف Kaizen','93000000-0000-0000-0000-000000000001'),(select id from public.redemptions where idempotency_key='93000000-0000-0000-0000-000000000001'),'spend retry idempotent');

select * from finish();
rollback;
