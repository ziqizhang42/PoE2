import { describe, expect, it } from "vitest";

import { normalizeUsername } from "./auth.js";
import {
  PlayerDirectorySchema,
  PlayerErrorResponseSchema,
  PublicPlayerProfileSchema,
} from "./player.js";

const profile = {
  username: "Player_One",
  createdAt: "2026-08-04T10:00:00.000Z",
  rating: { value: 1513, deviation: 87, percentile: 72 },
  ratingHistory: [{ at: "2026-08-04T10:00:00.000Z", rating: 1500 }],
  statistics: {
    totalFinishedGames: 3,
    wins: 1,
    losses: 2,
    ratedWins: 1,
    ratedLosses: 1,
    ratedGames: 2,
    casualGames: 1,
    boardFullGames: 1,
    resignationGames: 1,
    timeoutGames: 1,
  },
};

describe("public player profile", () => {
  it("accepts a rating with no percentile", () => {
    expect(
      PublicPlayerProfileSchema.safeParse({
        ...profile,
        rating: { value: 1500, deviation: 350, percentile: null },
      }).success,
    ).toBe(true);
  });

  it("rejects a rating point carrying anything but a time and a rating", () => {
    expect(
      PublicPlayerProfileSchema.safeParse({
        ...profile,
        ratingHistory: [
          {
            at: "2026-08-04T10:00:00.000Z",
            rating: 1500,
            gameId: "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a profile with no rated results at all", () => {
    expect(PublicPlayerProfileSchema.safeParse({ ...profile, ratingHistory: [] }).success).toBe(
      true,
    );
  });

  it.each([-1, 101, 12.5, "72"])("rejects a percentile of %o", (percentile) => {
    expect(
      PublicPlayerProfileSchema.safeParse({
        ...profile,
        rating: { value: 1513, deviation: 87, percentile },
      }).success,
    ).toBe(false);
  });

  it("accepts the complete public-only shape", () => {
    expect(PublicPlayerProfileSchema.parse(profile)).toEqual(profile);
  });

  it.each([
    { statistics: { ...profile.statistics, totalFinishedGames: 4 } },
    { statistics: { ...profile.statistics, wins: 2 } },
    { statistics: { ...profile.statistics, ratedGames: 3 } },
    { statistics: { ...profile.statistics, timeoutGames: 2 } },
    { statistics: { ...profile.statistics, ratedWins: 2 } },
  ])("rejects inconsistent aggregates", (replacement) => {
    expect(PublicPlayerProfileSchema.safeParse({ ...profile, ...replacement }).success).toBe(false);
  });

  it.each(["id", "volatility", "passwordHash", "sessions", "games", "opponents", "moves"])(
    "rejects private field %s",
    (field) => {
      expect(PublicPlayerProfileSchema.safeParse({ ...profile, [field]: "private" }).success).toBe(
        false,
      );
    },
  );

  it("requires integer display values", () => {
    expect(
      PublicPlayerProfileSchema.safeParse({
        ...profile,
        rating: { value: 1512.5, deviation: 87, percentile: 72 },
      }).success,
    ).toBe(false);
  });
});

describe("player errors", () => {
  it.each([
    "player_not_found",
    "invalid_request",
    "unauthenticated",
    "rate_limited",
    "internal_error",
  ])("accepts %s", (code) => {
    expect(
      PlayerErrorResponseSchema.safeParse({ code, message: "Safe public message" }).success,
    ).toBe(true);
  });

  it("rejects unknown and extra details", () => {
    expect(
      PlayerErrorResponseSchema.safeParse({ code: "permission_denied", message: "No" }).success,
    ).toBe(false);
    expect(
      PlayerErrorResponseSchema.safeParse({
        code: "player_not_found",
        message: "No",
        userId: "private",
      }).success,
    ).toBe(false);
  });
});

describe("player directory", () => {
  const entry = {
    id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1",
    username: "Player_One",
    rating: 1500,
    colorPercentile: 50,
  };

  it("accepts only the public list shape", () => {
    expect(PlayerDirectorySchema.parse([entry])).toEqual([entry]);
    expect(PlayerDirectorySchema.safeParse([{ ...entry, passwordHash: "private" }]).success).toBe(
      false,
    );
  });

  it.each([-1, 101, 50.5, null])("rejects a color percentile of %o", (colorPercentile) => {
    expect(PlayerDirectorySchema.safeParse([{ ...entry, colorPercentile }]).success).toBe(false);
  });

  it("requires a rounded display rating and canonical protocol username", () => {
    expect(PlayerDirectorySchema.safeParse([{ ...entry, rating: 1500.4 }]).success).toBe(false);
    expect(PlayerDirectorySchema.safeParse([{ ...entry, username: "has spaces" }]).success).toBe(
      false,
    );
  });
});

describe("username normalization", () => {
  it("folds ASCII uppercase identically everywhere", () => {
    expect(normalizeUsername("PlAyEr_123")).toBe("player_123");
  });

  it("does not apply non-ASCII locale casing", () => {
    expect(normalizeUsername("İPlayer")).toBe("İplayer");
  });
});
