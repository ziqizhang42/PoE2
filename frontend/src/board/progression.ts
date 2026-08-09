/** Replays authoritative moves to derive historical lead positions. */

import {
  applyMove,
  createGame,
  leaderAfterHandicap,
  marginHalfPoints,
  scoreBoard,
  type Board,
  type Player,
  type Square,
} from "@poe2/rules";

import { formatHalfPoints } from "./half-points.ts";

export interface LeadPoint {
  readonly ply: number;
  readonly leader: Player;
  /** Player 1's margin; negative means Player 2 leads. */
  readonly marginHalfPoints: number;
}

export function leadAt(board: Board, ply: number): LeadPoint {
  const scores = scoreBoard(board);
  return {
    ply,
    leader: leaderAfterHandicap(scores),
    marginHalfPoints: marginHalfPoints(scores),
  };
}

export interface Progression {
  readonly points: readonly [LeadPoint, ...LeadPoint[]];
  /** Sampled after equal turns, plus the final board, to avoid odd-ply bias. */
  readonly leadChanges: number;
  readonly peakHalfPoints: number;
}

export function progression(moves: readonly Square[]): Progression {
  let game = createGame();
  const points: [LeadPoint, ...LeadPoint[]] = [leadAt(game.board, 0)];

  for (const [index, square] of moves.entries()) {
    const applied = applyMove(game, square);
    if (!applied.accepted) {
      throw new RangeError(`move ${index} is not legal`);
    }
    game = applied.game;
    points.push(leadAt(game.board, index + 1));
  }

  return {
    points,
    leadChanges: countLeadChanges(points),
    peakHalfPoints: Math.max(...points.map((point) => Math.abs(point.marginHalfPoints))),
  };
}

export function pointAt(progression: Progression, ply: number): LeadPoint {
  const point = progression.points[ply];
  if (point === undefined) {
    throw new RangeError(`ply ${ply} is outside this progression`);
  }
  return point;
}

export function lastPly(progression: Progression): number {
  return progression.points.length - 1;
}

function isSampled(ply: number, finalPly: number): boolean {
  return ply % 2 === 0 || ply === finalPly;
}

function countLeadChanges(points: readonly LeadPoint[]): number {
  const finalPly = points.length - 1;
  let changes = 0;
  let previous: Player | null = null;

  for (const point of points) {
    if (!isSampled(point.ply, finalPly)) {
      continue;
    }
    if (previous !== null && point.leader !== previous) {
      changes += 1;
    }
    previous = point.leader;
  }

  return changes;
}

function nameOf(player: Player): string {
  return `Player ${player}`;
}

/** Accessible text equivalent of the visual lead strip. */
export function describeProgression(
  progression: Progression,
  currentPly: number,
  boardFull: boolean,
): string {
  const point = pointAt(progression, currentPly);
  const leader = nameOf(point.leader);
  const lead = formatHalfPoints(point.marginHalfPoints);

  if (currentPly === 0) {
    return `Who leads after each move. No moves played yet, and ${leader} is ahead by ${lead} on the handicap alone.`;
  }

  const standing = boardFull
    ? `${leader} finished ahead by ${lead} with the board full.`
    : `${leader} leads by ${lead} after move ${String(currentPly)}.`;

  return `Who leads after each move. ${standing} ${describeChanges(progression.leadChanges)}`;
}

function describeChanges(changes: number): string {
  if (changes === 0) {
    return "The lead has not changed hands.";
  }
  if (changes === 1) {
    return "The lead has changed hands once.";
  }
  return `The lead has changed hands ${String(changes)} times.`;
}
