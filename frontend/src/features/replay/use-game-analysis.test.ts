import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { parseSquare, type Square } from "@poe2/rules";

import { engineSuccess, FakeEngineClient } from "../../test/engine.ts";
import { clearEngineAnalysisCache } from "../analysis/engine-analysis-cache.ts";
import { useGameAnalysis } from "./use-game-analysis.ts";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

describe("useGameAnalysis", () => {
  afterEach(clearEngineAnalysisCache);

  it("searches the selected replay prefix with its visible settings", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() =>
      useGameAnalysis(
        { moves: [square("d4"), square("a1")], terminalEvaluationHalfPoints: null },
        client,
      ),
    );

    act(() => {
      result.current.analyzePosition(1, { candidateCount: 4, timePreset: "deep" });
    });
    expect(client.searches[0]?.request).toEqual({
      moves: ["d4"],
      searchTimeMs: 20_000,
      multiPv: 4,
    });

    act(() => {
      client.searches[0]?.callbacks.onStarted();
      client.searches[0]?.callbacks.onProgress(
        engineSuccess("a1", 1, { completedDepth: 1, nodes: 10_000 }),
        250,
      );
    });
    expect(result.current.state).toMatchObject({
      status: "analyzing",
      progress: {
        ply: 1,
        report: { evaluationHalfPoints: 1, completedDepth: 1, nodes: 10_000 },
      },
      nodesPerSecond: 40_000,
      points: [null, null, null],
    });

    act(() => {
      client.searches[0]?.callbacks.onProgress(
        engineSuccess("a1", 2, { completedDepth: 2, nodes: 30_000 }),
        500,
      );
    });
    expect(result.current.state).toMatchObject({
      status: "analyzing",
      progress: {
        ply: 1,
        report: { evaluationHalfPoints: 2, completedDepth: 2, nodes: 30_000 },
      },
      nodesPerSecond: 60_000,
    });

    act(() => {
      client.searches[0]?.callbacks.onResult(engineSuccess("a1", 3, { nodes: 40_000 }));
    });
    expect(result.current.state).toMatchObject({
      status: "ready",
      points: [null, { kind: "search", ply: 1, report: { evaluationHalfPoints: 3 } }, null],
    });
  });

  it("fills every missing game prefix sequentially and uses the exact terminal point", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() =>
      useGameAnalysis(
        { moves: [square("d4"), square("a1")], terminalEvaluationHalfPoints: -7 },
        client,
      ),
    );

    expect(result.current.state.points[2]).toEqual({
      kind: "terminal",
      ply: 2,
      evaluationHalfPoints: -7,
    });
    act(() => {
      result.current.analyzeGame();
    });
    expect(client.searches[0]?.request.moves).toEqual([]);

    act(() => {
      client.searches[0]?.callbacks.onStarted();
      client.searches[0]?.callbacks.onResult(engineSuccess("d4", 5));
    });
    expect(client.searches[1]?.request.moves).toEqual(["d4"]);
    expect(result.current.state.points[0]).toMatchObject({ kind: "search", ply: 0 });

    act(() => {
      client.searches[1]?.callbacks.onStarted();
      client.searches[1]?.callbacks.onResult(engineSuccess("a1", 1));
    });

    expect(client.searches.map((search) => search.request)).toEqual([
      { moves: [], searchTimeMs: 1_000, multiPv: 1 },
      { moves: ["d4"], searchTimeMs: 1_000, multiPv: 1 },
    ]);
    expect(result.current.state).toMatchObject({
      status: "ready",
      points: [
        { kind: "search", ply: 0, report: { evaluationHalfPoints: 5 } },
        { kind: "search", ply: 1, report: { evaluationHalfPoints: 1 } },
        { kind: "terminal", ply: 2, evaluationHalfPoints: -7 },
      ],
    });
  });

  it("retains completed batch points when cancellation kills the active Worker", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() =>
      useGameAnalysis(
        { moves: [square("d4"), square("a1")], terminalEvaluationHalfPoints: null },
        client,
      ),
    );

    act(() => {
      result.current.analyzeGame();
      client.searches[0]?.callbacks.onStarted();
      client.searches[0]?.callbacks.onResult(engineSuccess("d4", 5));
    });
    act(() => {
      result.current.cancel();
    });

    expect(client.searches[1]?.canceled).toBe(true);
    expect(result.current.state).toMatchObject({
      status: "ready",
      points: [{ kind: "search", ply: 0 }, null, null],
    });
  });

  it("reuses a completed selected-position search without starting the Worker again", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() =>
      useGameAnalysis(
        { moves: [square("d4"), square("a1")], terminalEvaluationHalfPoints: null },
        client,
      ),
    );
    const settings = { candidateCount: 1, timePreset: "fast" } as const;

    act(() => {
      result.current.analyzePosition(1, settings);
      client.searches[0]?.callbacks.onResult(engineSuccess("a1", 3));
    });
    act(() => {
      result.current.analyzePosition(1, settings);
    });

    expect(client.searches).toHaveLength(1);
    expect(result.current.state).toMatchObject({
      status: "ready",
      points: [null, { kind: "search", report: { evaluationHalfPoints: 3 } }, null],
    });
  });
});
