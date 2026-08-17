import { useMemo } from "react";

import {
  formatSquare,
  isGameOver,
  sideToMove,
  squareIndex,
  type Game,
  type Square,
} from "@poe2/rules";

import { BoardFrame } from "../../board/board-frame.tsx";
import { candidateRankAt, type CandidatePlacementGroup } from "../../board/engine-candidate.ts";
import { EngineCandidateMarks } from "../../board/engine-candidate-marks.tsx";
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
import { useBoardFocus } from "../../board/use-board-focus.ts";
import { useBoardMarks } from "../board-marks/board-marks-context.ts";

const NO_GAINS: ReadonlyMap<number, number> = new Map();
const NO_MARKS: readonly never[] = [];

export function AnalysisBoard({
  game,
  candidateGroups,
  selectedRank,
  onPlay,
}: {
  readonly game: Game;
  readonly candidateGroups: readonly CandidatePlacementGroup[];
  readonly selectedRank: number;
  readonly onPlay: (square: Square) => void;
}) {
  const player = sideToMove(game);
  const finished = isGameOver(game);
  const lastMove = game.moves.at(-1) ?? null;
  const focus = useBoardFocus(lastMove ?? { row: 3, col: 3 });
  const marks = useBoardMarks().chosen;
  const { runs, singletons } = useMemo(() => boardRuns(game.board), [game.board]);
  const runMarks = useMemo(
    () => (marks.runValues ? topRunMarks(runs) : NO_MARKS),
    [marks.runValues, runs],
  );
  const gains = useMemo(
    () => (marks.squareGains && !finished ? gainsForSideToMove(game.board, game.moves) : NO_GAINS),
    [finished, game.board, game.moves, marks.squareGains],
  );

  return (
    <BoardFrame
      labelled
      sizeClass="max-w-[560px]"
      overlay={
        <>
          <RunBands runs={runs} />
          <RunMarks marks={runMarks} />
          <EngineCandidateMarks
            groups={candidateGroups}
            selectedRank={selectedRank}
            rootPlayer={player}
          />
        </>
      }
    >
      <div
        role="grid"
        aria-label={`Analysis board, 7 by 7. ${String(game.moves.length)} of 49 squares played.${
          finished ? " The board is full." : ` Player ${String(player)} to move.`
        }`}
        aria-readonly={finished}
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
              const piece = pieceAt(game.board, square);
              const playable = !finished && piece === null;
              const isLastMove = lastMove !== null && sameSquare(lastMove, square);
              const candidateRank = candidateRankAt(candidateGroups, square);
              const gain = gains.get(squareIndex(square));

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
                    player,
                    isLastMove,
                    candidateRank,
                    candidateSelected: candidateRank === selectedRank,
                    ...(gain === undefined ? {} : { gain }),
                  })}
                  onClick={(event) => {
                    if (playable) {
                      onPlay(square);
                      // A pointer player can immediately use the page-level
                      // history arrows; keyboard activation keeps grid focus.
                      if (event.detail > 0) {
                        event.currentTarget.blur();
                      }
                    }
                  }}
                  className={`relative flex min-h-0 min-w-0 items-center justify-center ${
                    playable ? "cursor-pointer" : "cursor-default"
                  } focus-visible:z-10`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-[2px] rounded-sm transition-colors ${
                      piece === null
                        ? playable
                          ? "bg-tile hover:bg-pen-1-soft"
                          : "bg-tile"
                        : "bg-tile-hi"
                    }`}
                  />
                  {piece === null ? null : (
                    <Counter
                      player={piece}
                      isSingleton={singletons.has(squareIndex(square))}
                      isLastMove={isLastMove}
                    />
                  )}
                  {piece === null && gain !== undefined ? (
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

function squareLabel({
  notation,
  piece,
  player,
  isLastMove,
  candidateRank,
  candidateSelected,
  gain,
}: {
  readonly notation: string;
  readonly piece: 1 | 2 | null;
  readonly player: 1 | 2;
  readonly isLastMove: boolean;
  readonly candidateRank: number | null;
  readonly candidateSelected: boolean;
  readonly gain?: number;
}): string {
  if (piece !== null) {
    return `${notation}, Player ${String(piece)}${isLastMove ? ", last move" : ""}`;
  }

  const parts = [`${notation}, empty`, `play for Player ${String(player)}`];
  if (gain !== undefined) {
    parts.push(`worth ${String(gain)} ${gain === 1 ? "point" : "points"}`);
  }
  if (candidateRank !== null) {
    parts.push(`engine candidate rank ${String(candidateRank)}`);
    if (candidateSelected) {
      parts.push("selected candidate");
    }
  }
  return parts.join(", ");
}
