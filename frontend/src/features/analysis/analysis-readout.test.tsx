import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnalysisReadout } from "./analysis-readout.tsx";
import type { EngineAnalysisReport } from "./engine-analysis.ts";

const REPORT: EngineAnalysisReport = {
  bestMove: { row: 3, col: 3 },
  evaluationHalfPoints: -7,
  completedDepth: 6,
  nodes: 18_420,
  principalVariation: [
    { row: 3, col: 3 },
    { row: 2, col: 2 },
  ],
  lines: [
    {
      rank: 1,
      move: { row: 3, col: 3 },
      equivalentMoves: [
        { row: 3, col: 3 },
        { row: 3, col: 4 },
      ],
      evaluationHalfPoints: -7,
      principalVariation: [
        { row: 3, col: 3 },
        { row: 2, col: 2 },
      ],
    },
    {
      rank: 2,
      move: { row: 3, col: 2 },
      equivalentMoves: [{ row: 3, col: 2 }],
      evaluationHalfPoints: -3,
      principalVariation: [
        { row: 3, col: 2 },
        { row: 1, col: 1 },
      ],
    },
  ],
  engineVersion: "0.2.0",
  apiVersion: 1,
};

describe("analysis readout", () => {
  it("is honest when the engine adapter is absent", () => {
    render(<AnalysisReadout state={{ status: "unavailable" }} />);

    expect(screen.getByText(/engine is not connected/u)).toBeInTheDocument();
  });

  it("renders a completed engine report as a signed, color-coded value", () => {
    render(<AnalysisReadout state={{ status: "ready", report: REPORT }} rootPlayer={2} />);

    const evaluations = screen.getAllByText("−3½");
    expect(evaluations).toHaveLength(2);
    for (const evaluation of evaluations) {
      expect(evaluation).toHaveClass("text-pen-2-text");
    }
    expect(screen.getAllByText("d4").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("18,420")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Line 1/u })).toHaveTextContent("d4c3");
    expect(screen.getByRole("button", { name: /Line 2/u })).toHaveTextContent("c4b2");
    expect(screen.getByText(/Engine 0.2.0 · API 1/u)).toBeInTheDocument();
    expect(screen.queryByText("Candidate lines")).not.toBeInTheDocument();
    expect(screen.queryByText("Equivalent placements")).not.toBeInTheDocument();
  });

  it("keeps the last completed report visible while a replacement runs", () => {
    render(
      <AnalysisReadout
        state={{ status: "analyzing", progress: null, previous: REPORT, nodesPerSecond: null }}
        rootPlayer={2}
      />,
    );

    expect(screen.getByText("—").parentElement).toHaveTextContent("— nodes/s");
    expect(screen.getAllByText("−3½")).toHaveLength(2);
  });

  it("shows live search throughput with a streamed depth", () => {
    render(
      <AnalysisReadout
        state={{
          status: "analyzing",
          progress: REPORT,
          previous: null,
          nodesPerSecond: 3_860_000,
        }}
        rootPlayer={2}
      />,
    );

    const rate = screen.getByText("3.9M").parentElement;
    expect(rate).toHaveTextContent("3.9M nodes/s");
    expect(rate).toHaveClass("rounded-full");
  });

  it("selects a ranked line and computes cost in the root player's direction", async () => {
    const onSelectLine = vi.fn();
    const view = render(
      <AnalysisReadout
        state={{ status: "ready", report: REPORT }}
        rootPlayer={2}
        selectedRank={2}
        onSelectLine={onSelectLine}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /Line 2, evaluation −1½, principal variation c4 b2, estimated cost 2/u,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Line 2/u })).toHaveClass(
      "border-pen-2",
      "bg-pen-2-soft",
    );
    expect(view.container.querySelector('[data-engine-rank="1"]')).toHaveAttribute(
      "data-root-player",
      "2",
    );
    expect(view.container.querySelector('[data-engine-rank="2"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: /Line 1, evaluation −3½, principal variation d4 c3, best line/u,
      }),
    );
    expect(onSelectLine).toHaveBeenCalledWith(1);
  });

  it("falls back to the candidate move when a line has no principal variation", () => {
    const report = {
      ...REPORT,
      lines: [
        REPORT.lines[0],
        { ...REPORT.lines[1], principalVariation: [] },
      ] as EngineAnalysisReport["lines"],
    };

    render(<AnalysisReadout state={{ status: "ready", report }} rootPlayer={2} />);

    expect(
      screen.getByRole("button", {
        name: /Line 2, evaluation −1½, principal variation c4, estimated cost 2/u,
      }),
    ).toHaveTextContent("c4");
  });

  it("distinguishes idle, loading, terminal positions, and failures", () => {
    const view = render(<AnalysisReadout state={{ status: "idle" }} />);
    expect(screen.getByText(/turn on Engine/iu)).toBeInTheDocument();

    view.rerender(<AnalysisReadout state={{ status: "loading" }} />);
    expect(screen.getByText("Loading the analysis engine…")).toBeInTheDocument();

    view.rerender(<AnalysisReadout state={{ status: "terminal" }} />);
    expect(screen.getByText(/no next move to analyze/u)).toBeInTheDocument();

    view.rerender(
      <AnalysisReadout state={{ status: "error", message: "Search failed.", previous: null }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Search failed.");
  });
});
