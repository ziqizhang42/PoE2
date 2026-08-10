# Browser WebSocket protocol

Lobbies and open games use one authenticated WebSocket at `GET /api/ws`. Finished records use the public HTTP API in [http.md](./http.md).

The shared schemas are the specification. Read [`packages/protocol/src/websocket.ts`](../packages/protocol/src/websocket.ts) for message unions and rejection codes, and [`packages/protocol/src/game.ts`](../packages/protocol/src/game.ts) for snapshots, time controls, clocks, and their validation rules. Both browser and server parse with these schemas.

## Connection

The browser connects through Vite at `ws://localhost:5173/api/ws` in development. The server validates the exact `Origin` allow-list and the session cookie before upgrading. It revalidates the session before every command; an expired or revoked session closes the socket with code `1008`.

Frames are text JSON, limited to 16 KiB, with compression disabled. Commands from one connection execute serially in arrival order. A socket whose bounded queue overflows is closed with `1013` instead of growing an unbounded backlog.

`WS_PROTOCOL_VERSION` is an exact literal in `session.ready`. A client closes with protocol-error code `1002` and requires a reload if any server frame fails schema validation; it never retries an incompatible opening indefinitely.

## Messages

Every client message is a strict object with a UUID `requestId`.

| Client type    | Additional fields                      |
| -------------- | -------------------------------------- |
| `lobby.create` | `rated`, `creatorSeat`, `timeControl`  |
| `lobby.join`   | `gameId`                               |
| `lobby.cancel` | `gameId`                               |
| `game.ready`   | `gameId`, `readyCheckGeneration`       |
| `game.decline` | `gameId`, `readyCheckGeneration`       |
| `game.move`    | `gameId`, `expectedRevision`, `square` |
| `game.resign`  | `gameId`, `expectedRevision`           |

Time-control bounds and precision are exported by the game schema. A timed control stores its durations directly; there is no preset identifier. Rated games must be timed. Ready-check commands carry the stable generation from the snapshot; it changes when a declined or expired lobby is joined again. Repeated `game.ready` confirmations within that generation are idempotent. Moves and resignations act on a position and must carry the revision the client saw.

| Server type        | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `session.ready`    | Confirms identity and protocol version                      |
| `lobby.snapshot`   | Up to the 100 newest waiting lobbies                        |
| `game.snapshot`    | One complete waiting, ready-check, active, or finished game |
| `game.closed`      | Removes a game the user no longer has a seat in             |
| `players.status`   | Complete volatile presence and activity replacement         |
| `players.changed`  | Invalidates the durable HTTP player directory               |
| `session.synced`   | Marks the opening replay complete                           |
| `command.accepted` | Confirms one committed command by `requestId`               |
| `command.rejected` | Rejects by `requestId`, code, and safe message              |

Accepted and rejected messages are command replies. Snapshots and closures are state pushes and are not correlated to a request. A malformed frame uses a null request ID only when no valid UUID can be recovered.

## Opening synchronization

Every connection receives this ordered opening sequence:

1. `session.ready`
2. one `lobby.snapshot`
3. one `game.snapshot` for each waiting, ready-check, or active game in which the user holds a seat
4. one `players.status`
5. `session.synced`

Pushes caused by other users are buffered until the sequence completes. Only `session.synced` makes an omitted game authoritatively absent; `session.ready` arrives before the database reads and is not a completeness marker. If opening state cannot be assembled, the server closes with `1011`.

For an accepted command, acknowledgement is sent only after commit, followed by game messages and then any lobby broadcast. Failure to publish after that point does not turn acceptance into rejection; reconnecting restores committed open state.

## Player presence and activity

`players.status` is a complete replacement containing the union of connected accounts and accounts with current game activity. An omitted account is offline with no activity. A player is online when at least one authenticated WebSocket is open for that account anywhere in the signed-in application; multiple tabs count once. Only the first connection and last disconnection change presence.

Activity comes from authoritative unfinished games, independently of presence:

| Game state                | Directory activity |
| ------------------------- | ------------------ |
| `waiting`                 | `open_room`        |
| `ready_check` or `active` | `in_game`          |

`in_game` wins if an account also owns a waiting room. Disconnecting does not erase activity, so Overall can still describe an offline player's room or game. Replacements follow relevant connection and game-lifecycle commits, including ready-check expiry and game timeout. Reads are serialized so an older replacement cannot overtake a newer one.

`players.changed` carries no data. Registration and every finished rated result emit it so clients invalidate `GET /api/players`; casual results do not change the directory. Protocol version remains 1 because this schema has not been deployed.

## Snapshot model

Snapshots are complete replacements, never patches.

| Status        | Second player | Side to move | Ready check | Outcome | Clock              |
| ------------- | ------------- | ------------ | ----------- | ------- | ------------------ |
| `waiting`     | absent        | none         | none        | none    | none               |
| `ready_check` | present       | none         | present     | none    | none               |
| `active`      | present       | 1 or 2       | none        | none    | running when timed |
| `finished`    | present       | none         | none        | present | stopped when timed |

Canonical state is the ordered move list. The server replays it through `@poe2/rules` to produce the board and raw scores. A client never submits a board, score, turn, status, or outcome.

The outcome stores `reason`, `winner`, and `finishedAt`, but no margin. Board-full games are decided on points; a resignation or timeout may be won by the player who trails on the board, so a stored margin could contradict the recorded winner.

While waiting, the sole occupant is represented in `players.playerOne` even when `creatorSeat` says they will play second. Joining settles the physical seats. Code interpreting a waiting snapshot must use `creatorSeat`, not the temporary field position.

## Lifecycle and authority

- Joining enters a 60-second ready check. No move or clock starts until the second confirmation commits.
- Declining or expiring a ready check releases the joiner and restores the creator's waiting lobby without a result.
- A partial unique index permits only one waiting or ready-check lobby per creator.
- `revision` advances on accepted game state changes. A stale move or resignation is rejected without applying it to a newer position.
- `readyCheck.generation` remains stable while either player confirms. Ready and decline commands from an older cycle are rejected as stale.
- PostgreSQL time sampled under the game-row lock decides clocks. A command is timely only strictly before its deadline.
- An authorized move or resignation received at or after the deadline may commit the timeout first and then reject the attempted action as `game_over`.
- Browser countdowns are presentation only; they never decide readiness or timeout.

The service in [`backend/src/game`](../backend/src/game) owns these transitions without depending on WebSockets. The adapter authenticates, validates, orders, and publishes them.

## Errors and recovery

`WsErrorCode` is a closed union shared with the server's exhaustive rejection map. Consult the source rather than copying the list into another client. Unexpected failures use `internal_error` with no internal detail.

Reconnection replays all open games as complete snapshots. Finished games are not restored over the socket; fetch them from `/api/games/:gameId`.
