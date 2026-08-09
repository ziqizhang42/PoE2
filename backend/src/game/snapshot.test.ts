import { GameSnapshotSchema } from "@poe2/protocol";
import {
  allSquares,
  CELL_COUNT,
  createEmptyBoard,
  gameResult,
  PLAYER_ONE,
  PLAYER_TWO,
  replay,
  scoreBoard,
  type Player,
  type Square,
} from "@poe2/rules";
import { describe, expect, it } from "vitest";

import {
  CorruptGameError,
  isParticipant,
  seatOf,
  toGameSnapshot,
  toLobbyEntry,
  type StoredGame,
  type StoredOutcome,
} from "./snapshot.js";

const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const CREATED_AT = new Date("2026-08-04T10:00:00.000Z");
const UPDATED_AT = new Date("2026-08-04T10:05:00.000Z");
const FINISHED_AT = new Date("2026-08-04T10:30:00.000Z");

function boardFull(winner: Player): StoredOutcome {
  return { reason: "board_full", winner, finishedAt: FINISHED_AT };
}

function storedGame(overrides: Partial<StoredGame> = {}): StoredGame {
  return {
    id: GAME_ID,
    playerOne: PLAYER_ONE_USER,
    playerTwo: null,
    creatorId: PLAYER_ONE_USER.id,
    creatorSeat: PLAYER_ONE,
    status: "waiting",
    rated: false,
    readyCheckGeneration: 0,
    readyCheck: null,
    activatedRevision: null,
    timeControl: { kind: "untimed", initialMs: null, incrementMs: null },
    clock: null,
    moveClocks: [],
    serverNow: UPDATED_AT,
    revision: 0,
    moves: [],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    outcome: null,
    ...overrides,
  };
}

function firstMoves(count: number): readonly Square[] {
  return allSquares().slice(0, count);
}

describe("seat helpers", () => {
  const game = storedGame({ playerTwo: PLAYER_TWO_USER, status: "active" });

  it("recognises both participants", () => {
    expect(isParticipant(game, PLAYER_ONE_USER.id)).toBe(true);
    expect(isParticipant(game, PLAYER_TWO_USER.id)).toBe(true);
    expect(seatOf(game, PLAYER_ONE_USER.id)).toBe(PLAYER_ONE);
    expect(seatOf(game, PLAYER_TWO_USER.id)).toBe(PLAYER_TWO);
  });

  it("gives a stranger no seat", () => {
    expect(isParticipant(game, "d0f0a2ba-1ec1-4c02-9d9f-2b1d0a0b6a55")).toBe(false);
    expect(seatOf(game, "d0f0a2ba-1ec1-4c02-9d9f-2b1d0a0b6a55")).toBeNull();
  });

  it("gives the second seat to nobody while a game is waiting", () => {
    expect(seatOf(storedGame(), PLAYER_TWO_USER.id)).toBeNull();
  });
});

describe("toLobbyEntry", () => {
  it("exposes only the lobby's identity, owner, seat, stakes, and age", () => {
    expect(toLobbyEntry(storedGame())).toEqual({
      id: GAME_ID,
      owner: PLAYER_ONE_USER,
      creatorSeat: PLAYER_ONE,
      rated: false,
      timeControl: { kind: "untimed", initialMs: null, incrementMs: null },
      createdAt: CREATED_AT.toISOString(),
    });
  });

  it("carries the seat the owner asked for", () => {
    expect(toLobbyEntry(storedGame({ creatorSeat: PLAYER_TWO })).creatorSeat).toBe(PLAYER_TWO);
  });

  it("says whether taking the seat would put a rating at stake", () => {
    expect(toLobbyEntry(storedGame({ rated: true })).rated).toBe(true);
  });
});

describe("toGameSnapshot", () => {
  it("builds a valid waiting snapshot", () => {
    const snapshot = toGameSnapshot(storedGame());

    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot).toMatchObject({
      status: "waiting",
      board: createEmptyBoard(),
      moves: [],
      scores: { playerOne: 0, playerTwo: 0 },
      sideToMove: null,
      outcome: null,
      players: { playerOne: PLAYER_ONE_USER, playerTwo: null },
    });
  });

  it("replays the board and scores from the stored moves alone", () => {
    const moves = firstMoves(5);
    const replayed = replay(moves);
    const snapshot = toGameSnapshot(
      storedGame({ playerTwo: PLAYER_TWO_USER, status: "active", revision: 6, moves }),
    );

    expect(replayed.ok).toBe(true);
    expect(snapshot.board).toEqual(replayed.ok ? replayed.game.board : null);
    expect(snapshot.scores).toEqual(scoreBoard(snapshot.board));
    expect(snapshot.status).toBe("active");
    expect(snapshot.sideToMove).toBe(PLAYER_TWO);
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("agrees with the rules package on who won a game the board decided", () => {
    // Keep historical outcomes readable if scoring rules later change.
    const moves = firstMoves(CELL_COUNT);
    const replayed = replay(moves);
    const expected = replayed.ok ? gameResult(replayed.game) : null;
    if (expected === null) {
      throw new Error("expected a full board to have a result");
    }

    const snapshot = toGameSnapshot(
      storedGame({
        playerTwo: PLAYER_TWO_USER,
        status: "finished",
        revision: CELL_COUNT + 1,
        moves,
        outcome: boardFull(expected.winner),
      }),
    );

    expect(snapshot.outcome).toEqual({
      reason: "board_full",
      winner: expected.winner,
      finishedAt: FINISHED_AT.toISOString(),
    });
    expect(snapshot.sideToMove).toBeNull();
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("accepts a resignation on a board that is nowhere near full", () => {
    const moves = firstMoves(7);

    const snapshot = toGameSnapshot(
      storedGame({
        playerTwo: PLAYER_TWO_USER,
        status: "finished",
        revision: 8,
        moves,
        outcome: { reason: "resignation", winner: PLAYER_TWO, finishedAt: FINISHED_AT },
      }),
    );

    expect(snapshot.status).toBe("finished");
    expect(snapshot.outcome?.reason).toBe("resignation");
    expect(snapshot.outcome?.winner).toBe(PLAYER_TWO);
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("refuses a finished game with no recorded outcome", () => {
    expect(() =>
      toGameSnapshot(
        storedGame({ playerTwo: PLAYER_TWO_USER, status: "finished", revision: 2, moves: [] }),
      ),
    ).toThrow(CorruptGameError);
  });

  it("refuses a game decided on points whose board is not full", () => {
    expect(() =>
      toGameSnapshot(
        storedGame({
          playerTwo: PLAYER_TWO_USER,
          status: "finished",
          revision: 2,
          moves: firstMoves(3),
          outcome: boardFull(PLAYER_ONE),
        }),
      ),
    ).toThrow(CorruptGameError);
  });

  it("refuses an unfinished game that carries an outcome", () => {
    expect(() =>
      toGameSnapshot(
        storedGame({
          playerTwo: PLAYER_TWO_USER,
          status: "active",
          revision: 2,
          moves: firstMoves(3),
          outcome: boardFull(PLAYER_ONE),
        }),
      ),
    ).toThrow(CorruptGameError);
  });

  it.each([
    [
      "a waiting game holding a second player",
      storedGame({ playerTwo: PLAYER_TWO_USER }),
      /second player/u,
    ],
    ["a waiting game holding moves", storedGame({ moves: firstMoves(1) }), /played moves/u],
    [
      "an active game with no second player",
      storedGame({ status: "active", moves: firstMoves(1) }),
      /no second player/u,
    ],
    [
      "a game decided on points with an unfilled board",
      storedGame({
        status: "finished",
        playerTwo: PLAYER_TWO_USER,
        moves: firstMoves(3),
        outcome: boardFull(PLAYER_ONE),
      }),
      /unfilled board/u,
    ],
    [
      "a finished game with no recorded outcome",
      storedGame({ status: "finished", playerTwo: PLAYER_TWO_USER, moves: firstMoves(3) }),
      /no recorded outcome/u,
    ],
    [
      "an active game with a filled board",
      storedGame({
        status: "active",
        playerTwo: PLAYER_TWO_USER,
        moves: firstMoves(CELL_COUNT),
      }),
      /filled board/u,
    ],
    [
      "a history replaying the same square twice",
      storedGame({
        status: "active",
        playerTwo: PLAYER_TWO_USER,
        moves: [
          { row: 0, col: 0 },
          { row: 0, col: 0 },
        ],
      }),
      /move 1 is occupied/u,
    ],
  ])("refuses to publish %s", (_label, game, message) => {
    expect(() => toGameSnapshot(game)).toThrow(CorruptGameError);
    expect(() => toGameSnapshot(game)).toThrow(message);
  });
});
