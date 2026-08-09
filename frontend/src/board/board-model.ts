import {
  applyMove,
  BOARD_SIZE,
  cellAt,
  EMPTY,
  formatSquare,
  legalMoves,
  playerBreakdown,
  sideToMove,
  squareIndex,
  type Board,
  type Player,
  type Run,
  type Square,
} from "@poe2/rules";

export const RANKS: readonly number[] = Array.from(
  { length: BOARD_SIZE },
  (_unused, index) => BOARD_SIZE - 1 - index,
);

export const FILES: readonly number[] = Array.from({ length: BOARD_SIZE }, (_unused, i) => i);

export const BOARD_VIEWBOX = 700;

export const CELL_SPAN = BOARD_VIEWBOX / BOARD_SIZE;

export interface BandGeometry {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export function squareCentre(square: Square): { readonly x: number; readonly y: number } {
  return {
    x: square.col * CELL_SPAN + CELL_SPAN / 2,
    y: (BOARD_SIZE - 1 - square.row) * CELL_SPAN + CELL_SPAN / 2,
  };
}

/** Run squares are ordered and collinear, so endpoints define the band. */
export function runBand(run: Run): BandGeometry {
  const first = run.squares.at(0);
  const last = run.squares.at(-1);

  if (first === undefined || last === undefined) {
    throw new RangeError("a run always holds at least two squares");
  }

  const start = squareCentre(first);
  const end = squareCentre(last);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

export function runKey(run: Run): string {
  const first = run.squares.at(0);
  return `${run.player}-${run.direction}-${first === undefined ? "" : formatSquare(first)}`;
}

export interface RunMark {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

/** Label only a few high-value runs to avoid clutter on dense boards. */
export const MARK_LIMIT = 3;
export const MARK_MIN_VALUE = 8;

export function topRunMarks(runs: readonly Run[]): readonly RunMark[] {
  return [...runs]
    .filter((run) => run.value >= MARK_MIN_VALUE)
    .sort((a, b) => b.value - a.value)
    .slice(0, MARK_LIMIT)
    .map((run) => runMark(run, runKey(run)));
}

/** Places a value between counters, shifting odd-length runs off their midpoint. */
export function runMark(run: Run, key: string): RunMark {
  const band = runBand(run);
  const span = Math.hypot(band.x2 - band.x1, band.y2 - band.y1);
  const unitX = span === 0 ? 0 : (band.x2 - band.x1) / span;
  const unitY = span === 0 ? 0 : (band.y2 - band.y1) / span;
  const slide = run.length % 2 === 0 ? 0 : CELL_SPAN / 2;

  return {
    key,
    x: (band.x1 + band.x2) / 2 + unitX * slide,
    y: (band.y1 + band.y2) / 2 + unitY * slide,
    value: run.value,
  };
}

export interface BoardRuns {
  readonly runs: readonly Run[];
  readonly singletons: ReadonlySet<number>;
}

export function boardRuns(board: Board): BoardRuns {
  const one = playerBreakdown(board, 1);
  const two = playerBreakdown(board, 2);
  const singletons = new Set<number>();

  for (const square of [...one.singletons, ...two.singletons]) {
    singletons.add(squareIndex(square));
  }

  return { runs: [...one.runs, ...two.runs], singletons };
}

/** Score gain for each legal move, keyed by board index. */
export function gainsForSideToMove(
  board: Board,
  moves: readonly Square[],
): ReadonlyMap<number, number> {
  const game = { board, moves };
  const player = sideToMove(game);
  const before = playerBreakdown(board, player).total;
  const gains = new Map<number, number>();

  for (const square of legalMoves(game)) {
    const result = applyMove(game, square);
    if (result.accepted) {
      gains.set(squareIndex(square), playerBreakdown(result.game.board, player).total - before);
    }
  }

  return gains;
}

export function isEmptyCell(board: Board, square: Square): boolean {
  return cellAt(board, square) === EMPTY;
}

export function pieceAt(board: Board, square: Square): Player | null {
  const cell = cellAt(board, square);
  return cell === EMPTY ? null : cell;
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.row === b.row && a.col === b.col;
}
