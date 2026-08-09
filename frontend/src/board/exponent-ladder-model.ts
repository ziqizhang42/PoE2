/** Groups each player's scored runs by value. */

import { lineScore, MAX_LINE_LENGTH, playerBreakdown, type Board, type Player } from "@poe2/rules";

export const RUNG_LENGTHS: readonly number[] = Array.from(
  { length: MAX_LINE_LENGTH },
  (_unused, index) => MAX_LINE_LENGTH - index,
);

const SINGLETON_LENGTH = 1;

export interface RungSide {
  readonly count: number;
  readonly points: number;
}

export interface LadderRung {
  readonly value: number;
  readonly length: number;
  readonly playerOne: RungSide;
  readonly playerTwo: RungSide;
}

export interface ExponentLadder {
  readonly rungs: readonly LadderRung[];
  /** Scale bars by points, not run count. */
  readonly peakPoints: number;
  readonly totalRuns: number;
}

export function exponentLadder(board: Board): ExponentLadder {
  const one = playerBreakdown(board, 1);
  const two = playerBreakdown(board, 2);

  const rungs = RUNG_LENGTHS.map((length) => ({
    value: lineScore(length),
    length,
    playerOne: side(length, one),
    playerTwo: side(length, two),
  }));

  return {
    rungs,
    peakPoints: Math.max(
      0,
      ...rungs.flatMap((rung) => [rung.playerOne.points, rung.playerTwo.points]),
    ),
    totalRuns: one.runs.length + two.runs.length,
  };
}

type Breakdown = ReturnType<typeof playerBreakdown>;

function side(length: number, breakdown: Breakdown): RungSide {
  // Singletons occupy the one-point rung even though they are not runs.
  const count =
    length === SINGLETON_LENGTH
      ? breakdown.singletons.length
      : breakdown.runs.filter((run) => run.length === length).length;

  return { count, points: count * lineScore(length) };
}

export function rungBarPercent(points: number, peakPoints: number): number {
  if (points === 0 || peakPoints === 0) {
    return 0;
  }
  return Math.max(5, (points / peakPoints) * 100);
}

export function playerSide(rung: LadderRung, player: Player): RungSide {
  return player === 1 ? rung.playerOne : rung.playerTwo;
}
