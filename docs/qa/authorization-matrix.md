# Authorization matrix

## Decision model

Authorization is deny-by-default and enforced at the server/data boundary for every read and mutation. A permitted action requires all applicable predicates below, not merely the role label.

- The authenticated session is valid and the server-derived role permits the action.
- The event is the active event and is in a state that permits the operation.
- Every referenced object belongs to the same event.
- A scorer’s assignment is current, belongs to the scorer, covers the exact slot, and permits the requested action.
- A public request resolves its team only from the presented active NFC capability.
- A mutation re-evaluates permissions and authoritative state at commit time.

Public NFC access is a capability, not a logged-in role. Possession grants only the narrow reads shown below.

## Permission matrix

Legend: **All** = all rows within the active event; **Own** = authenticated scorer’s own data; **Assigned** = exact currently assigned slot; **Token team** = team resolved from the NFC token; **No** = denied.

| Resource / action | Administrator | Scorer | Public NFC |
|---|---:|---:|---:|
| View event public name/status | All | Active event | Token team’s event, allowlisted fields |
| Configure event state | All | No | No |
| View teams | All | Teams necessary for Assigned slots only | Token team, public fields only |
| Create/update/archive teams | All | No | No |
| View scorer accounts | All | Own profile only | No |
| Create/disable/change scorer role | All | No | No |
| View assignments | All | Own Assigned slots only | No |
| Create/change/remove assignments | All | No | No |
| View bonus cap and remaining amount | All | Own only | No |
| Set or change bonus cap | All | No | No |
| View slot details | All | Assigned only | No |
| Finalize a slot result | All, with event/slot rules | Assigned only, with cap and slot rules | No |
| Edit/delete a finalized result in place | No; use correction | No | No |
| Create linked correction/reversal | All, reason required | No | No |
| View team score/balance | All | Only if needed for Assigned workflow and explicitly allowlisted | Token team only |
| View ledger/history | All | Only own submitted operations if operationally required; otherwise No | Token team public entries only |
| Create ledger entry directly | No; only through atomic domain operations | No | No |
| Update/delete ledger entry | No | No | No |
| Redeem coins | All, subject to balance and event rules | No | No |
| Issue/rotate/revoke NFC token | All | No | No |
| View raw NFC token after issuance | No by default; one-time provisioning only if required | No | Presented token is accepted but never returned |
| View audit/security events | All, least-privilege admin view | No | No |

## Field-level restrictions

### Client-supplied fields never authoritative

The server must not trust a client-provided actor/scorer identity, role, event relationship, assignment ownership, bonus remaining value, resulting balance, prior balance, ledger timestamp, ledger actor, or token-to-team mapping. Client values may identify a requested object, but the server must resolve and validate every relationship.

### Public NFC response allowlist

The response may contain only the team’s public display name, current score and coin balance, public transaction description/type, signed amount, and server timestamp needed for understandable history. It must exclude internal row identifiers, scorer/admin identity, assignment data, bonus data, session data, raw/digested token values, private notes, request metadata, and entries belonging to any other team.

### Public NFC bootstrap restrictions

Every newly programmed tag opens `https://host/nfc#<opaque-token>`. The fragment is available to the first-party app but is not included in the HTTP request to Cloudflare/the origin or in referrers. The `/nfc` bootstrap response must set `Referrer-Policy: no-referrer` and load no third-party analytics or resources. The app copies the fragment only into session storage and immediately replaces the visible URL/current history entry with tokenless `/nfc` before normal navigation. It submits the token for first-party validation only through a protected non-URL mechanism; later requests use the resulting session/capability context.

The raw token must not be persisted in local storage, IndexedDB, caches, errors, telemetry, responses, ledger/audit records, or the database. The database stores only a cryptographic hash for token resolution.

`/nfc/{opaque-token}` is permitted only as temporary legacy compatibility. It is forbidden for newly programmed tags and every existing legacy tag must be reprogrammed immediately. Because a path token reaches Cloudflare/the origin and may be captured by access logging, all edge, proxy, origin, application, observability, and error logs must redact its token segment until the compatibility route is removed. The legacy response must enforce the same no-third-party, `no-referrer`, session-storage, and immediate tokenless-history controls.

### Scorer response restrictions

A scorer response must exclude other scorers’ identity, assignments, caps, remaining bonuses, operation metadata, and unassigned teams/slots. Aggregate screens must not leak forbidden rows through counts, filters, autocomplete, error differences, export, search, or pagination totals.

## State-transition restrictions

| Transition | Required authorization and condition |
|---|---|
| Slot open → finalized | Admin or exact assigned scorer; active event; valid outcome; cap available; atomic commit |
| Finalized → corrected | Admin only; reason and link to prior operation; compensating append, never overwrite |
| Bonus available → consumed | Same atomic score operation; amount positive and within authoritative remainder |
| Balance sufficient → redeemed | Admin only; positive amount; atomic conditional debit; result non-negative |
| NFC active → revoked/rotated | Admin only; old capability invalid immediately at authorization boundary |
| Scorer active/assigned → disabled/unassigned | Admin only; subsequent scorer mutation denied even with stale client state |
| Event open → closed | Admin only; subsequent score/redemption behavior follows explicitly configured closure rules and is server-enforced |

## Response behavior

- Cross-scope object access should use a non-enumerating not-found/denied response with no object existence details.
- Validation, conflict, insufficient-balance, and idempotent-replay outcomes must be distinct enough for safe client recovery but must not disclose forbidden records.
- No denied request creates a score, balance change, bonus consumption, or domain ledger entry. A redacted security event may be recorded separately.
