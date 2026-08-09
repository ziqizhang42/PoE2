import { describe, expect, it } from "vitest";

import { GAME_ID, USER_ONE, USER_TWO } from "../../test/fakes.ts";
import { gameRatingChangeKey } from "./use-rating-change.ts";

describe("gameRatingChangeKey", () => {
  it("identifies both the subject and the game", () => {
    expect(gameRatingChangeKey(USER_ONE.username, GAME_ID)).toEqual([
      "players",
      "player_one",
      "games",
      "rating-change",
      GAME_ID,
    ]);
    expect(gameRatingChangeKey(USER_TWO.username, GAME_ID)).not.toEqual(
      gameRatingChangeKey(USER_ONE.username, GAME_ID),
    );
  });

  it("shares a key across username case variants", () => {
    expect(gameRatingChangeKey("PLAYER_ONE", GAME_ID)).toEqual(
      gameRatingChangeKey("Player_One", GAME_ID),
    );
  });
});
