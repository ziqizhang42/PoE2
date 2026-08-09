import { describe, expect, it } from "vitest";

import { createFakeClock } from "../test-doubles.js";
import { createMemoryRateLimiter, type MemoryRateLimiterOptions } from "./rate-limiter.js";

function build(overrides: Partial<MemoryRateLimiterOptions> = {}) {
  const clock = createFakeClock();
  const limiter = createMemoryRateLimiter({
    capacity: 3,
    refillPerSecond: 1,
    maxKeys: 4,
    clock,
    ...overrides,
  });

  return { clock, limiter };
}

async function drain(
  limiter: ReturnType<typeof build>["limiter"],
  key: string,
  capacity: number,
): Promise<void> {
  for (let spent = 0; spent < capacity; spent += 1) {
    expect((await limiter.consume(key)).allowed).toBe(true);
  }
}

describe("in-memory rate limiter", () => {
  it("keeps separate keys in separate budgets", async () => {
    const { limiter } = build();

    await drain(limiter, "one", 3);

    expect((await limiter.consume("one")).allowed).toBe(false);
    expect((await limiter.consume("two")).allowed).toBe(true);
  });

  it("lets a throttled key back in once its budget refills", async () => {
    const { clock, limiter } = build();

    await drain(limiter, "one", 3);
    const refused = await limiter.consume("one");
    expect(refused.allowed).toBe(false);

    clock.advance(refused.retryAfterMs);

    expect((await limiter.consume("one")).allowed).toBe(true);
  });

  it("forgets a key only once a fresh bucket would be identical", async () => {
    const { clock, limiter } = build();

    await limiter.consume("one");
    expect(limiter.trackedKeys()).toBe(1);

    await limiter.consume("two");
    await limiter.consume("three");
    await limiter.consume("four");
    expect(limiter.trackedKeys()).toBe(4);

    clock.advance(3_000);
    expect((await limiter.consume("five")).allowed).toBe(true);
    expect(limiter.trackedKeys()).toBe(1);
  });

  it("refuses a new key rather than evicting a live one when full", async () => {
    const { limiter } = build();

    await limiter.consume("one");
    await limiter.consume("two");
    await limiter.consume("three");
    await limiter.consume("four");

    const refused = await limiter.consume("five");

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.trackedKeys()).toBe(4);
  });

  it("does not let a spray flush the bucket that is throttling it", async () => {
    const { limiter } = build();

    await drain(limiter, "attacker", 3);
    expect((await limiter.consume("attacker")).allowed).toBe(false);

    for (const key of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      await limiter.consume(key);
    }

    expect((await limiter.consume("attacker")).allowed).toBe(false);
  });

  it("keeps serving keys it already knows while the store is full", async () => {
    const { limiter } = build();

    await limiter.consume("regular");
    await limiter.consume("two");
    await limiter.consume("three");
    await limiter.consume("four");

    expect((await limiter.consume("stranger")).allowed).toBe(false);
    expect((await limiter.consume("regular")).allowed).toBe(true);
  });

  it("refuses nonsense configuration outright", () => {
    expect(() => build({ maxKeys: 0 })).toThrow(RangeError);
    expect(() => build({ capacity: 0 })).toThrow(RangeError);
    expect(() => build({ refillPerSecond: 0 })).toThrow(RangeError);
  });
});
