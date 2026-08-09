import { describe, expect, it } from "vitest";
import { PLAYER_TWO } from "@poe2/rules";

import {
  activeGame,
  finishedGame,
  playedGame,
  timedOutGame,
  USER_ONE,
  USER_TWO,
  waitingGame,
} from "../../test/fakes.ts";
import { describeStanding, marginReadout, moveGate, opponentOf, seatOf } from "./game-state.ts";

const THIRD_PARTY = { id: "0f0f0f0f-0000-4000-8000-000000000000", username: "Nobody" };

describe("seatOf", () => {
  it("finds the viewer's seat, and reports none for anyone else", () => {
    const game = activeGame();

    expect(seatOf(game, USER_ONE)).toBe(1);
    expect(seatOf(game, USER_TWO)).toBe(2);
    expect(seatOf(game, THIRD_PARTY)).toBeNull();
  });

  it("has no second seat while a lobby is still waiting", () => {
    expect(seatOf(waitingGame(), USER_TWO)).toBeNull();
    expect(opponentOf(waitingGame(), 1)).toBeNull();
  });

  it("uses creatorSeat for a waiting owner rather than the storage slot", () => {
    const game = waitingGame(undefined, USER_ONE, PLAYER_TWO);

    expect(seatOf(game, USER_ONE)).toBe(2);
    expect(opponentOf(game, 2)).toBeNull();
  });
});

describe("describeStanding", () => {
  it("says nobody has joined a waiting game", () => {
    expect(describeStanding(waitingGame(), 1).title).toBe("Waiting for a second player");
  });

  it("reads the turn from the snapshot, for both seats", () => {
    const game = activeGame();

    expect(describeStanding(game, 1).title).toBe("Your turn");
    expect(describeStanding(game, 2).title).toBe("Their turn");
  });

  it("names the opponent's last move so it need not be seen", () => {
    const game = playedGame(["d4"]);

    expect(describeStanding(game, 2).title).toBe("Your turn");
    expect(describeStanding(game, 2).detail).toContain(`${USER_ONE.username} played d4`);
  });

  it("states the result from the viewer's own side", () => {
    const game = finishedGame();

    expect(describeStanding(game, 1).title).toBe("You won by 34½");
    expect(describeStanding(game, 2).title).toBe("You lost by 34½");
  });

  it("uses a possessive opponent name when their clock expires", () => {
    expect(describeStanding(timedOutGame(), 2).detail).toContain(
      `${USER_ONE.username}'s clock expired`,
    );
    expect(describeStanding(timedOutGame(), 1).detail).toContain("Your clock expired");
  });
});

describe("moveGate", () => {
  it("allows a move only when the snapshot, the seat and the connection all agree", () => {
    expect(moveGate(activeGame(), 1, true, false)).toStrictEqual({ allowed: true, reason: null });
  });

  it("refuses in a fixed order, so the most fundamental reason is the one shown", () => {
    expect(moveGate(waitingGame(), 1, true, false).reason).toContain("other seat");
    expect(moveGate(finishedGame(), 1, true, false).reason).toContain("over");
    expect(moveGate(activeGame(), 1, false, false).reason).toContain("live connection");
    expect(moveGate(activeGame(), 2, true, false).reason).toContain("not your turn");
    expect(moveGate(activeGame(), 1, true, true).reason).toContain("confirm");
  });
});

describe("marginReadout", () => {
  it("counts the handicap, so an even board still has Player 2 ahead", () => {
    const readout = marginReadout({ playerOne: 10, playerTwo: 10 });

    expect(readout.leader).toBe(2);
    expect(readout.lead).toBe("5½");
  });

  it("gives Player 1 the lead only past six raw points", () => {
    expect(marginReadout({ playerOne: 16, playerTwo: 10 }).leader).toBe(1);
    expect(marginReadout({ playerOne: 15, playerTwo: 10 }).leader).toBe(2);
    expect(marginReadout({ playerOne: 16, playerTwo: 10 }).lead).toBe("½");
  });
});
