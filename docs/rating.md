# Ratings

Rated games use Glicko-2. The implementation, persistence policy, and public display are intentionally separate.

## Product policy

- Rated versus casual is fixed when the lobby is created.
- A rated game must have a clock, enforced by the protocol schema, game service, and database constraint. Untimed games can otherwise remain unresolved indefinitely.
- Each finished rated game is treated as one rating period and applied in finish order. Results are not batched.
- Board completion, resignation, and timeout all use the same rating path.

The model starts from the values in [`backend/src/db/schema.ts`](../backend/src/db/schema.ts) and uses the default system constant in [`rating/glicko2.ts`](../backend/src/rating/glicko2.ts). Keep policy floors and ceilings in [`rating/bounds.ts`](../backend/src/rating/bounds.ts), not in the reference arithmetic.

## Ledger and transactions

`rating_events` is the durable competitive record. A rated game writes one row per player containing the before and after rating, deviation, and volatility. The `(game_id, user_id)` primary key makes retries idempotent.

Rating updates run inside the transaction that finishes the game. Both player rows are locked in ascending user-ID order before either rating is read, avoiding deadlocks between concurrent games. Both new ratings are computed from the two pre-game values. `clock_timestamp()` is sampled after locking so ledger and game history order match the order in which shared-player updates were applied.

The `users` row caches current rating state for fast reads. A duplicate ledger insert must not rewrite that cache because a newer game may already have updated it.

The implementation is in [`backend/src/rating/ledger.ts`](../backend/src/rating/ledger.ts); the repository invokes it through the transaction-scoped finish hook.

## Inactivity

Inactivity leaves the rating estimate unchanged and widens deviation for each whole missed period. `users.rating_period_at` stores the current period boundary. Decay advances it by the exact number of whole periods rather than setting it to the current time, which makes passes idempotent, preserves partial periods, and catches up after downtime.

Each player is re-read under a row lock before decay is written, so a concurrent game result cannot be overwritten. Decay creates no ledger event: no game was played. The configured ceiling keeps a formerly rated player distinct from a new account at the initial deviation. A finishing rated game also applies every period already due under those same player locks before calculating its result; the background sweep therefore affects discovery latency, not correctness.

The worker is split between [`rating/decay.ts`](../backend/src/rating/decay.ts) and [`rating/decay-supervisor.ts`](../backend/src/rating/decay-supervisor.ts). Period, sweep, and batch settings live in [`backend/src/config/rating-decay.ts`](../backend/src/config/rating-decay.ts). The stored boundary is authoritative; the process timer only discovers due work.

## Ladder and public display

Ladder membership is `rated_games_played > 0`, not a deviation threshold. Inactivity can widen deviation back toward its ceiling, so deviation cannot say whether someone has played a rated game. The matching partial rating index uses the same predicate.

Public profiles expose rounded rating, rounded deviation, and a whole percentile among rated players. An account outside that population receives `percentile: null`, not zero. Volatility remains internal.

The authenticated player directory is a separate complete read. It orders accounts by rounded display rating descending and canonical username alphabetically for ties. Rated accounts use their ladder percentile as `colorPercentile`. Unrated accounts always display 1500 and estimate the color from the share of rated accounts below 1500; an empty rated population uses percentile 50. This estimate is presentation only and does not add the account to the ladder.

The aggregate profile fields and rating history are read in one repeatable-read transaction so every field describes the same committed database snapshot.

Profile history reads the newest 100 ledger events, orders them oldest first, and prepends the oldest event's `before` value so the first visible result forms a line. Subject-relative game history exposes before and after values for each rated result. Neither view recomputes ratings from games.

Public and directory query code lives in [`backend/src/player/repository.ts`](../backend/src/player/repository.ts) and [`backend/src/rating/reader.ts`](../backend/src/rating/reader.ts). Registration and rated finishes push `players.changed` so signed-in clients invalidate their cached directory.

## Verification

[`rating/glicko2.test.ts`](../backend/src/rating/glicko2.test.ts) checks the arithmetic against Glickman's published worked example. Unit tests cover policy bounds and decay; integration tests cover transactional application, concurrent finishes, and persisted inactivity updates. Run them with the commands in [dev.md](./dev.md#quality-and-tests).
