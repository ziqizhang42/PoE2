import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { CELL_COUNT } from "@poe2/rules";

import { createTestRuntime, type TestRuntime } from "../../test/fakes.ts";
import { TestProviders } from "../../test/providers.tsx";
import { PLY_INTERVAL_MS, useDemoPlayback } from "./use-demo-playback.ts";

function harness(reducedMotion = false) {
  const runtime: TestRuntime = createTestRuntime();
  runtime.motion.set(reducedMotion);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestProviders runtime={runtime}>{children}</TestProviders>
  );

  const rendered = renderHook(() => useDemoPlayback(), { wrapper });
  return { runtime, ...rendered };
}

function tick(runtime: TestRuntime): void {
  act(() => {
    runtime.clock.fire();
  });
}

describe("useDemoPlayback", () => {
  it("opens on the empty board, already playing", () => {
    const { result, runtime } = harness();

    expect(result.current.ply).toBe(0);
    expect(result.current.playing).toBe(true);
    expect(result.current.finished).toBe(false);
    expect(result.current.finalPly).toBe(CELL_COUNT);
    expect(runtime.clock.pending()).toHaveLength(1);
  });

  it("schedules one move at a time, at the interval it says it uses", () => {
    const { result, runtime } = harness();

    expect(runtime.clock.pending()).toHaveLength(1);
    expect(runtime.clock.pending().at(0)?.delayMs).toBe(PLY_INTERVAL_MS);

    tick(runtime);

    expect(result.current.ply).toBe(1);
    expect(runtime.clock.pending()).toHaveLength(1);
    expect(runtime.clock.pending().at(0)?.delayMs).toBe(PLY_INTERVAL_MS);
  });

  it("advances the frame with the ply, not just a counter", () => {
    const { result, runtime } = harness();

    expect(result.current.frame.moves).toHaveLength(0);
    tick(runtime);
    expect(result.current.frame.moves).toHaveLength(1);
    expect(result.current.frame.ply).toBe(1);
  });

  it("stops of its own accord at the last move, with nothing left pending", () => {
    const { result, runtime } = harness();

    for (let played = 0; played < CELL_COUNT; played += 1) {
      tick(runtime);
    }

    expect(result.current.ply).toBe(CELL_COUNT);
    expect(result.current.finished).toBe(true);
    expect(result.current.playing).toBe(false);
    expect(runtime.clock.pending()).toHaveLength(0);
  });

  it("cancels the pending move when it is paused", () => {
    const { result, runtime } = harness();

    tick(runtime);
    expect(runtime.clock.pending()).toHaveLength(1);

    act(() => {
      result.current.pause();
    });

    expect(result.current.playing).toBe(false);
    expect(runtime.clock.pending()).toHaveLength(0);
    expect(result.current.ply).toBe(1);
  });

  it("carries on from where it was paused", () => {
    const { result, runtime } = harness();

    tick(runtime);
    tick(runtime);
    act(() => {
      result.current.pause();
    });

    act(() => {
      result.current.play();
    });

    expect(result.current.playing).toBe(true);
    expect(result.current.ply).toBe(2);
    expect(runtime.clock.pending()).toHaveLength(1);
  });

  it("starts over when play is pressed on a finished demonstration", () => {
    const { result, runtime } = harness();

    for (let played = 0; played < CELL_COUNT; played += 1) {
      tick(runtime);
    }

    act(() => {
      result.current.play();
    });

    expect(result.current.ply).toBe(0);
    expect(result.current.playing).toBe(true);
    expect(runtime.clock.pending()).toHaveLength(1);
  });

  it("returns to the empty board on replay, from anywhere", () => {
    const { result, runtime } = harness();

    tick(runtime);
    tick(runtime);

    act(() => {
      result.current.replay();
    });

    expect(result.current.ply).toBe(0);
    expect(result.current.frame.moves).toHaveLength(0);
    expect(result.current.playing).toBe(true);
  });

  it("leaves no timer behind when it goes away", () => {
    const { runtime, unmount } = harness();

    expect(runtime.clock.pending()).toHaveLength(1);
    unmount();

    expect(runtime.clock.pending()).toHaveLength(0);
  });

  describe("under prefers-reduced-motion", () => {
    it("opens on the finished position, paused, and schedules nothing", () => {
      const { result, runtime } = harness(true);

      expect(result.current.ply).toBe(CELL_COUNT);
      expect(result.current.finished).toBe(true);
      expect(result.current.playing).toBe(false);
      expect(runtime.clock.timers).toHaveLength(0);
    });

    it("shows the completed board rather than an empty one", () => {
      const { result } = harness(true);

      expect(result.current.frame.moves).toHaveLength(CELL_COUNT);
      expect(result.current.frame.board.every((cell) => cell !== 0)).toBe(true);
    });

    it("still plays if the reader asks it to", () => {
      const { result, runtime } = harness(true);

      act(() => {
        result.current.play();
      });

      expect(result.current.ply).toBe(0);
      expect(result.current.playing).toBe(true);
      expect(runtime.clock.pending()).toHaveLength(1);
    });
  });
});
