import type { CSSProperties } from "react";

import { CELL_COUNT } from "@poe2/rules";

import { describeEngineEvaluations } from "./engine-evaluation.ts";

type EngineEvaluationStripProps = {
  /** Signed half-points normalized to Player 1, indexed by line ply. */
  evaluations: readonly (number | null)[];
  currentPly: number;
  finalPly: number;
  /** Last ply on the horizontal axis. Defaults to the board's full capacity. */
  axisFinalPly?: number;
};

const MIN_BAR_PERCENT = 8;

/** Evaluation sparkline sharing the score strip's exact ply axis. */
export function EngineEvaluationStrip({
  evaluations,
  currentPly,
  finalPly,
  axisFinalPly = CELL_COUNT,
}: EngineEvaluationStripProps) {
  const available = evaluations.slice(0, finalPly + 1).filter(isEvaluation);
  const peak = Math.max(1, ...available.map((evaluation) => Math.abs(evaluation)));
  const renderedFinalPly = Math.max(finalPly, axisFinalPly);

  return (
    <div
      role="img"
      aria-label={describeEngineEvaluations(evaluations, currentPly, finalPly)}
      className="relative flex h-16 gap-px rounded-sm bg-sunken px-1 py-1"
    >
      <span aria-hidden="true" className="absolute inset-x-1 top-1/2 h-px bg-line" />
      {Array.from({ length: renderedFinalPly + 1 }, (_unused, ply) => (
        <EvaluationSegment
          key={ply}
          evaluation={ply <= finalPly ? (evaluations[ply] ?? null) : null}
          selected={ply === currentPly}
          peak={peak}
        />
      ))}
    </div>
  );
}

function isEvaluation(value: number | null): value is number {
  return value !== null;
}

function EvaluationSegment({
  evaluation,
  selected,
  peak,
}: {
  evaluation: number | null;
  selected: boolean;
  peak: number;
}) {
  const share = evaluation === null ? 0 : Math.abs(evaluation) / peak;
  const height = `${String(Math.max(MIN_BAR_PERCENT, share * 100))}%`;

  return (
    <span aria-hidden="true" className="relative flex min-w-0 flex-1 flex-col">
      {selected ? (
        <span className="absolute inset-y-[-4px] left-1/2 z-1 w-px -translate-x-1/2 bg-ink" />
      ) : null}

      {evaluation === 0 ? (
        <span className="absolute top-1/2 h-0.5 w-full -translate-y-1/2 rounded-full bg-ink-3" />
      ) : null}
      <span className="flex h-1/2 items-end">
        {evaluation !== null && evaluation > 0 ? (
          <span
            className="lead-bar w-full rounded-t-[1px] bg-pen-1"
            style={{ "--lead-height": height } as CSSProperties}
          />
        ) : null}
      </span>
      <span className="flex h-1/2 items-start">
        {evaluation !== null && evaluation < 0 ? (
          <span
            className="lead-bar w-full rounded-b-[1px] bg-pen-2"
            style={{ "--lead-height": height } as CSSProperties}
          />
        ) : null}
      </span>
    </span>
  );
}
