/** Replays canonical moves into the derived board and scores sent on the wire. */

import type {
  ActiveGameClock,
  FinishedGameClock,
  GameOutcome,
  GameOutcomeReason,
  GameSnapshot,
  GameStatus,
  LobbyEntry,
  TimeControl,
} from "@poe2/protocol";
import {
  gameResult,
  PLAYER_ONE,
  PLAYER_TWO,
  replay,
  scoreBoard,
  sideToMove,
  type Game,
  type Player,
  type Square,
} from "@poe2/rules";
import type { AuthUser } from "@poe2/protocol";

export interface StoredOutcome {
  readonly reason: GameOutcomeReason;
  readonly winner: Player;
  readonly finishedAt: Date;
}

export interface StoredMoveClock {
  readonly ply: number;
  readonly acceptedAt: Date;
  readonly elapsedMs: number;
  readonly incrementAppliedMs: number;
  readonly playerOneRemainingMs: number;
  readonly playerTwoRemainingMs: number;
}

export interface StoredRunningClock {
  readonly state: "running";
  readonly playerOneRemainingMs: number;
  readonly playerTwoRemainingMs: number;
  readonly runningPlayer: Player;
  readonly turnStartedAt: Date;
  readonly deadline: Date;
}

export interface StoredStoppedClock {
  readonly state: "stopped";
  readonly playerOneRemainingMs: number;
  readonly playerTwoRemainingMs: number;
  readonly stoppedAt: Date;
}

export type StoredClock = StoredRunningClock | StoredStoppedClock;

export interface StoredReadyCheck {
  readonly generation: number;
  readonly playerOneReady: boolean;
  readonly playerTwoReady: boolean;
  readonly deadline: Date;
}

export interface StoredGame {
  readonly id: string;
  readonly playerOne: AuthUser;
  readonly playerTwo: AuthUser | null;
  /** Waiting games store the creator in playerOne until a join settles seats. */
  readonly creatorId: string;
  readonly creatorSeat: Player;
  readonly status: GameStatus;
  readonly revision: number;
  readonly rated: boolean;
  readonly timeControl: TimeControl;
  readonly readyCheckGeneration: number;
  readonly readyCheck: StoredReadyCheck | null;
  readonly activatedRevision: number | null;
  readonly clock: StoredClock | null;
  readonly moveClocks: readonly StoredMoveClock[];
  readonly serverNow: Date;
  readonly moves: readonly Square[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly outcome: StoredOutcome | null;
}

export class CorruptGameError extends Error {
  constructor(gameId: string, detail: string) {
    super(`stored game ${gameId} is inconsistent: ${detail}`);
    this.name = "CorruptGameError";
  }
}

export function isParticipant(game: StoredGame, userId: string): boolean {
  return game.playerOne.id === userId || game.playerTwo?.id === userId;
}

/** The participant other than the creator, independent of physical seat. */
export function joinerOf(game: StoredGame): AuthUser | null {
  if (game.playerTwo === null) {
    return null;
  }
  return game.playerOne.id === game.creatorId ? game.playerTwo : game.playerOne;
}

export function seatOf(game: StoredGame, userId: string): Player | null {
  if (game.playerOne.id === userId) {
    return PLAYER_ONE;
  }
  return game.playerTwo?.id === userId ? PLAYER_TWO : null;
}

export function replayStoredGame(game: StoredGame): Game {
  const replayed = replay(game.moves);

  if (!replayed.ok) {
    throw new CorruptGameError(game.id, `move ${replayed.index} is ${replayed.error}`);
  }

  return replayed.game;
}

export function toLobbyEntry(game: StoredGame): LobbyEntry {
  return {
    id: game.id,
    owner: game.playerOne,
    creatorSeat: game.creatorSeat,
    rated: game.rated,
    timeControl: game.timeControl,
    createdAt: game.createdAt.toISOString(),
  };
}

export function toGameSnapshot(game: StoredGame): GameSnapshot {
  const replayed = replayStoredGame(game);
  const scores = scoreBoard(replayed.board);
  const common = {
    id: game.id,
    revision: game.revision,
    rated: game.rated,
    timeControl: game.timeControl,
    board: replayed.board,
    moves: replayed.moves,
    scores,
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };

  if (game.status === "waiting") {
    if (game.playerTwo !== null) {
      throw new CorruptGameError(game.id, "a waiting game has a second player");
    }
    if (replayed.moves.length > 0) {
      throw new CorruptGameError(game.id, "a waiting game has played moves");
    }

    return {
      ...common,
      status: "waiting",
      players: { playerOne: game.playerOne, playerTwo: null },
      creatorSeat: game.creatorSeat,
      sideToMove: null,
      outcome: null,
      clock: null,
      readyCheck: null,
    };
  }

  const playerTwo = game.playerTwo;
  if (playerTwo === null) {
    throw new CorruptGameError(game.id, `a ${game.status} game has no second player`);
  }

  const players = { playerOne: game.playerOne, playerTwo };
  const result = gameResult(replayed);

  if (game.status === "ready_check") {
    const check = game.readyCheck;
    if (check === null) {
      throw new CorruptGameError(game.id, "a ready check has no deadline");
    }
    if (replayed.moves.length > 0) {
      throw new CorruptGameError(game.id, "a game that has not started has played moves");
    }
    if (game.clock !== null) {
      throw new CorruptGameError(game.id, "a game that has not started has a running clock");
    }

    return {
      ...common,
      status: "ready_check",
      players,
      sideToMove: null,
      outcome: null,
      clock: null,
      readyCheck: {
        generation: check.generation,
        playerOneReady: check.playerOneReady,
        playerTwoReady: check.playerTwoReady,
        deadline: check.deadline.toISOString(),
        serverNow: game.serverNow.toISOString(),
      },
    };
  }

  if (game.status === "finished") {
    const stored = game.outcome;

    if (stored === null) {
      throw new CorruptGameError(game.id, "a finished game has no recorded outcome");
    }

    // Only board_full requires the rules replay itself to be finished.
    if (stored.reason === "board_full" && result === null) {
      throw new CorruptGameError(game.id, "a game decided on points has an unfilled board");
    }

    // Historical winners are recorded facts; do not reinterpret them after rule changes.
    return {
      ...common,
      status: "finished",
      players,
      sideToMove: null,
      outcome: toOutcome(stored),
      clock: finishedClock(game),
      readyCheck: null,
    };
  }

  if (result !== null) {
    throw new CorruptGameError(game.id, "an active game has a filled board");
  }

  if (game.outcome !== null) {
    throw new CorruptGameError(game.id, "an unfinished game has a recorded outcome");
  }

  return {
    ...common,
    status: "active",
    players,
    sideToMove: sideToMove(replayed),
    outcome: null,
    clock: activeClock(game),
    readyCheck: null,
  };
}

function activeClock(game: StoredGame): ActiveGameClock | null {
  if (game.timeControl.kind === "untimed") {
    if (game.clock !== null) {
      throw new CorruptGameError(game.id, "an untimed game has clock state");
    }
    return null;
  }

  const clock = game.clock;
  if (clock === null || clock.state !== "running") {
    throw new CorruptGameError(game.id, "an active timed game has no running clock");
  }

  const elapsedMs = Math.max(0, game.serverNow.getTime() - clock.turnStartedAt.getTime());
  const playerOne =
    clock.runningPlayer === PLAYER_ONE
      ? Math.max(0, clock.playerOneRemainingMs - elapsedMs)
      : clock.playerOneRemainingMs;
  const playerTwo =
    clock.runningPlayer === PLAYER_TWO
      ? Math.max(0, clock.playerTwoRemainingMs - elapsedMs)
      : clock.playerTwoRemainingMs;

  return {
    remainingMs: {
      playerOne,
      playerTwo,
    },
    runningPlayer: clock.runningPlayer,
    turnStartedAt: clock.turnStartedAt.toISOString(),
    deadline: clock.deadline.toISOString(),
    serverNow: game.serverNow.toISOString(),
  };
}

function finishedClock(game: StoredGame): FinishedGameClock | null {
  if (game.timeControl.kind === "untimed") {
    if (game.clock !== null || game.moveClocks.length > 0) {
      throw new CorruptGameError(game.id, "an untimed game has clock records");
    }
    return null;
  }

  const clock = game.clock;
  if (clock === null || clock.state !== "stopped") {
    throw new CorruptGameError(game.id, "a finished timed game has no stopped clock");
  }

  return {
    remainingMs: {
      playerOne: clock.playerOneRemainingMs,
      playerTwo: clock.playerTwoRemainingMs,
    },
    stoppedAt: clock.stoppedAt.toISOString(),
  };
}

function toOutcome(stored: StoredOutcome): GameOutcome {
  return {
    reason: stored.reason,
    winner: stored.winner,
    finishedAt: stored.finishedAt.toISOString(),
  };
}
