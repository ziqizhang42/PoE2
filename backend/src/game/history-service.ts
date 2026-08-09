/** Public read model for finished games; live state never crosses this boundary. */

import type { GameHistoryEntry, GameHistoryPage, GameReplay } from "@poe2/protocol";
import { PLAYER_ONE, replay, scoreBoard, type Player } from "@poe2/rules";

import type { RatingReader } from "../rating/reader.js";
import { encodeHistoryCursor, type HistoryCursor } from "./history-cursor.js";
import type { GameRepository } from "./repository.js";
import { seatOf, type StoredGame } from "./snapshot.js";

export interface HistoryPageInput {
  readonly playerId: string;
  readonly limit: number;
  readonly before: HistoryCursor | null;
}

export interface HistoryService {
  listHistory(input: HistoryPageInput): Promise<GameHistoryPage>;
  findReplay(gameId: string): Promise<GameReplay | null>;
}

export function createHistoryService(
  repository: GameRepository,
  ratings: RatingReader,
): HistoryService {
  return {
    async listHistory({ playerId, limit, before }) {
      // Fetch one extra row to determine whether a next cursor is needed.
      const rows = await repository.listFinishedGamesForUser(playerId, {
        limit: limit + 1,
        before,
      });

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const hasMore = rows.length > limit;

      const changes = await ratings.changesForGames(
        playerId,
        page.filter((game) => game.rated).map((game) => game.id),
      );

      return {
        games: page.map((game) => toHistoryEntry(game, playerId, changes.get(game.id) ?? null)),
        nextCursor:
          hasMore && last?.outcome != null
            ? encodeHistoryCursor({ finishedAt: last.outcome.finishedAt, id: last.id })
            : null,
      };
    },

    async findReplay(gameId) {
      const game = await repository.findGame(gameId);

      // Never expose a live board through the public replay endpoint.
      if (game === null || game.status !== "finished" || game.outcome === null) {
        return null;
      }

      if (game.playerTwo === null) {
        return null;
      }

      return {
        id: game.id,
        players: { playerOne: game.playerOne, playerTwo: game.playerTwo },
        rated: game.rated,
        timeControl: game.timeControl,
        moves: game.moves,
        clockHistory: replayClockHistory(game),
        outcome: {
          reason: game.outcome.reason,
          winner: game.outcome.winner,
          finishedAt: game.outcome.finishedAt.toISOString(),
        },
        createdAt: game.createdAt.toISOString(),
      };
    },
  };
}

function toHistoryEntry(
  game: StoredGame,
  playerId: string,
  ratingChange: GameHistoryEntry["ratingChange"],
): GameHistoryEntry {
  const seat = seatOf(game, playerId);
  const outcome = game.outcome;

  if (seat === null || outcome === null || game.playerTwo === null) {
    throw new Error(`game ${game.id} cannot be summarised for ${playerId}`);
  }

  const replayed = replay(game.moves);
  if (!replayed.ok) {
    throw new Error(`game ${game.id} has an illegal stored move at ${String(replayed.index)}`);
  }

  return {
    id: game.id,
    seat,
    opponent: opponentOf(game, seat),
    rated: game.rated,
    timeControl: game.timeControl,
    outcome: {
      reason: outcome.reason,
      winner: outcome.winner,
      finishedAt: outcome.finishedAt.toISOString(),
    },
    // Derive scores from moves so they cannot drift from the rules.
    scores: scoreBoard(replayed.game.board),
    plies: game.moves.length,
    ratingChange,
    createdAt: game.createdAt.toISOString(),
  };
}

function replayClockHistory(game: StoredGame): GameReplay["clockHistory"] {
  if (game.timeControl.kind === "untimed") {
    return null;
  }

  if (game.clock?.state !== "stopped") {
    throw new Error(`timed replay ${game.id} has no final stopped clock`);
  }
  if (game.moveClocks.length !== game.moves.length) {
    throw new Error(`timed replay ${game.id} has misaligned clock history`);
  }

  return {
    moves: game.moveClocks.map((clock, index) => {
      if (clock.ply !== index) {
        throw new Error(`timed replay ${game.id} has a non-sequential clock record`);
      }
      return {
        ply: clock.ply + 1,
        acceptedAt: clock.acceptedAt.toISOString(),
        elapsedMs: clock.elapsedMs,
        incrementAppliedMs: clock.incrementAppliedMs,
        remainingMs: {
          playerOne: clock.playerOneRemainingMs,
          playerTwo: clock.playerTwoRemainingMs,
        },
      };
    }),
    final: {
      remainingMs: {
        playerOne: game.clock.playerOneRemainingMs,
        playerTwo: game.clock.playerTwoRemainingMs,
      },
      stoppedAt: game.clock.stoppedAt.toISOString(),
    },
  };
}

function opponentOf(game: StoredGame, seat: Player): GameHistoryEntry["opponent"] {
  const opponent = seat === PLAYER_ONE ? game.playerTwo : game.playerOne;

  if (opponent === null) {
    throw new Error(`game ${game.id} has no opponent for seat ${String(seat)}`);
  }

  return opponent;
}
