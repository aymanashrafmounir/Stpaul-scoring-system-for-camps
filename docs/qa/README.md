# Security and QA contract

Status: normative pre-implementation specification.

This folder defines the security and release criteria for the Saint Paul Sports Team mobile scoring app described in [`PRODUCT.md`](../../PRODUCT.md). No application, API, database schema, or Supabase policy exists in this workspace at the time of writing. Consequently, the documents use domain concepts such as “score operation,” “ledger entry,” and “assignment” without prescribing table, endpoint, function, or policy names.

## Documents

- [`threat-model.md`](threat-model.md): assets, trust boundaries, abuse cases, and required controls.
- [`authorization-matrix.md`](authorization-matrix.md): deny-by-default permissions and row-scope rules for admin, scorer, and public NFC access.
- [`adversarial-test-plan.md`](adversarial-test-plan.md): authorization, concurrency, integrity, NFC, and mobile tests.
- [`acceptance-checklist.md`](acceptance-checklist.md): evidence-based release gate.

## Normative language and assumptions

“Must” is release-blocking. “Should” is expected unless a documented risk acceptance is approved by the product owner and security reviewer.

The contract assumes one camp event with eight teams and approximately eighteen scorers, but tests must not encode those values as authorization boundaries. The system must remain correct if the configured counts differ.

The product requirement “no realtime” means clients use explicit refresh or bounded polling. Correctness must not depend on subscriptions, client-side caches, or immediate propagation to another device.

## Security invariants

1. Every request is authorized server-side against the authenticated role and current row scope; hidden UI is not an authorization control.
2. A scorer can read and mutate only currently assigned slots and can read only their own remaining bonus allowance.
3. A slot has at most one effective final scoring result; retries and concurrent submissions cannot multiply score or coin effects.
4. Bonus consumption and its score/ledger effect commit atomically, and total consumed bonus never exceeds the scorer’s configured cap.
5. Coin redemption and its ledger entry commit atomically; a team balance can never become negative.
6. Every accepted balance-affecting action has exactly one immutable audit-ledger record with actor, team, amount, operation type, server timestamp, and stable operation identifier.
7. Public NFC access is read-only, team-scoped, and based on a high-entropy opaque token that reveals no team or event identifier.
8. Every newly programmed NFC tag uses `https://host/nfc#<opaque-token>`. The fragment is available to the first-party app but is not sent in the HTTP request to Cloudflare/the origin or in referrers. The app immediately copies it into session storage and replaces the visible URL/current history entry with tokenless `/nfc`. The legacy `/nfc/{opaque-token}` form is compatibility-only, has an explicit path-log exposure risk, and requires immediate tag replacement plus path redaction wherever compatibility remains. The raw token never appears in analytics, errors, ledger/audit records, persistent browser storage, or third-party requests; the database stores only its cryptographic hash.
9. Authorization is evaluated at mutation time. Assignment removal, role change, token revocation, event closure, and cap changes take effect without relying on a client refresh.
10. The Arabic Egyptian mobile interface is RTL, accessible, and presents authoritative pending/success/failure states that prevent accidental repeat actions.

## Required evidence convention

Each test run should record: build/version, environment, UTC timestamp, tester, preconditions, request correlation or operation identifier with secrets redacted, observed result, relevant database assertions, and pass/fail. Screenshots alone are insufficient for atomicity or authorization claims.
