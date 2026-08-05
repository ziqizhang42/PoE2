/**
 * The authoritative game service.
 *
 * It knows nothing about sockets, JSON frames, or HTTP. Every operation takes
 * the identity of an already-authenticated actor and returns a typed result, so
 * the browser WebSocket adapter and any later adapter - a matchmaking job, an
 * automated player holding a seat - drive exactly the same rules through the
 * same entry points.
 *
 * Clients never supply a board, a score, a player number, a status, or a
 * result. They name a game, the revision they believe they are acting on, and a
 * square; everything else is derived here from the canonical move history.
 */

import type { GameSnapshot, LobbyEntry } from "@poe2/protocol";
import { applyMove, sideToMove, type MoveError, type Square } from "@poe2/rules";

import type { GameRepository } from "./repository.js";
import {
  isParticipant,
  replayStoredGame,
  seatOf,
  toGameSnapshot,
  toLobbyEntry,
} from "./snapshot.js";
import type { StoredGame } from "./snapshot.js";

/**
 * Domain rejections. These are transport-independent: an adapter maps them onto
 * whatever its own protocol says, and `invalid_square` only ever reaches an
 * adapter that did not bound-check coordinates for itself.
 */
export type GameErrorCode =
  | "game_not_found"
  | "game_not_waiting"
  | "cannot_join_own_game"
  | "not_lobby_owner"
  | "not_a_player"
  | "not_your_turn"
  | "stale_game"
  | "occupied"
  | "game_over"
  | "invalid_square";

export type GameOperationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly code: GameErrorCode };

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

export interface CancelledGame {
  readonly gameId: string;
}

export interface GameService {
  listWaitingLobbies(): Promise<readonly LobbyEntry[]>;
  listOpenGames(actorId: string): Promise<readonly GameSnapshot[]>;
  createGame(actorId: string): Promise<GameOperationResult<GameSnapshot>>;
  joinGame(input: JoinGameInput): Promise<GameOperationResult<GameSnapshot>>;
  cancelGame(input: CancelGameInput): Promise<GameOperationResult<CancelledGame>>;
  playMove(input: PlayMoveInput): Promise<GameOperationResult<GameSnapshot>>;
}

const MOVE_ERROR_CODES: Readonly<Record<MoveError, GameErrorCode>> = {
  out_of_bounds: "invalid_square",
  game_over: "game_over",
  occupied: "occupied",
};

interface Rejection {
  readonly ok: false;
  readonly error: GameErrorCode;
}

type PlayableGame = { readonly ok: true; readonly game: StoredGame } | Rejection;

function rejected(error: GameErrorCode): Rejection {
  return { ok: false, error };
}

/**
 * Everything a move needs settled before the rules are consulted.
 *
 * Authorization comes before the revision comparison, so a stranger cannot
 * learn a game's revision by guessing its ID.
 */
function requirePlayable(
  game: StoredGame | null,
  actorId: string,
  expectedRevision: number,
): PlayableGame {
  if (game === null) {
    return rejected("game_not_found");
  }
  if (!isParticipant(game, actorId)) {
    return rejected("not_a_player");
  }
  if (game.revision !== expectedRevision) {
    return rejected("stale_game");
  }
  if (game.status === "finished") {
    return rejected("game_over");
  }
  // Player 1 holds a seat from the start but has no turn until someone takes
  // the other one.
  if (game.status === "waiting") {
    return rejected("not_your_turn");
  }

  return { ok: true, game };
}

export function createGameService(repository: GameRepository): GameService {
  return {
    async listWaitingLobbies() {
      const waiting = await repository.listWaitingGames();
      return waiting.map(toLobbyEntry);
    },

    async listOpenGames(actorId) {
      const open = await repository.listOpenGamesForUser(actorId);
      return open.map(toGameSnapshot);
    },

    async createGame(actorId) {
      const created = await repository.createWaitingGame(actorId);
      return { ok: true, value: toGameSnapshot(created) };
    },

    async joinGame({ actorId, gameId }) {
      const result = await repository.updateGame<GameErrorCode>(gameId, (game) => {
        if (game === null) {
          return rejected("game_not_found");
        }
        if (game.status !== "waiting") {
          return rejected("game_not_waiting");
        }
        if (game.playerOne.id === actorId) {
          return rejected("cannot_join_own_game");
        }

        return { ok: true, change: { kind: "join", playerTwoId: actorId } };
      });

      return result.ok
        ? { ok: true, value: toGameSnapshot(result.game) }
        : { ok: false, code: result.error };
    },

    async cancelGame({ actorId, gameId }) {
      const result = await repository.removeGame<GameErrorCode>(gameId, (game) => {
        if (game === null) {
          return rejected("game_not_found");
        }
        if (game.playerOne.id !== actorId) {
          return rejected("not_lobby_owner");
        }
        // Cancelling is a lobby operation; a live game is not withdrawn from
        // under its opponent.
        if (game.status !== "waiting") {
          return rejected("game_not_waiting");
        }

        return { ok: true };
      });

      return result.ok ? { ok: true, value: { gameId } } : { ok: false, code: result.error };
    },

    async playMove({ actorId, gameId, expectedRevision, square }) {
      const result = await repository.updateGame<GameErrorCode>(gameId, (playable) => {
        const checked = requirePlayable(playable, actorId, expectedRevision);
        if (!checked.ok) {
          return checked;
        }

        const stored = checked.game;
        const game = replayStoredGame(stored);
        if (seatOf(stored, actorId) !== sideToMove(game)) {
          return rejected("not_your_turn");
        }

        const applied = applyMove(game, square);
        if (!applied.accepted) {
          return rejected(MOVE_ERROR_CODES[applied.error]);
        }

        return {
          ok: true,
          change: {
            kind: "move",
            ply: game.moves.length,
            square,
            finished: applied.result !== null,
          },
        };
      });

      return result.ok
        ? { ok: true, value: toGameSnapshot(result.game) }
        : { ok: false, code: result.error };
    },
  };
}
