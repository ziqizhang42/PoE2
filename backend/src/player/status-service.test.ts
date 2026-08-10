import { describe, expect, it, vi } from "vitest";

import type { PlayerActivityRecord } from "./repository.js";
import { createPlayerStatusService } from "./status-service.js";

const ALICE = "e4aa457e-7620-4f14-ae26-6c20f3995ee1";
const BOB = "9b5b3f42-9f3f-4a4e-9c1f-5d3a2c1b0e77";
const CAROL = "6f1f4a52-3d6a-4a37-8f0d-1f1a0bb6b6c1";

describe("player status service", () => {
  it("combines online presence with authoritative offline activity", async () => {
    const service = createPlayerStatusService(
      {
        listPlayerActivities: async () => [
          { id: ALICE, activity: "open_room" },
          { id: BOB, activity: "in_game" },
        ],
      },
      { connectedUserIds: () => [ALICE, CAROL] },
    );

    await expect(service.snapshot()).resolves.toEqual({
      type: "players.status",
      players: [
        { id: CAROL, online: true, activity: null },
        { id: BOB, online: false, activity: "in_game" },
        { id: ALICE, online: true, activity: "open_room" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    });
  });

  it("reads connections after activity I/O completes", async () => {
    let connected: readonly string[] = [];
    let release: (() => void) | undefined;
    const activity = new Promise<readonly []>((resolve) => {
      release = () => resolve([]);
    });
    const service = createPlayerStatusService(
      { listPlayerActivities: () => activity },
      { connectedUserIds: () => connected },
    );

    const snapshot = service.snapshot();
    connected = [ALICE];
    release?.();

    await expect(snapshot).resolves.toEqual({
      type: "players.status",
      players: [{ id: ALICE, online: true, activity: null }],
    });
  });

  it("serializes full replacements so an older read cannot land last", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstRead = new Promise<readonly []>((resolve) => {
      releaseFirst = () => resolve([]);
    });
    const read = vi
      .fn<() => Promise<readonly PlayerActivityRecord[]>>()
      .mockReturnValueOnce(firstRead)
      .mockResolvedValueOnce([{ id: BOB, activity: "in_game" }]);
    const service = createPlayerStatusService(
      { listPlayerActivities: read },
      { connectedUserIds: () => [] },
    );

    const first = service.snapshot();
    const second = service.snapshot();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await first;
    await expect(second).resolves.toEqual({
      type: "players.status",
      players: [{ id: BOB, online: false, activity: "in_game" }],
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
