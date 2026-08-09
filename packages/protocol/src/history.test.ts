import { describe, expect, it } from "vitest";

import { GameHistoryEntrySchema, GameReplaySchema } from "./history.js";

const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const ONE = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const TWO = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const AT = "2026-08-04T10:00:00.000Z";
const STOPPED = "2026-08-04T10:00:10.000Z";
const UNTIMED = { kind: "untimed", initialMs: null, incrementMs: null } as const;

describe("history time controls", () => {
  it("requires the persisted control on a summary", () => {
    const entry = {
      id: GAME_ID,
      seat: 1,
      opponent: TWO,
      rated: false,
      timeControl: UNTIMED,
      outcome: { reason: "resignation", winner: 1, finishedAt: STOPPED },
      scores: { playerOne: 2, playerTwo: 0 },
      plies: 1,
      ratingChange: null,
      createdAt: AT,
    };
    expect(GameHistoryEntrySchema.safeParse(entry).success).toBe(true);
    const { timeControl: _timeControl, ...missing } = entry;
    expect(GameHistoryEntrySchema.safeParse(missing).success).toBe(false);
  });

  it("keeps untimed replay moves square-only and clock history null", () => {
    expect(
      GameReplaySchema.safeParse({
        id: GAME_ID,
        players: { playerOne: ONE, playerTwo: TWO },
        rated: false,
        timeControl: UNTIMED,
        moves: [{ row: 0, col: 0 }],
        clockHistory: null,
        outcome: { reason: "resignation", winner: 1, finishedAt: STOPPED },
        createdAt: AT,
      }).success,
    ).toBe(true);
  });

  it("requires one sequential clock record per timed move", () => {
    const replay = {
      id: GAME_ID,
      players: { playerOne: ONE, playerTwo: TWO },
      rated: true,
      timeControl: { kind: "timed", initialMs: 301_000, incrementMs: 4_000 },
      moves: [{ row: 0, col: 0 }],
      clockHistory: {
        moves: [
          {
            ply: 1,
            acceptedAt: STOPPED,
            elapsedMs: 10_000,
            incrementAppliedMs: 4_000,
            remainingMs: { playerOne: 295_000, playerTwo: 301_000 },
          },
        ],
        final: {
          remainingMs: { playerOne: 295_000, playerTwo: 0 },
          stoppedAt: STOPPED,
        },
      },
      outcome: { reason: "timeout", winner: 1, finishedAt: STOPPED },
      createdAt: AT,
    };

    expect(GameReplaySchema.safeParse(replay).success).toBe(true);
    expect(
      GameReplaySchema.safeParse({
        ...replay,
        clockHistory: { ...replay.clockHistory, moves: [] },
      }).success,
    ).toBe(false);
    expect(
      GameReplaySchema.safeParse({
        ...replay,
        clockHistory: {
          ...replay.clockHistory,
          moves: [{ ...replay.clockHistory.moves[0], ply: 2 }],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects clock history on an untimed replay", () => {
    const timedHistory = {
      moves: [],
      final: { remainingMs: { playerOne: 1, playerTwo: 1 }, stoppedAt: STOPPED },
    };
    expect(
      GameReplaySchema.safeParse({
        id: GAME_ID,
        players: { playerOne: ONE, playerTwo: TWO },
        rated: false,
        timeControl: UNTIMED,
        moves: [],
        clockHistory: timedHistory,
        outcome: { reason: "resignation", winner: 1, finishedAt: STOPPED },
        createdAt: AT,
      }).success,
    ).toBe(false);
  });
});
