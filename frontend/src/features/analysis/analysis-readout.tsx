import { formatSquare, type Player } from "@poe2/rules";

import {
  engineEvaluationToneClass,
  formatEngineEvaluation,
} from "../../board/engine-evaluation.ts";
import { formatHalfPoints } from "../../board/half-points.ts";
import { NOTE } from "../../ui/classes.ts";
import { Chip } from "../../ui/chip.tsx";
import { EngineAnalysisCard, type EngineAnalysisCardControls } from "./engine-analysis-card.tsx";
import type { EngineAnalysisReport, EngineAnalysisState } from "./engine-analysis.ts";
import {
  candidateLineAt,
  candidateLossHalfPoints,
  visibleEngineReport,
} from "./engine-analysis.ts";
import { formatNodesPerSecond } from "./engine-search-rate.ts";

export function AnalysisReadout({
  state,
  rootPlayer = 1,
  selectedRank = 1,
  onSelectLine,
  controls,
}: {
  readonly state: EngineAnalysisState;
  readonly rootPlayer?: Player;
  readonly selectedRank?: number;
  readonly onSelectLine?: (rank: number) => void;
  readonly controls?: EngineAnalysisCardControls | undefined;
}) {
  const report = visibleEngineReport(state);

  return (
    <EngineAnalysisCard titleId="engine-analysis-title" controls={controls}>
      <div aria-live="polite" aria-atomic="true">
        {state.status === "unavailable" ? (
          <p className={NOTE}>
            The analysis board is ready, but the engine is not connected in this build yet.
          </p>
        ) : state.status === "idle" ? (
          <p className={NOTE}>Turn on Engine to analyze this position.</p>
        ) : state.status === "terminal" ? (
          <p className={NOTE}>The board is full, so there is no next move to analyze.</p>
        ) : state.status === "loading" ? (
          <p className={NOTE}>Loading the analysis engine…</p>
        ) : state.status === "analyzing" && report === null ? (
          <p className={NOTE}>Searching this position…</p>
        ) : report === null ? (
          <p role="alert" className={NOTE}>
            {state.status === "error" ? state.message : "No analysis is available."}
          </p>
        ) : (
          <div
            className={state.status === "analyzing" && state.progress === null ? "opacity-70" : ""}
          >
            {state.status === "error" ? (
              <p role="alert" className="mb-3 text-xs leading-relaxed text-pen-2-text">
                {state.message} The previous completed result is shown below.
              </p>
            ) : null}
            <EngineReport
              report={report}
              rootPlayer={rootPlayer}
              selectedRank={selectedRank}
              {...(state.status === "analyzing" ? { nodesPerSecond: state.nodesPerSecond } : {})}
              {...(onSelectLine === undefined ? {} : { onSelectLine })}
            />
          </div>
        )}
      </div>
    </EngineAnalysisCard>
  );
}

export function EngineReport({
  report,
  rootPlayer,
  selectedRank,
  nodesPerSecond,
  onSelectLine,
}: {
  readonly report: EngineAnalysisReport;
  readonly rootPlayer: Player;
  readonly selectedRank: number;
  readonly nodesPerSecond?: number | null;
  readonly onSelectLine?: (rank: number) => void;
}) {
  const evaluation = formatEngineEvaluation(report.evaluationHalfPoints);
  const selected = candidateLineAt(report, selectedRank);

  return (
    <>
      <p
        className={`num text-2xl leading-none font-medium tracking-tight ${engineEvaluationToneClass(
          report.evaluationHalfPoints,
        )}`}
      >
        {evaluation}
      </p>
      <p className="mt-2 text-sm text-ink-2">
        Best move <b className="num font-semibold text-ink">{formatSquare(report.bestMove)}</b>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip>
          depth <span className="num ml-1">{report.completedDepth}</span>
        </Chip>
        <Chip>
          <span className="num">{formatNodes(report.nodes)}</span>&nbsp;nodes
        </Chip>
        {nodesPerSecond === undefined ? null : (
          <Chip>
            <span className="num">
              {nodesPerSecond === null ? "—" : formatNodesPerSecond(nodesPerSecond)}
            </span>
            &nbsp;nodes/s
          </Chip>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="grid gap-2">
          {report.lines.map((line) => {
            const selectedLine = line.rank === selected.rank;
            const loss = candidateLossHalfPoints(report, line, rootPlayer);
            const standing = formatEngineEvaluation(line.evaluationHalfPoints);
            const cost = line.rank === 1 ? "best line" : `estimated cost ${formatHalfPoints(loss)}`;
            const principalVariation =
              line.principalVariation.length === 0 ? [line.move] : line.principalVariation;
            const principalVariationLabel = principalVariation.map(formatSquare).join(" ");
            const selectedTone =
              rootPlayer === 1 ? "border-pen-1 bg-pen-1-soft" : "border-pen-2 bg-pen-2-soft";
            return (
              <button
                key={line.rank}
                type="button"
                aria-pressed={selectedLine}
                aria-label={`Line ${String(line.rank)}, evaluation ${standing}, principal variation ${principalVariationLabel}, ${cost}`}
                onClick={() => {
                  onSelectLine?.(line.rank);
                }}
                className={`grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 rounded-md border px-3 py-2.5 text-left transition-colors ${
                  selectedLine ? selectedTone : "border-line bg-sunken hover:border-ink-3"
                }`}
              >
                <span
                  data-engine-rank={line.rank}
                  data-root-player={rootPlayer}
                  data-selected={selectedLine ? "true" : "false"}
                  className="engine-candidate-rank num flex size-6 items-center justify-center rounded-full border font-bold shadow-lift"
                >
                  {line.rank}
                </span>
                <span
                  className={`num min-w-[4rem] rounded-sm border border-line bg-surface px-2 py-1 text-center text-sm font-semibold shadow-lift ${engineEvaluationToneClass(
                    line.evaluationHalfPoints,
                  )}`}
                >
                  {standing}
                </span>
                <span className="min-w-0">
                  <span className="num flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm leading-relaxed">
                    {principalVariation.map((move, index) => (
                      <span
                        key={`${String(index)}-${formatSquare(move)}`}
                        className={index === 0 ? "font-semibold text-ink" : "text-ink-2"}
                      >
                        {formatSquare(move)}
                      </span>
                    ))}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-3">
                    {line.rank === 1 ? "Best line" : `Est. cost ${formatHalfPoints(loss)}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Engine {report.engineVersion} · API {report.apiVersion}
      </p>
    </>
  );
}

function formatNodes(nodes: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(nodes);
}
