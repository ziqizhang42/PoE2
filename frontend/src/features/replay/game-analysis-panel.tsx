import type { Player } from "@poe2/rules";

import {
  engineEvaluationToneClass,
  formatEngineEvaluation,
} from "../../board/engine-evaluation.ts";
import { NOTE } from "../../ui/classes.ts";
import { EngineReport } from "../analysis/analysis-readout.tsx";
import {
  EngineAnalysisCard,
  type EngineAnalysisCardControls,
} from "../analysis/engine-analysis-card.tsx";
import { type GameAnalysisState, visibleAnalysisPointAt } from "./game-analysis.ts";

export function GameAnalysisPanel({
  state,
  ply,
  rootPlayer,
  selectedRank,
  onSelectLine,
  controls,
}: {
  readonly state: GameAnalysisState;
  readonly ply: number;
  readonly rootPlayer: Player;
  readonly selectedRank: number;
  readonly onSelectLine: (rank: number) => void;
  readonly controls?: EngineAnalysisCardControls | undefined;
}) {
  const point = visibleAnalysisPointAt(state, ply);
  const emptyMessage = point === null ? emptyPositionMessage(state, ply) : null;
  const showingActiveProgress =
    state.status === "analyzing" && state.progress !== null && state.progress.ply === ply;

  return (
    <EngineAnalysisCard titleId="replay-analysis-title" controls={controls}>
      <div aria-live="polite" aria-atomic="true">
        {state.status === "unavailable" ? (
          <p className={NOTE}>
            Per-position results and move comparisons will appear here once the engine Worker is
            connected.
          </p>
        ) : (
          <>
            {state.status === "error" ? (
              <p role="alert" className="mb-3 text-xs leading-relaxed text-pen-2-text">
                {state.message}
              </p>
            ) : null}

            {point === null ? (
              emptyMessage === null ? null : (
                <p className={NOTE}>{emptyMessage}</p>
              )
            ) : point.kind === "terminal" ? (
              <TerminalEvaluation evaluationHalfPoints={point.evaluationHalfPoints} />
            ) : (
              <EngineReport
                report={point.report}
                rootPlayer={rootPlayer}
                selectedRank={selectedRank}
                onSelectLine={onSelectLine}
                {...(showingActiveProgress ? { nodesPerSecond: state.nodesPerSecond } : {})}
              />
            )}
          </>
        )}
      </div>
    </EngineAnalysisCard>
  );
}

function TerminalEvaluation({ evaluationHalfPoints }: { readonly evaluationHalfPoints: number }) {
  return (
    <p
      className={`num text-2xl leading-none font-medium tracking-tight ${engineEvaluationToneClass(
        evaluationHalfPoints,
      )}`}
    >
      {formatEngineEvaluation(evaluationHalfPoints)}
    </p>
  );
}

function emptyPositionMessage(state: GameAnalysisState, ply: number): string | null {
  if (state.status === "loading") {
    return "The engine is loading before this search starts.";
  }
  if (state.status === "analyzing") {
    if (state.activity.kind === "position" && state.activity.ply === ply) {
      return "Searching this position…";
    }
    return "This position is waiting for its turn in the game analysis.";
  }
  return null;
}
