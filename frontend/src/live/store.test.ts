import { describe, expect, it } from "vitest";

import { GAME_ID, OTHER_GAME_ID, waitingGame } from "../test/fakes.ts";
import {
  createLiveStore,
  INITIAL_LIVE_STATE,
  removeGame,
  removeGameReceiptTime,
  upsertGame,
} from "./store.ts";

describe("createLiveStore", () => {
  it("starts idle with nothing belonging to a user", () => {
    expect(createLiveStore().getState()).toEqual(INITIAL_LIVE_STATE);
  });

  it("gives each store its own state", () => {
    const first = createLiveStore();
    const second = createLiveStore();

    first.setState({ status: "ready", userId: "someone" });

    expect(second.getState()).toEqual(INITIAL_LIVE_STATE);
  });
});

describe("upsertGame", () => {
  it("appends a game it has not seen", () => {
    expect(upsertGame([], waitingGame())).toEqual([waitingGame()]);
  });

  it("replaces a game in place, keeping the order stable", () => {
    const games = [waitingGame(), waitingGame(OTHER_GAME_ID)];
    const revised = { ...waitingGame(), revision: 1 };

    const next = upsertGame(games, revised);

    expect(next).toEqual([revised, waitingGame(OTHER_GAME_ID)]);
  });
});

describe("removeGame", () => {
  it("drops the named game", () => {
    const games = [waitingGame(), waitingGame(OTHER_GAME_ID)];

    expect(removeGame(games, GAME_ID)).toEqual([waitingGame(OTHER_GAME_ID)]);
  });

  it("returns the same array when nothing matched, so selectors stay stable", () => {
    const games = [waitingGame()];

    expect(removeGame(games, OTHER_GAME_ID)).toBe(games);
  });
});

describe("removeGameReceiptTime", () => {
  it("removes only the closed game's monotonic anchor", () => {
    const receivedAt = { [GAME_ID]: 10, [OTHER_GAME_ID]: 20 };

    expect(removeGameReceiptTime(receivedAt, GAME_ID)).toEqual({ [OTHER_GAME_ID]: 20 });
    expect(removeGameReceiptTime(receivedAt, "missing")).toBe(receivedAt);
  });
});
