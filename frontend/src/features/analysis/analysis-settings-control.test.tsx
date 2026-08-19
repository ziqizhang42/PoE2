import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnalysisSettingsDialog } from "./analysis-settings-control.tsx";
import {
  ANALYSIS_TIME_CHOICES,
  DEFAULT_ENGINE_SETTINGS,
  MAX_ANALYSIS_TIME_MS,
} from "./analysis-settings.ts";

describe("AnalysisSettingsDialog", () => {
  it("presents Multi-PV count with the two time budgets", () => {
    render(
      <AnalysisSettingsDialog
        settings={DEFAULT_ENGINE_SETTINGS}
        onSave={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Engine settings" });
    const candidates = screen.getByRole("combobox", { name: "Candidate lines" });
    const live = screen.getByRole("slider", { name: "Live analysis time" });
    const game = screen.getByRole("slider", { name: "Game analysis time per move" });

    expect(dialog.parentElement).toHaveClass("fixed", "place-items-center");
    expect(candidates).toHaveValue("1");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(live).toHaveValue("0");
    expect(game).toHaveValue("0");
    expect(live).toHaveAttribute("max", String(ANALYSIS_TIME_CHOICES.length - 1));
    expect(game).toHaveAttribute("max", String(ANALYSIS_TIME_CHOICES.length - 1));
    expect(screen.queryByText(/choose how many candidate/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/time spent/u)).not.toBeInTheDocument();
  });

  it("maps the live endpoint to a 12-hour request and saves both drafts", async () => {
    const onSave = vi.fn();
    render(
      <AnalysisSettingsDialog
        settings={DEFAULT_ENGINE_SETTINGS}
        onSave={onSave}
        onDismiss={vi.fn()}
      />,
    );

    const live = screen.getByRole("slider", { name: "Live analysis time" });
    const game = screen.getByRole("slider", { name: "Game analysis time per move" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Candidate lines" }), "5");
    fireEvent.change(live, { target: { value: String(ANALYSIS_TIME_CHOICES.length - 1) } });
    fireEvent.change(game, { target: { value: "4" } });

    expect(live).toHaveAttribute("aria-valuetext", "12 hours");
    expect(screen.getAllByText("12 hours")).toHaveLength(2);
    expect(game).toHaveAttribute("aria-valuetext", "20 seconds per move");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      candidateCount: 5,
      liveAnalysisTimeMs: MAX_ANALYSIS_TIME_MS,
      gameAnalysisTimeMs: 20_000,
    });
  });

  it("dismisses without saving a changed draft", async () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(
      <AnalysisSettingsDialog
        settings={DEFAULT_ENGINE_SETTINGS}
        onSave={onSave}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Live analysis time" }), {
      target: { value: "8" },
    });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Candidate lines" }), "3");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});
