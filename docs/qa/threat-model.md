# Threat model

## Scope

In scope are the mobile clients, authentication/session handling, server-side authorization, scoring and bonus operations, coin redemption, team balances, the audit ledger, NFC tags and tokens, administrator/scorer/public views, and explicit refresh or polling behavior during the one-night camp.

Out of scope are device theft controls outside the app, physical replacement of team tags, denial of service against infrastructure, and compromise of the platform provider. These remain operational risks and do not relax the controls below.

## Assets and security objectives

| Asset | Objective |
|---|---|
| Team score and coin balance | Correct, non-negative where applicable, and changed only by authorized atomic operations |
| Score slots and outcomes | One effective final result per slot, limited to the assigned scorer or admin |
| Scorer bonus allowance | Private to that scorer/admin and impossible to exceed under concurrency |
| Audit ledger | Complete, immutable to ordinary roles, attributable, ordered by server facts, and reconcilable |
| NFC token | Unpredictable, non-identifying, revocable, stored server-side only as a cryptographic hash, and confined to read-only team access |
| Sessions and roles | Server-validated, least-privilege, and promptly revocable |
| Team history | Visible only to admin and the public capability for that exact team; never cross-team |

## Actors and trust boundaries

- **Administrator:** trusted to configure events, teams, scorers, assignments, caps, correct results through an auditable compensating action, and redeem coins. Administrator mistakes or compromised sessions are still recorded and constrained by invariants.
- **Scorer:** authenticated but untrusted outside their own active assignments and allowance. A scorer may modify requests, replay traffic, or coordinate with another scorer.
- **Public NFC holder:** unauthenticated bearer of one team-scoped capability. The holder is untrusted and may enumerate, share, replay, or inspect requests.
- **Mobile client and network:** untrusted. All fields, cached state, timestamps, identifiers, and UI restrictions can be changed or stale.
- **Server-side authorization and transaction boundary:** trusted enforcement point. It must derive actor identity, role, scope, timestamps, effects, and ledger facts rather than accepting them from the client.

## Principal abuse cases and controls

| ID | Threat / attack path | Impact | Required preventive controls | Required detection / recovery |
|---|---|---|---|---|
| T01 | Scorer replaces a slot, scorer, team, event, or ledger identifier (IDOR) | Cross-assignment read/write | Deny by default; bind authenticated actor to a current assignment server-side; validate all related rows belong to the same event and slot | Audit denied attempts without secrets; alert on repeated cross-scope probes |
| T02 | Public holder changes a team/history identifier while retaining a valid token | Cross-team data disclosure | Resolve team solely from a hashed/token lookup; never trust a client-supplied team scope; return indistinguishable not-found responses | Rate-limit and monitor enumeration patterns |
| T03 | Two taps, retries, offline replay, or two devices submit the same score | Duplicate score/coin effects | Stable idempotency key per intended operation; uniqueness at authoritative storage; single transaction for result, effects, and ledger | Reconcile one accepted operation to one ledger record; return the original result on a true retry |
| T04 | Two distinct requests race to finalize the same slot | Conflicting result or lost update | Authoritative conditional transition/locking; at most one finalization succeeds; no last-write-wins client behavior | Conflict response includes no sensitive data; admin correction uses a new compensating operation |
| T05 | Parallel bonus requests each observe remaining allowance | Bonus cap bypass | Atomically compare-and-consume against the cap in the same transaction as the score effect; enforce non-negative remainder | Record consumed amount and cap context; reconciliation flags consumption over cap |
| T06 | Client sends negative, fractional, oversized, or forged bonus values | Balance/cap corruption | Server-owned allowed values and integer units; strict range/type validation; do not trust computed totals from client | Reject with stable validation result and no ledger entry |
| T07 | Two admins redeem from the same team concurrently | Double charge or negative balance | Atomic conditional debit with unique operation identifier; reject debit when authoritative balance is insufficient | Ledger-to-balance reconciliation; explicit insufficient-funds result |
| T08 | Timeout occurs after commit and user retries redemption | Duplicate debit | Idempotent mutation semantics; retry with same key returns the committed result without a new debit or ledger entry | UI supports “outcome unknown—check status” rather than suggesting a fresh operation |
| T09 | Ledger write succeeds but balance/score update fails, or vice versa | Unreconcilable state | Business mutation and ledger append in one transaction; rollback all effects on any failure | Automated reconciliation and release-blocking integrity checks |
| T10 | Actor edits or deletes history to conceal an action | Audit loss | Append-only ledger for application roles; corrections are new linked compensating entries; privileged maintenance is separately controlled | Monitor direct privileged changes and retain backups |
| T11 | Client forges actor, timestamp, before/after balance, or operation type | False attribution | Derive audit facts on the server from authenticated identity and transactional state; server time only | Reconciliation verifies arithmetic and required attribution fields |
| T12 | A token leaks from the NFC bootstrap into network path logs, later URLs/history, analytics, errors, ledger data, persistent storage, referrers, or third-party requests; legacy path tags expose the token to Cloudflare/origin logging | Persistent unauthorized team access | Program all new tags as `https://host/nfc#<opaque-token>` so the fragment is not sent to Cloudflare/the origin or referrers; send `Referrer-Policy: no-referrer`; load no third-party analytics or resources; immediately copy the fragment into session storage and replace the visible URL/current history entry with tokenless `/nfc`; store only a cryptographic token hash in the database; retain `/nfc/{opaque-token}` only for temporary compatibility with explicit path-log redaction | Reprogram every legacy tag immediately; verify proxy/origin log redaction while compatibility exists; rotate/revoke any exposed token; access events contain only a safe fingerprint |
| T13 | Attacker enumerates short or structured NFC tokens | Team history disclosure | Cryptographically random token with at least 128 bits of entropy; constant-shape not-found behavior; rate limiting | Enumeration alerting without recording raw candidates |
| T14 | Removed scorer uses a stale screen/session | Unauthorized post-revocation write | Re-check assignment, role, event state, and cap at mutation time | Denial audit correlated to the former assignment |
| T15 | NFC public endpoint exposes mutation capability or privileged fields | Unauthorized changes/data leak | Read-only operation surface and field allowlist; no scorer identity, cap, internal IDs, token value, or admin metadata | Contract tests compare response to allowlist |
| T16 | Client cache/polling shows stale balance and permits unsafe action | User confusion; repeat operation | Server is authoritative; mutation response states committed outcome; refresh is explicit/bounded; pending action is guarded against repeat taps | Visible last-updated state and deterministic recovery after timeout |
| T17 | Event/team relationships are mixed in a crafted request | Cross-event corruption | Validate all referenced entities and assignments share the active event; derive relationships server-side where possible | Integrity constraints and cross-event adversarial tests |
| T18 | RTL layout reverses numeric meaning or hides destructive context | Wrong team, score, or debit | Keep numbers and operation signs unambiguous; show team, amount, and resulting balance in Egyptian Arabic confirmation; color-independent status | Mobile RTL, screen-reader, contrast, and touch-target acceptance tests |

## Atomic operation contracts

### NFC bootstrap

Every newly programmed physical NFC tag contains `https://host/nfc#<opaque-token>`. The URL fragment is processed by the first-party app and is not included in the HTTP request to Cloudflare/the origin or in a referrer. The `/nfc` response must set `Referrer-Policy: no-referrer` and must not load third-party analytics, scripts, images, fonts, or other resources.

Before normal application navigation, the client copies the fragment only into session storage and immediately replaces the visible URL and current browser history entry with tokenless `/nfc`. It must then transmit the token for first-party validation only through the protected non-URL request mechanism defined by the implementation. The token must not enter local storage, IndexedDB, caches, telemetry, errors, ledger/audit data, later URLs, or third-party requests. The database retains only a cryptographic hash used for lookup; comparison must not require storage of the recoverable raw value.

`/nfc/{opaque-token}` is legacy-only compatibility, not an acceptable format for newly programmed tags. Because its path reaches Cloudflare and the origin and may enter access logs, every legacy tag must be reprogrammed to the fragment form immediately. While the compatibility route exists, edge, proxy, origin, application, observability, and error logging must redact the token path segment; the response must apply the same no-third-party, `no-referrer`, session-storage, and immediate tokenless-history rules. Removal of legacy compatibility is preferred once all physical tags are replaced.

### Finalize score

One transaction must validate the actor’s current role and assignment, validate that the slot is open and related entities match, validate the result and bonus, atomically consume any bonus, write the single effective result and derived effects, and append exactly one ledger/audit operation. Any failure leaves all values unchanged.

The idempotency key identifies one user intent. Reusing it with identical normalized input returns the original outcome; reusing it with different input is rejected. A different key targeting an already finalized slot receives a conflict and creates no effect.

### Redeem coins

One transaction must validate administrator authority, token/team status, event state, positive integer amount, and sufficient authoritative balance; conditionally debit the balance and append exactly one ledger entry. Any failure leaves both unchanged. Identical retry and conflicting-key behavior follows the score contract.

### Corrections

Final results and ledger entries are not overwritten or deleted through ordinary workflows. An administrator correction must be a separately authorized operation linked to the corrected operation, with a reason, reversing and replacement effects as applicable. The full history remains arithmetically reconcilable.

## Residual and operational risks

- A shared NFC tag is a bearer capability: anyone holding or photographing it can read that team’s permitted public data until rotation. Minimize the exposed fields and provide rapid rotation.
- An administrator can intentionally perform harmful authorized actions. Strong audit attribution, individual admin accounts, short sessions, and post-event reconciliation reduce but do not eliminate this risk.
- With no realtime updates, stale views are expected. Server-side atomic enforcement is mandatory; polling frequency is a usability choice, not a correctness control.
