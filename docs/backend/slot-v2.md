# Slot V2 contracts

All mutation RPCs require an authenticated active profile and use fixed `search_path`, row locks, and idempotency keys. Admin-only RPCs call `private.require_role('admin')`; scorer RPCs call `private.require_role('scorer')` and verify exact slot assignment.

## Slot model

`match_slots.slot_type` is `game | tournament`. Existing rows migrate as `game`.

- Game defaults: `winner_score=50`, `draw_score=25`, `loser_score=20`.
- Tournament defaults: `first_score=175`, `second_score=125`, `third_score=75`, `others_score=30`.
- Every slot: `bonus_limit=10` by default.
- `slot_participants(slot_id, team_id)` is authoritative. Games require exactly 2 participants; tournaments require at least 4.

## Admin RPCs

### `upsert_slot_v2(p_request jsonb) -> uuid`

Required object fields: `event_id`, `slot_number`, `label_ar`, `scheduled_at`, `scorer_id`, `slot_type`, and `team_ids`. `id` is optional (update when present). Score fields and `bonus_limit` are optional and use the defaults above. A submitted slot cannot be edited.

### `redeem_by_team(p_team_id, p_amount, p_note, p_idempotency_key) -> uuid`

Spends Kaizen directly from the selected team. It locks the team, checks its ledger balance, and returns the existing redemption for an identical retry.

### NFC

- `reassign_nfc_token(p_token_id, p_team_id) -> text`: revokes the old token and returns a fresh raw token for rewriting the physical NFC card.
- `delete_nfc_token(p_token_id) -> void`: hard-deletes the token row, immediately invalidating the physical card. Wallet and ledger audit rows are never deleted.

## Scorer RPCs

### `my_assignments() -> table(assignment jsonb)`

Each JSON object contains slot metadata, type-specific `scores`, per-slot bonus used/remaining, participants, and submitted result. Game objects also include explicit `team_a_id` and `team_b_id`; their `participants` array always places Team A first and Team B second. Only active-event slots assigned to the caller are returned.

### `submit_game_result(p_slot_id, p_outcome, p_idempotency_key) -> uuid`

Outcome is `team_a_win | draw | team_b_win`. Both awards are written atomically using the slot's configured scores.

### `submit_tournament_result(p_slot_id, p_first_team_id, p_second_team_id, p_third_team_id, p_idempotency_key) -> uuid`

The three ranked teams must be distinct participants. The database automatically awards every other participant `others_score` in the same transaction.

### `award_slot_bonus(p_slot_id, p_team_id, p_amount, p_reason, p_idempotency_key) -> uuid`

Bonus is independent of result submission and stays open while the event is active. The exact slot row is locked and the cumulative `bonus_awards.slot_id` sum is rechecked before insert, preventing concurrent cap overspend.
