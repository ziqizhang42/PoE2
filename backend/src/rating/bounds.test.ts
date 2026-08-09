import { describe, expect, it } from "vitest";

import {
  MAX_DEVIATION,
  MIN_DEVIATION,
  withDeviationCeiling,
  withDeviationFloor,
} from "./bounds.js";
import { INITIAL_RATING, updateRating, type Rating } from "./glicko2.js";

const rated = (deviation: number): Rating => ({ rating: 1500, deviation, volatility: 0.06 });

describe("the bounds themselves", () => {
  it("keeps the ceiling strictly below an unrated player's deviation", () => {
    expect(MAX_DEVIATION).toBeLessThan(INITIAL_RATING.deviation);
  });

  it("leaves room between the floor and the ceiling", () => {
    expect(MIN_DEVIATION).toBeLessThan(MAX_DEVIATION);
  });
});

describe("withDeviationFloor", () => {
  it("raises a deviation that has fallen below the floor", () => {
    expect(withDeviationFloor(rated(MIN_DEVIATION - 10)).deviation).toBe(MIN_DEVIATION);
  });

  it("leaves a deviation at the floor alone", () => {
    const at = rated(MIN_DEVIATION);

    expect(withDeviationFloor(at)).toBe(at);
  });

  it("does not apply the ceiling, so a newcomer's first game is not compressed", () => {
    const wide = rated(MAX_DEVIATION + 40);

    expect(withDeviationFloor(wide).deviation).toBe(MAX_DEVIATION + 40);
  });

  it("changes neither the rating nor the volatility", () => {
    const floored = withDeviationFloor({ rating: 1712.5, deviation: 3, volatility: 0.041 });

    expect(floored.rating).toBe(1712.5);
    expect(floored.volatility).toBe(0.041);
  });
});

describe("withDeviationCeiling", () => {
  it("lowers a deviation that has risen above the ceiling", () => {
    expect(withDeviationCeiling(rated(MAX_DEVIATION + 25)).deviation).toBe(MAX_DEVIATION);
  });

  it("leaves a deviation at the ceiling alone", () => {
    const at = rated(MAX_DEVIATION);

    expect(withDeviationCeiling(at)).toBe(at);
  });

  it("does not apply the floor, so a rating resting on the floor stays there", () => {
    expect(withDeviationCeiling(rated(MIN_DEVIATION - 10)).deviation).toBe(MIN_DEVIATION - 10);
  });
});

/** Pins the equilibrium underlying `MIN_DEVIATION`. */
describe("where per-game rating actually settles", () => {
  const opponent = rated(50);

  function playOut(scoreAt: (game: number) => number, games = 2_000): Rating {
    let player: Rating = INITIAL_RATING;
    for (let game = 0; game < games; game += 1) {
      player = updateRating(player, [{ opponent, score: scoreAt(game) }]);
    }
    return player;
  }

  it("reaches an equilibrium rather than falling toward zero", () => {
    const alternating = playOut((game) => game % 2);

    expect(alternating.deviation).toBeGreaterThan(50);
    expect(alternating.deviation).toBeLessThan(70);
  });

  it("settles above the floor whatever the pattern of results", () => {
    const patterns = [
      playOut((game) => game % 2),
      playOut((game) => Math.floor(game / 2) % 2),
      playOut((game) => (game % 10 < 7 ? 1 : 0)),
    ];

    for (const settled of patterns) {
      expect(settled.deviation).toBeGreaterThan(MIN_DEVIATION);
    }
  });

  it("would fall below the floor only if volatility collapsed", () => {
    let player: Rating = { rating: 1500, deviation: 200, volatility: 0.001 };
    for (let game = 0; game < 2_000; game += 1) {
      player = updateRating(player, [{ opponent, score: game % 2 }]);
    }

    expect(player.deviation).toBeLessThan(MIN_DEVIATION);
    expect(withDeviationFloor(player).deviation).toBe(MIN_DEVIATION);
  });
});
