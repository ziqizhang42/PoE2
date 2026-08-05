import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  AuthSessionResponseSchema,
  WS_PROTOCOL_VERSION,
  WsServerMessageSchema,
  type AuthUser,
  type GameSnapshot,
  type WsServerMessage,
} from "@poe2/protocol";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKdfExecutor } from "../auth/kdf-executor.js";
import { createPasswordHasher } from "../auth/password.js";
import { createAuthRepository } from "../auth/repository.js";
import { createAuthService, type AuthService } from "../auth/service.js";
import { buildApp } from "../app.js";
import { readAuthConfig } from "../config/auth.js";
import { readDatabaseConfig } from "../config/database.js";
import { createDatabaseClient } from "../db/client.js";
import { users } from "../db/schema.js";
import { createGameRepository } from "../game/repository.js";
import { createGameService, type GameService } from "../game/service.js";
import { authPlugin } from "./auth.js";
import { createConnectionHub } from "./ws-hub.js";
import { registerWebSocket, WS_ROUTE } from "./ws.js";

const PASSWORD = "correct horse battery staple";
const ALLOWED_ORIGIN = "http://localhost:5173";
const WAIT_TIMEOUT_MS = 5_000;

const database = createDatabaseClient(readDatabaseConfig(process.env));
const authConfig = readAuthConfig({ NODE_ENV: "test" });
const authService = createAuthService(
  createAuthRepository(database.db),
  createPasswordHasher(createKdfExecutor({ maxConcurrent: 2, maxQueued: 16 })),
);
const realGameService = createGameService(createGameRepository(database.db));
const hub = createConnectionHub();
const app = buildApp();

app.register(authPlugin, { ...authConfig, service: authService });

await registerWebSocket(app, {
  ...authConfig,
  allowedOrigins: [ALLOWED_ORIGIN],
  authService,
  gameService: realGameService,
  hub,
});

await app.ready();

/**
 * The auth routes rate-limit per client address, and the limiter's memory
 * outlives a test, so every registration comes from an address of its own.
 */
let addressCounter = 0;

function nextAddress(): string {
  addressCounter += 1;
  return `10.0.${Math.floor(addressCounter / 250)}.${addressCounter % 250}`;
}

interface Account {
  readonly user: AuthUser;
  readonly cookie: string;
}

interface Client {
  readonly socket: WebSocket;
  /** Server frames that failed `WsServerMessageSchema`; must stay empty. */
  readonly invalid: string[];
  next(): Promise<WsServerMessage>;
  pending(): number;
  closed(): Promise<{ readonly code: number }>;
  close(): void;
}

const openClients: Client[] = [];

beforeEach(async () => {
  await database.db.delete(users);
});

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    client.close();
  }

  await waitUntil(() => hub.totalConnections() === 0);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

async function waitUntil(predicate: () => boolean, timeoutMs = WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for a condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Gives the server room to send anything it should not have sent. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

async function register(username: string): Promise<Account> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password: PASSWORD },
    remoteAddress: nextAddress(),
  });

  expect(response.statusCode).toBe(201);

  const header = response.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(";")[0];
  if (cookie === undefined) {
    throw new Error("expected a session cookie");
  }

  return { user: AuthSessionResponseSchema.parse(response.json()).user, cookie };
}

async function connect(
  account: Account,
  origin = ALLOWED_ORIGIN,
  target: FastifyInstance = app,
): Promise<Client> {
  const messages: WsServerMessage[] = [];
  const invalid: string[] = [];
  let closeCode: number | null = null;
  let cursor = 0;

  const socket = await target.injectWS(
    WS_ROUTE,
    { headers: { cookie: account.cookie, origin } },
    {
      // Listeners are attached before the socket opens, so the first frames the
      // server pushes on connection cannot be missed.
      onInit: (ws) => {
        ws.on("message", (data: Buffer) => {
          const text = data.toString("utf8");
          const parsed = WsServerMessageSchema.safeParse(JSON.parse(text) as unknown);

          if (parsed.success) {
            messages.push(parsed.data);
          } else {
            invalid.push(text);
          }
        });

        ws.on("close", (code: number) => {
          closeCode = code;
        });
      },
    },
  );

  const client: Client = {
    socket,
    invalid,

    async next() {
      await waitUntil(() => messages.length > cursor);
      const message = messages[cursor];
      cursor += 1;

      if (message === undefined) {
        throw new Error("expected a message");
      }

      return message;
    },

    pending: () => messages.length - cursor,

    async closed() {
      await waitUntil(() => closeCode !== null);
      return { code: closeCode ?? 0 };
    },

    // `injectWS` splices the two ends together with in-memory streams that
    // never finish a graceful closing handshake, so a plain `close()` would
    // leave the server waiting. Terminating drops the transport, which is what
    // a disappearing browser looks like anyway.
    close: () => socket.terminate(),
  };

  openClients.push(client);
  return client;
}

function send(client: Client, message: Record<string, unknown>): void {
  client.socket.send(JSON.stringify(message));
}

/** Consumes the three-message opening sequence and returns the restored games. */
async function readOpeningState(
  client: Client,
  user: AuthUser,
  openGameCount = 0,
): Promise<{ lobbies: readonly unknown[]; games: GameSnapshot[] }> {
  const ready = await client.next();
  expect(ready).toEqual({
    type: "session.ready",
    protocolVersion: WS_PROTOCOL_VERSION,
    user,
  });

  const lobby = await client.next();
  if (lobby.type !== "lobby.snapshot") {
    throw new Error(`expected lobby.snapshot, got ${lobby.type}`);
  }

  const games: GameSnapshot[] = [];
  for (let index = 0; index < openGameCount; index += 1) {
    const snapshot = await client.next();
    if (snapshot.type !== "game.snapshot") {
      throw new Error(`expected game.snapshot, got ${snapshot.type}`);
    }
    games.push(snapshot.game);
  }

  return { lobbies: lobby.lobbies, games };
}

async function expectGameSnapshot(client: Client): Promise<GameSnapshot> {
  const message = await client.next();
  if (message.type !== "game.snapshot") {
    throw new Error(`expected game.snapshot, got ${message.type}`);
  }

  return message.game;
}

async function expectLobbySnapshot(client: Client): Promise<readonly unknown[]> {
  const message = await client.next();
  if (message.type !== "lobby.snapshot") {
    throw new Error(`expected lobby.snapshot, got ${message.type}`);
  }

  return message.lobbies;
}

describe("upgrade authentication", () => {
  it("refuses an upgrade with no session cookie", async () => {
    await expect(app.injectWS(WS_ROUTE, { headers: { origin: ALLOWED_ORIGIN } })).rejects.toThrow(
      "401",
    );
  });

  it("refuses an upgrade whose session is not valid", async () => {
    await expect(
      app.injectWS(WS_ROUTE, {
        headers: { origin: ALLOWED_ORIGIN, cookie: "poe2_session=not-a-real-token" },
      }),
    ).rejects.toThrow("401");
  });

  it("refuses a wrong or missing browser origin", async () => {
    const alice = await register("Alice");

    await expect(
      app.injectWS(WS_ROUTE, {
        headers: { origin: "http://evil.example", cookie: alice.cookie },
      }),
    ).rejects.toThrow("403");

    await expect(app.injectWS(WS_ROUTE, { headers: { cookie: alice.cookie } })).rejects.toThrow(
      "403",
    );
  });

  it("accepts an authenticated upgrade from the allowed origin", async () => {
    const alice = await register("Alice");
    const client = await connect(alice);

    const { lobbies, games } = await readOpeningState(client, alice.user);

    expect(lobbies).toEqual([]);
    expect(games).toEqual([]);
    expect(client.invalid).toEqual([]);
    expect(hub.connectionCount(alice.user.id)).toBe(1);
  });
});

describe("frame handling", () => {
  it("rejects frames it cannot correlate with a null request ID", async () => {
    const alice = await register("Alice");
    const client = await connect(alice);
    await readOpeningState(client, alice.user);

    client.socket.send("this is not json");
    client.socket.send(JSON.stringify({ type: "lobby.create", requestId: "not-a-uuid" }));
    client.socket.send(JSON.stringify(["lobby.create"]));
    client.socket.send(JSON.stringify({ requestId: 17 }));

    for (let index = 0; index < 4; index += 1) {
      expect(await client.next()).toMatchObject({
        type: "command.rejected",
        requestId: null,
        code: "invalid_message",
      });
    }
  });

  it.each([
    ["an unknown command type", (requestId: string) => ({ type: "lobby.destroy", requestId })],
    [
      "an out-of-bounds square",
      (requestId: string) => ({
        type: "game.move",
        requestId,
        gameId: randomUUID(),
        expectedRevision: 0,
        square: { row: 9, col: 0 },
      }),
    ],
    [
      "a negative revision",
      (requestId: string) => ({
        type: "game.move",
        requestId,
        gameId: randomUUID(),
        expectedRevision: -1,
        square: { row: 0, col: 0 },
      }),
    ],
  ])("recovers the request ID from a frame carrying %s", async (_label, build) => {
    const alice = await register("Alice");
    const client = await connect(alice);
    await readOpeningState(client, alice.user);

    const requestId = randomUUID();
    send(client, build(requestId));

    expect(await client.next()).toMatchObject({
      type: "command.rejected",
      requestId,
      code: "invalid_message",
    });
  });

  it("rejects a binary frame", async () => {
    const alice = await register("Alice");
    const client = await connect(alice);
    await readOpeningState(client, alice.user);

    client.socket.send(Buffer.from([0x01, 0x02, 0x03]));

    expect(await client.next()).toMatchObject({
      type: "command.rejected",
      requestId: null,
      code: "invalid_message",
    });
  });

  it("rejects extra properties rather than acting on them", async () => {
    const alice = await register("Alice");
    const client = await connect(alice);
    await readOpeningState(client, alice.user);

    const requestId = randomUUID();
    send(client, { type: "lobby.create", requestId, asPlayer: 2 });

    expect(await client.next()).toMatchObject({
      type: "command.rejected",
      requestId,
      code: "invalid_message",
    });
  });
});

describe("lobby and game lifecycle", () => {
  it("carries two players from an open lobby to a played move", async () => {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const aliceClient = await connect(alice);
    const bobClient = await connect(bob);

    await readOpeningState(aliceClient, alice.user);
    await readOpeningState(bobClient, bob.user);

    const createId = randomUUID();
    send(aliceClient, { type: "lobby.create", requestId: createId });

    expect(await aliceClient.next()).toEqual({ type: "command.accepted", requestId: createId });
    const created = await expectGameSnapshot(aliceClient);
    expect(created).toMatchObject({
      status: "waiting",
      revision: 0,
      players: { playerOne: alice.user, playerTwo: null },
    });

    // Both connected users see the new lobby.
    expect(await expectLobbySnapshot(aliceClient)).toHaveLength(1);
    expect(await expectLobbySnapshot(bobClient)).toEqual([
      { id: created.id, playerOne: alice.user, createdAt: created.createdAt },
    ]);

    const joinId = randomUUID();
    send(bobClient, { type: "lobby.join", requestId: joinId, gameId: created.id });

    expect(await bobClient.next()).toEqual({ type: "command.accepted", requestId: joinId });
    const bobJoined = await expectGameSnapshot(bobClient);
    const aliceJoined = await expectGameSnapshot(aliceClient);

    expect(bobJoined).toEqual(aliceJoined);
    expect(bobJoined).toMatchObject({
      status: "active",
      revision: 1,
      sideToMove: 1,
      players: { playerOne: alice.user, playerTwo: bob.user },
    });

    // The lobby is gone for everyone now that it is being played.
    expect(await expectLobbySnapshot(bobClient)).toEqual([]);
    expect(await expectLobbySnapshot(aliceClient)).toEqual([]);

    const moveId = randomUUID();
    send(aliceClient, {
      type: "game.move",
      requestId: moveId,
      gameId: created.id,
      expectedRevision: 1,
      square: { row: 3, col: 3 },
    });

    expect(await aliceClient.next()).toEqual({ type: "command.accepted", requestId: moveId });
    const aliceMoved = await expectGameSnapshot(aliceClient);
    const bobSaw = await expectGameSnapshot(bobClient);

    expect(aliceMoved).toEqual(bobSaw);
    expect(aliceMoved).toMatchObject({
      revision: 2,
      sideToMove: 2,
      moves: [{ row: 3, col: 3 }],
    });
    expect(aliceMoved.board[3 * 7 + 3]).toBe(1);

    expect(aliceClient.invalid).toEqual([]);
    expect(bobClient.invalid).toEqual([]);
  });

  it("rejects a stale and an out-of-turn move without changing the game", async () => {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const aliceClient = await connect(alice);
    const bobClient = await connect(bob);

    await readOpeningState(aliceClient, alice.user);
    await readOpeningState(bobClient, bob.user);

    const game = await startGameThrough(aliceClient, bobClient, alice, bob);

    const outOfTurnId = randomUUID();
    send(bobClient, {
      type: "game.move",
      requestId: outOfTurnId,
      gameId: game.id,
      expectedRevision: game.revision,
      square: { row: 0, col: 0 },
    });

    expect(await bobClient.next()).toMatchObject({
      type: "command.rejected",
      requestId: outOfTurnId,
      code: "not_your_turn",
    });

    const staleId = randomUUID();
    send(aliceClient, {
      type: "game.move",
      requestId: staleId,
      gameId: game.id,
      expectedRevision: game.revision - 1,
      square: { row: 0, col: 0 },
    });

    expect(await aliceClient.next()).toMatchObject({
      type: "command.rejected",
      requestId: staleId,
      code: "stale_game",
    });

    // Neither rejection produced a snapshot, so nothing moved.
    expect(aliceClient.pending()).toBe(0);
    expect(bobClient.pending()).toBe(0);
  });

  it("rejects a move from someone who holds no seat", async () => {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const carol = await register("Carol");
    const aliceClient = await connect(alice);
    const bobClient = await connect(bob);
    const carolClient = await connect(carol);

    await readOpeningState(aliceClient, alice.user);
    await readOpeningState(bobClient, bob.user);
    await readOpeningState(carolClient, carol.user);

    const game = await startGameThrough(aliceClient, bobClient, alice, bob);
    await expectLobbySnapshot(carolClient);
    await expectLobbySnapshot(carolClient);

    const requestId = randomUUID();
    send(carolClient, {
      type: "game.move",
      requestId,
      gameId: game.id,
      expectedRevision: game.revision,
      square: { row: 0, col: 0 },
    });

    expect(await carolClient.next()).toMatchObject({
      type: "command.rejected",
      requestId,
      code: "not_a_player",
    });
  });

  it("closes a cancelled lobby for its owner and clears it for everyone", async () => {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const aliceClient = await connect(alice);
    const bobClient = await connect(bob);

    await readOpeningState(aliceClient, alice.user);
    await readOpeningState(bobClient, bob.user);

    const createId = randomUUID();
    send(aliceClient, { type: "lobby.create", requestId: createId });
    await aliceClient.next();
    const created = await expectGameSnapshot(aliceClient);
    await expectLobbySnapshot(aliceClient);
    expect(await expectLobbySnapshot(bobClient)).toHaveLength(1);

    const cancelId = randomUUID();
    send(aliceClient, { type: "lobby.cancel", requestId: cancelId, gameId: created.id });

    expect(await aliceClient.next()).toEqual({ type: "command.accepted", requestId: cancelId });
    expect(await aliceClient.next()).toEqual({ type: "game.closed", gameId: created.id });
    expect(await expectLobbySnapshot(aliceClient)).toEqual([]);
    expect(await expectLobbySnapshot(bobClient)).toEqual([]);
  });

  it("refuses to let a bystander cancel a lobby", async () => {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const aliceClient = await connect(alice);
    const bobClient = await connect(bob);

    await readOpeningState(aliceClient, alice.user);
    await readOpeningState(bobClient, bob.user);

    send(aliceClient, { type: "lobby.create", requestId: randomUUID() });
    await aliceClient.next();
    const created = await expectGameSnapshot(aliceClient);
    await expectLobbySnapshot(aliceClient);
    await expectLobbySnapshot(bobClient);

    const requestId = randomUUID();
    send(bobClient, { type: "lobby.cancel", requestId, gameId: created.id });

    expect(await bobClient.next()).toMatchObject({
      type: "command.rejected",
      requestId,
      code: "not_lobby_owner",
    });
  });

  it("restores a reconnecting player's open games", async () => {
    const alice = await register("Alice");
    const bob = await register("Bob");
    const aliceClient = await connect(alice);
    const bobClient = await connect(bob);

    await readOpeningState(aliceClient, alice.user);
    await readOpeningState(bobClient, bob.user);

    const game = await startGameThrough(aliceClient, bobClient, alice, bob);

    const reconnected = await connect(alice);
    const opening = await readOpeningState(reconnected, alice.user, 1);

    expect(opening.lobbies).toEqual([]);
    expect(opening.games).toEqual([game]);
    expect(hub.connectionCount(alice.user.id)).toBe(2);
  });
});

describe("session lifetime", () => {
  it("closes the socket once the session has been logged out", async () => {
    const alice = await register("Alice");
    const client = await connect(alice);
    await readOpeningState(client, alice.user);

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/auth/session",
      headers: { cookie: alice.cookie },
    });
    expect(logout.statusCode).toBe(204);

    send(client, { type: "lobby.create", requestId: randomUUID() });

    // Policy violation, and no command was carried out.
    expect(await client.closed()).toEqual({ code: 1008 });
    expect(client.pending()).toBe(0);
  });

  it("forgets a socket once it closes", async () => {
    const alice = await register("Alice");
    const client = await connect(alice);
    await readOpeningState(client, alice.user);

    expect(hub.connectionCount(alice.user.id)).toBe(1);

    client.close();
    await waitUntil(() => hub.connectionCount(alice.user.id) === 0);

    expect(hub.totalConnections()).toBe(0);
  });
});

describe("unexpected failures", () => {
  it("acknowledges a committed command even when publishing it fails", async () => {
    const alice = await register("Alice");
    let listCalls = 0;

    // The lobby broadcast runs only after the game row is committed, so this
    // fails strictly on the far side of acceptance.
    const faulty = await buildFaultyApp(alice, {
      listWaitingLobbies: async () => {
        listCalls += 1;
        if (listCalls > 1) {
          throw new Error("lobby query exploded");
        }
        return realGameService.listWaitingLobbies();
      },
    });

    try {
      const client = await faulty.connect();
      await readOpeningState(client, alice.user);

      const requestId = randomUUID();
      send(client, { type: "lobby.create", requestId });

      expect(await client.next()).toEqual({ type: "command.accepted", requestId });
      const created = await expectGameSnapshot(client);

      expect(created.status).toBe("waiting");

      // The write really did happen, and no rejection chased the acceptance.
      expect(await realGameService.listOpenGames(alice.user.id)).toHaveLength(1);
      await settle();
      expect(client.pending()).toBe(0);
    } finally {
      await faulty.app.close();
    }
  });

  it("answers an upgrade with a generic 500 when authentication throws", async () => {
    const alice = await register("Alice");
    const faulty = await buildFaultyApp(
      alice,
      {},
      { authenticateSession: () => Promise.reject(new Error("session store unreachable")) },
    );

    try {
      await expect(faulty.connect()).rejects.toThrow("500");

      // Injected rather than upgraded, because only a real response exposes the
      // body: the sibling auth plugin's error handler does not cover this
      // route, so an uncaught throw would answer with the internal message.
      const response = await faulty.app.inject({
        method: "GET",
        url: WS_ROUTE,
        headers: {
          origin: ALLOWED_ORIGIN,
          cookie: alice.cookie,
          connection: "upgrade",
          upgrade: "websocket",
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ code: "internal_error" });
      expect(response.body).not.toContain("session store unreachable");
    } finally {
      await faulty.app.close();
    }
  });
});

/**
 * A second app wired to the same database, with chosen service methods made to
 * fail, for pinning what happens when something unexpected goes wrong.
 */
async function buildFaultyApp(
  account: Account,
  gameOverrides: Partial<GameService>,
  authOverrides: Partial<AuthService> = {},
): Promise<{ readonly app: FastifyInstance; connect: () => Promise<Client> }> {
  const faultyApp = buildApp();

  await registerWebSocket(faultyApp, {
    ...authConfig,
    allowedOrigins: [ALLOWED_ORIGIN],
    authService: { ...authService, ...authOverrides },
    gameService: { ...realGameService, ...gameOverrides },
    hub: createConnectionHub(),
  });

  await faultyApp.ready();

  return { app: faultyApp, connect: () => connect(account, ALLOWED_ORIGIN, faultyApp) };
}

/** Drives a create/join exchange and returns the resulting active game. */
async function startGameThrough(
  ownerClient: Client,
  joinerClient: Client,
  owner: Account,
  joiner: Account,
): Promise<GameSnapshot> {
  send(ownerClient, { type: "lobby.create", requestId: randomUUID() });
  await ownerClient.next();
  const created = await expectGameSnapshot(ownerClient);
  await expectLobbySnapshot(ownerClient);
  await expectLobbySnapshot(joinerClient);

  send(joinerClient, { type: "lobby.join", requestId: randomUUID(), gameId: created.id });
  await joinerClient.next();
  const joined = await expectGameSnapshot(joinerClient);
  await expectGameSnapshot(ownerClient);
  await expectLobbySnapshot(joinerClient);
  await expectLobbySnapshot(ownerClient);

  expect(joined.players.playerOne.id).toBe(owner.user.id);
  expect(joined.players.playerTwo?.id).toBe(joiner.user.id);

  return joined;
}
