/**
 * Precomputes record-only playback frames. Live games must continue to render
 * the authoritative snapshot board, never a locally rebuilt frame.
 */

import {
  applyMove,
  createGame,
  scoreBoard,
  type Board,
  type ScoreByPlayer,
  type Square,
} from "@poe2/rules";

import { boardRuns, type BoardRuns } from "./board-model.ts";
import { leadAt, progression, type LeadPoint, type Progression } from "./progression.ts";

export interface ReplayFrame {
  readonly ply: number;
  readonly board: Board;
  readonly moves: readonly Square[];
  readonly runs: BoardRuns;
  readonly lead: LeadPoint;
  readonly scores: ScoreByPlayer;
}

export interface ReplayScript {
  readonly frames: readonly [ReplayFrame, ...ReplayFrame[]];
  readonly progression: Progression;
}

export function replayScript(moves: readonly Square[]): ReplayScript {
  let game = createGame();
  const frames: [ReplayFrame, ...ReplayFrame[]] = [frameOf(game.board, [], 0)];

  for (const [index, square] of moves.entries()) {
    const applied = applyMove(game, square);
    if (!applied.accepted) {
      throw new RangeError(`move ${index} is not legal`);
    }
    game = applied.game;
    frames.push(frameOf(game.board, game.moves, index + 1));
  }

  return { frames, progression: progression(moves) };
}

export function frameAt(script: ReplayScript, ply: number): ReplayFrame {
  const frame = script.frames[ply];
  if (frame === undefined) {
    throw new RangeError(`ply ${ply} is not in this record`);
  }
  return frame;
}

export function finalPly(script: ReplayScript): number {
  return script.frames.length - 1;
}

function frameOf(board: Board, moves: readonly Square[], ply: number): ReplayFrame {
  return {
    ply,
    board,
    moves,
    runs: boardRuns(board),
    lead: leadAt(board, ply),
    scores: scoreBoard(board),
  };
}
