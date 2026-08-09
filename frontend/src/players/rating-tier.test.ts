import { describe, expect, it } from "vitest";

import { describeRatingPercentile, percentileAt, ratingColor, ratingScale } from "./rating-tier.ts";

describe("ratingColor", () => {
  it.each([
    [0, "var(--tier-1)"],
    [50, "color-mix(in oklab, var(--tier-4), var(--tier-5) 50%)"],
    [100, "var(--tier-8)"],
  ])("interpolates percentile %d across all eight anchors", (percentile, color) => {
    expect(ratingColor(percentile)).toBe(color);
  });

  it("changes continuously on either side of the old band boundary", () => {
    expect(ratingColor(49)).toBe("color-mix(in oklab, var(--tier-4), var(--tier-5) 43%)");
    expect(ratingColor(50)).toBe("color-mix(in oklab, var(--tier-4), var(--tier-5) 50%)");
  });

  it("gives an unranked player no ranking colour", () => {
    expect(ratingColor(null)).toBeNull();
  });

  it("clamps a percentile outside the range to the end anchors", () => {
    expect(ratingColor(-5)).toBe("var(--tier-1)");
    expect(ratingColor(140)).toBe("var(--tier-8)");
  });
});

describe("describeRatingPercentile", () => {
  it("says the share below, because that is the number the server sent", () => {
    expect(describeRatingPercentile(88)).toBe("Higher than 88% of rated players.");
  });

  it("says an unranked player is unranked rather than giving them a share", () => {
    expect(describeRatingPercentile(null)).toBe(
      "Not ranked yet — a rated game places this rating.",
    );
  });
});

describe("percentileAt", () => {
  it("reproduces the stated percentile at the stated rating", () => {
    expect(percentileAt(1800, 1800, 88)).toBe(88);
    expect(percentileAt(1300, 1300, 21)).toBe(21);
  });

  it("never gives a higher rating a lower share", () => {
    const shares = [1200, 1400, 1600, 1800, 2000].map((rating) => percentileAt(rating, 1800, 88));
    expect(shares).toEqual([...shares].sort((left, right) => left - right));
  });

  it("keeps a curve for a player sitting on the centre, rather than dividing by nothing", () => {
    expect(percentileAt(1500, 1500, 50)).toBe(50);
    expect(percentileAt(1700, 1500, 50)).toBeGreaterThan(50);
  });

  it("stays inside 0 and 100 at the extremes", () => {
    expect(percentileAt(400, 1800, 88)).toBeGreaterThanOrEqual(0);
    expect(percentileAt(4000, 1800, 88)).toBeLessThanOrEqual(100);
  });
});

describe("ratingScale", () => {
  it("has no curve to offer an unranked player", () => {
    expect(ratingScale(1500, null)).toBeNull();
  });

  it("paints a past rating the band it would earn today", () => {
    const scale = ratingScale(1800, 88);
    expect(scale).not.toBeNull();
    expect(scale?.(1800)).toBe(ratingColor(88));
    expect(scale?.(1200)).not.toBe(scale?.(1800));
  });
});
