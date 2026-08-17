import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { AnalysisSettingsControl } from "./analysis-settings-control.tsx";
import {
  DEFAULT_POSITION_ANALYSIS_SETTINGS,
  searchTimeMs,
  type PositionAnalysisSettings,
} from "./analysis-settings.ts";

function SettingsHarness() {
  const [settings, setSettings] = useState<PositionAnalysisSettings>(
    DEFAULT_POSITION_ANALYSIS_SETTINGS,
  );
  return <AnalysisSettingsControl settings={settings} onChange={setSettings} />;
}

describe("AnalysisSettingsControl", () => {
  it("offers every supported Multi-PV count and visible time preset", async () => {
    render(<SettingsHarness />);
    const candidates = screen.getByRole("combobox", { name: "Candidate lines" });

    expect(candidates).toHaveValue("1");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    await userEvent.selectOptions(candidates, "5");
    await userEvent.click(screen.getByRole("button", { name: "Balanced · 5s" }));

    expect(candidates).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Balanced · 5s" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Balanced · 5s" })).toHaveClass(
      "button-control",
      "button-surface",
    );
    expect(screen.getByRole("button", { name: "Fast · 1s" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deep · 20s" })).toBeInTheDocument();
  });

  it("maps the public presets to the engine's millisecond budgets", () => {
    expect(searchTimeMs({ candidateCount: 1, timePreset: "fast" })).toBe(1_000);
    expect(searchTimeMs({ candidateCount: 3, timePreset: "balanced" })).toBe(5_000);
    expect(searchTimeMs({ candidateCount: 5, timePreset: "deep" })).toBe(20_000);
  });
});
