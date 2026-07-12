# Saint Paul camp scoring backend

This backend is a Supabase/Postgres implementation for one active, one-night camp. It is intentionally request/response only; no table is added to a Realtime publication.

## Security model

- Supabase Auth identifies administrators and scorers. `public.profiles.role` is the database authorization source.
- Scorers can select only their profile, active event, allowance, assigned slots, teams in those slots, and entries they created. All scoring writes go through RPCs.
- Admins configure events, teams, and slots through RLS-protected table writes. Scorer profiles/allowances, wallet changes, and NFC lifecycle changes use their dedicated server or RPC paths.
- Admins create scorer Auth accounts through the authenticated `create-scorer` Edge Function. Clients never call Auth admin APIs or receive a service-role key.
- Public NFC users receive no direct table grants. They can call only `get_team_wallet_by_nfc` with the raw tag secret.
- NFC secrets contain 256 random bits and are returned as 64 lowercase hexadecimal characters, which are URL-safe. The database stores only their 32-byte SHA-256 hashes, so a database read cannot recover tag values. `issue_nfc_token` returns the raw secret once; the caller must program and retain it securely.
- The `service_role` key bypasses RLS and must never be embedded in a mobile app, NFC tag, browser bundle, or client configuration. Clients use only the Supabase URL and anon key. The `create-scorer` Edge Function reads the key from its server environment solely for Auth creation, compensation, and the restricted provisioning RPC.

RLS is defense in depth. Every privileged `security definer` function independently verifies the authenticated role, uses a fixed `search_path`, and exposes only its exact signature.

## Accounting and concurrency

`wallet_ledger` is the balance source of truth. Its trigger rejects every update and delete, including owner-level SQL. Corrections append either a reversal or an admin adjustment. A balance is always `sum(wallet_ledger.amount)` for a team.

Each mutation runs in one Postgres transaction:

- Match submission locks its slot and both teams in UUID order. One result is allowed per slot, and one ledger entry is allowed per result/team.
- Match submission also locks the event and rejects it when inactive; stale scorer clients cannot write after a committed event closure.
- Bonus awarding locks the active event, scorer allowance, and team. The spent sum is checked while that allowance row is locked.
- Scorer setting changes lock the profile and the same allowance row, reject a limit below committed bonuses, and update display name, active state, and allowance in one transaction.
- Redemption and adjustment lock the team before checking its balance, preventing concurrent deductions from overspending.
- Reversal locks the team, appends the exact negation, and is unique per original entry.
- Client mutations use a UUID idempotency key. An advisory transaction lock serializes the same actor/key, while unique constraints provide a final invariant. A retry with the same normalized request returns the original record; reuse with changed input is rejected.

Coin values live on `events`: `winner_coins`, `draw_coins`, and `loser_coins`. The demo event uses 10/5/2.

`my_assignments` returns slots only while their event is active. Closing an event immediately removes scorer work and causes both scoring RPCs to return SQLSTATE `55000`. Admin NFC redemption intentionally remains available after closure so prizes and audit corrections can be settled after play ends.

## Client-safe API

Authenticated scorer calls:

| RPC | Arguments | Result |
| --- | --- | --- |
| `my_assignments` | none | Assigned slots, participating teams, submitted outcome, and current bonus allowance |
| `submit_match_result` | `p_slot_id`, `p_outcome`, `p_idempotency_key` | Match result UUID |
| `award_bonus` | `p_team_id`, `p_amount`, `p_reason`, `p_idempotency_key` | Bonus award UUID |

`p_outcome` is one of `team_a_win`, `draw`, or `team_b_win`. Generate a new UUID idempotency key for each user action and persist it across network retries.

Authenticated admin calls:

| RPC | Purpose |
| --- | --- |
| `issue_nfc_token(p_team_id, p_label)` | Returns one new raw NFC secret |
| `revoke_nfc_token(p_token_id)` | Immediately invalidates a tag |
| `redeem_by_nfc(p_token, p_amount, p_note, p_idempotency_key)` | Atomically validates the tag, checks balance, and deducts coins |
| `adjust_wallet(p_team_id, p_amount, p_reason, p_idempotency_key)` | Appends an explained positive or negative correction |
| `reverse_wallet_entry(p_entry_id, p_reason)` | Appends the exact opposite of one ledger entry |
| `update_scorer_settings(p_scorer_id, p_event_id, p_display_name, p_is_active, p_bonus_limit)` | Atomically edits an existing scorer and rejects a bonus limit below used bonuses |

Scorer account creation is an Edge Function rather than a browser database upsert because `profiles.user_id` must reference an existing Auth user. See [create-scorer.md](./create-scorer.md) for the exact client contract and recovery behavior.

Authenticated clients have read-only access to `profiles` and `scorer_allowances`; even admins cannot mutate either table directly. Existing scorer edits must use `update_scorer_settings`. The `create-scorer` server flow inserts the initial profile and allowance through its service-role-only transaction.

Anonymous or authenticated public call:

| RPC | Purpose |
| --- | --- |
| `get_team_wallet_by_nfc(p_token)` | Returns team code/name, balance, and transaction amount/kind/description/time; it never returns internal UUIDs |

The anonymous payload has this public shape:

```json
{
  "team": { "code": "TEAM_1", "name_ar": "النسور" },
  "balance": 17,
  "transactions": [
    {
      "amount": 7,
      "kind": "bonus",
      "description_ar": "روح رياضية",
      "created_at": "2026-07-11T18:00:00+00:00"
    }
  ]
}
```

Team UUIDs, ledger UUIDs, source-record UUIDs, actor UUIDs, NFC token identifiers, and token hashes are not part of this response.

No RPC accepts a role from the client. Authorization always derives from `auth.uid()`.

## Data files

- `supabase/migrations/202607110001_initial_backend.sql`: types, schema, constraints, functions, grants, and RLS.
- `supabase/seed.sql`: eight teams, eighteen isolated scorers, one admin, eighteen slots, allowances, and local-only NFC tags.
- `supabase/tests/backend.sql`: pgTAP checks for isolation, scoring, idempotency, bonus limits, event closure, NFC reads/redemption, and ledger immutability.
- `supabase/tests/concurrency.sql`: two-session pgTAP coverage for bonus/allowance lock serialization.
- `supabase/functions/create-scorer/index.ts`: server-side scorer Auth and profile provisioning.
