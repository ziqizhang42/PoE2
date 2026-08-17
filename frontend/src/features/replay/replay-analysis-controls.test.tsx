import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_POSITION_ANALYSIS_SETTINGS } from "../analysis/analysis-settings.ts";
import { EngineAnalysisCard } from "../analysis/engine-analysis-card.tsx";
import { replayAnalysisCardControls } from "./replay-analysis-controls.tsx";

type ReplayAnalysisControlsProps = Parameters<typeof replayAnalysisCardControls>[0];

function ReplayAnalysisControls(props: ReplayAnalysisControlsProps) {
  return (
    <EngineAnalysisCard titleId="replay-engine-title" controls={replayAnalysisCardControls(props)}>
      <p>Position result</p>
    </EngineAnalysisCard>
  );
}

describe("ReplayAnalysisControls", () => {
  it("keeps unavailable engine actions truthful", () => {
    render(
      <ReplayAnalysisControls
        state={{ status: "unavailable", points: [] }}
        continuousPositionAnalysis={false}
        positionSettings={DEFAULT_POSITION_ANALYSIS_SETTINGS}
        settingsOpen={false}
        onPositionSettingsChange={vi.fn()}
        onSettingsOpenChange={vi.fn()}
        onTogglePositionAnalysis={vi.fn()}
        onAnalyzeGame={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch", { name: "Engine" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Analyze game" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Engine evaluation" })).not.toBeInTheDocument();
  });

  it("reports batch progress and exposes cancellation while searching", async () => {
    const onCancel = vi.fn();
    render(
      <ReplayAnalysisControls
        state={{
          status: "analyzing",
          points: [{ kind: "terminal", ply: 0, evaluationHalfPoints: -11 }, null, null],
          activity: { kind: "game", totalPositions: 3 },
          progress: null,
          nodesPerSecond: null,
        }}
        continuousPositionAnalysis={false}
        positionSettings={DEFAULT_POSITION_ANALYSIS_SETTINGS}
        settingsOpen
        onPositionSettingsChange={vi.fn()}
        onSettingsOpenChange={vi.fn()}
        onTogglePositionAnalysis={vi.fn()}
        onAnalyzeGame={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("1 of 3 positions analyzed.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Candidate lines" })).toHaveValue("1");
    expect(screen.getByText(/one line and 1 second per position/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("presents selected-position analysis as a persistent toggle", async () => {
    const onTogglePositionAnalysis = vi.fn();
    const view = render(
      <ReplayAnalysisControls
        state={{ status: "idle", points: [null] }}
        continuousPositionAnalysis={false}
        positionSettings={DEFAULT_POSITION_ANALYSIS_SETTINGS}
        settingsOpen={false}
        onPositionSettingsChange={vi.fn()}
        onSettingsOpenChange={vi.fn()}
        onTogglePositionAnalysis={onTogglePositionAnalysis}
        onAnalyzeGame={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const engine = screen.getByRole("switch", { name: "Engine" });
    expect(engine).not.toBeChecked();
    await userEvent.click(engine);
    expect(onTogglePositionAnalysis).toHaveBeenCalledOnce();

    view.rerender(
      <ReplayAnalysisControls
        state={{ status: "ready", points: [null] }}
        continuousPositionAnalysis
        positionSettings={DEFAULT_POSITION_ANALYSIS_SETTINGS}
        settingsOpen={false}
        onPositionSettingsChange={vi.fn()}
        onSettingsOpenChange={vi.fn()}
        onTogglePositionAnalysis={onTogglePositionAnalysis}
        onAnalyzeGame={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch", { name: "Engine" })).toBeChecked();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(
      screen.queryByText(/positions analyzed|selected position|Continuous analysis/u),
    ).toBeNull();
  });
});
