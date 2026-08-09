import { describe, expect, it, vi } from "vitest";

import { createCommandQueue } from "./command-queue.js";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve = (): void => {};
  let reject = (_error: Error): void => {};

  const promise = new Promise<void>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });

  return { promise, resolve, reject };
}

describe("bounded command queue", () => {
  it("runs work in arrival order, one at a time", async () => {
    const order: number[] = [];
    const queue = createCommandQueue({ maxDepth: 4, onError: () => {} });

    const first = deferred();
    queue.enqueue(async () => {
      await first.promise;
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(order).toStrictEqual([]);

    first.resolve();
    await vi.waitFor(() => {
      expect(order).toStrictEqual([1, 2]);
    });
  });

  it("refuses work past its depth without queueing it", async () => {
    const queue = createCommandQueue({ maxDepth: 2, onError: () => {} });
    const blocker = deferred();
    const ran: string[] = [];

    expect(
      queue.enqueue(async () => {
        await blocker.promise;
        ran.push("first");
      }),
    ).toBe(true);
    expect(
      queue.enqueue(() => {
        ran.push("second");
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(
      queue.enqueue(() => {
        ran.push("third");
        return Promise.resolve();
      }),
    ).toBe(false);

    blocker.resolve();
    await vi.waitFor(() => {
      expect(queue.depth()).toBe(0);
    });

    expect(ran).toStrictEqual(["first", "second"]);
  });

  it("counts a running command in its depth", async () => {
    const queue = createCommandQueue({ maxDepth: 4, onError: () => {} });
    const blocker = deferred();

    queue.enqueue(() => blocker.promise);
    expect(queue.depth()).toBe(1);

    blocker.resolve();
    await vi.waitFor(() => {
      expect(queue.depth()).toBe(0);
    });
  });

  it("does not leak depth when a command throws", async () => {
    const onError = vi.fn();
    const queue = createCommandQueue({ maxDepth: 2, onError });

    queue.enqueue(() => Promise.reject(new Error("boom")));
    queue.enqueue(() => Promise.reject(new Error("boom again")));

    await vi.waitFor(() => {
      expect(queue.depth()).toBe(0);
    });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(queue.enqueue(() => Promise.resolve())).toBe(true);
  });

  it("keeps running later commands after one fails", async () => {
    const ran: string[] = [];
    const queue = createCommandQueue({ maxDepth: 4, onError: () => {} });

    queue.enqueue(() => Promise.reject(new Error("boom")));
    queue.enqueue(() => {
      ran.push("after");
      return Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(ran).toStrictEqual(["after"]);
    });
  });

  it("reports a command that threw synchronously rather than losing it", async () => {
    const onError = vi.fn();
    const queue = createCommandQueue({ maxDepth: 2, onError });

    queue.enqueue(() => {
      throw new Error("thrown before any await");
    });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(queue.depth()).toBe(0);
  });

  it("refuses nonsense configuration outright", () => {
    expect(() => createCommandQueue({ maxDepth: 0, onError: () => {} })).toThrow(RangeError);
  });
});
