# Backend operations

## Local setup

From the repository root:

```powershell
supabase start
supabase db reset
supabase test db
```

The reset applies all migrations and then `supabase/seed.sql`. Demo password for the admin and all scorer accounts is `CampDemo!2026`.

| Account | Email |
| --- | --- |
| Admin | `admin@stpaul.local` |
| Scorers | `scorer01@stpaul.local` through `scorer18@stpaul.local` |

The eight local-only NFC secrets follow this pattern:

```text
demo-stpaul-nfc-team-01-2026-local-only
...
demo-stpaul-nfc-team-08-2026-local-only
```

These deterministic credentials and tokens exist only for local testing. Do not copy them to a hosted project.

## Hosted deployment

1. Link the local project with `supabase link --project-ref <project-ref>`.
2. Review pending SQL with `supabase db diff --linked` or the team's normal migration review process.
3. Apply migrations with `supabase db push`.
4. Bootstrap administrator Auth users through a trusted server or the Dashboard and create their `admin` profile rows through reviewed server-side SQL. Do not create scorers through the Dashboard and do not run the demo seed in production.
5. Set `FIRST_PARTY_ORIGIN` with `supabase secrets set FIRST_PARTY_ORIGIN=https://your-admin-app.example`. The value must be the exact browser origin and cannot be `*`.
6. Deploy `create-scorer` with `supabase functions deploy create-scorer`; signed-in admins then use it to create Auth users, scorer profiles, and allowances together.
7. Configure the event, eight teams, and scorer slots while authenticated as an admin.
8. Call `issue_nfc_token` for every physical tag. It returns one 64-character lowercase hexadecimal secret. Program that returned value into the tag, verify it once, then discard unnecessary plaintext copies; Postgres retains only its SHA-256 hash.

Disable public sign-up in Auth settings. Require strong, unique scorer passwords. Deactivate a scorer through `update_scorer_settings`, then disable the associated Auth user through a trusted server or the Dashboard.

## Camp-night checklist

- Confirm exactly one event is active and its coin rules are correct before scoring begins.
- Confirm each scorer sees only their own slots and expected bonus remaining.
- Edit existing scorer display name, active state, and bonus limit only through `update_scorer_settings`; direct allowance writes are intentionally denied.
- Scan every NFC tag and verify its Arabic team name before distribution.
- Never correct history with SQL updates. Use `reverse_wallet_entry` or `adjust_wallet` with a clear Arabic reason.
- If a tag is lost, revoke its token and issue a replacement. Existing ledger history remains attached to the team.
- Export the final ledger after the camp for audit retention.
- Set `events.is_active = false` when play closes. Scorer assignments disappear and stale match/bonus writes are rejected; admin NFC redemption remains available for operational settlement.

## API error handling

Postgres error codes are intentional and safe for client branching:

| Code | Meaning |
| --- | --- |
| `42501` | Not authorized, wrong assignment, or invalid/revoked NFC token |
| `22023` | Invalid input or idempotency key reused with different input |
| `23505` | Slot or business record already exists |
| `23514` | Bonus/balance rule would be violated |
| `P0002` | Requested team or token record was not found |
| `55000` | Scorer attempted to write after the event closed |

Present localized Arabic messages in the app; do not expose raw database details beyond the stable code mapping.

## Backup and recovery

Use Supabase managed backups for the hosted database. Before the camp, rehearse a restore and retain a separate export of `events`, `teams`, `profiles`, `match_slots`, `match_results`, `bonus_awards`, `redemptions`, `admin_adjustments`, and `wallet_ledger`. Treat NFC token hashes as sensitive operational data even though they cannot be reversed.
