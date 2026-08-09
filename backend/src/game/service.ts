/** Transport-neutral decisions using database time sampled under the game lock. */

import {
  READY_CHECK_MS,
  UNTIMED,
  type GameSnapshot,
  type LobbyEntry,
  type TimeControl,
} from "@poe2/protocol";
import {
  applyMove,
  PLAYER_ONE,
  PLAYER_TWO,
  sideToMove,
  type MoveError,
  type Player,
  type Square,
} from "@poe2/rules";

import type {
  AcceptedMoveClock,
  ClockTransition,
  GameChange,
  GameRepository,
} from "./repository.js";
import {
  isParticipant,
  joinerOf,
  replayStoredGame,
  seatOf,
  toGameSnapshot,
  toLobbyEntry,
} from "./snapshot.js";
import type { StoredGame, StoredReadyCheck, StoredRunningClock } from "./snapshot.js";

export type GameErrorCode =
  | "game_not_found"
  | "game_not_waiting"
  | "cannot_join_own_game"
  | "not_lobby_owner"
  | "not_a_player"
  | "game_not_ready_check"
  | "not_your_turn"
  | "stale_game"
  | "occupied"
  | "game_over"
  | "lobby_already_open"
  | "rated_requires_clock"
  | "deadline_capacity"
  | "invalid_square";

export type GameOperationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | {
      readonly ok: false;
      readonly code: GameErrorCode;
      /** A late command may commit the timeout it discovers. */
      readonly committed?: TValue;
    };

export interface CreateGameInput {
  readonly actorId: string;
  readonly rated: boolean;
  readonly timeControl?: TimeControl;
  readonly creatorSeat?: Player;
}

export interface JoinGameInput {
  readonly actorId: string;
  readonly gameId: string;
}

export interface CancelGameInput {
  readonly actorId: string;
  readonly gameId: string;
}

export interface PlayMoveInput {
  readonly actorId: string;
  readonly gameId: string;
  readonly expectedRevision: number;
  readonly square: Square;
}

export interface ResignGameInput {
  readonly actorId: string;
  readonly gameId: string;
  readonly expectedRevision: number;
}

export interface ReadyGameInput {
  readonly actorId: string;
  readonly gameId: string;
  readonly readyCheckGeneration: number;
}

export interface CancelledGame {
  readonly gameId: string;
}

/** A reopened lobby plus the player omitted from its new snapshot. */
export interface AbandonedReadyCheck {
  readonly game: GameSnapshot;
  readonly releasedPlayerId: string;
}

export interface DeadlineReservation {
  commit(gameId: string, deadline: Date, serverNow: Date): void;
  release(): void;
}

export interface GameDeadlineController {
  reserve(): DeadlineReservation | null;
  replace(gameId: string, deadline: Date, serverNow: Date): void;
  remove(gameId: string): void;
}

export type DeadlineProcessingResult =
  | { readonly kind: "absent" }
  | {
      readonly kind: "reschedule";
      readonly gameId: string;
      readonly deadline: Date;
      readonly serverNow: Date;
    }
  | { readonly kind: "finished"; readonly game: GameSnapshot }
  | ({ readonly kind: "abandoned" } & AbandonedReadyCheck);

export interface GameService {
  listWaitingLobbies(): Promise<readonly LobbyEntry[]>;
  listOpenGames(actorId: string): Promise<readonly GameSnapshot[]>;
  createGame(input: CreateGameInput): Promise<GameOperationResult<GameSnapshot>>;
  joinGame(input: JoinGameInput): Promise<GameOperationResult<GameSnapshot>>;
  cancelGame(input: CancelGameInput): Promise<GameOperationResult<CancelledGame>>;
  readyGame(input: ReadyGameInput): Promise<GameOperationResult<GameSnapshot>>;
  declineGame(input: ReadyGameInput): Promise<GameOperationResult<AbandonedReadyCheck>>;
  playMove(input: PlayMoveInput): Promise<GameOperationResult<GameSnapshot>>;
  resignGame(input: ResignGameInput): Promise<GameOperationResult<GameSnapshot>>;
  processDeadline(gameId: string, expectedDeadline: Date): Promise<DeadlineProcessingResult>;
}

const MOVE_ERROR_CODES: Readonly<Record<MoveError, GameErrorCode>> = {
  out_of_bounds: "invalid_square",
  game_over: "game_over",
  occupied: "occupied",
};

interface Rejection {
  readonly ok: false;
  readonly error: GameErrorCode;
  readonly change?: GameChange;
}

type PlayableGame = { readonly ok: true; readonly game: StoredGame } | Rejection;

function rejected(error: GameErrorCode, change?: GameChange): Rejection {
  return change === undefined ? { ok: false, error } : { ok: false, error, change };
}

function requirePlayable(
  game: StoredGame | null,
  actorId: string,
  expectedRevision: number,
  decisionAt: Date,
): PlayableGame {
  if (game === null) {
    return rejected("game_not_found");
  }
  if (!isParticipant(game, actorId)) {
    return rejected("not_a_player");
  }

  // Once time is gone, the authoritative timeout supersedes move validation.
  const late = timeoutChangeIfExpired(game, decisionAt);
  if (late !== null) {
    return rejected("game_over", late);
  }

  if (game.status === "finished") {
    return rejected("game_over");
  }
  if (game.revision !== expectedRevision) {
    return rejected("stale_game");
  }
  if (game.status === "waiting" || game.status === "ready_check") {
    return rejected("not_your_turn");
  }

  return { ok: true, game };
}

type ReadyCheckGame =
  | { readonly ok: true; readonly game: StoredGame; readonly check: StoredReadyCheck }
  | Rejection;

/** Validates a ready action while leaving expiry transitions to the supervisor. */
function requireReadyCheck(
  game: StoredGame | null,
  actorId: string,
  readyCheckGeneration: number,
  decisionAt: Date,
): ReadyCheckGame {
  if (game === null) {
    return rejected("game_not_found");
  }
  if (!isParticipant(game, actorId)) {
    return rejected("not_a_player");
  }
  if (game.status !== "ready_check" || game.readyCheck === null) {
    return rejected("game_not_ready_check");
  }
  if (game.readyCheck.generation !== readyCheckGeneration) {
    return rejected("stale_game");
  }
  if (decisionAt.getTime() >= game.readyCheck.deadline.getTime()) {
    return rejected("game_not_ready_check");
  }

  return { ok: true, game, check: game.readyCheck };
}

const NO_DEADLINES: GameDeadlineController = {
  reserve: () => ({ commit: () => {}, release: () => {} }),
  replace: () => {},
  remove: () => {},
};

export function createGameService(
  repository: GameRepository,
  deadlines: GameDeadlineController = NO_DEADLINES,
): GameService {
  const settleUpdatedGame = (game: StoredGame): GameSnapshot => {
    // A game has either a ready deadline or a move deadline, never both.
    if (game.status === "ready_check" && game.readyCheck !== null) {
      deadlines.replace(game.id, game.readyCheck.deadline, game.serverNow);
    } else if (game.status === "active" && game.clock?.state === "running") {
      deadlines.replace(game.id, game.clock.deadline, game.serverNow);
    } else {
      deadlines.remove(game.id);
    }
    return toGameSnapshot(game);
  };

  return {
    async listWaitingLobbies() {
      return (await repository.listWaitingGames()).map(toLobbyEntry);
    },

    async listOpenGames(actorId) {
      return (await repository.listOpenGamesForUser(actorId)).map(toGameSnapshot);
    },

    async createGame({ actorId, rated, timeControl = UNTIMED, creatorSeat = PLAYER_ONE }) {
      // Direct callers still need the invariant enforced below the wire schema.
      if (rated && timeControl.kind === "untimed") {
        return { ok: false, code: "rated_requires_clock" };
      }

      const created = await repository.createWaitingGame(actorId, rated, timeControl, creatorSeat);
      return created.ok
        ? { ok: true, value: toGameSnapshot(created.game) }
        : { ok: false, code: "lobby_already_open" };
    },

    async joinGame({ actorId, gameId }) {
      // Even untimed games reserve capacity while their ready check can expire.
      const reservation: { current: DeadlineReservation | null } = { current: null };

      try {
        const result = await repository.updateGame<GameErrorCode>(gameId, (game, decisionAt) => {
          if (game === null) {
            return rejected("game_not_found");
          }
          if (game.status !== "waiting") {
            return rejected("game_not_waiting");
          }
          if (game.creatorId === actorId) {
            return rejected("cannot_join_own_game");
          }

          reservation.current = deadlines.reserve();
          if (reservation.current === null) {
            return rejected("deadline_capacity");
          }

          return {
            ok: true,
            change: {
              kind: "join",
              playerTwoId: actorId,
              readyDeadline: addMilliseconds(decisionAt, READY_CHECK_MS),
            },
          };
        });

        if (!result.ok) {
          reservation.current?.release();
          return { ok: false, code: result.error };
        }

        const check = result.game.readyCheck;
        if (reservation.current !== null) {
          if (check === null) {
            reservation.current.release();
            throw new Error(`join for ${gameId} committed without a ready check`);
          }
          reservation.current.commit(gameId, check.deadline, result.game.serverNow);
        }

        return { ok: true, value: toGameSnapshot(result.game) };
      } catch (error) {
        reservation.current?.release();
        throw error;
      }
    },

    async readyGame({ actorId, gameId, readyCheckGeneration }) {
      const result = await repository.updateGame<GameErrorCode>(gameId, (game, decisionAt) => {
        const checked = requireReadyCheck(game, actorId, readyCheckGeneration, decisionAt);
        if (!checked.ok) {
          return checked;
        }

        const seat = seatOf(checked.game, actorId);
        if (seat === null) {
          return rejected("not_a_player");
        }

        const check = checked.check;
        const alreadyReady = seat === PLAYER_ONE ? check.playerOneReady : check.playerTwoReady;
        const otherReady = seat === PLAYER_ONE ? check.playerTwoReady : check.playerOneReady;

        // Confirmation is idempotent and does not consume another revision.
        if (alreadyReady) {
          return { ok: true, change: null };
        }

        if (!otherReady) {
          return { ok: true, change: { kind: "ready", seat } };
        }

        return {
          ok: true,
          change: { kind: "start", seat, clock: startingClock(checked.game, decisionAt) },
        };
      });

      return result.ok
        ? { ok: true, value: settleUpdatedGame(result.game) }
        : { ok: false, code: result.error };
    },

    async declineGame({ actorId, gameId, readyCheckGeneration }) {
      const released: { id: string | null } = { id: null };

      const result = await repository.updateGame<GameErrorCode>(gameId, (game, decisionAt) => {
        const checked = requireReadyCheck(game, actorId, readyCheckGeneration, decisionAt);
        if (!checked.ok) {
          return checked;
        }

        // Capture the released player before the reopened snapshot omits them.
        released.id = joinerOf(checked.game)?.id ?? null;
        return { ok: true, change: { kind: "abandon_ready" } };
      });

      if (!result.ok) {
        return { ok: false, code: result.error };
      }
      if (released.id === null) {
        throw new Error(`ready check for ${gameId} was abandoned without a second seat`);
      }

      return {
        ok: true,
        value: { game: settleUpdatedGame(result.game), releasedPlayerId: released.id },
      };
    },

    async cancelGame({ actorId, gameId }) {
      const result = await repository.removeGame<GameErrorCode>(gameId, (game) => {
        if (game === null) {
          return rejected("game_not_found");
        }
        if (game.creatorId !== actorId) {
          return rejected("not_lobby_owner");
        }
        if (game.status !== "waiting") {
          return rejected("game_not_waiting");
        }
        return { ok: true };
      });

      return result.ok ? { ok: true, value: { gameId } } : { ok: false, code: result.error };
    },

    async playMove({ actorId, gameId, expectedRevision, square }) {
      const result = await repository.updateGame<GameErrorCode>(gameId, (stored, decisionAt) => {
        const checked = requirePlayable(stored, actorId, expectedRevision, decisionAt);
        if (!checked.ok) {
          return checked;
        }

        const game = replayStoredGame(checked.game);
        if (seatOf(checked.game, actorId) !== sideToMove(game)) {
          return rejected("not_your_turn");
        }

        const applied = applyMove(game, square);
        if (!applied.accepted) {
          return rejected(MOVE_ERROR_CODES[applied.error]);
        }

        const finish =
          applied.result === null
            ? null
            : ({ reason: "board_full", winner: applied.result.winner } as const);

        return {
          ok: true,
          change: {
            kind: "move",
            ply: game.moves.length,
            square,
            finished: finish,
            clock: acceptedMoveClock(checked.game, decisionAt, finish !== null),
          },
        };
      });

      if (!result.ok) {
        if (result.committedGame === undefined) {
          return { ok: false, code: result.error };
        }
        return {
          ok: false,
          code: result.error,
          committed: settleUpdatedGame(result.committedGame),
        };
      }

      return { ok: true, value: settleUpdatedGame(result.game) };
    },

    async resignGame({ actorId, gameId, expectedRevision }) {
      const result = await repository.updateGame<GameErrorCode>(gameId, (stored, decisionAt) => {
        const checked = requirePlayable(stored, actorId, expectedRevision, decisionAt);
        if (!checked.ok) {
          return checked;
        }

        const seat = seatOf(checked.game, actorId);
        if (seat === null) {
          return rejected("not_a_player");
        }

        return {
          ok: true,
          change: {
            kind: "resign",
            finished: {
              reason: "resignation",
              winner: opponent(seat),
            },
            clock: resignationClock(checked.game, decisionAt),
          },
        };
      });

      if (!result.ok) {
        if (result.committedGame === undefined) {
          return { ok: false, code: result.error };
        }
        return {
          ok: false,
          code: result.error,
          committed: settleUpdatedGame(result.committedGame),
        };
      }

      return { ok: true, value: settleUpdatedGame(result.game) };
    },

    async processDeadline(gameId, expectedDeadline) {
      const released: { id: string | null } = { id: null };

      const result = await repository.updateGame<"absent">(gameId, (game, decisionAt) => {
        if (game === null) {
          return { ok: false, error: "absent" };
        }

        if (game.status === "ready_check" && game.readyCheck !== null) {
          if (game.readyCheck.deadline.getTime() !== expectedDeadline.getTime()) {
            return { ok: true, change: null };
          }
          if (decisionAt.getTime() < game.readyCheck.deadline.getTime()) {
            return { ok: true, change: null };
          }
          released.id = joinerOf(game)?.id ?? null;
          return { ok: true, change: { kind: "abandon_ready" } };
        }

        if (game.status !== "active" || game.clock?.state !== "running") {
          return { ok: true, change: null };
        }

        if (game.clock.deadline.getTime() !== expectedDeadline.getTime()) {
          return { ok: true, change: null };
        }

        const change = timeoutChangeIfExpired(game, decisionAt);
        return { ok: true, change };
      });

      if (!result.ok) {
        return { kind: "absent" };
      }

      const game = result.game;
      // The scheduler publishes this autonomous state change.
      if (result.changed && game.status === "waiting" && released.id !== null) {
        return { kind: "abandoned", game: toGameSnapshot(game), releasedPlayerId: released.id };
      }

      if (game.status === "ready_check" && game.readyCheck !== null) {
        return {
          kind: "reschedule",
          gameId,
          deadline: game.readyCheck.deadline,
          serverNow: game.serverNow,
        };
      }

      if (result.changed && game.status === "finished") {
        // The caller removes the deadline only after consuming this result.
        return { kind: "finished", game: toGameSnapshot(game) };
      }

      if (game.status === "active" && game.clock?.state === "running") {
        return {
          kind: "reschedule",
          gameId,
          deadline: game.clock.deadline,
          serverNow: game.serverNow,
        };
      }

      return { kind: "absent" };
    },
  };
}

/** Starts both balances when the second confirmation commits. */
function startingClock(game: StoredGame, startedAt: Date): ClockTransition | null {
  if (game.timeControl.kind === "untimed") {
    return null;
  }

  const initialMs = game.timeControl.initialMs;
  return {
    playerOneRemainingMs: initialMs,
    playerTwoRemainingMs: initialMs,
    runningPlayer: PLAYER_ONE,
    turnStartedAt: startedAt,
    deadline: addMilliseconds(startedAt, initialMs),
    stoppedAt: null,
  };
}

function acceptedMoveClock(
  game: StoredGame,
  acceptedAt: Date,
  finishes: boolean,
): AcceptedMoveClock | null {
  if (game.timeControl.kind === "untimed") {
    return null;
  }

  const clock = runningClock(game);
  const elapsedMs = elapsed(clock, acceptedAt);
  const incrementAppliedMs = game.timeControl.incrementMs;
  const balances = chargedBalances(clock, elapsedMs, incrementAppliedMs);

  if (finishes) {
    return {
      ...balances,
      acceptedAt,
      elapsedMs,
      incrementAppliedMs,
      runningPlayer: null,
      turnStartedAt: null,
      deadline: null,
      stoppedAt: acceptedAt,
    };
  }

  const next = opponent(clock.runningPlayer);
  const nextBalance =
    next === PLAYER_ONE ? balances.playerOneRemainingMs : balances.playerTwoRemainingMs;
  return {
    ...balances,
    acceptedAt,
    elapsedMs,
    incrementAppliedMs,
    runningPlayer: next,
    turnStartedAt: acceptedAt,
    deadline: addMilliseconds(acceptedAt, nextBalance),
    stoppedAt: null,
  };
}

function resignationClock(game: StoredGame, decisionAt: Date): ClockTransition | null {
  if (game.timeControl.kind === "untimed") {
    return null;
  }

  const clock = runningClock(game);
  return {
    ...chargedBalances(clock, elapsed(clock, decisionAt), 0),
    runningPlayer: null,
    turnStartedAt: null,
    deadline: null,
    stoppedAt: decisionAt,
  };
}

function timeoutChangeIfExpired(game: StoredGame, decisionAt: Date): GameChange | null {
  if (game.status !== "active" || game.timeControl.kind === "untimed") {
    return null;
  }

  const clock = runningClock(game);
  if (decisionAt.getTime() < clock.deadline.getTime()) {
    return null;
  }

  const playerOneRemainingMs = clock.runningPlayer === PLAYER_ONE ? 0 : clock.playerOneRemainingMs;
  const playerTwoRemainingMs = clock.runningPlayer === PLAYER_TWO ? 0 : clock.playerTwoRemainingMs;

  return {
    kind: "timeout",
    finished: { reason: "timeout", winner: opponent(clock.runningPlayer) },
    clock: {
      playerOneRemainingMs,
      playerTwoRemainingMs,
      runningPlayer: null,
      turnStartedAt: null,
      deadline: null,
      stoppedAt: clock.deadline,
    },
  };
}

function runningClock(game: StoredGame): StoredRunningClock {
  if (game.clock?.state !== "running") {
    throw new Error(`active timed game ${game.id} has no running clock`);
  }
  return game.clock;
}

function elapsed(clock: StoredRunningClock, decisionAt: Date): number {
  return Math.max(0, decisionAt.getTime() - clock.turnStartedAt.getTime());
}

function chargedBalances(
  clock: StoredRunningClock,
  elapsedMs: number,
  incrementMs: number,
): { readonly playerOneRemainingMs: number; readonly playerTwoRemainingMs: number } {
  return clock.runningPlayer === PLAYER_ONE
    ? {
        playerOneRemainingMs: clock.playerOneRemainingMs - elapsedMs + incrementMs,
        playerTwoRemainingMs: clock.playerTwoRemainingMs,
      }
    : {
        playerOneRemainingMs: clock.playerOneRemainingMs,
        playerTwoRemainingMs: clock.playerTwoRemainingMs - elapsedMs + incrementMs,
      };
}

function opponent(player: Player): Player {
  return player === PLAYER_ONE ? PLAYER_TWO : PLAYER_ONE;
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
