import { useEffect, useMemo, useState } from "react";

import { CELL_COUNT, isGameOver, marginHalfPoints, scoreBoard, sideToMove } from "@poe2/rules";

import { ANALYSIS_TITLE, useDocumentTitle } from "../../app/document-title.ts";
import { engineEvaluationValueText } from "../../board/engine-evaluation.ts";
import { ExponentLadder } from "../../board/exponent-ladder.tsx";
import { EngineEvaluationStrip } from "../../board/engine-evaluation-strip.tsx";
import { progression } from "../../board/progression.ts";
import { ScorePanel } from "../../board/score-panel.tsx";
import { Scrubber } from "../../board/scrubber.tsx";
import { usePlyNavigationKeys } from "../../board/use-ply-navigation-keys.ts";
import { CARD, EYEBROW, HINT, H_XL, STACK, TWO_UP } from "../../ui/classes.ts";
import { Chip } from "../../ui/chip.tsx";
import { StatusNote } from "../../ui/status-note.tsx";
import { Switch } from "../../ui/switch.tsx";
import { BoardMarksControl } from "../board-marks/board-marks-control.tsx";
import { MoveHistory } from "../game/move-history.tsx";
import { AnalysisBoard } from "./analysis-board.tsx";
import { AnalysisControls } from "./analysis-controls.tsx";
import { AnalysisReadout } from "./analysis-readout.tsx";
import {
  DEFAULT_POSITION_ANALYSIS_SETTINGS,
  type PositionAnalysisSettings,
} from "./analysis-settings.ts";
import {
  candidateLineAt,
  candidatePlacementGroups,
  isEngineAnalysisBusy,
  type EngineAnalysisState,
  visibleEngineReport,
} from "./engine-analysis.ts";
import {
  EvaluationTimelineControls,
  type EvaluationTimelineMode,
} from "./evaluation-timeline-controls.tsx";
import { analysisPath } from "./analysis-url.ts";
import { useAnalysisLine } from "./use-analysis-line.ts";
import { useEngineAnalysis } from "./use-engine-analysis.ts";

export function AnalysisPage() {
  useDocumentTitle(ANALYSIS_TITLE);
  const control = useAnalysisLine();
  const { game, future } = control.line;
  const lineMoves = useMemo(() => [...game.moves, ...future], [future, game.moves]);
  const lineProgression = useMemo(() => progression(lineMoves), [lineMoves]);
  const currentPly = game.moves.length;
  const finalPly = lineMoves.length;
  const finished = isGameOver(game);
  const player = sideToMove(game);
  const engine = useEngineAnalysis(game.moves);
  const analyzePosition = engine.analyze;
  const cancelAnalysis = engine.cancel;
  const [settings, setSettings] = useState<PositionAnalysisSettings>(
    DEFAULT_POSITION_ANALYSIS_SETTINGS,
  );
  const [continuousAnalysis, setContinuousAnalysis] = useState(false);
  const [timelineMode, setTimelineMode] = useState<EvaluationTimelineMode>("score");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRank, setSelectedRank] = useState(1);
  const shownEngineState: EngineAnalysisState = finished ? { status: "terminal" } : engine.state;
  const report = visibleEngineReport(shownEngineState);
  const visibleSelectedRank =
    report === null ? selectedRank : candidateLineAt(report, selectedRank).rank;
  const candidateGroups = candidatePlacementGroups(report);
  const engineBusy = isEngineAnalysisBusy(shownEngineState);
  const engineEvaluations = finished
    ? engine.evaluations.map((evaluation, ply) =>
        ply === game.moves.length ? marginHalfPoints(scoreBoard(game.board)) : evaluation,
      )
    : engine.evaluations;

  usePlyNavigationKeys({ ply: currentPly, finalPly, onSeek: control.seek });

  useEffect(() => {
    if (continuousAnalysis && !finished) {
      analyzePosition(settings);
    }
  }, [analyzePosition, continuousAnalysis, finished, settings]);

  return (
    <div className={TWO_UP}>
      <div className={STACK}>
        <div>
          <p className={EYEBROW}>Study room</p>
          <h1 className={H_XL}>Analysis board</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone={finished ? "neutral" : player === 1 ? "player-1" : "player-2"}>
              {finished ? "Board full" : `Player ${String(player)} to move`}
            </Chip>
            <Chip>
              <span className="num">{game.moves.length}</span>&nbsp;/&nbsp;
              <span className="num">{CELL_COUNT}</span>&nbsp;moves
            </Chip>
          </div>
        </div>

        {control.urlError === null ? null : (
          <StatusNote
            tone="alarm"
            title="That position link could not be read"
            detail={`${control.urlError} An empty board has been opened instead.`}
            live="alert"
          />
        )}

        <section className={CARD} aria-labelledby="analysis-board-title">
          <h2 id="analysis-board-title" className="sr-only">
            Editable analysis position
          </h2>
          <AnalysisBoard
            game={game}
            candidateGroups={candidateGroups}
            selectedRank={visibleSelectedRank}
            onPlay={control.play}
          />
          {finished ? (
            <p className={HINT}>The board is full. Undo a move to keep exploring.</p>
          ) : null}

          <div
            role="group"
            aria-label="Evaluation timeline"
            className="mt-4 border-t border-line pt-4"
          >
            <EvaluationTimelineControls mode={timelineMode} onModeChange={setTimelineMode} />
            <div className="mt-3">
              <Scrubber
                progression={lineProgression}
                ply={currentPly}
                finalPly={finalPly}
                boardFull={finished}
                completeScoreTimeline
                onSeek={control.seek}
                {...(timelineMode === "engine"
                  ? {
                      timeline: (
                        <EngineEvaluationStrip
                          evaluations={engineEvaluations}
                          currentPly={currentPly}
                          finalPly={finalPly}
                          axisFinalPly={finalPly}
                        />
                      ),
                      positionValueText: engineEvaluationValueText(
                        engineEvaluations,
                        currentPly,
                        finalPly,
                      ),
                    }
                  : {})}
              />
            </div>
          </div>

          <AnalysisControls
            moves={game.moves}
            future={future}
            sharePath={analysisPath(game.moves)}
            resetAvailable={control.urlError !== null}
            onUndo={control.undo}
            onRedo={control.redo}
            onReset={control.reset}
          />
        </section>

        <ExponentLadder board={game.board} />
      </div>

      <div className={STACK}>
        <AnalysisReadout
          state={shownEngineState}
          rootPlayer={player}
          selectedRank={visibleSelectedRank}
          onSelectLine={setSelectedRank}
          controls={{
            settings,
            settingsDisabled: engineBusy,
            settingsOpen,
            toggle: (
              <Switch
                accessibleLabel="Engine"
                checked={continuousAnalysis}
                disabled={engine.state.status === "unavailable"}
                onChange={(enabled) => {
                  setContinuousAnalysis(enabled);
                  if (enabled) {
                    setTimelineMode("engine");
                  } else {
                    cancelAnalysis();
                  }
                }}
              />
            ),
            onSettingsChange: setSettings,
            onSettingsOpenChange(open) {
              setSettingsOpen(open);
              if (open) {
                setTimelineMode("engine");
              }
            },
          }}
        />
        <ScorePanel
          titleId="analysis-score-title"
          scores={scoreBoard(game.board)}
          nameOne="Player 1"
          nameTwo="Player 2"
          thinking={finished ? null : player}
        />
        <MoveHistory moves={game.moves} />
        <BoardMarksControl />
      </div>
    </div>
  );
}
