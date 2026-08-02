/**
 * Scoring for Powers of Exponent 2.
 *
 * Scores are always recalculated from the board contents. Each maximal
 * contiguous run of length >= 2 is emitted exactly once per direction and
 * scores `2^(length - 1)`. A piece that belongs to no such run in any direction
 * scores one point; a piece in any run never also counts as a singleton.
 *
 * Player 2's handicap is held in half-points so winner comparisons stay exact
 * integer arithmetic and never touch floating point.
 */

import {
  BOARD_SIZE,
  CELL_COUNT,
  cellAt,
  isBoardFull,
  PLAYER_ONE,
  PLAYER_TWO,
  squareFromIndex,
} from "./board.js";
import type { Board, Player, Square } from "./board.js";

export const MAX_LINE_LENGTH = 7;

export function lineScore(length: number): number {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LINE_LENGTH) {
    throw new RangeError(`length must be an integer from 1 through ${MAX_LINE_LENGTH}`);
  }
  return 2 ** (length - 1);
}

/** Player 2's handicap, in half-points. 11 half-points is 5.5 points. */
export const PLAYER_TWO_HANDICAP_HALF_POINTS = 11;

/**
 * The four axes runs are scanned along. Row 0 is rank 1, so an increasing row
 * moves up the board: `{ 1, 1 }` reads as `/` and `{ 1, -1 }` as `\`.
 */
export type RunDirection = "horizontal" | "vertical" | "diagonal-up-right" | "diagonal-up-left";

interface DirectionStep {
  readonly direction: RunDirection;
  readonly rowDelta: number;
  readonly colDelta: number;
}

const DIRECTION_STEPS: readonly DirectionStep[] = [
  { direction: "horizontal", rowDelta: 0, colDelta: 1 },
  { direction: "vertical", rowDelta: 1, colDelta: 0 },
  { direction: "diagonal-up-right", rowDelta: 1, colDelta: 1 },
  { direction: "diagonal-up-left", rowDelta: 1, colDelta: -1 },
];

/** One maximal contiguous run of at least two pieces. */
export interface Run {
  readonly player: Player;
  readonly direction: RunDirection;
  /** Members in scan order, from the end of the run the scan started at. */
  readonly squares: readonly Square[];
  readonly length: number;
  /** `lineScore(length)`. */
  readonly value: number;
}

/** A player's score with the runs and singletons that produced it. */
export interface PlayerScore {
  readonly total: number;
  readonly runTotal: number;
  readonly singletonTotal: number;
  readonly runs: readonly Run[];
  /** Pieces in no run of length >= 2 in any direction, each worth one point. */
  readonly singletons: readonly Square[];
}

export interface ScoreByPlayer {
  readonly playerOne: number;
  readonly playerTwo: number;
}

export interface ScoreBreakdown {
  readonly playerOne: PlayerScore;
  readonly playerTwo: PlayerScore;
}

export interface GameResult {
  /** Raw board scores, before the handicap. Always integers. */
  readonly scores: ScoreByPlayer;
  readonly winner: Player;
  /** Player 1's lead in half-points after the handicap. Always odd, never 0. */
  readonly marginHalfPoints: number;
}

/**
 * Every maximal run of `player` with length >= 2, across all four directions.
 *
 * A square only starts a run when the previous square along that direction is
 * not the same player, so each maximal run is emitted exactly once and no run
 * is ever a subset of another in the same direction.
 */
function findRuns(board: Board, player: Player): readonly Run[] {
  const runs: Run[] = [];

  for (const step of DIRECTION_STEPS) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (cellAt(board, { row, col }) !== player) {
          continue;
        }
        const previous = { row: row - step.rowDelta, col: col - step.colDelta };
        if (cellAt(board, previous) === player) {
          continue;
        }

        const squares: Square[] = [];
        let current = { row, col };
        while (cellAt(board, current) === player) {
          squares.push(current);
          current = { row: current.row + step.rowDelta, col: current.col + step.colDelta };
        }

        if (squares.length >= 2) {
          runs.push({
            player,
            direction: step.direction,
            squares,
            length: squares.length,
            value: lineScore(squares.length),
          });
        }
      }
    }
  }

  return runs;
}

/**
 * A player's full score breakdown.
 *
 * Singletons are only resolved once run membership is known across all four
 * directions, so a piece in a run anywhere is never also counted as a single.
 */
export function playerBreakdown(board: Board, player: Player): PlayerScore {
  const runs = findRuns(board, player);
  const inRun = new Set<number>();
  let runTotal = 0;

  for (const run of runs) {
    runTotal += run.value;
    for (const square of run.squares) {
      inRun.add(square.row * BOARD_SIZE + square.col);
    }
  }

  const singletons: Square[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (board[index] === player && !inRun.has(index)) {
      singletons.push(squareFromIndex(index));
    }
  }

  return {
    total: runTotal + singletons.length,
    runTotal,
    singletonTotal: singletons.length,
    runs,
    singletons,
  };
}

export function scoreBreakdown(board: Board): ScoreBreakdown {
  return {
    playerOne: playerBreakdown(board, PLAYER_ONE),
    playerTwo: playerBreakdown(board, PLAYER_TWO),
  };
}

export function scorePlayer(board: Board, player: Player): number {
  return playerBreakdown(board, player).total;
}

export function scoreBoard(board: Board): ScoreByPlayer {
  return {
    playerOne: scorePlayer(board, PLAYER_ONE),
    playerTwo: scorePlayer(board, PLAYER_TWO),
  };
}

/**
 * Player 1's lead in half-points once Player 2's handicap is applied.
 *
 * Raw scores are integers, so this is an odd number and therefore never zero.
 * That is why the game cannot be drawn.
 */
export function marginHalfPoints(scores: ScoreByPlayer): number {
  return scores.playerOne * 2 - (scores.playerTwo * 2 + PLAYER_TWO_HANDICAP_HALF_POINTS);
}

/** Player 1 wins only with a raw-score lead of at least six points. */
export function leaderAfterHandicap(scores: ScoreByPlayer): Player {
  return marginHalfPoints(scores) > 0 ? PLAYER_ONE : PLAYER_TWO;
}

/** The terminal result, or `null` while the board still has empty squares. */
export function resultIfFull(board: Board): GameResult | null {
  if (!isBoardFull(board)) {
    return null;
  }

  const scores = scoreBoard(board);
  return {
    scores,
    winner: leaderAfterHandicap(scores),
    marginHalfPoints: marginHalfPoints(scores),
  };
}
