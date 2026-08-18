import {
  BOARD_SIZE,
  CELL_COUNT,
  lineScore,
  MAX_LINE_LENGTH,
  PLAYER_TWO_HANDICAP_HALF_POINTS,
} from "@poe2/rules";

import { formatHalfPoints } from "../../board/half-points.ts";
import { Button } from "../../ui/button.tsx";
import { Modal } from "../../ui/modal.tsx";

const RUN_LENGTHS = Array.from({ length: MAX_LINE_LENGTH }, (_, index) => index + 1);

export function RulesDialog({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <Modal
      labelledBy="game-rules-title"
      width="wide"
      panelClassName="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      onDismiss={onDismiss}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium tracking-wide text-pen-2-text uppercase">
            Powers of Exponent 2
          </p>
          <h2 id="game-rules-title" className="font-display text-2xl font-medium tracking-tight">
            Game rules
          </h2>
        </div>
        <Button variant="quiet" size="sm" onClick={onDismiss}>
          Close
        </Button>
      </div>

      <div className="mt-5 grid gap-6 text-sm leading-relaxed text-ink-2 md:grid-cols-2 md:gap-x-10">
        <section>
          <h3 className="font-display text-base font-semibold text-ink">Board and turns</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              Start with an empty{" "}
              <span className="num">
                {BOARD_SIZE} × {BOARD_SIZE}
              </span>{" "}
              board. Player 1 takes the first turn.
            </li>
            <li>
              Players alternate placing one of their pieces on any empty square. Placed pieces never
              move.
            </li>
            <li>
              The game ends when all <span className="num">{CELL_COUNT}</span> squares are filled.
            </li>
          </ol>
        </section>

        <section>
          <h3 className="font-display text-base font-semibold text-ink">Scoring</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              Count each maximal straight run of your pieces: horizontal, vertical, or along either
              diagonal.
            </li>
            <li>
              A run of <span className="italic">n</span> pieces is worth{" "}
              <span className="num">2ⁿ⁻¹</span>. Do not also count shorter parts of the same run.
            </li>
            <li>
              A piece in no run of two or more is worth <span className="num">1</span>. A piece can
              contribute to crossing runs in different directions.
            </li>
            <li>The whole board is rescored after every move.</li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base font-semibold text-ink">Run values</h3>
          <div className="mt-2 grid grid-cols-4 gap-1.5" aria-label="Run values">
            {RUN_LENGTHS.map((length) => (
              <div
                key={length}
                className="rounded-md border border-line bg-sunken px-2 py-1.5 text-center"
              >
                <span className="num font-semibold text-ink">{length}</span>
                <span aria-hidden="true" className="mx-1 text-ink-3">
                  →
                </span>
                <span className="sr-only"> pieces score </span>
                <span className="num">{lineScore(length)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-display text-base font-semibold text-ink">Winning</h3>
          <p className="mt-2">
            Player 2 has a{" "}
            <span className="num">{formatHalfPoints(PLAYER_TWO_HANDICAP_HALF_POINTS)}</span>
            -point head start. When the board is full, compare Player 1&rsquo;s score with Player
            2&rsquo;s score plus that handicap. The higher adjusted score wins; the half point means
            there is never a draw.
          </p>
        </section>
      </div>
    </Modal>
  );
}
