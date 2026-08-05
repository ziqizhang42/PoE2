import {
  allSquares,
  BOARD_SIZE,
  CELL_COUNT,
  createEmptyBoard,
  gameResult,
  replay,
  scoreBoard,
  sideToMove,
  type Game,
} from "@poe2/rules";
import { describe, expect, it } from "vitest";

import {
  ActiveGameSnapshotSchema,
  BoardSchema,
  CellSchema,
  FinishedGameSnapshotSchema,
  GAME_STATUSES,
  GameResultSchema,
  GameSnapshotSchema,
  LobbyEntrySchema,
  PlayerSchema,
  ScoreByPlayerSchema,
  SquareSchema,
  WaitingGameSnapshotSchema,
} from "./game.js";

const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const CREATED_AT = "2026-08-04T10:00:00.000Z";
const UPDATED_AT = "2026-08-04T10:05:00.000Z";

function waitingSnapshot(): unknown {
  return {
    id: GAME_ID,
    revision: 0,
    status: "waiting",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: null },
    board: createEmptyBoard(),
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    sideToMove: null,
    result: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

/** A real game built through the rules package, played `moveCount` plies deep. */
function playedGame(moveCount: number): Game {
  const replayed = replay(allSquares().slice(0, moveCount));

  if (!replayed.ok) {
    throw new Error("expected the generated move sequence to be legal");
  }

  return replayed.game;
}

function activeSnapshot(moveCount = 3): unknown {
  const game = playedGame(moveCount);

  return {
    id: GAME_ID,
    revision: moveCount + 1,
    status: "active",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER },
    board: game.board,
    moves: game.moves,
    scores: scoreBoard(game.board),
    sideToMove: sideToMove(game),
    result: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

function finishedSnapshot(): unknown {
  const game = playedGame(CELL_COUNT);

  return {
    id: GAME_ID,
    revision: CELL_COUNT + 1,
    status: "finished",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER },
    board: game.board,
    moves: game.moves,
    scores: scoreBoard(game.board),
    sideToMove: null,
    result: gameResult(game),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

/** A snapshot with one field replaced, for pinning a single invariant at a time. */
function withField(snapshot: unknown, field: string, value: unknown): unknown {
  return { ...(snapshot as Record<string, unknown>), [field]: value };
}

describe("CellSchema", () => {
  it.each([0, 1, 2])("accepts cell %i", (cell) => {
    expect(CellSchema.safeParse(cell).success).toBe(true);
  });

  it.each([-1, 3, 1.5, "1", null])("rejects %o", (cell) => {
    expect(CellSchema.safeParse(cell).success).toBe(false);
  });
});

describe("PlayerSchema", () => {
  it.each([1, 2])("accepts player %i", (player) => {
    expect(PlayerSchema.safeParse(player).success).toBe(true);
  });

  it.each([0, 3, "1"])("rejects %o", (player) => {
    expect(PlayerSchema.safeParse(player).success).toBe(false);
  });
});

describe("SquareSchema", () => {
  it.each([
    { row: 0, col: 0 },
    { row: BOARD_SIZE - 1, col: BOARD_SIZE - 1 },
    { row: 3, col: 4 },
  ])("accepts %o", (square) => {
    expect(SquareSchema.safeParse(square).success).toBe(true);
  });

  it.each([
    { row: -1, col: 0 },
    { row: 0, col: -1 },
    { row: BOARD_SIZE, col: 0 },
    { row: 0, col: BOARD_SIZE },
    { row: 1.5, col: 0 },
    { row: 0 },
    { row: 0, col: 0, index: 0 },
  ])("rejects %o", (square) => {
    expect(SquareSchema.safeParse(square).success).toBe(false);
  });
});

describe("BoardSchema", () => {
  it("accepts a board of exactly the canonical cell count", () => {
    expect(BoardSchema.safeParse(createEmptyBoard()).success).toBe(true);
  });

  it("rejects a board that is one cell short or one cell long", () => {
    const board = createEmptyBoard();
    expect(BoardSchema.safeParse(board.slice(1)).success).toBe(false);
    expect(BoardSchema.safeParse([...board, 0]).success).toBe(false);
  });

  it("rejects a board holding a value that is not a cell", () => {
    const board = [...createEmptyBoard()];
    board[10] = 3 as never;
    expect(BoardSchema.safeParse(board).success).toBe(false);
  });
});

describe("ScoreByPlayerSchema", () => {
  it("accepts raw integer scores", () => {
    expect(ScoreByPlayerSchema.safeParse({ playerOne: 12, playerTwo: 9 }).success).toBe(true);
  });

  it.each([
    { playerOne: -1, playerTwo: 0 },
    { playerOne: 1.5, playerTwo: 0 },
    { playerOne: 1, playerTwo: 0, total: 1 },
    { playerOne: 1 },
  ])("rejects %o", (scores) => {
    expect(ScoreByPlayerSchema.safeParse(scores).success).toBe(false);
  });
});

describe("GameResultSchema", () => {
  it("accepts the terminal result the rules package produces", () => {
    const result = gameResult(playedGame(CELL_COUNT));

    expect(result).not.toBeNull();
    expect(GameResultSchema.safeParse(result).success).toBe(true);
  });

  it("requires the explicitly named half-point margin", () => {
    const result = {
      scores: { playerOne: 20, playerTwo: 10 },
      winner: 1,
      marginHalfPoints: 9,
    };

    expect(GameResultSchema.safeParse(result).success).toBe(true);
    expect(GameResultSchema.safeParse(withField(result, "marginHalfPoints", 4.5)).success).toBe(
      false,
    );
    expect(GameResultSchema.safeParse({ scores: result.scores, winner: 1 }).success).toBe(false);
    expect(GameResultSchema.safeParse({ ...result, margin: 4.5 }).success).toBe(false);
  });
});

describe("LobbyEntrySchema", () => {
  it("accepts a waiting lobby entry", () => {
    expect(
      LobbyEntrySchema.safeParse({
        id: GAME_ID,
        playerOne: PLAYER_ONE_USER,
        createdAt: CREATED_AT,
      }).success,
    ).toBe(true);
  });

  it.each([
    { id: "not-a-uuid", playerOne: PLAYER_ONE_USER, createdAt: CREATED_AT },
    { id: GAME_ID, playerOne: PLAYER_ONE_USER, createdAt: "yesterday" },
    { id: GAME_ID, playerOne: { id: PLAYER_ONE_USER.id }, createdAt: CREATED_AT },
    { id: GAME_ID, playerOne: PLAYER_ONE_USER, createdAt: CREATED_AT, private: true },
  ])("rejects %o", (entry) => {
    expect(LobbyEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe("GameSnapshotSchema", () => {
  it("names every status the union covers", () => {
    expect(GAME_STATUSES).toEqual(["waiting", "active", "finished"]);
  });

  it("accepts a waiting snapshot", () => {
    expect(GameSnapshotSchema.safeParse(waitingSnapshot()).success).toBe(true);
    expect(WaitingGameSnapshotSchema.safeParse(waitingSnapshot()).success).toBe(true);
  });

  it("accepts an active snapshot generated by the rules package", () => {
    expect(GameSnapshotSchema.safeParse(activeSnapshot()).success).toBe(true);
    expect(ActiveGameSnapshotSchema.safeParse(activeSnapshot()).success).toBe(true);
  });

  it("accepts a finished snapshot generated by the rules package", () => {
    expect(GameSnapshotSchema.safeParse(finishedSnapshot()).success).toBe(true);
    expect(FinishedGameSnapshotSchema.safeParse(finishedSnapshot()).success).toBe(true);
  });

  it.each([
    ["a second player", "players", { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER }],
    ["a side to move", "sideToMove", 1],
    [
      "a result",
      "result",
      { scores: { playerOne: 0, playerTwo: 0 }, winner: 2, marginHalfPoints: -11 },
    ],
    ["played moves", "moves", [{ row: 0, col: 0 }]],
  ])("rejects a waiting snapshot with %s", (_label, field, value) => {
    expect(GameSnapshotSchema.safeParse(withField(waitingSnapshot(), field, value)).success).toBe(
      false,
    );
  });

  it.each([
    ["no second player", "players", { playerOne: PLAYER_ONE_USER, playerTwo: null }],
    ["no side to move", "sideToMove", null],
    [
      "a result",
      "result",
      { scores: { playerOne: 0, playerTwo: 0 }, winner: 2, marginHalfPoints: -11 },
    ],
  ])("rejects an active snapshot with %s", (_label, field, value) => {
    expect(GameSnapshotSchema.safeParse(withField(activeSnapshot(), field, value)).success).toBe(
      false,
    );
  });

  it.each([
    ["no result", "result", null],
    ["a side to move", "sideToMove", 1],
    ["no second player", "players", { playerOne: PLAYER_ONE_USER, playerTwo: null }],
  ])("rejects a finished snapshot with %s", (_label, field, value) => {
    expect(GameSnapshotSchema.safeParse(withField(finishedSnapshot(), field, value)).success).toBe(
      false,
    );
  });

  it.each([
    ["an unknown status", "status", "cancelled"],
    ["a non-UUID identifier", "id", "game-1"],
    ["a negative revision", "revision", -1],
    ["a fractional revision", "revision", 0.5],
    ["a short board", "board", createEmptyBoard().slice(1)],
    ["a non-ISO timestamp", "createdAt", "2026-08-04"],
  ])("rejects any snapshot with %s", (_label, field, value) => {
    expect(GameSnapshotSchema.safeParse(withField(activeSnapshot(), field, value)).success).toBe(
      false,
    );
  });

  it("rejects extra properties", () => {
    expect(
      GameSnapshotSchema.safeParse({ ...(activeSnapshot() as object), spectators: [] }).success,
    ).toBe(false);
  });

  it("never carries a session token or password", () => {
    const snapshot = activeSnapshot() as Record<string, unknown>;

    expect(Object.keys(snapshot)).not.toContain("token");
    expect(GameSnapshotSchema.safeParse({ ...snapshot, token: "secret" }).success).toBe(false);
  });
});
