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
} from "./snapshot.js";

const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const CREATED_AT = new Date("2026-08-04T10:00:00.000Z");
const UPDATED_AT = new Date("2026-08-04T10:05:00.000Z");

function storedGame(overrides: Partial<StoredGame> = {}): StoredGame {
  return {
    id: GAME_ID,
    playerOne: PLAYER_ONE_USER,
    playerTwo: null,
    status: "waiting",
    revision: 0,
    moves: [],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
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
  it("exposes only the lobby's identity, owner, and age", () => {
    expect(toLobbyEntry(storedGame())).toEqual({
      id: GAME_ID,
      playerOne: PLAYER_ONE_USER,
      createdAt: CREATED_AT.toISOString(),
    });
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
      result: null,
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
    // Five moves played, so it is Player 2's turn.
    expect(snapshot.sideToMove).toBe(PLAYER_TWO);
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("agrees with the rules package on a finished game's result", () => {
    const moves = firstMoves(CELL_COUNT);
    const replayed = replay(moves);
    const snapshot = toGameSnapshot(
      storedGame({
        playerTwo: PLAYER_TWO_USER,
        status: "finished",
        revision: CELL_COUNT + 1,
        moves,
      }),
    );

    expect(replayed.ok).toBe(true);
    expect(snapshot.result).toEqual(replayed.ok ? gameResult(replayed.game) : null);
    expect(snapshot.sideToMove).toBeNull();
    expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
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
      "a finished game with an unfilled board",
      storedGame({ status: "finished", playerTwo: PLAYER_TWO_USER, moves: firstMoves(3) }),
      /unfilled board/u,
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
