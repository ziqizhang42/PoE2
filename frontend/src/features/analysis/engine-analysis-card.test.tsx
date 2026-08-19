import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "../../ui/switch.tsx";
import { DEFAULT_ENGINE_SETTINGS } from "./analysis-settings.ts";
import { EngineAnalysisCard } from "./engine-analysis-card.tsx";

describe("EngineAnalysisCard", () => {
  it("uses one concise Engine heading", () => {
    render(
      <EngineAnalysisCard titleId="engine-title">
        <p>Engine result</p>
      </EngineAnalysisCard>,
    );

    const heading = screen.getByRole("heading", { name: "Engine" });
    expect(heading).toBeInTheDocument();
    expect(heading.parentElement).toHaveClass("items-center");
    expect(screen.queryByText("Engine analysis")).not.toBeInTheDocument();
  });

  it("keeps the toggle and settings inside the Engine box", async () => {
    const onSettingsOpenChange = vi.fn();
    const view = render(
      <EngineAnalysisCard
        titleId="engine-title"
        controls={{
          settings: DEFAULT_ENGINE_SETTINGS,
          settingsOpen: false,
          toggle: <Switch accessibleLabel="Engine" checked={false} onChange={vi.fn()} />,
          onSettingsSave: vi.fn(),
          onSettingsOpenChange,
        }}
      >
        <p>Engine result</p>
      </EngineAnalysisCard>,
    );

    const card = screen.getByRole("region", { name: "Engine" });
    const heading = within(card).getByRole("heading", { name: "Engine" });
    const toggle = within(card).getByRole("switch", { name: "Engine" });
    expect(heading.nextElementSibling).toBe(toggle);
    expect(within(card).queryByText(/^(?:On|Off)$/u)).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Engine settings" })).toBeInTheDocument();
    expect(within(card).getByText("Engine result")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Engine settings" }));
    expect(onSettingsOpenChange).toHaveBeenCalledWith(true);

    view.rerender(
      <EngineAnalysisCard
        titleId="engine-title"
        controls={{
          settings: DEFAULT_ENGINE_SETTINGS,
          settingsOpen: true,
          toggle: <Switch accessibleLabel="Engine" checked={false} onChange={vi.fn()} />,
          onSettingsSave: vi.fn(),
          onSettingsOpenChange,
        }}
      >
        <p>Engine result</p>
      </EngineAnalysisCard>,
    );
    expect(within(card).getByRole("dialog", { name: "Engine settings" })).toBeInTheDocument();
    expect(within(card).getByRole("slider", { name: "Live analysis time" })).toHaveValue("0");
    expect(within(card).getByRole("slider", { name: "Game analysis time per move" })).toHaveValue(
      "0",
    );
  });
});
