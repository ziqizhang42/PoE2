import type { WsServerMessage } from "@poe2/protocol";
import type { WebSocket } from "ws";
import { describe, expect, it } from "vitest";

import { createConnectionHub, sendMessage, type ConnectionHub } from "./ws-hub.js";

const OPEN = 1;
const CLOSED = 3;

const LOBBIES: WsServerMessage = { type: "lobby.snapshot", lobbies: [] };
const CLOSED_GAME: WsServerMessage = {
  type: "game.closed",
  gameId: "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1",
};
const READY: WsServerMessage = {
  type: "session.ready",
  protocolVersion: 1,
  user: { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Player_One" },
};

interface FakeSocket {
  readonly sent: string[];
  readyState: number;
}

function fakeSocket(readyState = OPEN): FakeSocket & WebSocket {
  const socket = {
    sent: [] as string[],
    readyState,
    send(payload: string) {
      this.sent.push(payload);
    },
  };

  return socket as unknown as FakeSocket & WebSocket;
}

function received(socket: FakeSocket): unknown[] {
  return socket.sent.map((payload) => JSON.parse(payload) as unknown);
}

/** Registers a socket and puts it straight into live delivery. */
function join(hub: ConnectionHub, userId: string, socket: WebSocket): void {
  hub.add(userId, socket);
  hub.activate(userId, socket);
}

describe("sendMessage", () => {
  it("writes a message as JSON text", () => {
    const socket = fakeSocket();
    sendMessage(socket, LOBBIES);

    expect(received(socket)).toEqual([LOBBIES]);
  });

  it("skips a socket that is no longer open", () => {
    const socket = fakeSocket(CLOSED);
    sendMessage(socket, LOBBIES);

    expect(socket.sent).toEqual([]);
  });
});

describe("pending connections", () => {
  it("holds hub traffic back until the connection is activated", () => {
    const hub = createConnectionHub();
    const socket = fakeSocket();

    hub.add("user-1", socket);
    hub.send("user-1", CLOSED_GAME);
    hub.broadcast(LOBBIES);

    expect(socket.sent).toEqual([]);

    // The opening sequence bypasses the hub, so it lands first either way.
    sendMessage(socket, READY);
    hub.activate("user-1", socket);

    expect(received(socket)).toEqual([READY, CLOSED_GAME, LOBBIES]);
  });

  it("counts a pending connection as connected", () => {
    const hub = createConnectionHub();
    hub.add("user-1", fakeSocket());

    expect(hub.connectionCount("user-1")).toBe(1);
    expect(hub.totalConnections()).toBe(1);
  });

  it("delivers live once activated, without replaying the flush", () => {
    const hub = createConnectionHub();
    const socket = fakeSocket();

    join(hub, "user-1", socket);
    hub.send("user-1", LOBBIES);
    hub.activate("user-1", socket);

    expect(received(socket)).toEqual([LOBBIES]);
  });

  it("discards buffered traffic for a connection removed before activation", () => {
    const hub = createConnectionHub();
    const socket = fakeSocket();

    hub.add("user-1", socket);
    hub.broadcast(LOBBIES);
    hub.remove("user-1", socket);
    hub.activate("user-1", socket);

    expect(socket.sent).toEqual([]);
    expect(hub.totalConnections()).toBe(0);
  });

  it("leaves one user's pending connection out of another's delivery", () => {
    const hub = createConnectionHub();
    const live = fakeSocket();
    const pending = fakeSocket();

    join(hub, "user-1", live);
    hub.add("user-2", pending);
    hub.broadcast(LOBBIES);

    expect(received(live)).toEqual([LOBBIES]);
    expect(pending.sent).toEqual([]);
  });
});

describe("connection hub", () => {
  it("reports only the first and last connection for a user", () => {
    const hub = createConnectionHub();
    const first = fakeSocket();
    const second = fakeSocket();

    expect(hub.add("user-1", first)).toBe(true);
    expect(hub.add("user-1", second)).toBe(false);
    expect(hub.connectedUserIds()).toEqual(["user-1"]);
    expect(hub.remove("user-1", first)).toBe(false);
    expect(hub.remove("user-1", second)).toBe(true);
    expect(hub.connectedUserIds()).toEqual([]);
  });

  it("delivers to every socket one user has open", () => {
    const hub = createConnectionHub();
    const first = fakeSocket();
    const second = fakeSocket();

    join(hub, "user-1", first);
    join(hub, "user-1", second);
    hub.send("user-1", LOBBIES);

    expect(hub.connectionCount("user-1")).toBe(2);
    expect(received(first)).toEqual([LOBBIES]);
    expect(received(second)).toEqual([LOBBIES]);
  });

  it("delivers only to the addressed user", () => {
    const hub = createConnectionHub();
    const mine = fakeSocket();
    const theirs = fakeSocket();

    join(hub, "user-1", mine);
    join(hub, "user-2", theirs);
    hub.send("user-1", CLOSED_GAME);

    expect(received(mine)).toEqual([CLOSED_GAME]);
    expect(theirs.sent).toEqual([]);
  });

  it("ignores a send to a user with no connection", () => {
    const hub = createConnectionHub();
    expect(() => hub.send("nobody", LOBBIES)).not.toThrow();
  });

  it("ignores activating a socket it never held", () => {
    const hub = createConnectionHub();
    expect(() => hub.activate("nobody", fakeSocket())).not.toThrow();
  });

  it("broadcasts to every connected user", () => {
    const hub = createConnectionHub();
    const first = fakeSocket();
    const second = fakeSocket();
    const third = fakeSocket();

    join(hub, "user-1", first);
    join(hub, "user-1", second);
    join(hub, "user-2", third);
    hub.broadcast(LOBBIES);

    for (const socket of [first, second, third]) {
      expect(received(socket)).toEqual([LOBBIES]);
    }
  });

  it("can omit the opening socket from a replacement broadcast", () => {
    const hub = createConnectionHub();
    const opening = fakeSocket();
    const existing = fakeSocket();

    join(hub, "user-1", opening);
    join(hub, "user-2", existing);
    hub.broadcast(LOBBIES, opening);

    expect(opening.sent).toEqual([]);
    expect(received(existing)).toEqual([LOBBIES]);
  });

  it("forgets a socket once it is removed", () => {
    const hub = createConnectionHub();
    const first = fakeSocket();
    const second = fakeSocket();

    join(hub, "user-1", first);
    join(hub, "user-1", second);
    hub.remove("user-1", first);

    hub.broadcast(LOBBIES);

    expect(hub.connectionCount("user-1")).toBe(1);
    expect(hub.totalConnections()).toBe(1);
    expect(first.sent).toEqual([]);
    expect(received(second)).toEqual([LOBBIES]);

    hub.remove("user-1", second);
    expect(hub.connectionCount("user-1")).toBe(0);
    expect(hub.totalConnections()).toBe(0);
  });

  it("tolerates removing a socket it never held", () => {
    const hub = createConnectionHub();
    expect(() => hub.remove("user-1", fakeSocket())).not.toThrow();
  });

  it("skips a closed socket while still delivering to the rest", () => {
    const hub = createConnectionHub();
    const open = fakeSocket();
    const closed = fakeSocket(CLOSED);

    join(hub, "user-1", open);
    join(hub, "user-1", closed);
    hub.send("user-1", LOBBIES);

    expect(received(open)).toEqual([LOBBIES]);
    expect(closed.sent).toEqual([]);
  });
});
