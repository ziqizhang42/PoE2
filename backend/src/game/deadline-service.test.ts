import type { GameSnapshot } from "@poe2/protocol";
import { describe, expect, it, vi } from "vitest";

import { createFakeClock, createFakeScheduler } from "../limits/test-doubles.js";
import { createDeadlineService } from "./deadline-service.js";
import type { DeadlineProcessingResult } from "./service.js";

const GAME_ONE = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const GAME_TWO = "9a3c9f5e-1f2b-4c3d-8e7f-0a1b2c3d4e5f";
const SERVER_NOW = new Date("2026-08-04T10:00:00.000Z");

function after(milliseconds: number): Date {
  return new Date(SERVER_NOW.getTime() + milliseconds);
}

function harness(
  capacity = 2,
  process = vi.fn<(gameId: string, deadline: Date) => Promise<DeadlineProcessingResult>>(
    async () => ({ kind: "absent" }),
  ),
) {
  const clock = createFakeClock();
  const scheduler = createFakeScheduler();
  const onFinished = vi.fn<(game: GameSnapshot) => void>();
  const onError = vi.fn<(error: unknown) => void>();
  const service = createDeadlineService({
    capacity,
    clock,
    scheduler,
    process,
    onFinished,
    onAbandoned: vi.fn(),
    onError,
  });
  return { service, clock, scheduler, process, onFinished, onError };
}

describe("deadline capacity", () => {
  it("reserves synchronously and releases on rollback", () => {
    const { service } = harness(1);
    const first = service.reserve();

    expect(first).not.toBeNull();
    expect(service.reservedCount()).toBe(1);
    expect(service.reserve()).toBeNull();

    first?.release();
    first?.release();
    expect(service.reservedCount()).toBe(0);
    expect(service.reserve()).not.toBeNull();
  });

  it("turns a committed reservation into one supervised game", () => {
    const { service, scheduler } = harness(1);
    service.reserve()?.commit(GAME_ONE, after(5_000), SERVER_NOW);

    expect(service.activeCount()).toBe(1);
    expect(service.reservedCount()).toBe(0);
    expect(service.reserve()).toBeNull();
    expect(scheduler.pending()).toEqual([{ delayMs: 5_000, cancelled: false, fired: false }]);
  });

  it("does not install an outstanding reservation after shutdown", () => {
    const { service, scheduler } = harness(1);
    const reservation = service.reserve();

    service.stop();
    reservation?.commit(GAME_ONE, after(5_000), SERVER_NOW);

    expect(service.activeCount()).toBe(0);
    expect(service.reservedCount()).toBe(0);
    expect(scheduler.pending()).toEqual([]);
  });

  it("refuses startup recovery beyond the configured bound", () => {
    const { service } = harness(1);
    expect(() =>
      service.restore([
        { gameId: GAME_ONE, deadline: after(1_000), serverNow: SERVER_NOW },
        { gameId: GAME_TWO, deadline: after(2_000), serverNow: SERVER_NOW },
      ]),
    ).toThrow(/exceed deadline capacity/u);
  });
});

describe("deadline scheduling", () => {
  it("keeps exactly one timer for the nearest deadline", () => {
    const { service, scheduler } = harness();
    service.restore([
      { gameId: GAME_TWO, deadline: after(9_000), serverNow: SERVER_NOW },
      { gameId: GAME_ONE, deadline: after(4_000), serverNow: SERVER_NOW },
    ]);

    expect(scheduler.pending()).toEqual([{ delayMs: 4_000, cancelled: false, fired: false }]);

    service.replace(GAME_ONE, after(12_000), SERVER_NOW);
    expect(scheduler.pending()).toEqual([{ delayMs: 9_000, cancelled: false, fired: false }]);
  });

  it("rechecks through the processor and removes a finished entry", async () => {
    const process = vi.fn<(gameId: string, deadline: Date) => Promise<DeadlineProcessingResult>>(
      async () => ({ kind: "finished", game: {} as GameSnapshot }),
    );
    const { service, clock, scheduler, onFinished } = harness(1, process);
    service.restore([{ gameId: GAME_ONE, deadline: after(5_000), serverNow: SERVER_NOW }]);

    clock.advance(5_000);
    scheduler.fireAll();
    await vi.waitFor(() => {
      expect(onFinished).toHaveBeenCalledTimes(1);
    });

    expect(process).toHaveBeenCalledWith(GAME_ONE, after(5_000));
    expect(service.activeCount()).toBe(0);
    expect(scheduler.pending()).toEqual([]);
  });

  it("reschedules an early advisory callback from the authoritative answer", async () => {
    const process = vi.fn<(gameId: string, deadline: Date) => Promise<DeadlineProcessingResult>>(
      async () => ({
        kind: "reschedule",
        gameId: GAME_ONE,
        deadline: after(20_000),
        serverNow: after(5_000),
      }),
    );
    const { service, clock, scheduler } = harness(1, process);
    service.restore([{ gameId: GAME_ONE, deadline: after(5_000), serverNow: SERVER_NOW }]);

    clock.advance(2_000);
    scheduler.fireAll();
    await vi.waitFor(() => {
      expect(process).toHaveBeenCalledTimes(1);
      expect(scheduler.pending()).toEqual([{ delayMs: 15_000, cancelled: false, fired: false }]);
    });
  });

  it("ignores a callback superseded while its row-lock work is pending", async () => {
    let finish: ((result: DeadlineProcessingResult) => void) | undefined;
    const pending = new Promise<DeadlineProcessingResult>((resolve) => {
      finish = resolve;
    });
    const process = vi.fn(async () => pending);
    const { service, clock, scheduler, onFinished } = harness(1, process);
    service.restore([{ gameId: GAME_ONE, deadline: after(5_000), serverNow: SERVER_NOW }]);

    clock.advance(5_000);
    scheduler.fireAll();
    await vi.waitFor(() => {
      expect(process).toHaveBeenCalledTimes(1);
    });

    service.replace(GAME_ONE, after(30_000), after(5_000));
    finish?.({ kind: "finished", game: {} as GameSnapshot });
    await pending;
    await Promise.resolve();

    expect(onFinished).not.toHaveBeenCalled();
    expect(service.activeCount()).toBe(1);
    expect(scheduler.pending()).toEqual([{ delayMs: 25_000, cancelled: false, fired: false }]);
  });

  it("cancels the one timer on shutdown", () => {
    const { service, scheduler } = harness(1);
    service.restore([{ gameId: GAME_ONE, deadline: after(5_000), serverNow: SERVER_NOW }]);
    service.stop();

    expect(scheduler.pending()).toEqual([]);
    expect(service.activeCount()).toBe(0);
  });
});
