import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { allSquares, formatSquare } from "@poe2/rules";

import { createFakeAuthClient, createTestRuntime } from "../../test/fakes.ts";
import { renderApp } from "../../test/render.tsx";

function runtime() {
  return createTestRuntime({
    authClient: createFakeAuthClient({ fetchSession: async () => null }),
  });
}

async function openAnalysis(path = "/analysis"): Promise<void> {
  renderApp(runtime(), path);
  await screen.findByRole("heading", { name: "Analysis board", level: 1 });
}

function square(name: string): HTMLElement {
  return screen.getByRole("gridcell", { name: new RegExp(`^${name},`, "u") });
}

describe("analysis page", () => {
  it("is a public, local board with analysis ready to start", async () => {
    await openAnalysis();

    expect(document.title).toBe("Analysis — PoE2");
    expect(screen.queryByText(/Build a legal position/u)).not.toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /^d4, empty/u })).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell")).toHaveLength(49);
    const engineCard = screen.getByRole("region", { name: "Engine" });
    expect(engineCard).not.toHaveTextContent(/not connected/u);
    expect(screen.getByRole("switch", { name: "Engine" })).not.toBeChecked();
    expect(within(engineCard).queryByText(/^(?:On|Off)$/u)).not.toBeInTheDocument();
    const scorePanel = screen.getByRole("region", { name: "Score" });
    expect(scorePanel).not.toHaveTextContent(/ahead|after move/u);
    expect(within(scorePanel).getByText("Player 1")).toBeInTheDocument();
    expect(within(scorePanel).getByText("Player 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board score" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Engine settings" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("combobox", { name: "Candidate lines" })).not.toBeInTheDocument();
    expect(screen.queryByText(/While on, analysis follows/u)).not.toBeInTheDocument();
    const timeline = screen.getByRole("group", { name: "Evaluation timeline" });
    expect(within(engineCard).getByRole("switch", { name: "Engine" })).toBeInTheDocument();
    expect(within(engineCard).getByRole("button", { name: "Engine settings" })).toBeInTheDocument();
    expect(within(timeline).getAllByRole("button")).toHaveLength(2);
    expect(within(timeline).queryByRole("switch", { name: "Engine" })).not.toBeInTheDocument();
    expect(
      within(timeline).queryByRole("button", { name: "Engine settings" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analysis" })).toHaveAttribute("href", "/analysis");
  });

  it("lets the analysis settings be prepared before a search", async () => {
    await openAnalysis();
    await userEvent.click(screen.getByRole("button", { name: "Engine settings" }));
    const candidates = screen.getByRole("combobox", { name: "Candidate lines" });

    await userEvent.selectOptions(candidates, "5");
    await userEvent.click(screen.getByRole("button", { name: "Deep · 20s" }));

    expect(candidates).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Deep · 20s" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Deep · 20s · 5 lines")).toBeInTheDocument();
  });

  it("switches the board strip from score to known engine evaluations", async () => {
    await openAnalysis("/analysis?moves=d4,a1");

    await userEvent.click(screen.getByRole("button", { name: "Engine evaluation" }));

    expect(screen.getByRole("button", { name: "Engine evaluation" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("img", { name: /Engine evaluation after each move/u }),
    ).toHaveAccessibleName(/0 of 3 positions analyzed/u);
  });

  it("plays legal moves and writes the current line into the URL", async () => {
    const user = userEvent.setup();
    await openAnalysis();

    await user.click(square("d4"));
    await user.click(square("a1"));

    expect(window.location.pathname).toBe("/analysis");
    expect(window.location.search).toBe("?moves=d4,a1");
    expect(screen.getByText("Player 1 to move")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /a1, Player 2, last move/u })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Moves/u })).getByText("d4")).toBeVisible();
  });

  it("supports undo, redo, branching, and reset", async () => {
    const user = userEvent.setup();
    await openAnalysis("/analysis?moves=d4,a1,e4");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(window.location.search).toBe("?moves=d4,a1");
    expect(screen.getByRole("button", { name: "Redo e4" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Redo e4" }));
    expect(window.location.search).toBe("?moves=d4,a1,e4");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(square("g7"));
    expect(window.location.search).toBe("?moves=d4,a1,g7");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(window.location.pathname).toBe("/analysis");
    expect(window.location.search).toBe("");
    expect(screen.getByText("Nothing has been played yet.")).toBeInTheDocument();
  });

  it("walks one linear line with Left and Right Arrow and replaces an abandoned future", async () => {
    const user = userEvent.setup();
    await openAnalysis("/analysis?moves=d4,a1,e4,a2");
    const timeline = screen.getByRole("slider", { name: "Position after ply" });

    expect(timeline).toHaveValue("4");
    expect(timeline).toHaveAttribute("max", "4");

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(window.location.search).toBe("?moves=d4,a1,e4");
    expect(timeline).toHaveValue("3");
    expect(timeline).toHaveAttribute("max", "4");

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(window.location.search).toBe("?moves=d4,a1,e4");

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await user.click(square("g7"));
    expect(window.location.search).toBe("?moves=d4,a1,g7");
    expect(timeline).toHaveValue("3");
    expect(timeline).toHaveAttribute("max", "3");
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    expect(square("g7")).not.toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(window.location.search).toBe("?moves=d4,a1");
    await user.keyboard("{ArrowRight}");
    expect(window.location.search).toBe("?moves=d4,a1,g7");
  });

  it("loads shared positions and safely rejects an illegal one", async () => {
    const user = userEvent.setup();
    await openAnalysis("/analysis?moves=D4%2Ca1");

    expect(screen.getByRole("gridcell", { name: /d4, Player 1/u })).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /a1, Player 2, last move/u })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Analysis" }));
    await waitFor(() => {
      expect(screen.getByText("Nothing has been played yet.")).toBeInTheDocument();
    });

    window.history.pushState({}, "", "/analysis?moves=d4,d4");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
    });
    expect(screen.getByText("Nothing has been played yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(window.location.search).toBe("");
  });

  it("uses the shared roving keyboard controls to place a move", async () => {
    const user = userEvent.setup();
    await openAnalysis();
    const d4 = square("d4");
    d4.focus();

    await user.keyboard("{ArrowRight}{Enter}");

    expect(screen.getByRole("gridcell", { name: /e4, Player 1, last move/u })).toBeInTheDocument();
    expect(window.location.search).toBe("?moves=e4");
  });

  it("copies a canonical link for the current position", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      await openAnalysis("/analysis?moves=d4,a1");
      await user.click(screen.getByRole("button", { name: "Copy position link" }));

      expect(writeText).toHaveBeenCalledWith(
        new URL("/analysis?moves=d4,a1", window.location.origin).href,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Position link copied");
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(navigator, "clipboard");
      } else {
        Object.defineProperty(navigator, "clipboard", descriptor);
      }
    }
  });

  it("treats a full imported line as terminal without asking an engine for a move", async () => {
    const history = allSquares().map(formatSquare).join(",");
    await openAnalysis(`/analysis?moves=${history}`);

    expect(screen.getByText("Board full")).toBeInTheDocument();
    expect(screen.getByText(/no next move to analyze/u)).toBeInTheDocument();
    const engine = screen.getByRole("switch", { name: "Engine" });
    expect(engine).toBeEnabled();
    await userEvent.click(engine);
    expect(engine).toBeChecked();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-readonly", "true");
    expect(screen.getAllByRole("gridcell").every((cell) => cell.ariaDisabled === "true")).toBe(
      true,
    );
  });
});
