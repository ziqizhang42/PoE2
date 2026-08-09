import {
  allSquares,
  BOARD_SIZE,
  CELL_COUNT,
  createEmptyBoard,
  gameResult,
  PLAYER_ONE,
  PLAYER_TWO,
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
  ReadyCheckGameSnapshotSchema,
  PlayerSchema,
  ScoreByPlayerSchema,
  SquareSchema,
  MAX_INCREMENT_MS,
  MAX_INITIAL_MS,
  MIN_INITIAL_MS,
  TimeControlSchema,
  timedControl,
  WaitingGameSnapshotSchema,
} from "./game.js";

const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const CREATED_AT = "2026-08-04T10:00:00.000Z";
const UPDATED_AT = "2026-08-04T10:05:00.000Z";
const UNTIMED = { kind: "untimed", initialMs: null, incrementMs: null };

function waitingSnapshot(): unknown {
  return {
    id: GAME_ID,
    revision: 0,
    rated: false,
    timeControl: UNTIMED,
    status: "waiting",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: null },
    creatorSeat: PLAYER_ONE,
    board: createEmptyBoard(),
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    sideToMove: null,
    outcome: null,
    clock: null,
    readyCheck: null,
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
    rated: false,
    timeControl: UNTIMED,
    status: "active",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER },
    board: game.board,
    moves: game.moves,
    scores: scoreBoard(game.board),
    sideToMove: sideToMove(game),
    outcome: null,
    clock: null,
    readyCheck: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  };
}

const FINISHED_AT = "2026-08-04T10:30:00.000Z";

function finishedSnapshot(): unknown {
  const game = playedGame(CELL_COUNT);

  return {
    id: GAME_ID,
    revision: CELL_COUNT + 1,
    rated: true,
    timeControl: UNTIMED,
    status: "finished",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER },
    board: game.board,
    moves: game.moves,
    scores: scoreBoard(game.board),
    sideToMove: null,
    outcome: {
      reason: "board_full",
      winner: gameResult(game)?.winner,
      finishedAt: FINISHED_AT,
    },
    clock: null,
    readyCheck: null,
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
  const entry = {
    id: GAME_ID,
    owner: PLAYER_ONE_USER,
    creatorSeat: PLAYER_ONE,
    rated: false,
    timeControl: UNTIMED,
    createdAt: CREATED_AT,
  };

  it("accepts a waiting lobby entry", () => {
    expect(LobbyEntrySchema.safeParse(entry).success).toBe(true);
    expect(LobbyEntrySchema.safeParse({ ...entry, rated: true }).success).toBe(true);
  });

  it("accepts a lobby whose owner took the second seat", () => {
    expect(LobbyEntrySchema.safeParse({ ...entry, creatorSeat: PLAYER_TWO }).success).toBe(true);
  });

  it.each([
    ["a non-UUID id", { ...entry, id: "not-a-uuid" }],
    ["an unparseable timestamp", { ...entry, createdAt: "yesterday" }],
    ["a partial player", { ...entry, owner: { id: PLAYER_ONE_USER.id } }],
    ["no seat for the owner", { ...entry, creatorSeat: undefined }],
    ["a seat that is not one of the two", { ...entry, creatorSeat: 0 }],
    ["an extra property", { ...entry, private: true }],
    ["no rated flag", { id: GAME_ID, owner: PLAYER_ONE_USER, createdAt: CREATED_AT }],
    ["a non-boolean rated flag", { ...entry, rated: "yes" }],
  ])("rejects %s", (_label, invalid) => {
    expect(LobbyEntrySchema.safeParse(invalid).success).toBe(false);
  });
});

describe("time controls", () => {
  it("accepts an untimed control", () => {
    expect(TimeControlSchema.safeParse(UNTIMED).success).toBe(true);
  });

  it.each([
    ["the shortest clock", MIN_INITIAL_MS, 0],
    ["the longest clock", MAX_INITIAL_MS, MAX_INCREMENT_MS],
    ["an ordinary one nobody preset", 137_000, 7_000],
  ])("accepts %s", (_label, initialMs, incrementMs) => {
    expect(TimeControlSchema.safeParse({ kind: "timed", initialMs, incrementMs }).success).toBe(
      true,
    );
  });

  it("accepts a timed control with no increment", () => {
    expect(timedControl(60_000, 0)).toEqual({ kind: "timed", initialMs: 60_000, incrementMs: 0 });
  });

  it.each([
    [
      "a clock below the floor",
      { kind: "timed", initialMs: MIN_INITIAL_MS - 1_000, incrementMs: 0 },
    ],
    [
      "a clock above the ceiling",
      { kind: "timed", initialMs: MAX_INITIAL_MS + 1_000, incrementMs: 0 },
    ],
    [
      "an increment above the ceiling",
      { kind: "timed", initialMs: 60_000, incrementMs: MAX_INCREMENT_MS + 1_000 },
    ],
    ["a negative increment", { kind: "timed", initialMs: 60_000, incrementMs: -1_000 }],
    ["a fraction of a second", { kind: "timed", initialMs: 60_500, incrementMs: 0 }],
    [
      "a fraction of a second of increment",
      { kind: "timed", initialMs: 60_000, incrementMs: 1_500 },
    ],
    ["durations on an untimed control", { kind: "untimed", initialMs: 60_000, incrementMs: null }],
    ["half a control", { kind: "timed", initialMs: 60_000, incrementMs: null }],
    [
      "a preset name where a kind belongs",
      { kind: "5m_3s", initialMs: 300_000, incrementMs: 3_000 },
    ],
  ])("rejects %s", (_label, control) => {
    expect(TimeControlSchema.safeParse(control).success).toBe(false);
  });

  it.each([
    [MIN_INITIAL_MS - 1_000, 0],
    [60_500, 0],
    [60_000, MAX_INCREMENT_MS + 1_000],
  ])("returns null from timedControl for %d + %d", (initialMs, incrementMs) => {
    expect(timedControl(initialMs, incrementMs)).toBeNull();
  });
});

function readyCheckSnapshot(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: GAME_ID,
    revision: 1,
    rated: false,
    timeControl: UNTIMED,
    status: "ready_check",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER },
    board: createEmptyBoard(),
    moves: [],
    scores: { playerOne: 0, playerTwo: 0 },
    sideToMove: null,
    outcome: null,
    clock: null,
    readyCheck: {
      generation: 1,
      playerOneReady: false,
      playerTwoReady: false,
      deadline: "2026-08-04T10:06:00.000Z",
      serverNow: UPDATED_AT,
    },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

describe("GameSnapshotSchema", () => {
  it("accepts a ready check with two seats and nothing started", () => {
    expect(GameSnapshotSchema.safeParse(readyCheckSnapshot()).success).toBe(true);
    expect(ReadyCheckGameSnapshotSchema.safeParse(readyCheckSnapshot()).success).toBe(true);
  });

  it("rejects a check both players have confirmed", () => {
    expect(
      GameSnapshotSchema.safeParse(
        readyCheckSnapshot({
          readyCheck: {
            generation: 1,
            playerOneReady: true,
            playerTwoReady: true,
            deadline: "2026-08-04T10:06:00.000Z",
            serverNow: UPDATED_AT,
          },
        }),
      ).success,
    ).toBe(false);
  });

  it.each([
    ["a second seat", { players: { playerOne: PLAYER_ONE_USER, playerTwo: null } }],
    ["moves it cannot have played", { moves: [{ row: 0, col: 0 }] }],
    ["a side to move", { sideToMove: 1 }],
    [
      "a running clock",
      {
        clock: {
          remainingMs: { playerOne: 1_000, playerTwo: 1_000 },
          runningPlayer: 1,
          turnStartedAt: CREATED_AT,
          deadline: UPDATED_AT,
          serverNow: UPDATED_AT,
        },
      },
    ],
  ])("rejects a ready check with %s", (_label, overrides) => {
    expect(GameSnapshotSchema.safeParse(readyCheckSnapshot(overrides)).success).toBe(false);
  });

  it("names every status the union covers", () => {
    expect(GAME_STATUSES).toEqual(["waiting", "ready_check", "active", "finished"]);
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

  it("accepts a timed active snapshot whose running balance matches server time", () => {
    expect(
      GameSnapshotSchema.safeParse({
        ...(activeSnapshot() as object),
        timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
        clock: {
          remainingMs: { playerOne: 60_000, playerTwo: 280_000 },
          runningPlayer: 1,
          turnStartedAt: CREATED_AT,
          deadline: "2026-08-04T10:06:00.000Z",
          serverNow: UPDATED_AT,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a timed active snapshot whose displayed balance disagrees with its deadline", () => {
    expect(
      GameSnapshotSchema.safeParse({
        ...(activeSnapshot() as object),
        timeControl: { kind: "timed", initialMs: 300_000, incrementMs: 3_000 },
        clock: {
          remainingMs: { playerOne: 59_999, playerTwo: 280_000 },
          runningPlayer: 1,
          turnStartedAt: CREATED_AT,
          deadline: "2026-08-04T10:06:00.000Z",
          serverNow: UPDATED_AT,
        },
      }).success,
    ).toBe(false);
  });

  it("requires the timed-out player's final balance to be zero", () => {
    const timedOut = {
      ...(finishedSnapshot() as object),
      timeControl: { kind: "timed", initialMs: 180_000, incrementMs: 2_000 },
      outcome: { reason: "timeout", winner: 1, finishedAt: FINISHED_AT },
      clock: {
        remainingMs: { playerOne: 12_000, playerTwo: 0 },
        stoppedAt: FINISHED_AT,
      },
    };

    expect(GameSnapshotSchema.safeParse(timedOut).success).toBe(true);
    expect(
      GameSnapshotSchema.safeParse({
        ...timedOut,
        clock: { ...timedOut.clock, remainingMs: { playerOne: 12_000, playerTwo: 1 } },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["a second player", "players", { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER }],
    ["a side to move", "sideToMove", 1],
    ["an outcome", "outcome", { reason: "resignation", winner: 2, finishedAt: FINISHED_AT }],
    ["played moves", "moves", [{ row: 0, col: 0 }]],
  ])("rejects a waiting snapshot with %s", (_label, field, value) => {
    expect(GameSnapshotSchema.safeParse(withField(waitingSnapshot(), field, value)).success).toBe(
      false,
    );
  });

  it.each([
    ["no second player", "players", { playerOne: PLAYER_ONE_USER, playerTwo: null }],
    ["no side to move", "sideToMove", null],
    ["an outcome", "outcome", { reason: "resignation", winner: 2, finishedAt: FINISHED_AT }],
  ])("rejects an active snapshot with %s", (_label, field, value) => {
    expect(GameSnapshotSchema.safeParse(withField(activeSnapshot(), field, value)).success).toBe(
      false,
    );
  });

  it.each([
    ["no outcome", "outcome", null],
    ["a side to move", "sideToMove", 1],
    ["no second player", "players", { playerOne: PLAYER_ONE_USER, playerTwo: null }],
    [
      "an unknown outcome reason",
      "outcome",
      { reason: "abandoned", winner: 1, finishedAt: FINISHED_AT },
    ],
    ["an outcome with no winner", "outcome", { reason: "board_full", finishedAt: FINISHED_AT }],
    [
      "an outcome carrying a margin, which is derived rather than sent",
      "outcome",
      { reason: "board_full", winner: 1, finishedAt: FINISHED_AT, marginHalfPoints: 1 },
    ],
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
