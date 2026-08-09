import { describe, expect, it } from "vitest";

import { describeRatingHistory, ratingHistoryShape } from "./rating-history.ts";

function line(...ratings: readonly number[]) {
  return ratings.map((rating, index) => ({
    at: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
    rating,
  }));
}

describe("ratingHistoryShape", () => {
  it.each([
    ["nothing", []],
    ["a single point", line(1500)],
  ])("refuses to draw %s", (_label, points) => {
    expect(ratingHistoryShape(points)).toBeNull();
  });

  it("scales between the lowest and highest the line reached", () => {
    const shape = ratingHistoryShape(line(1500, 1600, 1400));

    expect(shape?.lowest).toBe(1400);
    expect(shape?.highest).toBe(1600);
    expect(shape?.current).toBe(1400);
    expect(shape?.heights).toEqual([0.5, 1, 0]);
  });

  it("counts results rather than points", () => {
    expect(ratingHistoryShape(line(1500, 1516, 1499))?.ratedGames).toBe(2);
  });

  it("puts a flat line down the middle", () => {
    expect(ratingHistoryShape(line(1500, 1500, 1500))?.heights).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("describeRatingHistory", () => {
  function describe_(...ratings: readonly number[]): string {
    const shape = ratingHistoryShape(line(...ratings));
    if (shape === null) {
      throw new Error("expected a drawable line");
    }
    return describeRatingHistory(shape);
  }

  it("says where the rating is now and where it came from", () => {
    expect(describe_(1500, 1560)).toBe(
      "Rating over 1 rated game: now 1560, up from 1500. Highest 1560, lowest 1500.",
    );
  });

  it("says when it has fallen", () => {
    expect(describe_(1500, 1440, 1420)).toBe(
      "Rating over 2 rated games: now 1420, down from 1500. Highest 1500, lowest 1420.",
    );
  });

  it("says when it has come back to where it began", () => {
    expect(describe_(1500, 1560, 1500)).toBe(
      "Rating over 2 rated games: now 1500, level with where it started, 1500. Highest 1560, lowest 1500.",
    );
  });
});
