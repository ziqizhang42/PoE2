import { Button } from "../../ui/button.tsx";
import { Switch } from "../../ui/switch.tsx";
import type { EngineSettings } from "../analysis/analysis-settings.ts";
import type { EngineAnalysisCardControls } from "../analysis/engine-analysis-card.tsx";
import {
  completedPositionCount,
  isGameAnalysisBusy,
  type GameAnalysisState,
} from "./game-analysis.ts";

export type ReplayAnalysisControlsOptions = {
  state: GameAnalysisState;
  continuousPositionAnalysis: boolean;
  settings: EngineSettings;
  settingsOpen: boolean;
  onSettingsSave: (settings: EngineSettings) => void;
  onSettingsOpenChange: (open: boolean) => void;
  onTogglePositionAnalysis: () => void;
  onAnalyzeGame: () => void;
  onCancel: () => void;
};

export function replayAnalysisCardControls({
  state,
  continuousPositionAnalysis,
  settings,
  settingsOpen,
  onSettingsSave,
  onSettingsOpenChange,
  onTogglePositionAnalysis,
  onAnalyzeGame,
  onCancel,
}: ReplayAnalysisControlsOptions): EngineAnalysisCardControls {
  const unavailable = state.status === "unavailable";
  const busy = isGameAnalysisBusy(state);
  const gameBusy =
    (state.status === "loading" || state.status === "analyzing") && state.activity.kind === "game";

  return {
    settings,
    settingsOpen,
    toggle: (
      <Switch
        accessibleLabel="Engine"
        checked={continuousPositionAnalysis}
        disabled={unavailable || gameBusy}
        onChange={onTogglePositionAnalysis}
      />
    ),
    actions: (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="surface" disabled={unavailable || busy} onClick={onAnalyzeGame}>
          Analyze game
        </Button>
        {gameBusy ? (
          <Button size="sm" variant="quiet" aria-label="Cancel game analysis" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    ),
    ...(state.status === "analyzing" && state.activity.kind === "game"
      ? {
          status: (
            <p className="mb-3 text-right text-xs leading-relaxed text-ink-3" aria-live="polite">
              {String(completedPositionCount(state.points))} of{" "}
              {String(state.activity.totalPositions)} positions analyzed.
            </p>
          ),
        }
      : {}),
    onSettingsSave,
    onSettingsOpenChange,
  };
}
