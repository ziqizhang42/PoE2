# Browser HTTP API

HTTP handles health checks, authentication, the signed-in player directory, public player records, and finished games. Live presence, lobbies, and games use the authenticated WebSocket described in [protocol.md](./protocol.md).

The shared Zod schemas are the response contract:

- health checks: [`packages/protocol/src/health.ts`](../packages/protocol/src/health.ts)
- authentication: [`packages/protocol/src/auth.ts`](../packages/protocol/src/auth.ts)
- player profiles: [`packages/protocol/src/player.ts`](../packages/protocol/src/player.ts)
- history and replays: [`packages/protocol/src/history.ts`](../packages/protocol/src/history.ts)

## Routes

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | public | Process liveness |
| `GET` | `/ready` | public | Process and PostgreSQL readiness |
| `POST` | `/api/auth/register` | public | Create an account and session |
| `POST` | `/api/auth/login` | public | Create a session |
| `GET` | `/api/auth/session` | cookie | Read the current session |
| `DELETE` | `/api/auth/session` | cookie | End the current session |
| `GET` | `/api/players` | cookie | Complete rating-sorted player directory |
| `GET` | `/api/players/:username` | public | Profile, aggregates, rating history |
| `GET` | `/api/players/:username/games?limit&cursor` | public | Finished-game summaries, newest first |
| `GET` | `/api/games/:gameId` | public | One finished game and its move record |

Route registration lives in [`backend/src/http`](../backend/src/http).

`/health` does not touch a dependency and remains available for liveness checks. `/ready` executes a minimal PostgreSQL query; it returns `{ status: "ok" }` with `200` or `{ status: "unavailable" }` with `503`. Neither response exposes database details, and both disable caching.

## Authentication

Registration and login accept the strict username and password shapes exported by `@poe2/protocol`. Usernames are looked up case-insensitively while preserving their registered casing.

Successful registration or login sets an HTTP-only, same-site session cookie. Production uses a secure `__Host-` cookie; development uses `poe2_session`. `GET /api/auth/session` returns `401 unauthenticated` when the cookie is absent, expired, or invalid. Deleting a session is idempotent and returns `204`.

Authentication has independent per-address and failed-login-per-username limits, plus a bounded Argon2 work queue. Do not merge those limits or expose which one was reached: their common response prevents account enumeration. The exact policy is in [`backend/src/http/auth.ts`](../backend/src/http/auth.ts) and [`backend/src/config/kdf.ts`](../backend/src/config/kdf.ts).

## Player directory and public records

`GET /api/players` requires a valid session and returns every account without pagination. Each strict entry contains the account ID, canonical username, rounded display rating, and a whole `colorPercentile`. Rows are ordered by displayed rating descending and then normalized username ascending; no rank number is part of the representation.

Unrated accounts display at 1500. Their color estimates where 1500 falls among rated accounts, or uses the midpoint percentile when the rated population is empty. The WebSocket supplies volatile presence and activity separately, so the HTTP response remains cacheable until registration or a rated result changes durable directory data.

The profile and replay routes do not inspect the session cookie and must remain viewer-independent. They expose only finished games:

- A profile contains the canonical username, current display rating, aggregate statistics, and recent rating points.
- History pages contain subject-relative summaries and rating changes, but no moves.
- A replay contains canonical moves and, for timed games, clock history.

`GET /api/games/:gameId` returns the same `404 game_not_found` response for an unknown game and for any waiting, ready-check, or active game. Live boards are available only to their seated players over the WebSocket.

Scores and replay positions are reconstructed from canonical moves through `@poe2/rules`; they are not separate persisted authorities.

## Pagination

Player history uses keyset pagination ordered by `(finishedAt, id)`. The cursor is an opaque, validated encoding of that position, not a secret. Pass `nextCursor` back unchanged; an invalid cursor returns `400 invalid_cursor` rather than silently restarting at the first page. Defaults and bounds live in [`packages/protocol/src/history.ts`](../packages/protocol/src/history.ts). Finish timestamps are stored at millisecond precision, matching the JavaScript date carried by the cursor, while the game UUID breaks same-millisecond ties.

Profiles and game pages are separate requests because profile aggregates are cheap while each history row requires replaying a game. Keep that boundary when adding fields.

## Limits and errors

Directory, profile, history, and replay reads use four independent per-address token-bucket stores. They also remain separate from WebSocket command limits, so one surface cannot exhaust another's budget. The history budget is tighter because a page materializes several replays. Authentication is checked before a directory request spends its read budget.

Client-address accuracy depends on the trusted-proxy configuration described in [dev.md](./dev.md#development-proxy-and-ports). A limited response is `429` with `Retry-After`.

Errors use `{ code, message }`. Each surface has a closed code union in its shared schema; unexpected failures are logged and returned as a generic `internal_error`, never Fastify internals or client input.
