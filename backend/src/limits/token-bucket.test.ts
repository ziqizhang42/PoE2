import { describe, expect, it } from "vitest";

import { draw, newBucket, reclaimableAfterMs, type TokenBucketOptions } from "./token-bucket.js";

const OPTIONS: TokenBucketOptions = { capacity: 4, refillPerSecond: 2 };

describe("token bucket", () => {
  it("starts full, so a first request is never refused", () => {
    const state = newBucket(OPTIONS, 1_000);

    expect(state.tokens).toBe(OPTIONS.capacity);
    expect(draw(state, OPTIONS, 1_000).allowed).toBe(true);
  });

  it("allows exactly the capacity as a burst, then refuses", () => {
    let state = newBucket(OPTIONS, 0);

    for (let spent = 0; spent < OPTIONS.capacity; spent += 1) {
      const drawn = draw(state, OPTIONS, 0);
      expect(drawn.allowed).toBe(true);
      state = drawn.state;
    }

    expect(draw(state, OPTIONS, 0).allowed).toBe(false);
  });

  it("says how long to wait, and the wait is enough", () => {
    let state = newBucket(OPTIONS, 0);
    for (let spent = 0; spent < OPTIONS.capacity; spent += 1) {
      state = draw(state, OPTIONS, 0).state;
    }

    const refused = draw(state, OPTIONS, 0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(500);

    expect(draw(refused.state, OPTIONS, refused.retryAfterMs).allowed).toBe(true);
  });

  it("does not spend anything on a refused draw, so retrying cannot dig a hole", () => {
    let state = newBucket(OPTIONS, 0);
    for (let spent = 0; spent < OPTIONS.capacity; spent += 1) {
      state = draw(state, OPTIONS, 0).state;
    }

    const first = draw(state, OPTIONS, 0);
    const second = draw(first.state, OPTIONS, 0);

    expect(second.state.tokens).toBe(first.state.tokens);
    expect(second.retryAfterMs).toBe(first.retryAfterMs);
  });

  it("refills over time but never past capacity", () => {
    let state = newBucket(OPTIONS, 0);
    for (let spent = 0; spent < OPTIONS.capacity; spent += 1) {
      state = draw(state, OPTIONS, 0).state;
    }

    const drawn = draw(state, OPTIONS, 3_600_000);
    expect(drawn.state.tokens).toBe(OPTIONS.capacity - 1);
  });

  it("charges nothing for a clock that reads backwards", () => {
    const state = { tokens: 2, updatedAtMs: 5_000 };
    const drawn = draw(state, OPTIONS, 1_000);

    expect(drawn.allowed).toBe(true);
    expect(drawn.state.tokens).toBe(1);
  });

  it("reports the idle window after which a bucket is as good as new", () => {
    expect(reclaimableAfterMs(OPTIONS)).toBe(2_000);
  });
});
