import type { GameSnapshot, WsServerMessage } from "@poe2/protocol";
import { describe, expect, it, vi } from "vitest";

import { publishAbandonedGame, publishFinishedGame } from "./game-publication.js";

const ALICE = { id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1", username: "Alice" };
const BOB = { id: "9b5b3f42-9f3f-4a4e-9c1f-5d3a2c1b0e77", username: "Bob" };
const GAME_ID = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";
const STATUS: WsServerMessage = {
  type: "players.status",
  players: [
    { id: ALICE.id, online: true, activity: null },
    { id: BOB.id, online: false, activity: null },
  ],
};

function publisherHarness() {
  const send = vi.fn<(userId: string, message: WsServerMessage) => void>();
  const broadcast = vi.fn<(message: WsServerMessage) => void>();
  const snapshot = vi.fn(
    async () => STATUS as Extract<WsServerMessage, { type: "players.status" }>,
  );
  return {
    options: { hub: { send, broadcast }, playerStatusService: { snapshot } },
    send,
    broadcast,
  };
}

describe("autonomous game publication", () => {
  it("publishes a rated deadline finish, directory invalidation, and activity replacement", async () => {
    const { options, send, broadcast } = publisherHarness();
    const game = {
      id: GAME_ID,
      rated: true,
      status: "finished",
      players: { playerOne: ALICE, playerTwo: BOB },
    } as GameSnapshot;

    await publishFinishedGame(options, game);

    expect(send).toHaveBeenCalledWith(ALICE.id, { type: "game.snapshot", game });
    expect(send).toHaveBeenCalledWith(BOB.id, { type: "game.snapshot", game });
    expect(broadcast.mock.calls.map(([message]) => message)).toEqual([
      { type: "players.changed" },
      STATUS,
    ]);
  });

  it("publishes a deadline-abandoned ready check and preserves the reopened room", async () => {
    const { options, send, broadcast } = publisherHarness();
    const game = {
      id: GAME_ID,
      rated: false,
      status: "waiting",
      players: { playerOne: ALICE, playerTwo: null },
    } as GameSnapshot;

    await publishAbandonedGame({ ...options, listWaitingLobbies: async () => [] }, game, BOB.id);

    expect(send.mock.calls).toEqual([
      [ALICE.id, { type: "game.snapshot", game }],
      [BOB.id, { type: "game.closed", gameId: GAME_ID }],
    ]);
    expect(broadcast.mock.calls.map(([message]) => message)).toEqual([
      { type: "lobby.snapshot", lobbies: [] },
      STATUS,
    ]);
  });
});
