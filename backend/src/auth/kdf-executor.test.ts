import { describe, expect, it } from "vitest";

import { createKdfExecutor, isKdfCapacityError, KdfCapacityError } from "./kdf-executor.js";

/**
 * A stand-in for one Argon2 call that finishes exactly when the test says so,
 * so concurrency is asserted on observed state rather than on timing.
 */
function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

/** Lets queued work start before assertions run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("createKdfExecutor", () => {
  it.each([
    { maxConcurrent: 0, maxQueued: 16 },
    { maxConcurrent: -1, maxQueued: 16 },
    { maxConcurrent: 1.5, maxQueued: 16 },
    { maxConcurrent: 2, maxQueued: -1 },
    { maxConcurrent: 2, maxQueued: 1.5 },
  ])("rejects the invalid limits %o", (options) => {
    expect(() => createKdfExecutor(options)).toThrow(RangeError);
  });

  it("never runs more operations at once than maxConcurrent", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 2, maxQueued: 16 });
    const gates = Array.from({ length: 6 }, () => deferred());
    let active = 0;
    let peakActive = 0;

    const running = gates.map((gate) =>
      executor.run(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await flush();
    expect(active).toBe(2);

    // Release one at a time so a queued operation replaces it immediately.
    for (const gate of gates) {
      gate.resolve();
      await flush();
      expect(active).toBeLessThanOrEqual(2);
    }

    await Promise.all(running);
    expect(peakActive).toBe(2);
    expect(active).toBe(0);
  });

  it("starts queued operations in FIFO order", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 1, maxQueued: 8 });
    const started: number[] = [];
    const gates = Array.from({ length: 4 }, () => deferred());

    const running = gates.map((gate, index) =>
      executor.run(async () => {
        started.push(index);
        await gate.promise;
      }),
    );

    await flush();
    expect(started).toEqual([0]);

    for (const gate of gates) {
      gate.resolve();
      await flush();
    }

    await Promise.all(running);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it("fails fast once the queue is full, without starting the operation", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 1, maxQueued: 2 });
    const gate = deferred();
    let starts = 0;

    const accepted = [
      executor.run(async () => {
        starts += 1;
        await gate.promise;
      }),
      executor.run(async () => {
        starts += 1;
      }),
      executor.run(async () => {
        starts += 1;
      }),
    ];

    await flush();
    expect(starts).toBe(1);

    // One active plus two queued is the whole budget; this one is shed.
    let overflowStarted = false;
    await expect(
      executor.run(async () => {
        overflowStarted = true;
      }),
    ).rejects.toBeInstanceOf(KdfCapacityError);
    expect(overflowStarted).toBe(false);

    gate.resolve();
    await Promise.all(accepted);
    expect(starts).toBe(3);
  });

  it("frees the slot when an operation rejects", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 1, maxQueued: 0 });
    const failure = new Error("argon2 failed");

    await expect(executor.run(() => Promise.reject(failure))).rejects.toBe(failure);

    await expect(executor.run(() => Promise.resolve("second"))).resolves.toBe("second");
  });

  it("frees the slot when an operation throws synchronously", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 1, maxQueued: 0 });

    await expect(
      executor.run(() => {
        throw new Error("synchronous failure");
      }),
    ).rejects.toThrow("synchronous failure");

    await expect(executor.run(() => Promise.resolve("second"))).resolves.toBe("second");
  });

  it("rejects immediately when maxQueued is zero and every slot is busy", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 1, maxQueued: 0 });
    const gate = deferred();
    const running = executor.run(() => gate.promise);

    const shed = await executor.run(() => Promise.resolve()).catch((error: unknown) => error);
    expect(isKdfCapacityError(shed)).toBe(true);

    gate.resolve();
    await running;
  });

  it("resolves and rejects queued operations with their own results", async () => {
    const executor = createKdfExecutor({ maxConcurrent: 1, maxQueued: 4 });
    const gate = deferred();
    const blocking = executor.run(() => gate.promise);
    const failure = new Error("queued failure");

    const queuedValue = executor.run(() => Promise.resolve("queued"));
    const queuedFailure = executor.run(() => Promise.reject(failure));

    gate.resolve();
    await blocking;

    await expect(queuedValue).resolves.toBe("queued");
    await expect(queuedFailure).rejects.toBe(failure);
  });
});
