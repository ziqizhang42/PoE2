import { applyMove, createGame, replay, type Game, type Square } from "@poe2/rules";

export interface AnalysisLine {
  readonly game: Game;
  /** Moves removed by undo, ordered so the first entry is the next redo. */
  readonly future: readonly Square[];
}

/** Creates a line from a history already validated at an input boundary. */
export function analysisLine(moves: readonly Square[] = []): AnalysisLine {
  const rebuilt = replay(moves);
  if (!rebuilt.ok) {
    throw new RangeError(`move ${String(rebuilt.index + 1)} is ${rebuilt.error}`);
  }
  return { game: rebuilt.game, future: [] };
}

/** Extends the current line and abandons any variation that had been undone. */
export function playAnalysisMove(line: AnalysisLine, square: Square): AnalysisLine {
  const result = applyMove(line.game, square);
  return result.accepted ? { game: result.game, future: [] } : line;
}

export function undoAnalysisMove(line: AnalysisLine): AnalysisLine {
  const removed = line.game.moves.at(-1);
  if (removed === undefined) {
    return line;
  }

  const rebuilt = replay(line.game.moves.slice(0, -1));
  if (!rebuilt.ok) {
    throw new RangeError("a legal analysis line could not be rebuilt");
  }

  return { game: rebuilt.game, future: [removed, ...line.future] };
}

export function redoAnalysisMove(line: AnalysisLine): AnalysisLine {
  const next = line.future.at(0);
  if (next === undefined) {
    return line;
  }

  const result = applyMove(line.game, next);
  if (!result.accepted) {
    throw new RangeError("an undone analysis move is no longer legal");
  }

  return { game: result.game, future: line.future.slice(1) };
}

/** Selects one position on the current linear line without creating a variation. */
export function seekAnalysisPly(line: AnalysisLine, target: number): AnalysisLine {
  if (!Number.isFinite(target)) {
    return line;
  }

  const moves = [...line.game.moves, ...line.future];
  const ply = Math.min(Math.max(Math.trunc(target), 0), moves.length);
  if (ply === line.game.moves.length) {
    return line;
  }

  const rebuilt = replay(moves.slice(0, ply));
  if (!rebuilt.ok) {
    throw new RangeError("a legal analysis line could not be rebuilt");
  }

  return { game: rebuilt.game, future: moves.slice(ply) };
}

export function resetAnalysisLine(line: AnalysisLine): AnalysisLine {
  return line.game.moves.length === 0 && line.future.length === 0
    ? line
    : { game: createGame(), future: [] };
}
