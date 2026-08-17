import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EvaluationTimelineControls } from "./evaluation-timeline-controls.tsx";

describe("EvaluationTimelineControls", () => {
  it("contains only the two shared timeline measures", async () => {
    const onModeChange = vi.fn();
    render(<EvaluationTimelineControls mode="score" onModeChange={onModeChange} />);

    const selected = screen.getByRole("button", { name: "Board score" });
    const unselected = screen.getByRole("button", { name: "Engine evaluation" });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(selected).toHaveClass("button-control", "button-surface");
    expect(unselected).toHaveClass("button-control");
    expect(unselected).not.toHaveClass("button-surface");
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Engine settings" })).not.toBeInTheDocument();

    await userEvent.click(unselected);
    expect(onModeChange).toHaveBeenCalledWith("engine");
  });
});
