# Browser WebSocket protocol

Lobbies and live games run over one authenticated WebSocket at `/api/ws`. The game rules it enforces are in [rules.md](./rules.md); the development workflow is in [dev.md](./dev.md).

The schemas are the specification. They live in [packages/protocol/src/game.ts](../packages/protocol/src/game.ts) and [packages/protocol/src/websocket.ts](../packages/protocol/src/websocket.ts), are shared by both ends, and reuse `@poe2/rules` for every board dimension, cell value, player number, and scoring rule rather than restating them.

## Endpoint

```
GET /api/ws
```

Through the Vite dev server the browser connects to `ws://localhost:5173/api/ws`, which is proxied to the backend. See [Vite WebSocket proxy](./dev.md#vite-websocket-proxy).

### Authentication

The upgrade is authenticated **before** it completes, so an unauthorized caller receives an HTTP status and never holds a socket:

| Condition                                             | Response                   |
| ----------------------------------------------------- | -------------------------- |
| `Origin` missing, malformed, or not on the allow-list | `403`                      |
| No session cookie                                     | `401`                      |
| Session cookie expired, logged out, or unknown        | `401`                      |
| An unexpected failure while authenticating            | `500`, with a generic body |
| Otherwise                                             | `101 Switching Protocols`  |

The session cookie is the same one the HTTP auth routes issue. Nothing else identifies the caller: **the client cannot name a user, and no credential or session token ever appears in a message in either direction.**

The `Origin` check matters because a WebSocket upgrade is not subject to the same-origin policy but still sends cookies, so without it any page could open an authenticated socket. `WEBSOCKET_ALLOWED_ORIGINS` holds a comma-separated list of exact origins. There is no wildcard: `*` is rejected outright, and production refuses to start without an explicit list.

The session token captured at handshake is **revalidated before every command**. If the session has since been logged out or expired, the connection is closed with `1008` (policy violation) rather than continuing under the identity the handshake established. A peer that does not answer the close frame within one second has its transport dropped.

### Framing

- **Text JSON frames only.** A binary frame is rejected like any other malformed message.
- **Maximum payload 16 KiB.** `ws` closes the connection itself if a frame exceeds it.
- **Per-message compression is disabled.**
- Commands from one connection are processed strictly in arrival order, one at a time.

### Protocol version

Version **1**, announced in `session.ready` as `protocolVersion`.

## Client messages

Every client message is a strict object — an unrecognized property is a rejection, not something to ignore — and carries a `requestId` that must be a UUID.

| Type           | Extra fields                                                |
| -------------- | ----------------------------------------------------------- |
| `lobby.create` | —                                                           |
| `lobby.join`   | `gameId` (UUID)                                             |
| `lobby.cancel` | `gameId` (UUID)                                             |
| `game.move`    | `gameId` (UUID), `expectedRevision` (integer ≥ 0), `square` |

```json
{
  "type": "game.move",
  "requestId": "0f2b6b2a-3d70-4ad6-b34e-2d34e8f1e0d5",
  "gameId": "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1",
  "expectedRevision": 4,
  "square": { "row": 3, "col": 3 }
}
```

A client never submits a board, a score, a player number, a game status, or a result. It names a game, the revision it believes it is acting on, and a square.

## Server messages

| Type               | Payload                                    |
| ------------------ | ------------------------------------------ |
| `session.ready`    | `protocolVersion`, `user`                  |
| `lobby.snapshot`   | `lobbies`: every waiting lobby             |
| `game.snapshot`    | `game`: one complete game snapshot         |
| `game.closed`      | `gameId`                                   |
| `command.accepted` | `requestId`                                |
| `command.rejected` | `requestId` (or `null`), `code`, `message` |

### Request correlation

`command.accepted` and `command.rejected` are the only replies; they echo the `requestId` of the frame that caused them. Every other server message is an unsolicited state push, not a response, and carries no request ID.

`command.accepted` is final. It is only sent once the change has been committed, so nothing that happens afterwards — a failed snapshot query, a dropped peer — can turn an accepted command into a rejection. A client will never see both for one `requestId`.

`command.rejected` uses `requestId: null` when the offending frame was too malformed to correlate — invalid JSON, a binary frame, a non-object body, or a `requestId` that is not a UUID. When a frame is invalid but still names a valid request UUID, that ID is echoed so the client can settle the right pending command.

### Rejection codes

The code set is closed:

| Code                   | Meaning                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `invalid_message`      | The frame did not match the protocol                                         |
| `game_not_found`       | No such game                                                                 |
| `game_not_waiting`     | The game already has two players, so it cannot be joined or cancelled        |
| `cannot_join_own_game` | The creator tried to take the second seat                                    |
| `not_lobby_owner`      | Only the creator may cancel a lobby                                          |
| `not_a_player`         | The caller holds no seat in that game                                        |
| `not_your_turn`        | Not the caller's turn, or the game has no turn yet because nobody has joined |
| `stale_game`           | `expectedRevision` did not match the stored revision                         |
| `occupied`             | That square already holds a piece                                            |
| `game_over`            | The board is full and the game has finished                                  |
| `internal_error`       | An unexpected failure; the detail is logged, never sent                      |

`message` is a short, safe explanation. It never carries an internal error, a stack trace, or anything echoed back from client input.

## Full snapshots

Every state change is published as a **complete** `game.snapshot` or `lobby.snapshot`. There are no incremental board patches: a client that applies the newest snapshot it received is correct, without replaying anything it missed, and a reconnecting client needs no catch-up protocol.

## Board and result representation

Both come straight from `@poe2/rules`:

- **`board`** is exactly 49 cells in row-major order, indexed `row * 7 + col`. Row 0 is rank 1 and column 0 is file a, so `a1` is `{ row: 0, col: 0 }` and `g7` is `{ row: 6, col: 6 }`. Each cell is `0` (empty), `1`, or `2`.
- **`moves`** is the canonical history in ply order. It is the authoritative state: the server stores only these, and replays them to produce `board` and `scores` on every read.
- **`scores`** are the raw board scores, before Player 2's handicap.
- **`result`** appears only on a finished game. `marginHalfPoints` is Player 1's lead in **half-points** after the handicap, so the comparison stays exact integer arithmetic. It is always odd and therefore never zero, which is why the game cannot be drawn.

## Game revisions

`revision` counts accepted state changes to one game:

- creation starts at `0`
- a join increments it once
- every accepted move increments it once
- a rejected command never changes it

`game.move` must carry the revision the client is acting on as `expectedRevision`. A mismatch is rejected with `stale_game` and nothing is written, so a move computed against a board the server has already replaced can never be applied to a different position.

## Lifecycle

A snapshot's `status` determines which other fields it may hold, and the schema enforces that:

| `status`   | `players.playerTwo` | `sideToMove` | `result` | `moves`  |
| ---------- | ------------------- | ------------ | -------- | -------- |
| `waiting`  | `null`              | `null`       | `null`   | empty    |
| `active`   | present             | `1` or `2`   | `null`   | any      |
| `finished` | present             | `null`       | present  | 49 moves |

The sequence:

1. **On connection** the server sends, in order: `session.ready`, then `lobby.snapshot`, then one `game.snapshot` for each **waiting or active** game the user holds a seat in. Finished games stay stored but are not restored. This order is guaranteed: anything another user's command would push to this connection is held back until the sequence has been sent. If the server cannot assemble that opening state it closes the socket with `1011` rather than leaving a connection that never learned its own state.
2. **`lobby.create`** opens a waiting game with the creator as Player 1. The creator receives `command.accepted` and the waiting `game.snapshot`; every connected user receives a fresh `lobby.snapshot`. Player 1 cannot move yet.
3. **`lobby.join`** by another user takes the second seat, sets the game `active`, and bumps the revision to `1`. Both participants receive the active `game.snapshot`; every connected user receives a fresh `lobby.snapshot`. The creator cannot join their own lobby.
4. **`lobby.cancel`** by the creator withdraws a waiting lobby and removes it. The creator receives `game.closed`; every connected user receives a fresh `lobby.snapshot`. An active game cannot be cancelled this way.
5. **`game.move`** is accepted only from a participant, only from the side matching `sideToMove`, only at the current revision, and only onto an empty square. Both participants receive the revised `game.snapshot`.
6. **The 49th move** fills the board. The game is stored as `finished`, `sideToMove` becomes `null`, and `result` carries the canonical outcome. Further moves are rejected with `game_over`.

Ordering within one accepted command is deterministic: `command.accepted`, then the game messages, then the lobby broadcast.

## What this protocol is, and is not

This is the **browser** protocol. It is one adapter in front of the authoritative game service in [backend/src/game](../backend/src/game), which owns every rule described above and knows nothing about sockets, JSON frames, or HTTP.

Any later participant — an automated player, a matchmaking job — is expected to hold an authorized identity and call that same service directly, or through an adapter of its own. It does not need this protocol, and this protocol carries no field for it: there is nothing here that names an engine, a process, or a non-human player, and nothing here that a future adapter would have to change.

Authority is not a transport concern either. PostgreSQL holds the games; the in-memory connection registry holds sockets and nothing else, so losing it costs open connections and never state.
