/**
 * Turns a persisted game into the wire snapshot clients receive.
 *
 * The board and the scores are never read from storage. They are replayed from
 * the canonical move history through `@poe2/rules` every time, so a snapshot
 * cannot disagree with the rules, and the database cannot hold a position that
 * no legal sequence of moves produces.
 */

import type { GameSnapshot, GameStatus, LobbyEntry } from "@poe2/protocol";
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

export interface StoredGame {
  readonly id: string;
  readonly playerOne: AuthUser;
  readonly playerTwo: AuthUser | null;
  readonly status: GameStatus;
  readonly revision: number;
  /** Canonical history, ordered by ply. */
  readonly moves: readonly Square[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A stored game that could not have been produced by the rules. */
export class CorruptGameError extends Error {
  constructor(gameId: string, detail: string) {
    super(`stored game ${gameId} is inconsistent: ${detail}`);
    this.name = "CorruptGameError";
  }
}

export function isParticipant(game: StoredGame, userId: string): boolean {
  return game.playerOne.id === userId || game.playerTwo?.id === userId;
}

/** Which side `userId` plays, or `null` when they hold no seat. */
export function seatOf(game: StoredGame, userId: string): Player | null {
  if (game.playerOne.id === userId) {
    return PLAYER_ONE;
  }
  return game.playerTwo?.id === userId ? PLAYER_TWO : null;
}

/** The rules-level game a stored move history replays to. */
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
    playerOne: game.playerOne,
    createdAt: game.createdAt.toISOString(),
  };
}

export function toGameSnapshot(game: StoredGame): GameSnapshot {
  const replayed = replayStoredGame(game);
  const scores = scoreBoard(replayed.board);
  const common = {
    id: game.id,
    revision: game.revision,
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
      sideToMove: null,
      result: null,
    };
  }

  const playerTwo = game.playerTwo;
  if (playerTwo === null) {
    throw new CorruptGameError(game.id, `a ${game.status} game has no second player`);
  }

  const players = { playerOne: game.playerOne, playerTwo };
  const result = gameResult(replayed);

  if (game.status === "finished") {
    if (result === null) {
      throw new CorruptGameError(game.id, "a finished game has an unfilled board");
    }

    return { ...common, status: "finished", players, sideToMove: null, result };
  }

  if (result !== null) {
    throw new CorruptGameError(game.id, "an active game has a filled board");
  }

  return { ...common, status: "active", players, sideToMove: sideToMove(replayed), result: null };
}
