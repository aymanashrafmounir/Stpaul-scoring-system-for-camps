begin;

create temporary table corrected_shift_labels on commit drop as
select
  slot.id as slot_id,
  scorer.username,
  slot.slot_number,
  slot.label_ar as previous_label,
  case
    when scorer.username in ('scorer01','scorer02','scorer03','scorer04')
      then 'Shift ' || row_number() over (
        partition by scorer.username order by slot.slot_number
      )
    else 'Shift ' || (
      row_number() over (
        partition by scorer.username order by slot.slot_number
      ) + 4
    )
  end as corrected_label
from public.match_slots slot
join public.events event
  on event.id=slot.event_id and event.is_active
join public.profiles scorer
  on scorer.user_id=slot.scorer_id
where scorer.role='scorer'
  and scorer.username in (
    'scorer01','scorer02','scorer03','scorer04',
    'scorer05','scorer06','scorer07','scorer08'
  );

do $$
declare
  active_event_id uuid;
begin
  select id into strict active_event_id
  from public.events
  where is_active;

  if (select count(*) from corrected_shift_labels)<>32 then
    raise exception 'expected 32 scorer slots';
  end if;

  if exists (
    select username
    from corrected_shift_labels
    group by username
    having count(*)<>4 or count(distinct corrected_label)<>4
  ) then
    raise exception 'every scorer must have four distinct shift labels';
  end if;

  insert into private.camp_reset_backups(event_id,snapshot)
  select active_event_id,jsonb_build_object(
    'shift_label_correction',
    jsonb_agg(
      jsonb_build_object(
        'slot_id',slot_id,
        'username',username,
        'slot_number',slot_number,
        'previous_label',previous_label,
        'corrected_label',corrected_label
      )
      order by username,slot_number
    )
  )
  from corrected_shift_labels;

  update public.match_slots slot
  set label_ar=labels.corrected_label
  from corrected_shift_labels labels
  where slot.id=labels.slot_id;

  if exists (
    select 1
    from corrected_shift_labels labels
    join public.match_slots slot on slot.id=labels.slot_id
    where slot.label_ar is distinct from labels.corrected_label
  ) then
    raise exception 'shift label correction failed';
  end if;
end $$;

commit;
