import {
  allSquares,
  CELL_COUNT,
  createEmptyBoard,
  gameResult,
  replay,
  scoreBoard,
} from "@poe2/rules";
import { describe, expect, it } from "vitest";

import {
  WS_ERROR_CODES,
  WS_PROTOCOL_VERSION,
  WsClientMessageSchema,
  WsCommandAcceptedMessageSchema,
  WsCommandRejectedMessageSchema,
  WsGameClosedMessageSchema,
  WsGameMoveMessageSchema,
  WsGameSnapshotMessageSchema,
  WsLobbyCancelMessageSchema,
  WsLobbyCreateMessageSchema,
  WsLobbyJoinMessageSchema,
  WsLobbySnapshotMessageSchema,
  WsServerMessageSchema,
  WsSessionReadyMessageSchema,
} from "./websocket.js";

const REQUEST_ID = "0f2b6b2a-3d70-4ad6-b34e-2d34e8f1e0d5";
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const PLAYER_ONE_USER = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" };
const PLAYER_TWO_USER = { id: "1b5d1bfe-2d8c-4a0e-9d34-9ff5f2f0c8d3", username: "Player_Two" };
const CREATED_AT = "2026-08-04T10:00:00.000Z";

const lobbyCreate = { type: "lobby.create", requestId: REQUEST_ID };
const lobbyJoin = { type: "lobby.join", requestId: REQUEST_ID, gameId: GAME_ID };
const lobbyCancel = { type: "lobby.cancel", requestId: REQUEST_ID, gameId: GAME_ID };
const gameMove = {
  type: "game.move",
  requestId: REQUEST_ID,
  gameId: GAME_ID,
  expectedRevision: 3,
  square: { row: 2, col: 5 },
};

function waitingGame(): unknown {
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
    updatedAt: CREATED_AT,
  };
}

function finishedGame(): unknown {
  const replayed = replay(allSquares());

  if (!replayed.ok) {
    throw new Error("expected a full row-major fill to be legal");
  }

  return {
    id: GAME_ID,
    revision: CELL_COUNT + 1,
    status: "finished",
    players: { playerOne: PLAYER_ONE_USER, playerTwo: PLAYER_TWO_USER },
    board: replayed.game.board,
    moves: replayed.game.moves,
    scores: scoreBoard(replayed.game.board),
    sideToMove: null,
    result: gameResult(replayed.game),
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

describe("protocol version", () => {
  it("is version 1", () => {
    expect(WS_PROTOCOL_VERSION).toBe(1);
  });
});

describe("WsClientMessageSchema", () => {
  it.each([
    ["lobby.create", lobbyCreate, WsLobbyCreateMessageSchema],
    ["lobby.join", lobbyJoin, WsLobbyJoinMessageSchema],
    ["lobby.cancel", lobbyCancel, WsLobbyCancelMessageSchema],
    ["game.move", gameMove, WsGameMoveMessageSchema],
  ])("accepts %s through the union and its own schema", (_label, message, schema) => {
    expect(WsClientMessageSchema.safeParse(message).success).toBe(true);
    expect(schema.safeParse(message).success).toBe(true);
  });

  it.each([lobbyCreate, lobbyJoin, lobbyCancel, gameMove])(
    "rejects extra properties on %o",
    (message) => {
      expect(WsClientMessageSchema.safeParse({ ...message, spoofed: true }).success).toBe(false);
    },
  );

  it.each([
    ["an unknown type", { type: "lobby.destroy", requestId: REQUEST_ID }],
    ["a missing type", { requestId: REQUEST_ID }],
    ["a missing request ID", { type: "lobby.create" }],
    ["a non-UUID request ID", { type: "lobby.create", requestId: "request-1" }],
    ["a non-UUID game ID", { type: "lobby.join", requestId: REQUEST_ID, gameId: "game-1" }],
    ["a missing game ID", { type: "lobby.cancel", requestId: REQUEST_ID }],
    ["a null body", null],
    ["a string body", "lobby.create"],
    ["an array body", []],
  ])("rejects %s", (_label, message) => {
    expect(WsClientMessageSchema.safeParse(message).success).toBe(false);
  });

  it.each([
    { row: -1, col: 0 },
    { row: 7, col: 0 },
    { row: 0, col: 7 },
    { row: 0.5, col: 0 },
    { row: 0 },
    "a1",
  ])("rejects game.move with square %o", (square) => {
    expect(WsClientMessageSchema.safeParse({ ...gameMove, square }).success).toBe(false);
  });

  it.each([-1, 1.5, "3", null])("rejects game.move with expectedRevision %o", (revision) => {
    expect(
      WsClientMessageSchema.safeParse({ ...gameMove, expectedRevision: revision }).success,
    ).toBe(false);
  });

  it("accepts the first revision a freshly created game has", () => {
    expect(WsClientMessageSchema.safeParse({ ...gameMove, expectedRevision: 0 }).success).toBe(
      true,
    );
  });

  it("refuses to carry credentials or a caller-chosen identity", () => {
    for (const field of ["token", "sessionToken", "password", "userId", "player", "board"]) {
      expect(WsClientMessageSchema.safeParse({ ...gameMove, [field]: "x" }).success).toBe(false);
    }
  });
});

describe("WsServerMessageSchema", () => {
  const sessionReady = {
    type: "session.ready",
    protocolVersion: WS_PROTOCOL_VERSION,
    user: PLAYER_ONE_USER,
  };
  const lobbySnapshot = {
    type: "lobby.snapshot",
    lobbies: [{ id: GAME_ID, playerOne: PLAYER_ONE_USER, createdAt: CREATED_AT }],
  };
  const gameClosed = { type: "game.closed", gameId: GAME_ID };
  const commandAccepted = { type: "command.accepted", requestId: REQUEST_ID };
  const commandRejected = {
    type: "command.rejected",
    requestId: REQUEST_ID,
    code: "not_your_turn",
    message: "It is not your turn",
  };

  it.each([
    ["session.ready", sessionReady, WsSessionReadyMessageSchema],
    ["lobby.snapshot", lobbySnapshot, WsLobbySnapshotMessageSchema],
    ["game.closed", gameClosed, WsGameClosedMessageSchema],
    ["command.accepted", commandAccepted, WsCommandAcceptedMessageSchema],
    ["command.rejected", commandRejected, WsCommandRejectedMessageSchema],
  ])("accepts %s through the union and its own schema", (_label, message, schema) => {
    expect(WsServerMessageSchema.safeParse(message).success).toBe(true);
    expect(schema.safeParse(message).success).toBe(true);
  });

  it.each([
    ["a waiting game", waitingGame()],
    ["a finished game", finishedGame()],
  ])("accepts game.snapshot carrying %s", (_label, game) => {
    const message = { type: "game.snapshot", game };

    expect(WsServerMessageSchema.safeParse(message).success).toBe(true);
    expect(WsGameSnapshotMessageSchema.safeParse(message).success).toBe(true);
  });

  it("rejects game.snapshot whose game breaks a status invariant", () => {
    const broken = { ...(waitingGame() as object), sideToMove: 1 };

    expect(
      WsGameSnapshotMessageSchema.safeParse({ type: "game.snapshot", game: broken }).success,
    ).toBe(false);
  });

  it("accepts an empty lobby snapshot", () => {
    expect(
      WsLobbySnapshotMessageSchema.safeParse({ type: "lobby.snapshot", lobbies: [] }).success,
    ).toBe(true);
  });

  it("rejects a session.ready announcing another protocol version", () => {
    expect(
      WsSessionReadyMessageSchema.safeParse({ ...sessionReady, protocolVersion: 2 }).success,
    ).toBe(false);
  });

  it("never lets session.ready carry the session token", () => {
    expect(
      WsSessionReadyMessageSchema.safeParse({ ...sessionReady, token: "secret" }).success,
    ).toBe(false);
    expect(
      WsSessionReadyMessageSchema.safeParse({
        ...sessionReady,
        user: { ...PLAYER_ONE_USER, passwordHash: "x" },
      }).success,
    ).toBe(false);
  });

  it.each(WS_ERROR_CODES)("accepts the %s rejection code", (code) => {
    expect(WsCommandRejectedMessageSchema.safeParse({ ...commandRejected, code }).success).toBe(
      true,
    );
  });

  it("allows a null request ID when the frame could not be correlated", () => {
    expect(
      WsCommandRejectedMessageSchema.safeParse({
        ...commandRejected,
        requestId: null,
        code: "invalid_message",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["an unknown code", { ...commandRejected, code: "kaboom" }],
    ["an empty message", { ...commandRejected, message: "" }],
    ["a missing message", { type: "command.rejected", requestId: REQUEST_ID, code: "occupied" }],
    ["a non-UUID request ID", { ...commandRejected, requestId: "request-1" }],
    ["extra properties", { ...commandRejected, stack: "Error: ..." }],
  ])("rejects command.rejected with %s", (_label, message) => {
    expect(WsCommandRejectedMessageSchema.safeParse(message).success).toBe(false);
  });

  it("rejects an unknown server message type", () => {
    expect(WsServerMessageSchema.safeParse({ type: "game.patch", gameId: GAME_ID }).success).toBe(
      false,
    );
  });
});
