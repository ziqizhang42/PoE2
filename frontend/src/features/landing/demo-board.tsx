import { formatSquare, squareIndex } from "@poe2/rules";

import { BoardFrame } from "../../board/board-frame.tsx";
import { FILES, pieceAt, RANKS, sameSquare } from "../../board/board-model.ts";
import { Counter } from "../../board/counter.tsx";
import { RunBands } from "../../board/run-bands.tsx";
import type { ReplayFrame } from "../../board/replay-script.ts";

/** Decorative playback board kept out of the accessibility tree while repainting. */
export function DemoBoard({ frame }: { frame: ReplayFrame }) {
  const lastMove = frame.moves.at(-1) ?? null;

  return (
    <div aria-hidden="true">
      <BoardFrame
        labelled={false}
        sizeClass="max-w-[380px]"
        overlay={<RunBands runs={frame.runs.runs} />}
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
