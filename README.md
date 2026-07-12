# Saint Paul Camp Scoring

Mobile-first Egyptian Arabic scoring and Kaizen Coins wallet for a one-night camp. The app has isolated Admin and Scorer routes plus a read-only NFC team wallet.

## Production setup

Configure the production URL and Supabase values in your hosting provider. Do not commit production environment files, database credentials, access tokens, NFC tokens, or real account passwords.

## Routes

- `/admin`: teams, scorer accounts and bonus limits, slot assignment, ledger corrections, NFC issue/revoke, and coin redemption.
- `/scorer`: only the signed-in scorer's assigned slots and remaining bonus allowance.
- `/nfc`: read-only team balance and history. New tags use `/nfc#<opaque-token>` so the secret fragment is not sent to the web host.

## Local frontend

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev -- --host 127.0.0.1
```

Set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` to use Supabase. The app requires these values and intentionally has no demo-data fallback.

Quality checks:

```powershell
npm run lint
npm test
npm run build
```

## Local Supabase

Install the Supabase CLI and Docker Desktop, then run:

```powershell
supabase start
supabase db reset
supabase test db
supabase db lint --level warning
supabase functions serve create-scorer --env-file supabase/functions/.env.example
```

The local accounts, demo NFC secrets, RPC contract, and deployment sequence are documented in [backend operations](docs/backend/operations.md). The `service_role` key belongs only in Supabase's server-side Edge Function runtime and must never be added to `.env.local` or Cloudflare Pages.

## Deploy

1. Link the hosted Supabase project and apply the migrations with `supabase db push`. Do not run `supabase/seed.sql` in production.
2. Set the exact frontend origin: `supabase secrets set FIRST_PARTY_ORIGIN=https://your-app.example`.
3. Deploy account provisioning: `supabase functions deploy create-scorer`.
4. In Cloudflare Pages, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, use `npm run build`, and publish `dist`.
5. Bootstrap the first Admin account as described in [backend operations](docs/backend/operations.md), then create scorer accounts from `/admin`.

Cloudflare headers enforce a restrictive CSP and no-referrer policy. The SPA fallback is provided by `public/_redirects`.

## NFC programming

Issue a team token from the Admin NFC screen and copy the generated full URL directly to the physical tag. New tags use this form:

```text
https://your-app.example/nfc#64-character-token
```

The browser moves the secret to session storage and immediately replaces the visible address with `/nfc`. Public responses contain no internal UUIDs. A logged-in Admin scanning the same tag also receives the inline redemption tool; everyone else remains read-only.

## Security and operations

- [Backend architecture and RPCs](docs/backend/README.md)
- [Create-scorer Edge Function](docs/backend/create-scorer.md)
- [Threat model and authorization QA](docs/qa/README.md)
- [Release acceptance checklist](docs/qa/acceptance-checklist.md)
