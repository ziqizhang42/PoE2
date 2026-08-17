import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseSquare, type Square } from "@poe2/rules";

import type { EngineAnalysisReport } from "../analysis/engine-analysis.ts";
import type { GameAnalysisPoint } from "./game-analysis.ts";
import { GameAnalysisPanel } from "./game-analysis-panel.tsx";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

function point(ply: number, evaluationHalfPoints: number, bestMove: string): GameAnalysisPoint {
  const report: EngineAnalysisReport = {
    bestMove: square(bestMove),
    evaluationHalfPoints,
    completedDepth: 6,
    nodes: 18_420,
    principalVariation: [square(bestMove)],
    lines: [
      {
        rank: 1,
        move: square(bestMove),
        equivalentMoves: [square(bestMove)],
        evaluationHalfPoints,
        principalVariation: [square(bestMove)],
      },
    ],
    engineVersion: "0.2.0",
    apiVersion: 1,
  };
  return { kind: "search", ply, report };
}

describe("GameAnalysisPanel", () => {
  it("explains the disconnected boundary without inventing an evaluation", () => {
    render(
      <GameAnalysisPanel
        state={{ status: "unavailable", points: [] }}
        ply={0}
        rootPlayer={1}
        selectedRank={1}
        onSelectLine={() => undefined}
      />,
    );

    expect(screen.getByText(/once the engine Worker is connected/u)).toBeInTheDocument();
    expect(screen.queryByText(/Player [12] \+/u)).not.toBeInTheDocument();
  });

  it("shows the selected position without a separate move-assessment block", () => {
    render(
      <GameAnalysisPanel
        state={{ status: "ready", points: [point(0, 5, "d4"), point(1, 1, "a1")] }}
        ply={1}
        rootPlayer={2}
        selectedRank={1}
        onSelectLine={() => undefined}
      />,
    );

    expect(screen.queryByText(/^Move /u)).not.toBeInTheDocument();
    expect(screen.queryByText(/engine’s first choice/u)).not.toBeInTheDocument();
    expect(screen.getAllByText("+½")).toHaveLength(2);
    expect(screen.getAllByText("a1")).toHaveLength(2);
  });

  it("puts live throughput beside the streamed depth and node pills", () => {
    const progress = point(0, 5, "d4");
    if (progress.kind !== "search") {
      throw new TypeError("fixture is a search point");
    }

    render(
      <GameAnalysisPanel
        state={{
          status: "analyzing",
          points: [null],
          activity: { kind: "position", ply: 0 },
          progress: { ply: 0, report: progress.report },
          nodesPerSecond: 3_860_000,
        }}
        ply={0}
        rootPlayer={1}
        selectedRank={1}
        onSelectLine={() => undefined}
      />,
    );

    const rate = screen.getByText("3.9M").parentElement;
    expect(rate).toHaveTextContent("3.9M nodes/s");
    expect(rate).toHaveClass("rounded-full");
  });

  it("omits mover-cost prose from analyzed replay positions", () => {
    render(
      <GameAnalysisPanel
        state={{ status: "ready", points: [point(0, 5, "c3"), point(1, 1, "a1")] }}
        ply={1}
        rootPlayer={2}
        selectedRank={1}
        onSelectLine={() => undefined}
      />,
    );

    expect(screen.queryByText(/gave up|engine preferred/u)).not.toBeInTheDocument();
  });

  it("renders an exact terminal value without claiming there is a best move", () => {
    render(
      <GameAnalysisPanel
        state={{
          status: "ready",
          points: [null, { kind: "terminal", ply: 1, evaluationHalfPoints: -7 }],
        }}
        ply={1}
        rootPlayer={2}
        selectedRank={1}
        onSelectLine={() => undefined}
      />,
    );

    expect(screen.getByText("−3½")).toHaveClass("text-pen-2-text");
    expect(screen.queryByText(/Exact final evaluation/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Best move/u)).not.toBeInTheDocument();
  });

  it("leaves an unanalyzed idle position free of placeholder prose", () => {
    render(
      <GameAnalysisPanel
        state={{ status: "idle", points: [null] }}
        ply={0}
        rootPlayer={1}
        selectedRank={1}
        onSelectLine={() => undefined}
      />,
    );

    expect(screen.queryByText(/No engine result/u)).not.toBeInTheDocument();
  });
});
