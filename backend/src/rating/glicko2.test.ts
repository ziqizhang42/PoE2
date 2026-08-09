import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYSTEM,
  INITIAL_RATING,
  skippedPeriod,
  updateRating,
  type Rating,
} from "./glicko2.js";

/** Glickman's published worked example: 1464.06, 151.52, and 0.05999 at τ=0.5. */
const PAPER_PLAYER: Rating = { rating: 1500, deviation: 200, volatility: 0.06 };

const PAPER_OUTCOMES = [
  { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
  { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
  { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
];

describe("Glicko-2 against the published worked example", () => {
  const updated = updateRating(PAPER_PLAYER, PAPER_OUTCOMES, { tau: 0.5 });

  it("produces the paper's rating", () => {
    expect(updated.rating).toBeCloseTo(1464.06, 1);
  });

  it("produces the paper's deviation", () => {
    expect(updated.deviation).toBeCloseTo(151.52, 1);
  });

  it("produces the paper's volatility", () => {
    expect(updated.volatility).toBeCloseTo(0.05999, 4);
  });
});

describe("updateRating", () => {
  const opponent: Rating = { rating: 1500, deviation: 100, volatility: 0.06 };

  it("raises the winner and lowers the loser", () => {
    const won = updateRating(INITIAL_RATING, [{ opponent, score: 1 }]);
    const lost = updateRating(INITIAL_RATING, [{ opponent, score: 0 }]);

    expect(won.rating).toBeGreaterThan(INITIAL_RATING.rating);
    expect(lost.rating).toBeLessThan(INITIAL_RATING.rating);
  });

  it("narrows the deviation when a game is played", () => {
    const played = updateRating(INITIAL_RATING, [{ opponent, score: 1 }]);

    expect(played.deviation).toBeLessThan(INITIAL_RATING.deviation);
  });

  it("moves a provisional rating further than a settled one", () => {
    const provisional = updateRating(INITIAL_RATING, [{ opponent, score: 1 }]);
    const settled = updateRating({ rating: 1500, deviation: 50, volatility: 0.06 }, [
      { opponent, score: 1 },
    ]);

    expect(provisional.rating - INITIAL_RATING.rating).toBeGreaterThan(settled.rating - 1500);
  });

  it("rewards beating a stronger opponent more than a weaker one", () => {
    const beatStrong = updateRating(INITIAL_RATING, [
      { opponent: { rating: 1900, deviation: 100, volatility: 0.06 }, score: 1 },
    ]);
    const beatWeak = updateRating(INITIAL_RATING, [
      { opponent: { rating: 1100, deviation: 100, volatility: 0.06 }, score: 1 },
    ]);

    expect(beatStrong.rating).toBeGreaterThan(beatWeak.rating);
  });

  it("discounts an opponent whose own rating is barely known", () => {
    const beatCertain = updateRating(INITIAL_RATING, [
      { opponent: { rating: 1900, deviation: 30, volatility: 0.06 }, score: 1 },
    ]);
    const beatUncertain = updateRating(INITIAL_RATING, [
      { opponent: { rating: 1900, deviation: 350, volatility: 0.06 }, score: 1 },
    ]);

    expect(beatCertain.rating).toBeGreaterThan(beatUncertain.rating);
  });

  it("keeps a lower system constant from moving volatility as far", () => {
    const upset = [{ opponent: { rating: 2200, deviation: 50, volatility: 0.06 }, score: 1 }];

    const steady = updateRating(PAPER_PLAYER, upset, { tau: 0.2 });
    const loose = updateRating(PAPER_PLAYER, upset, { tau: 1.2 });

    expect(Math.abs(steady.volatility - PAPER_PLAYER.volatility)).toBeLessThan(
      Math.abs(loose.volatility - PAPER_PLAYER.volatility),
    );
  });

  it("treats several games in one period as one update", () => {
    const together = updateRating(INITIAL_RATING, [
      { opponent, score: 1 },
      { opponent, score: 1 },
    ]);
    const oneGame = updateRating(INITIAL_RATING, [{ opponent, score: 1 }]);

    expect(together.rating).toBeGreaterThan(oneGame.rating);
    expect(together.deviation).toBeLessThan(oneGame.deviation);
  });

  it("defaults to the system constant when none is passed", () => {
    expect(updateRating(PAPER_PLAYER, PAPER_OUTCOMES)).toStrictEqual(
      updateRating(PAPER_PLAYER, PAPER_OUTCOMES, DEFAULT_SYSTEM),
    );
  });

  it("produces finite numbers for the most lopsided result possible", () => {
    const result = updateRating({ rating: 100, deviation: 350, volatility: 0.06 }, [
      { opponent: { rating: 2900, deviation: 30, volatility: 0.06 }, score: 1 },
    ]);

    expect(Number.isFinite(result.rating)).toBe(true);
    expect(Number.isFinite(result.deviation)).toBe(true);
    expect(Number.isFinite(result.volatility)).toBe(true);
    expect(result.volatility).toBeGreaterThan(0);
  });
});

describe("skippedPeriod", () => {
  it("leaves the rating alone and widens the deviation", () => {
    const rested = skippedPeriod(INITIAL_RATING);

    expect(rested.rating).toBeCloseTo(INITIAL_RATING.rating, 6);
    expect(rested.deviation).toBeGreaterThan(INITIAL_RATING.deviation);
    expect(rested.volatility).toBe(INITIAL_RATING.volatility);
  });

  it("is what an empty period means", () => {
    expect(updateRating(INITIAL_RATING, [])).toStrictEqual(skippedPeriod(INITIAL_RATING));
  });

  it("widens further the longer the absence", () => {
    const once = skippedPeriod(INITIAL_RATING);

    expect(skippedPeriod(once).deviation).toBeGreaterThan(once.deviation);
  });
});
