import type { AuthUser, GameSnapshot } from "@poe2/protocol";
import {
  CELL_COUNT,
  formatSquare,
  marginHalfPoints,
  PLAYER_ONE,
  type Player,
  type ScoreByPlayer,
} from "@poe2/rules";

import type { StatusTone } from "../../ui/status-tone.ts";
import { formatHalfPoints } from "../../board/half-points.ts";
import { describeMargin, isDecidedOnPoints } from "../outcome.ts";

export interface PlayersBySeat {
  readonly playerOne: AuthUser | null;
  readonly playerTwo: AuthUser | null;
}

/** Resolves the waiting snapshot's owner representation into physical seats. */
export function playersBySeat(game: GameSnapshot): PlayersBySeat {
  if (game.status !== "waiting") {
    return game.players;
  }

  return game.creatorSeat === PLAYER_ONE
    ? { playerOne: game.players.playerOne, playerTwo: null }
    : { playerOne: null, playerTwo: game.players.playerOne };
}

export function seatOf(game: GameSnapshot, viewer: AuthUser): Player | null {
  const players = playersBySeat(game);
  if (players.playerOne?.id === viewer.id) {
    return 1;
  }
  if (players.playerTwo?.id === viewer.id) {
    return 2;
  }
  return null;
}

export function opponentOf(game: GameSnapshot, seat: Player): AuthUser | null {
  const players = playersBySeat(game);
  return seat === 1 ? players.playerTwo : players.playerOne;
}

export interface Standing {
  readonly tone: StatusTone;
  readonly title: string;
  readonly detail: string;
}

export function describeStanding(game: GameSnapshot, seat: Player): Standing {
  const opponent = opponentOf(game, seat)?.username ?? "your opponent";

  if (game.status === "waiting") {
    return {
      tone: "wait",
      title: "Waiting for a second player",
      detail:
        game.creatorSeat === PLAYER_ONE
          ? "Nobody has taken the other seat yet. You move first once someone does."
          : "Nobody has taken the other seat yet. You play second, so whoever takes it moves first.",
    };
  }

  if (game.status === "ready_check") {
    const mine = seat === 1 ? game.readyCheck.playerOneReady : game.readyCheck.playerTwoReady;
    const theirs = seat === 1 ? game.readyCheck.playerTwoReady : game.readyCheck.playerOneReady;

    return {
      tone: "wait",
      title: mine ? `Waiting for ${opponent}` : "Both players are here",
      detail: mine
        ? `You have confirmed. The game starts, and the clock with it, as soon as ${opponent} does.`
        : theirs
          ? `${opponent} has confirmed. The game starts, and the clock with it, as soon as you do.`
          : "Nothing has started yet. The game begins once both of you confirm.",
    };
  }

  if (game.status === "active") {
    const ply = game.moves.length + 1;
    const last = game.moves.at(-1);
    const played = last === undefined ? "" : ` ${opponent} played ${formatSquare(last)}.`;

    return game.sideToMove === seat
      ? {
          tone: "info",
          title: "Your turn",
          detail: `Move ${ply} of ${CELL_COUNT}.${played} Choose an empty square.`,
        }
      : {
          tone: "wait",
          title: "Their turn",
          detail: `Move ${ply} of ${CELL_COUNT}. The board updates as soon as ${opponent} plays.`,
        };
  }

  const won = game.outcome.winner === seat;
  const margin = describeMargin(game.outcome, game.scores);

  return {
    tone: won ? "info" : "alarm",
    title: won ? `You won ${margin}` : `You lost ${margin}`,
    detail: isDecidedOnPoints(game.outcome)
      ? `The board is full. ${CELL_COUNT} moves played, and the handicap decided what a full board was worth.`
      : game.outcome.reason === "timeout"
        ? `${won ? `${opponent}'s` : "Your"} clock expired after ${game.moves.length} of ${CELL_COUNT} moves.`
        : `${won ? opponent : "You"} resigned after ${game.moves.length} of ${CELL_COUNT} moves, so the board never decided it.`,
  };
}

export interface MoveGate {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/** Client move gate derived from the latest snapshot; the server remains authoritative. */
export function moveGate(
  game: GameSnapshot,
  seat: Player,
  canCommand: boolean,
  moveInFlight: boolean,
): MoveGate {
  if (game.status === "waiting") {
    return { allowed: false, reason: "Nobody has taken the other seat yet." };
  }
  if (game.status === "ready_check") {
    return { allowed: false, reason: "The game has not started yet." };
  }
  if (game.status === "finished") {
    return { allowed: false, reason: "This game is over." };
  }
  if (!canCommand) {
    return { allowed: false, reason: "Moves are disabled until the live connection is ready." };
  }
  if (game.sideToMove !== seat) {
    return { allowed: false, reason: "It is not your turn." };
  }
  if (moveInFlight) {
    return { allowed: false, reason: "Waiting for the server to confirm your move." };
  }
  return { allowed: true, reason: null };
}

export interface MarginReadout {
  readonly leader: Player;
  readonly lead: string;
  readonly halfPoints: number;
}

export function marginReadout(scores: ScoreByPlayer): MarginReadout {
  const halfPoints = marginHalfPoints(scores);
  return {
    leader: halfPoints > 0 ? 1 : 2,
    lead: formatHalfPoints(halfPoints),
    halfPoints,
  };
}
