# Release acceptance checklist

Record evidence links beside each item. “Implemented” without server-side test evidence is not a pass.

## Authorization and isolation

- [ ] Q01 All reads and writes are deny-by-default and authorized at the server/data boundary. Evidence: A01–A14.
- [ ] Q02 Scorers see only their own current assignments, necessary slot/team fields, and their own bonus allowance; filters, counts, search, errors, and pagination leak nothing else. Evidence: A01–A06.
- [ ] Q03 Assignment removal, account disablement/role change, event closure, and other scope changes are enforced at mutation time despite stale clients. Evidence: A06–A08, C10.
- [ ] Q04 Cross-event, cross-team, cross-slot, forged-actor, and forged-role requests are rejected without partial effects or existence leaks. Evidence: A01, A02, A09, A12.
- [ ] Q05 Only administrators can manage configuration, assignments, caps, NFC lifecycle, corrections, and coin redemption. Evidence: authorization matrix plus A10–A13.

## Scoring and bonuses

- [ ] Q06 A slot has at most one effective final result; concurrent identical or conflicting requests cannot multiply or mix effects. Evidence: C01–C03.
- [ ] Q07 Scoring is atomic across authorization, slot state, result, bonus consumption, derived score/coin effects, and ledger append. Evidence: C07, C08, L01–L03.
- [ ] Q08 Bonus values are server-validated integer units and aggregate consumption cannot exceed the authoritative scorer cap under concurrency. Remaining allowance never becomes negative. Evidence: C04, C05, C09.
- [ ] Q09 Idempotency keys identify one normalized intent: identical retry returns the original outcome and altered reuse is rejected. Evidence: C01, C06, C07.
- [ ] Q10 Finalized results are corrected only by linked, reasoned compensating operations; originals remain immutable. Evidence: L04.

## Coins and ledger

- [ ] Q11 Redemption is administrator-only and atomically performs a conditional debit plus exactly one ledger append. Evidence: R01–R04, R08.
- [ ] Q12 Concurrent redemption can never overspend; no accepted or rejected input can produce a negative balance or turn a debit into a credit. Evidence: R02–R05.
- [ ] Q13 Redemption retry after an uncertain response is idempotent, while altered reuse of an operation key is rejected. Evidence: R01, R06.
- [ ] Q14 Every accepted balance-affecting operation has exactly one complete, server-attributed ledger record; rejected operations have none. Evidence: L02, L03.
- [ ] Q15 Application roles cannot directly insert, update, or delete ledger rows; corrections preserve history. Evidence: A13, L04, L05.
- [ ] Q16 Full reconciliation exactly reproduces balances and bonus consumption and finds no duplicates, orphan effects, over-cap totals, or malformed entries. Evidence: L01–L07.

## NFC and public access

- [ ] Q17 Each NFC capability is cryptographically random with at least 128 bits of entropy and encodes no team/event identity or sequence. Evidence: N01.
- [ ] Q18 A valid token permits only allowlisted read-only data for its resolved team; supplied team identifiers cannot change scope. Evidence: A09, A10, N05.
- [ ] Q19 Every newly programmed tag uses `https://host/nfc#<opaque-token>`: the HTTP request reaching Cloudflare/origin is tokenless `/nfc`, the fragment is absent from referrers, the response sets `Referrer-Policy: no-referrer` and loads no third-party analytics/resources, and the app copies the fragment only into session storage before immediately replacing the visible URL/current history entry with tokenless `/nfc`. `/nfc/{opaque-token}` is legacy-only, is forbidden for new tags, and every legacy tag is inventory-marked and reprogrammed immediately; until removal, its token segment is redacted at every log layer and its response applies the same bootstrap controls. In both flows later URLs, persistent browser storage, analytics, errors, responses, and ledger/audit records contain no raw token, and the database stores only its cryptographic hash. Evidence: N02, new/legacy tag inventory, browser/network capture, edge-to-application log search, artifact search, and database storage inspection.
- [ ] Q20 Invalid token responses resist enumeration and guessing is rate-limited; public responses reveal no internal IDs, identities, assignments, caps, or private metadata. Evidence: A11, A14, N03.
- [ ] Q21 Token revocation/rotation invalidates the old capability at the authorization boundary and does not expose raw old/new values in audit data. Evidence: N04, R07.

## No-realtime operation and mobile UX

- [ ] Q22 The app uses explicit refresh or bounded polling rather than realtime subscriptions; correctness does not depend on cache freshness. Evidence: architecture/config inspection and U01.
- [ ] Q23 Pending, committed, rejected, conflict, insufficient-funds, and unknown-outcome states are distinct; repeat taps and recovery cannot duplicate an operation. Evidence: U02, U06.
- [ ] Q24 All user-facing operational flows use clear Egyptian Arabic in RTL and remain correct on supported narrow mobile widths. Evidence: U03, U05.
- [ ] Q25 The interface meets WCAG 2.2 AA contrast, visible focus, logical RTL reading/focus order, text zoom, reduced motion, adequate touch targets, and color-independent status requirements. Evidence: U04, U05.
- [ ] Q26 Team, amount, sign, score outcome, current/resulting balance, and last-updated state remain unambiguous with mixed Arabic/Latin and numeric content. Evidence: U03, U05, U06.

## Operational readiness

- [ ] Q27 The eight-team/~eighteen-scorer burst and one-night duration profile completes without an invariant violation; configured counts are not embedded as authorization assumptions.
- [ ] Q28 Monitoring detects repeated IDOR/token enumeration attempts, integrity violations, and privileged ledger changes without storing secrets or raw NFC tokens.
- [ ] Q29 Operators have rehearsed token rotation, scorer disablement, assignment correction, safe timeout recovery, ledger reconciliation, and post-event export/backup.
- [ ] Q30 Test evidence identifies the exact release candidate, environment, UTC run time, tester, authoritative database assertions, and redacted operation identifiers.

## Release decision

- [ ] All Q01–Q30 items pass with evidence.
- [ ] No open critical/high authorization, atomicity, balance, token-secrecy, or ledger-integrity defect remains.
- [ ] Any accepted lower-severity risk has an owner, rationale, compensating control, and expiry date.
- [ ] Product owner and security/QA reviewer approve the release candidate.

If any invariant in [`README.md`](README.md) fails, release is blocked regardless of aggregate pass rate.
