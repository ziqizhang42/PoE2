import { useMemo } from "react";

import type { GameSnapshot } from "@poe2/protocol";
import { formatSquare, squareIndex, type Player, type Square } from "@poe2/rules";

import { BoardFrame } from "../../board/board-frame.tsx";
import {
  boardRuns,
  FILES,
  gainsForSideToMove,
  pieceAt,
  RANKS,
  sameSquare,
  topRunMarks,
} from "../../board/board-model.ts";
import { Counter } from "../../board/counter.tsx";
import { RunBands, RunMarks } from "../../board/run-bands.tsx";
import { useBoardMarks } from "../board-marks/board-marks-context.ts";
import { marksFor } from "../board-marks/board-marks.ts";
import type { MoveGate } from "./game-state.ts";
import { useBoardFocus } from "./use-board-focus.ts";

type BoardProps = {
  game: GameSnapshot;
  seat: Player;
  gate: MoveGate;
  pendingSquare: Square | null;
  onPlay: (square: Square) => void;
};

const NO_GAINS: ReadonlyMap<number, number> = new Map();
const NO_MARKS: readonly never[] = [];

/** Interactive 7x7 grid with roving focus and non-authoritative pending outlines. */
export function Board({ game, seat, gate, pendingSquare, onPlay }: BoardProps) {
  const board = game.board;
  const lastMove = game.moves.at(-1) ?? null;
  const focus = useBoardFocus(lastMove ?? { row: 3, col: 3 });

  const { runs, singletons } = useMemo(() => boardRuns(board), [board]);

  // Rated games suppress optional board aids for every player.
  const drawn = marksFor(useBoardMarks().chosen, game.rated);
  const marks = useMemo(
    () => (drawn.runValues ? topRunMarks(runs) : NO_MARKS),
    [drawn.runValues, runs],
  );

  // Keep gains visible during a transient disconnect on the viewer's turn.
  const yourTurn = game.status === "active" && game.sideToMove === seat;
  const gains = useMemo(
    () => (yourTurn && drawn.squareGains ? gainsForSideToMove(board, game.moves) : NO_GAINS),
    [yourTurn, drawn.squareGains, board, game.moves],
  );

  return (
    <BoardFrame
      labelled
      sizeClass="max-w-[560px]"
      overlay={
        <>
          <RunBands runs={runs} />
          <RunMarks marks={marks} />
        </>
      }
    >
      <div
        role="grid"
        aria-label={`Game board, 7 by 7. ${game.moves.length} of 49 squares played.`}
        aria-readonly={!gate.allowed}
        ref={focus.gridRef}
        onKeyDown={focus.onKeyDown}
        onFocus={focus.onFocus}
        className="absolute inset-[5px] grid grid-rows-7"
      >
        {RANKS.map((row) => (
          <div key={row} role="row" className="grid grid-cols-7">
            {FILES.map((col) => {
              const square = { row, col };
              const notation = formatSquare(square);
              const piece = pieceAt(board, square);
              const index = squareIndex(square);
              // Authoritative occupancy supersedes an outstanding local outline.
              const isPending =
                piece === null && pendingSquare !== null && sameSquare(pendingSquare, square);
              const playable = gate.allowed && piece === null && !isPending;
              const gain = gains.get(index);

              return (
                <button
                  key={notation}
                  type="button"
                  role="gridcell"
                  data-square={notation}
                  tabIndex={focus.isAnchor(square) ? 0 : -1}
                  aria-disabled={!playable}
                  aria-label={squareLabel({
                    notation,
                    piece,
                    seat,
                    isLastMove: lastMove !== null && sameSquare(lastMove, square),
                    isPending,
                    ...(gain === undefined ? {} : { gain }),
                  })}
                  onClick={() => {
                    if (playable) {
                      onPlay(square);
                    }
                  }}
                  className={`relative flex min-h-0 min-w-0 items-center justify-center ${
                    playable ? "cursor-pointer" : "cursor-default"
                  } focus-visible:z-10`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-[2px] rounded-sm transition-colors ${tileClass(
                      piece !== null,
                      isPending ? seat : null,
                      playable,
                    )}`}
                  />
                  {piece === null ? null : (
                    <Counter
                      player={piece}
                      isSingleton={singletons.has(index)}
                      isLastMove={lastMove !== null && sameSquare(lastMove, square)}
                    />
                  )}
                  {isPending ? (
                    <span
                      aria-hidden="true"
                      className={`num relative z-3 flex aspect-square w-[66%] items-center justify-center rounded-full border-2 border-dashed text-[clamp(9px,1.7vw,13px)] leading-none font-semibold ${
                        seat === 1 ? "border-pen-1 text-pen-1-text" : "border-pen-2 text-pen-2-text"
                      }`}
                    >
                      {seat}
                    </span>
                  ) : null}
                  {piece === null && !isPending && gain !== undefined ? (
                    <span
                      aria-hidden="true"
                      className={`num relative z-3 text-sm ${
                        gain === 1 ? "font-normal text-ink-3" : "font-semibold text-ink-2"
                      }`}
                    >
                      {gain}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </BoardFrame>
  );
}

function tileClass(taken: boolean, pending: Player | null, playable: boolean): string {
  if (pending !== null) {
    return pending === 1 ? "bg-pen-1-soft" : "bg-pen-2-soft";
  }
  if (taken) {
    return "bg-tile-hi";
  }
  return playable ? "bg-tile hover:bg-pen-1-soft" : "bg-tile";
}

type LabelInput = {
  notation: string;
  piece: Player | null;
  seat: Player;
  isLastMove: boolean;
  isPending: boolean;
  gain?: number;
};

function squareLabel({ notation, piece, seat, isLastMove, isPending, gain }: LabelInput): string {
  if (isPending) {
    return `${notation}, your move is being sent`;
  }

  if (piece !== null) {
    const whose = piece === seat ? "yours" : "theirs";
    return `${notation}, player ${piece}, ${whose}${isLastMove ? ", last move" : ""}`;
  }

  if (gain === undefined) {
    return `${notation}, empty`;
  }

  return `${notation}, empty, worth ${gain} ${gain === 1 ? "point" : "points"}`;
}
