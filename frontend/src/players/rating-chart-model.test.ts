import { describe, expect, it } from "vitest";

import type { RatingPoint } from "@poe2/protocol";

import { indexAtFraction, pointsInRange, RATING_RANGES } from "./rating-chart-model.ts";

const NOW = Date.parse("2026-08-07T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function range(id: string) {
  const found = RATING_RANGES.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new RangeError(id);
  }
  return found;
}

function pointsAgo(days: readonly number[]): readonly RatingPoint[] {
  return days.map((ago, index) => ({
    at: new Date(NOW - ago * DAY).toISOString(),
    rating: 1500 + index,
  }));
}

describe("pointsInRange", () => {
  it("keeps the whole available line for the last-100 range", () => {
    const points = pointsAgo([90, 40, 2, 0]);
    expect(pointsInRange(points, range("all"), NOW)).toHaveLength(4);
    expect(range("all").label).toBe("Last 100");
  });

  it("anchors a window to the point before it, so the first result is a move", () => {
    const points = pointsAgo([90, 40, 2, 0]);
    const week = pointsInRange(points, range("1w"), NOW);

    expect(week).toHaveLength(3);
    expect(week[0]).toBe(points[1]);
  });

  it("is empty when nothing landed in the window", () => {
    const points = pointsAgo([90, 40]);
    expect(pointsInRange(points, range("1d"), NOW)).toHaveLength(0);
  });

  it("does not reach past the start of the line for its anchor", () => {
    const points = pointsAgo([2, 0]);
    expect(pointsInRange(points, range("1w"), NOW)).toHaveLength(2);
  });
});

describe("indexAtFraction", () => {
  it("lands on the nearest point rather than the one to the left", () => {
    expect(indexAtFraction(0.24, 5)).toBe(1);
    expect(indexAtFraction(0.26, 5)).toBe(1);
    expect(indexAtFraction(0.4, 5)).toBe(2);
  });

  it("clamps a pointer that has left the plot", () => {
    expect(indexAtFraction(-3, 5)).toBe(0);
    expect(indexAtFraction(9, 5)).toBe(4);
  });

  it("has nowhere to go on a single point", () => {
    expect(indexAtFraction(0.9, 1)).toBe(0);
  });
});
