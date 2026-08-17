import { formatSquare, PLAYER_ONE, PLAYER_TWO, squareIndex } from "@poe2/rules";

import { BoardFrame } from "./board-frame.tsx";
import { FILES, pieceAt, RANKS, sameSquare, topRunMarks } from "./board-model.ts";
import { Counter } from "./counter.tsx";
import { EngineCandidateMarks } from "./engine-candidate-marks.tsx";
import type { CandidatePlacementGroup } from "./engine-candidate.ts";
import { RunBands, RunMarks } from "./run-bands.tsx";
import type { ReplayFrame } from "./replay-script.ts";

/** Read-only replay position exposed as one labeled image, not an interactive grid. */
export function ReplayBoard({
  frame,
  showRunValues,
  candidateGroups = [],
  selectedRank = 1,
}: {
  readonly frame: ReplayFrame;
  readonly showRunValues: boolean;
  readonly candidateGroups?: readonly CandidatePlacementGroup[];
  readonly selectedRank?: number;
}) {
  const lastMove = frame.moves.at(-1) ?? null;
  const marks = showRunValues ? topRunMarks(frame.runs.runs) : [];
  const rootPlayer = frame.ply % 2 === 0 ? PLAYER_ONE : PLAYER_TWO;

  const positionLabel =
    lastMove === null
      ? "The board before the first move."
      : `The board after ply ${String(frame.ply)}, ${formatSquare(lastMove)}. Player 1 has ${String(frame.scores.playerOne)}, Player 2 has ${String(frame.scores.playerTwo)} before the handicap.`;
  const label = `${positionLabel}${
    candidateGroups.length === 0
      ? ""
      : ` Engine candidate markers are shown, with line ${String(selectedRank)} selected.`
  }`;

  return (
    <div role="img" aria-label={label}>
      <BoardFrame
        labelled
        sizeClass="max-w-[520px]"
        overlay={
          <>
            <RunBands runs={frame.runs.runs} />
            <RunMarks marks={marks} />
            <EngineCandidateMarks
              groups={candidateGroups}
              selectedRank={selectedRank}
              rootPlayer={rootPlayer}
            />
          </>
        }
      >
        <div className="absolute inset-[5px] grid grid-rows-7">
          {RANKS.map((row) => (
            <div key={row} className="grid grid-cols-7">
              {FILES.map((col) => {
                const square = { row, col };
                const piece = pieceAt(frame.board, square);

                return (
                  <div
                    key={formatSquare(square)}
                    className="relative flex min-h-0 min-w-0 items-center justify-center"
                  >
                    <span
                      className={`absolute inset-[2px] rounded-sm ${
                        piece === null ? "bg-tile" : "bg-tile-hi"
                      }`}
                    />
                    {piece === null ? null : (
                      <Counter
                        player={piece}
                        isSingleton={frame.runs.singletons.has(squareIndex(square))}
                        isLastMove={lastMove !== null && sameSquare(lastMove, square)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </BoardFrame>
    </div>
  );
}
