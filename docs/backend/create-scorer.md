# Create scorer Edge Function

`create-scorer` is the only client-facing account-creation path. It keeps `SUPABASE_SERVICE_ROLE_KEY` inside the Edge Function runtime and never returns or logs the key.

## Client contract

Invoke `POST /functions/v1/create-scorer` from the configured `FIRST_PARTY_ORIGIN` with the signed-in administrator's access token:

```http
Authorization: Bearer <admin-access-token>
Content-Type: application/json
Origin: https://admin.example.org
```

```json
{
  "username": "scorer19",
  "password": "temporary-password",
  "display_name": "مسجل 19",
  "event_id": "30000000-0000-0000-0000-000000000001",
  "bonus_limit": 20
}
```

Validation rules:

- `username`: normalized to lowercase; 3–32 characters from `a-z`, `0-9`, `.`, `_`, and `-`.
- `password`: 8–128 characters; it is sent to Supabase Auth and is never returned or stored in public tables.
- `display_name`: trimmed, 1–80 characters.
- `event_id`: UUID for an existing event.
- `bonus_limit`: integer from 0 through 2,147,483,647.

Success is HTTP `201` and contains only fields needed by the admin UI:

```json
{
  "scorer": {
    "user_id": "new-auth-user-uuid",
    "username": "scorer19",
    "display_name": "مسجل 19",
    "event_id": "30000000-0000-0000-0000-000000000001",
    "bonus_limit": 20
  }
}
```

The response never includes the password, access/refresh tokens, user metadata, service key, or internal Auth record.

## Authorization and CORS

The Supabase gateway keeps JWT verification enabled. The function also extracts the Bearer token, verifies it through `auth.getUser(token)`, and requires a matching active `profiles` row with role `admin`.

`FIRST_PARTY_ORIGIN` is mandatory and rejects `*`. The function handler emits `Access-Control-Allow-Origin` only for that exact origin on preflight and normal responses. Missing or different origins receive `403 ORIGIN_NOT_ALLOWED` from the handler without a permissive CORS header.

## Failure behavior

Errors have the stable shape `{ "error": { "code": "..." } }`. Unexpected failures may also include a safe `request_id` for log correlation.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_JSON`, `INVALID_REQUEST` | Malformed JSON or missing/wrong field type |
| 401 | `AUTHENTICATION_REQUIRED`, `INVALID_ACCESS_TOKEN` | Missing or invalid Bearer token |
| 403 | `ORIGIN_NOT_ALLOWED`, `ADMIN_REQUIRED` | Wrong origin or caller is not an active admin |
| 405 | `METHOD_NOT_ALLOWED` | Method other than `POST`/`OPTIONS` |
| 409 | `USERNAME_ALREADY_EXISTS` | Auth already contains the normalized username |
| 422 | `INVALID_USERNAME`, `INVALID_PASSWORD`, `INVALID_DISPLAY_NAME`, `INVALID_EVENT_ID`, `INVALID_BONUS_LIMIT`, `EVENT_NOT_FOUND` | Valid JSON that fails a field or event rule |
| 500 | `SCORER_PROVISIONING_FAILED` | Database transaction failed and the new Auth user was deleted; response includes `request_id` |
| 500 | `SCORER_PROVISIONING_CLEANUP_FAILED` | Database transaction failed and compensating Auth deletion also failed; response includes `request_id` for restricted server-log repair |
| 500 | `INTERNAL_ERROR` | Failure before an Auth user needed compensation |

The function maps the public username to an internal `${username}@stpaul.local` Auth email; that email is never part of the client contract. Duplicate concurrent requests rely on Auth email uniqueness and the database's case-insensitive username index: one may succeed and the other returns `409`. The database function `complete_scorer_provisioning(jsonb)` is executable only by `service_role` and inserts the username, profile, and event allowance in one Postgres transaction.

## Reset scorer password

An active admin can invoke `POST /functions/v1/reset-scorer-password` with the same authorization and exact-origin headers:

```json
{
  "scorer_id": "scorer-auth-user-uuid",
  "new_password": "new-temporary-password"
}
```

The target must have role `scorer`; admin passwords cannot be changed through this endpoint. Passwords must be 8–128 characters and are never returned. Success is `200` with `{ "scorer": { "user_id": "...", "password_reset": true } }`.

Auth and Postgres cannot share one transaction. The function therefore validates the event before Auth creation, performs the two database inserts atomically, and calls `auth.admin.deleteUser` if the database RPC fails. Deleting the Auth user cascades an unassigned scorer profile and allowance, covering a lost RPC response after a commit. A cleanup failure is logged with the new Auth user UUID and a request ID but neither is exposed in the ordinary failure body.

## Verification strategy

Run the database checks first:

```powershell
supabase db reset
supabase test db
supabase db lint --level warning
```

Then serve the function with an exact local origin:

```powershell
# This matches: npm run dev -- --host 127.0.0.1
supabase functions serve create-scorer --env-file supabase/functions/.env.example
```

Integration coverage should exercise:

1. Missing/wrong `Origin`, preflight, missing token, scorer token, inactive admin, and active admin.
2. Every field boundary and a nonexistent event before checking Auth for side effects.
3. A successful request: confirmed Auth user, `scorer` profile, and allowance all exist; the response has only the documented five fields.
4. Repeating the email returns `409` and does not alter the existing account.
5. Force the database RPC to fail in an isolated test project; verify the just-created Auth user is deleted.
6. Force both RPC and Auth deletion to fail; verify the safe cleanup error and correlate its request ID with restricted server logs.

Never run failure injection against the camp's production project.
