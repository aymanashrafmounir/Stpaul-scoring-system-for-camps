# Concurrency and adversarial test plan

## Test approach

Run authorization tests against the deployed server/data boundary, not mocked client guards. Run concurrency tests with synchronized workers and independent sessions/devices. For each mutation, verify both the response and authoritative persisted state after all workers finish. Disable or bypass UI-only tap guards when testing the server.

Use synthetic tokens and accounts only. Never place raw NFC tokens or credentials in test reports. Record safe fingerprints and operation identifiers.

## Baseline fixture

Create one open event with eight teams, approximately eighteen scorer accounts, at least two administrators, and these deliberate relationships:

- Scorer A owns Slot A and has a small nonzero bonus cap.
- Scorer B owns Slot B and has a different cap.
- Slot C is unassigned; Slot D is already finalized.
- Team A has sufficient coins; Team B has a zero balance; Team C has a balance smaller than a planned redemption.
- Each team has a distinct active opaque NFC token; one old token is revoked.

Exact counts are fixture data, not trusted security boundaries. Capture initial balances, scores, bonus consumption, slot state, and ledger head/count for reconciliation.

## Authorization and IDOR cases

| ID | Attack / procedure | Expected result |
|---|---|---|
| A01 | As Scorer A, read or finalize Slot B by substituting its identifier | Denied/non-enumerating response; no state or ledger change |
| A02 | As Scorer A, claim Scorer B’s identity or role in the payload/header | Server uses session identity; denied; forged fields ignored or rejected |
| A03 | As Scorer A, request all assignments, vary filters/pagination/search, and inspect totals | Only A’s rows and safe totals; no B metadata |
| A04 | As Scorer A, read B’s cap, remaining allowance, submitted operations, or profile | Denied with no existence leak |
| A05 | As Scorer A, finalize unassigned Slot C or already finalized Slot D | Denied/conflict; no effect |
| A06 | Remove A’s assignment after A loads the screen, then submit from the stale screen | Denied at mutation time; no bonus or ledger effect |
| A07 | Disable A or change A’s role while the session remains open, then mutate | Denied at mutation time |
| A08 | Close the event after screen load, then score/redeem according to closure policy | Server enforces closed state; stale client cannot bypass it |
| A09 | Present Team A token while substituting Team B identifier/history cursor | Only Team A data or denial; never Team B data |
| A10 | Attempt public writes, direct ledger creation, bonus changes, or redemption | Denied; no state change |
| A11 | Use revoked, malformed, truncated, random, and expired-if-supported tokens | Same safe failure shape; no team data |
| A12 | Cross event/team/slot relationships in one crafted request | Rejected atomically; no partial state |
| A13 | Attempt to update/delete a ledger row or finalized result as every ordinary role | Denied; correction path required for admin |
| A14 | Inspect public and scorer responses, errors, counts, exports, logs, analytics, and storage after NFC bootstrap | No forbidden fields, credentials, or cross-scope metadata; for new tags the raw token exists only in the initial URL fragment and session storage, then the visible URL/history is immediately tokenless; no inspected persistent artifact contains it |

## Score and bonus concurrency cases

| ID | Procedure | Expected result / invariant |
|---|---|---|
| C01 | Send 20 simultaneous identical score requests with the same idempotency key | One effective result, one set of effects, one bonus consumption, one ledger operation; all successful retries identify the same outcome |
| C02 | Send 20 simultaneous requests for the same slot using different keys and identical input | At most one commits; all others conflict; one ledger operation |
| C03 | Race different outcomes and bonus values for the same slot | Exactly one complete intent commits; no mixed fields or partial bonus consumption |
| C04 | With allowance equal to one bonus unit, race two eligible slots for that scorer | Total consumed does not exceed cap; only permitted complete operation(s) commit |
| C05 | Race requests whose combined bonuses exceed remaining allowance but individually fit | Committed sum is at most the authoritative remainder; rejected requests have zero effect |
| C06 | Retry a committed key with different result, slot, team, or bonus | Rejected as idempotency-key misuse; original operation unchanged |
| C07 | Force timeout/disconnect immediately before and after commit, then retry same key | Final state is either zero commits or exactly one commit; never duplicate/partial |
| C08 | Inject a failure at each transactional write boundary in a test environment | Result, bonus, effects, and ledger all roll back together |
| C09 | Submit negative, zero where disallowed, fractional, huge, overflow-shaped, string, null, duplicate-field, and unexpected bonus input | Validation failure; no state/ledger change; remainder never negative |
| C10 | Simultaneously unassign scorer or close event while score commit waits at synchronization barrier | Serializable authorized outcome: commit only if policy conditions hold at its authoritative decision point; no partial effect |

## Redemption and balance concurrency cases

| ID | Procedure | Expected result / invariant |
|---|---|---|
| R01 | Send 20 simultaneous identical redemptions with one idempotency key | Exactly one debit and ledger entry; retries return same outcome |
| R02 | Race different keys whose total exceeds Team A balance | Committed debit sum never exceeds starting balance; final balance is non-negative |
| R03 | Race two admins redeeming the exact remaining balance | One succeeds; the other receives insufficient balance/conflict; final balance zero |
| R04 | Redeem from Team B at zero and from Team C above its balance | Rejected; balance and ledger unchanged |
| R05 | Submit negative, zero, fractional, overflow-shaped, NaN/string/null, and unexpected currency/unit values | Rejected; no credit-by-negative-debit and no ledger entry |
| R06 | Retry committed key with a different team/token or amount | Rejected as key misuse; original debit unchanged |
| R07 | Rotate/revoke token while redemption waits at a barrier | Authorization observes a coherent token state; no debit using an invalid capability unless admin independently selected/confirmed the team under the approved flow |
| R08 | Inject failure between balance and ledger persistence | Both roll back; never an orphan balance change or ledger entry |

## NFC secrecy and enumeration cases

| ID | Procedure | Expected result |
|---|---|---|
| N01 | Decode/inspect many issued tokens | No team/event IDs, sequence, timestamp, or predictable structure; generation provides at least 128 bits of entropy |
| N02 | Test a newly programmed `https://host/nfc#<opaque-token>` tag and a legacy `/nfc/{opaque-token}` tag while capturing browser navigation/storage, network requests/referrers, Cloudflare/edge/proxy/origin/application logs, analytics, errors, audit/ledger rows, and the database token record | **New tag:** initial HTTP request is tokenless `/nfc`; fragment reaches neither Cloudflare/origin nor referrers; response sets `Referrer-Policy: no-referrer` and loads no third-party resource/analytics; app copies the fragment only into session storage and immediately replaces visible URL/current history with tokenless `/nfc`; first-party validation uses a protected non-URL request. **Legacy tag:** compatibility is documented and inventory-marked for immediate physical replacement; token path is redacted from every log layer; response immediately applies the same storage/history/no-third-party controls. **Both:** later URLs, persistent storage, errors, responses, analytics, and ledger/audit data contain no raw token; database contains only its cryptographic hash and access events use only an approved safe fingerprint |
| N03 | Send high-rate random token guesses and compare status, size, timing distribution, and body | Rate limiting activates; responses do not provide a practical existence oracle |
| N04 | Rotate Team A token, then use old and new values | Old value fails immediately; new value reads only Team A; historical audit contains no raw value |
| N05 | Share a valid token across devices and repeat reads | Read-only behavior remains team-scoped; no mutation or privilege escalation |

## Ledger integrity and reconciliation cases

| ID | Procedure | Expected result |
|---|---|---|
| L01 | Recompute each team balance from its opening value plus signed ledger entries | Recomputed and materialized balances match exactly |
| L02 | Map every accepted score/redemption/correction operation to ledger records | Exactly one required record per accepted operation; none for rejected attempts |
| L03 | Validate each entry | Stable unique operation ID, server timestamp, server-derived actor, team, integer amount, type, and correction link/reason where applicable |
| L04 | Perform an admin correction | Original entry remains; linked compensating/replacement entries reconcile; no in-place overwrite |
| L05 | Attempt direct update/delete/insert through every application role | Denied; ledger count/content unchanged |
| L06 | Order near-simultaneous operations | UI does not rely on client clocks; stable server facts/cursor yield deterministic pagination without missing/duplicating rows |
| L07 | Run reconciliation after every concurrency and fault-injection suite | No negative balance, over-cap consumption, orphan effect, duplicate operation, or arithmetic mismatch |

## No-realtime and mobile RTL cases

| ID | Procedure | Expected result |
|---|---|---|
| U01 | Keep two clients open without subscriptions; mutate on one and explicitly refresh/poll the other | Second client converges; stale display never weakens server enforcement |
| U02 | Simulate slow network, dropped response, airplane-mode transition, and rapid repeat taps | One visible pending state; safe retry uses same intent key; user can resolve unknown outcome without creating a new charge/score |
| U03 | Exercise scoring, conflict, insufficient balance, expired assignment, revoked token, and success in Egyptian Arabic RTL on narrow phones | Correct RTL order; team/amount/outcome remain unambiguous; no clipped controls or hidden error context |
| U04 | Use screen reader, keyboard/switch navigation, 200% text zoom, reduced motion, and night contrast | Logical focus/reading order, visible focus, WCAG 2.2 AA contrast, adequate touch targets, and no color-only status |
| U05 | Display signed numbers, coin amounts, dates, mixed Arabic/Latin identifiers, and win/draw/loss | Bidirectional text does not reverse sign/value or associate it with the wrong team; text label accompanies color/icon |
| U06 | Observe last-updated and post-mutation state | User can distinguish pending, committed, rejected, and stale; mutation response is authoritative |

## Load and duration profile

Run a burst profile representative of all eighteen scorers submitting within the same few seconds, plus two administrators redeeming and public team reads. Repeat bursts for the expected one-night duration or an accelerated equivalent. Correctness criteria take precedence over latency: no invariant violation, authorization leak, duplicate, negative balance, over-cap bonus, missing ledger row, or unrecoverable client state is allowed.

## Exit criteria

All cases pass on the release candidate. C01–C10, R01–R08, and L01–L07 must be repeated enough to exercise actual overlap, with synchronization evidence rather than relying only on random timing. Any invariant failure is release-blocking and requires a clean rerun of the affected suite plus full reconciliation.
