import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { parseSquare, type Square } from "@poe2/rules";

import { engineSuccess, FakeEngineClient } from "../../test/engine.ts";
import { clearEngineAnalysisCache } from "./engine-analysis-cache.ts";
import { useEngineAnalysis } from "./use-engine-analysis.ts";

function square(notation: string): Square {
  const parsed = parseSquare(notation);
  if (parsed === null) {
    throw new RangeError(notation);
  }
  return parsed;
}

describe("useEngineAnalysis", () => {
  afterEach(clearEngineAnalysisCache);

  it("streams and commits a Multi-PV position search", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() => useEngineAnalysis([square("d4")], client));

    expect(result.current.state).toEqual({ status: "idle" });
    expect(result.current.evaluations).toEqual([null, null]);
    act(() => {
      result.current.analyze({ candidateCount: 3, timePreset: "balanced" });
    });

    expect(result.current.state).toEqual({ status: "loading" });
    expect(client.searches[0]?.request).toEqual({
      moves: ["d4"],
      searchTimeMs: 5_000,
      multiPv: 3,
    });

    act(() => {
      client.searches[0]?.callbacks.onStarted();
      client.searches[0]?.callbacks.onProgress(
        engineSuccess("a1", 3, { completedDepth: 1, nodes: 10_000 }),
        250,
      );
    });
    expect(result.current.state).toMatchObject({
      status: "analyzing",
      progress: {
        bestMove: square("a1"),
        evaluationHalfPoints: 3,
        completedDepth: 1,
        nodes: 10_000,
      },
      nodesPerSecond: 40_000,
    });
    expect(result.current.evaluations).toEqual([null, 3]);

    act(() => {
      client.searches[0]?.callbacks.onProgress(
        engineSuccess("a1", 4, { completedDepth: 2, nodes: 30_000 }),
        500,
      );
    });
    expect(result.current.state).toMatchObject({
      status: "analyzing",
      progress: { evaluationHalfPoints: 4, completedDepth: 2, nodes: 30_000 },
      nodesPerSecond: 60_000,
    });

    act(() => {
      client.searches[0]?.callbacks.onResult(engineSuccess("a1", 5, { nodes: 40_000 }));
    });
    expect(result.current.state).toMatchObject({
      status: "ready",
      report: { bestMove: square("a1"), evaluationHalfPoints: 5, engineVersion: "0.1.0" },
    });
    expect(result.current.evaluations).toEqual([null, 5]);
  });

  it("terminates a search and keeps its latest completed depth", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() => useEngineAnalysis([], client));

    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "deep" });
      client.searches[0]?.callbacks.onStarted();
      client.searches[0]?.callbacks.onProgress(engineSuccess("d4", -1), 250);
      result.current.cancel();
    });

    expect(client.searches[0]?.canceled).toBe(true);
    expect(result.current.state).toMatchObject({
      status: "ready",
      report: { evaluationHalfPoints: -1 },
    });
  });

  it("shows a new stream from depth one while retaining a stronger cached result", () => {
    const client = new FakeEngineClient();
    const { result } = renderHook(() => useEngineAnalysis([], client));

    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "fast" });
      client.searches[0]?.callbacks.onResult(
        engineSuccess("d4", 7, { completedDepth: 8, nodes: 50_000 }),
      );
      result.current.analyze({ candidateCount: 1, timePreset: "deep" });
      client.searches[1]?.callbacks.onStarted();
      client.searches[1]?.callbacks.onProgress(
        engineSuccess("d4", 1, { completedDepth: 1, nodes: 100 }),
        10,
      );
    });

    expect(result.current.state).toMatchObject({
      status: "analyzing",
      progress: { evaluationHalfPoints: 1, completedDepth: 1, nodes: 100 },
      nodesPerSecond: 10_000,
    });

    act(() => {
      result.current.cancel();
    });
    expect(result.current.state).toMatchObject({
      status: "ready",
      report: { evaluationHalfPoints: 7, completedDepth: 8, nodes: 50_000 },
    });
  });

  it("cancels and clears a stale result when the board line changes", () => {
    const client = new FakeEngineClient();
    const { result, rerender } = renderHook(
      ({ moves }: { readonly moves: readonly Square[] }) => useEngineAnalysis(moves, client),
      { initialProps: { moves: [square("d4")] } },
    );

    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "fast" });
    });
    rerender({ moves: [square("d4"), square("a1")] });

    expect(client.searches[0]?.canceled).toBe(true);
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("reuses a completed result when the same position and settings return", () => {
    const client = new FakeEngineClient();
    const { result, rerender } = renderHook(
      ({ moves }: { readonly moves: readonly Square[] }) => useEngineAnalysis(moves, client),
      { initialProps: { moves: [square("d4")] } },
    );

    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "fast" });
      client.searches[0]?.callbacks.onResult(engineSuccess("a1", 5));
    });
    rerender({ moves: [square("d4"), square("a1")] });
    rerender({ moves: [square("d4")] });

    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "fast" });
    });

    expect(client.searches).toHaveLength(1);
    expect(result.current.state).toMatchObject({
      status: "ready",
      report: { evaluationHalfPoints: 5, nodes: 12_345 },
    });
    expect(result.current.evaluations).toEqual([null, 5]);
  });

  it("keeps analyzed prefixes on the visible line while navigating", () => {
    const client = new FakeEngineClient();
    const { result, rerender } = renderHook(
      ({ moves }: { readonly moves: readonly Square[] }) => useEngineAnalysis(moves, client),
      { initialProps: { moves: [square("d4")] } },
    );

    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "fast" });
      client.searches[0]?.callbacks.onResult(engineSuccess("a1", 5));
    });
    rerender({ moves: [square("d4"), square("a1")] });
    act(() => {
      result.current.analyze({ candidateCount: 1, timePreset: "fast" });
      client.searches[1]?.callbacks.onResult(engineSuccess("e4", -2));
    });

    expect(result.current.evaluations).toEqual([null, 5, -2]);
    rerender({ moves: [square("d4")] });
    expect(result.current.evaluations).toEqual([null, 5]);
  });
});
